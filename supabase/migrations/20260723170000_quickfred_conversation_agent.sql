-- Binds each Findog conversation permanently to Fred or QuickFred.
-- Existing conversations remain Fred conversations and retain their exact
-- WeKnora channel/session provenance.
alter table public.fred_conversations
  add column agent_key text not null default 'fred',
  add column weknora_agent_id varchar(128);

alter table public.fred_conversations
  add constraint fred_conversations_agent_key
    check (agent_key in ('fred', 'quickfred')),
  add constraint fred_conversations_agent_id_format
    check (
      weknora_agent_id is null
      or weknora_agent_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
    ),
  add constraint fred_conversations_quickfred_has_agent_id
    check (agent_key = 'fred' or weknora_agent_id is not null);

create function public.prevent_fred_conversation_agent_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.agent_key is distinct from old.agent_key then
    raise exception 'fred conversation agent is immutable' using errcode = '23514';
  end if;
  if old.weknora_agent_id is not null
    and new.weknora_agent_id is distinct from old.weknora_agent_id
  then
    raise exception 'fred conversation provider agent is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger fred_conversations_agent_immutable
before update of agent_key, weknora_agent_id
on public.fred_conversations
for each row
execute function public.prevent_fred_conversation_agent_change();

revoke all on function public.prevent_fred_conversation_agent_change()
from public, anon, authenticated;

