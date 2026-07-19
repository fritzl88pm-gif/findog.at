-- Stores user-scoped WeKnora embed history with bridge and webhook provenance.
create table public.fred_conversations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references auth.users(id) on delete cascade,
  weknora_channel_id varchar(128) not null,
  weknora_session_id varchar(128) not null,
  title varchar(120) not null default 'Neue Fred-Unterhaltung',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fred_conversations_channel_session_unique
    unique (weknora_channel_id, weknora_session_id),
  constraint fred_conversations_id_client_unique
    unique (id, client_id),
  constraint fred_conversations_channel_format
    check (weknora_channel_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  constraint fred_conversations_session_format
    check (weknora_session_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$')
);

create index fred_conversations_client_updated_idx
  on public.fred_conversations (client_id, updated_at desc, id desc);

create table public.fred_webhook_events (
  id bigserial primary key,
  delivery_sha256 char(64) not null unique,
  weknora_channel_id varchar(128) not null,
  weknora_session_id varchar(128) not null,
  event_type text not null check (event_type in ('message_sent', 'message_received')),
  content text not null check (char_length(content) between 1 and 500000),
  provider_created_at timestamptz not null,
  raw_event jsonb not null check (jsonb_typeof(raw_event) = 'object'),
  signature_verified boolean not null default true check (signature_verified),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  conversation_id uuid,
  client_id uuid,
  constraint fred_webhook_events_delivery_hash_format
    check (delivery_sha256 ~ '^[0-9a-f]{64}$'),
  constraint fred_webhook_events_channel_format
    check (weknora_channel_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  constraint fred_webhook_events_session_format
    check (weknora_session_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  constraint fred_webhook_events_conversation_owner_fk
    foreign key (conversation_id, client_id)
    references public.fred_conversations(id, client_id)
    on delete cascade,
  constraint fred_webhook_events_processing_scope
    check (
      (processed_at is null and conversation_id is null and client_id is null)
      or (processed_at is not null and conversation_id is not null and client_id is not null)
    )
);

create index fred_webhook_events_pending_session_idx
  on public.fred_webhook_events (
    weknora_channel_id,
    weknora_session_id,
    provider_created_at,
    id
  )
  where processed_at is null;

create table public.fred_messages (
  id bigserial primary key,
  conversation_id uuid not null,
  client_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 500000),
  provider_created_at timestamptz,
  bridge_event_id uuid unique,
  webhook_event_id bigint unique references public.fred_webhook_events(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint fred_messages_conversation_owner_fk
    foreign key (conversation_id, client_id)
    references public.fred_conversations(id, client_id)
    on delete cascade,
  constraint fred_messages_has_provenance
    check (bridge_event_id is not null or webhook_event_id is not null)
);

create index fred_messages_conversation_created_idx
  on public.fred_messages (conversation_id, provider_created_at, created_at, id);

alter table public.fred_conversations enable row level security;
alter table public.fred_webhook_events enable row level security;
alter table public.fred_messages enable row level security;

revoke all on table
  public.fred_conversations,
  public.fred_webhook_events,
  public.fred_messages
from anon, authenticated;

revoke all on sequence
  public.fred_webhook_events_id_seq,
  public.fred_messages_id_seq
from anon, authenticated;

grant usage on schema public to service_role;
grant select, insert, update, delete on table
  public.fred_conversations,
  public.fred_webhook_events,
  public.fred_messages
to service_role;
grant usage, select on sequence
  public.fred_webhook_events_id_seq,
  public.fred_messages_id_seq
to service_role;

create function public.record_fred_bridge_event(payload jsonb)
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

  if channel_id_value !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
    or session_id_value !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
    or event_type_value not in ('message_sent', 'message_received')
    or char_length(content_value) not between 1 and 500000
    or occurred_at_value is null
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
  else
    normalized_title := case when role_value = 'user'
      then left(regexp_replace(content_value, E'\\s+', ' ', 'g'), 120)
      else 'Neue Fred-Unterhaltung'
    end;
    insert into public.fred_conversations (
      client_id,
      weknora_channel_id,
      weknora_session_id,
      title,
      created_at,
      updated_at
    ) values (
      client_id_value,
      channel_id_value,
      session_id_value,
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
    'updated_at', conversation_row.updated_at
  );
end;
$$;

create function public.record_fred_webhook_event(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  delivery_sha256_value text;
  channel_id_value text;
  session_id_value text;
  event_type_value text;
  role_value text;
  content_value text;
  provider_created_at_value timestamptz;
  raw_event_value jsonb;
  webhook_row public.fred_webhook_events%rowtype;
  conversation_row public.fred_conversations%rowtype;
  message_id_value bigint;
begin
  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'fred webhook payload must be an object' using errcode = '22023';
  end if;

  delivery_sha256_value := btrim(payload ->> 'delivery_sha256');
  channel_id_value := btrim(payload ->> 'channel_id');
  session_id_value := btrim(payload ->> 'session_id');
  event_type_value := btrim(payload ->> 'event_type');
  content_value := btrim(payload ->> 'content');
  provider_created_at_value := (payload ->> 'provider_created_at')::timestamptz;
  raw_event_value := payload -> 'raw_event';

  if delivery_sha256_value !~ '^[0-9a-f]{64}$'
    or channel_id_value !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
    or session_id_value !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
    or event_type_value not in ('message_sent', 'message_received')
    or char_length(content_value) not between 1 and 500000
    or provider_created_at_value is null
    or jsonb_typeof(raw_event_value) is distinct from 'object'
  then
    raise exception 'fred webhook payload fields are invalid' using errcode = '22023';
  end if;

  role_value := case event_type_value when 'message_sent' then 'user' else 'assistant' end;

  perform pg_advisory_xact_lock(
    hashtextextended('fred:' || channel_id_value || ':' || session_id_value, 0)
  );

  delete from public.fred_webhook_events
  where processed_at is null
    and received_at < now() - interval '24 hours';

  insert into public.fred_webhook_events (
    delivery_sha256,
    weknora_channel_id,
    weknora_session_id,
    event_type,
    content,
    provider_created_at,
    raw_event
  ) values (
    delivery_sha256_value,
    channel_id_value,
    session_id_value,
    event_type_value,
    content_value,
    provider_created_at_value,
    raw_event_value
  )
  on conflict (delivery_sha256) do nothing;

  select webhook.*
  into webhook_row
  from public.fred_webhook_events as webhook
  where webhook.delivery_sha256 = delivery_sha256_value
  for update;

  if webhook_row.processed_at is not null then
    return jsonb_build_object(
      'duplicate', true,
      'pending', false,
      'conversation_id', webhook_row.conversation_id
    );
  end if;

  select conversation.*
  into conversation_row
  from public.fred_conversations as conversation
  where conversation.weknora_channel_id = channel_id_value
    and conversation.weknora_session_id = session_id_value
  for update;

  if not found then
    return jsonb_build_object('duplicate', false, 'pending', true);
  end if;

  select message.id
  into message_id_value
  from public.fred_messages as message
  where message.conversation_id = conversation_row.id
    and message.client_id = conversation_row.client_id
    and message.role = role_value
    and message.content = content_value
    and message.webhook_event_id is null
    and abs(extract(epoch from (
      coalesce(message.provider_created_at, message.created_at)
      - provider_created_at_value
    ))) <= 300
  order by coalesce(message.provider_created_at, message.created_at), message.id
  limit 1
  for update;

  if found then
    update public.fred_messages
    set webhook_event_id = webhook_row.id,
        provider_created_at = least(
          coalesce(provider_created_at, provider_created_at_value),
          provider_created_at_value
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
      conversation_row.client_id,
      role_value,
      content_value,
      provider_created_at_value,
      webhook_row.id
    );
  end if;

  update public.fred_webhook_events
  set processed_at = now(),
      conversation_id = conversation_row.id,
      client_id = conversation_row.client_id
  where id = webhook_row.id;

  update public.fred_conversations
  set title = case
        when role_value = 'user' and title = 'Neue Fred-Unterhaltung'
          then left(regexp_replace(content_value, E'\\s+', ' ', 'g'), 120)
        else title
      end,
      updated_at = greatest(updated_at, provider_created_at_value, now())
  where id = conversation_row.id
  returning * into conversation_row;

  return jsonb_build_object(
    'duplicate', false,
    'pending', false,
    'conversation_id', conversation_row.id
  );
end;
$$;

revoke all on function public.record_fred_bridge_event(jsonb)
from public, anon, authenticated;
grant execute on function public.record_fred_bridge_event(jsonb)
to service_role;

revoke all on function public.record_fred_webhook_event(jsonb)
from public, anon, authenticated;
grant execute on function public.record_fred_webhook_event(jsonb)
to service_role;