create or replace function public.record_fred_bridge_event(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  client_id_value uuid;
  channel_id_value text;
  session_id_value text;
  event_id_value uuid;
  event_type_value text;
  role_value text;
  content_value text;
  occurred_at_value timestamptz;
  agent_key_value text;
  weknora_agent_id_value text;
  conversation_row public.fred_conversations%rowtype;
  message_id_value bigint;
  webhook_row public.fred_webhook_events%rowtype;
  normalized_title text;
begin
  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'fred bridge payload must be an object' using errcode = '22023';
  end if;

  client_id_value := (payload ->> 'client_id')::uuid;
  channel_id_value := btrim(payload ->> 'channel_id');
  session_id_value := btrim(payload ->> 'session_id');
  event_id_value := (payload ->> 'event_id')::uuid;
  event_type_value := btrim(payload ->> 'event_type');
  content_value := btrim(payload ->> 'content');
  occurred_at_value := (payload ->> 'occurred_at')::timestamptz;
  agent_key_value := coalesce(nullif(btrim(payload ->> 'agent_key'), ''), 'fred');
  weknora_agent_id_value := nullif(btrim(payload ->> 'weknora_agent_id'), '');

  if channel_id_value !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
    or session_id_value !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
    or event_type_value not in ('message_sent', 'message_received')
    or char_length(content_value) not between 1 and 500000
    or occurred_at_value is null
    or agent_key_value not in ('fred', 'quickfred')
    or (
      weknora_agent_id_value is not null
      and weknora_agent_id_value !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
    )
    or (agent_key_value = 'quickfred' and weknora_agent_id_value is null)
  then
    raise exception 'fred bridge payload fields are invalid' using errcode = '22023';
  end if;

  role_value := case event_type_value
    when 'message_sent' then 'user'
    else 'assistant'
  end;

  perform pg_advisory_xact_lock(
    hashtextextended('fred:' || channel_id_value || ':' || session_id_value, 0)
  );

  delete from public.fred_webhook_events
  where processed_at is null
    and received_at < now() - interval '24 hours';

  select conversation.*
  into conversation_row
  from public.fred_conversations as conversation
  where conversation.weknora_channel_id = channel_id_value
    and conversation.weknora_session_id = session_id_value
  for update;

  if found then
    if conversation_row.client_id is distinct from client_id_value then
      raise exception 'fred conversation ownership mismatch' using errcode = '42501';
    end if;
    if conversation_row.agent_key is distinct from agent_key_value then
      raise exception 'fred conversation agent mismatch' using errcode = '23514';
    end if;
    if conversation_row.weknora_agent_id is not null
      and conversation_row.weknora_agent_id is distinct from weknora_agent_id_value
    then
      raise exception 'fred conversation provider agent mismatch' using errcode = '23514';
    end if;
    if conversation_row.weknora_agent_id is null
      and weknora_agent_id_value is not null
    then
      update public.fred_conversations
      set weknora_agent_id = weknora_agent_id_value
      where id = conversation_row.id
      returning * into conversation_row;
    end if;
  else
    normalized_title := case when role_value = 'user'
      then left(regexp_replace(content_value, E'\\s+', ' ', 'g'), 120)
      else 'Neue Fred-Unterhaltung'
    end;
    insert into public.fred_conversations (
      client_id,
      weknora_channel_id,
      weknora_session_id,
      agent_key,
      weknora_agent_id,
      title,
      created_at,
      updated_at
    ) values (
      client_id_value,
      channel_id_value,
      session_id_value,
      agent_key_value,
      weknora_agent_id_value,
      normalized_title,
      occurred_at_value,
      occurred_at_value
    )
    returning * into conversation_row;
  end if;

  select message.id
  into message_id_value
  from public.fred_messages as message
  where message.bridge_event_id = event_id_value
  for update;

  if found then
    if not exists (
      select 1
      from public.fred_messages as existing
      where existing.id = message_id_value
        and existing.conversation_id = conversation_row.id
        and existing.client_id = client_id_value
        and existing.role = role_value
        and existing.content = content_value
    ) then
      raise exception 'fred bridge event id reuse mismatch' using errcode = '23505';
    end if;
  else
    select message.id
    into message_id_value
    from public.fred_messages as message
    where message.conversation_id = conversation_row.id
      and message.client_id = client_id_value
      and message.role = role_value
      and message.content = content_value
      and message.bridge_event_id is null
      and message.webhook_event_id is not null
      and abs(extract(epoch from (
        coalesce(message.provider_created_at, message.created_at) - occurred_at_value
      ))) <= 300
    order by coalesce(message.provider_created_at, message.created_at), message.id
    limit 1
    for update;

    if found then
      update public.fred_messages
      set bridge_event_id = event_id_value
      where id = message_id_value;
    else
      insert into public.fred_messages (
        conversation_id,
        client_id,
        role,
        content,
        provider_created_at,
        bridge_event_id
      ) values (
        conversation_row.id,
        client_id_value,
        role_value,
        content_value,
        occurred_at_value,
        event_id_value
      )
      returning id into message_id_value;
    end if;
  end if;

  for webhook_row in
    select webhook.*
    from public.fred_webhook_events as webhook
    where webhook.weknora_channel_id = channel_id_value
      and webhook.weknora_session_id = session_id_value
      and webhook.processed_at is null
    order by webhook.provider_created_at, webhook.id
    for update
  loop
    select message.id
    into message_id_value
    from public.fred_messages as message
    where message.conversation_id = conversation_row.id
      and message.client_id = client_id_value
      and message.role = case webhook_row.event_type
        when 'message_sent' then 'user'
        else 'assistant'
      end
      and message.content = webhook_row.content
      and message.webhook_event_id is null
      and abs(extract(epoch from (
        coalesce(message.provider_created_at, message.created_at)
        - webhook_row.provider_created_at
      ))) <= 300
    order by coalesce(message.provider_created_at, message.created_at), message.id
    limit 1
    for update;

    if found then
      update public.fred_messages
      set webhook_event_id = webhook_row.id,
          provider_created_at = least(
            coalesce(provider_created_at, webhook_row.provider_created_at),
            webhook_row.provider_created_at
          )
      where id = message_id_value;
    else
      insert into public.fred_messages (
        conversation_id,
        client_id,
        role,
        content,
        provider_created_at,
        webhook_event_id
      ) values (
        conversation_row.id,
        client_id_value,
        case webhook_row.event_type when 'message_sent' then 'user' else 'assistant' end,
        webhook_row.content,
        webhook_row.provider_created_at,
        webhook_row.id
      );
    end if;

    update public.fred_webhook_events
    set processed_at = now(),
        conversation_id = conversation_row.id,
        client_id = client_id_value
    where id = webhook_row.id;
  end loop;

  if role_value = 'user'
    and conversation_row.title = 'Neue Fred-Unterhaltung'
  then
    normalized_title := left(regexp_replace(content_value, E'\\s+', ' ', 'g'), 120);
  else
    normalized_title := conversation_row.title;
  end if;

  update public.fred_conversations
  set title = normalized_title,
      updated_at = greatest(updated_at, occurred_at_value, now())
  where id = conversation_row.id
  returning * into conversation_row;

  return jsonb_build_object(
    'conversation_id', conversation_row.id,
    'title', conversation_row.title,
    'created_at', conversation_row.created_at,
    'updated_at', conversation_row.updated_at,
    'agent_key', conversation_row.agent_key
  );
end;
$$;
