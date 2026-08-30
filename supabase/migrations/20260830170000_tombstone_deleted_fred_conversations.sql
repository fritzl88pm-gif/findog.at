-- Permanently fence deleted Fred provider sessions so a late bridge or
-- webhook event cannot recreate user-deleted history. Tombstones retain no
-- title, message content, raw provider event, channel id, or session id.

create table public.fred_conversation_tombstones (
  conversation_id uuid primary key,
  -- Deliberately no auth.users FK: deleting an account must not remove the
  -- provider-session fence and make late webhook payloads storable again.
  client_id uuid not null,
  session_key_sha256 char(64) not null unique
    constraint fred_conversation_tombstones_session_hash_format
      check (session_key_sha256 ~ '^[0-9a-f]{64}$'),
  deleted_at timestamptz not null,
  deletion_reason text not null
    constraint fred_conversation_tombstones_reason_values
      check (deletion_reason = 'user_conversation_delete')
);

create index fred_conversation_tombstones_client_deleted_idx
  on public.fred_conversation_tombstones (client_id, deleted_at desc, conversation_id);

alter table public.fred_conversation_tombstones enable row level security;

revoke all on public.fred_conversation_tombstones
from public, anon, authenticated, service_role;
-- Runtime code only needs equality checks. Tombstone creation is confined to
-- the SECURITY DEFINER deletion RPC below.
grant select on public.fred_conversation_tombstones
to service_role;

-- Length-prefix both values and domain-separate the digest. The digest is the
-- only retained provider-session key; it is sufficient for equality checks
-- without preserving the raw channel or session identifier.
create function public.fred_conversation_session_sha256(
  p_channel_id text,
  p_session_id text
)
returns text
language sql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        'findog:fred-conversation-session:v1|' ||
        char_length(p_channel_id)::text || '|' || p_channel_id || '|' ||
        char_length(p_session_id)::text || '|' || p_session_id,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

-- Tombstones are append-only and cannot be removed through an account FK.
create function public.prevent_fred_conversation_tombstone_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'fred conversation tombstones are immutable'
    using errcode = '55000';
end;
$$;

create trigger fred_conversation_tombstones_immutable
before update or delete on public.fred_conversation_tombstones
for each row
execute function public.prevent_fred_conversation_tombstone_update();

-- A deletion-cancelled run is a terminal audit record. More generally, no
-- terminal generation run may be rewritten by a late best-effort worker
-- update after another transaction has completed, failed, or cancelled it.
create function public.prevent_terminal_fred_generation_run_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status in ('completed', 'failed', 'cancelled') then
    -- Permit only the FK-driven privacy detach performed when a referenced
    -- conversation is deleted. The existing updated_at trigger may also
    -- change updated_at; every other current or future column must stay equal.
    if old.conversation_id is not null
      and new.conversation_id is null
      and (
        to_jsonb(new) - 'conversation_id' - 'updated_at'
      ) is not distinct from (
        to_jsonb(old) - 'conversation_id' - 'updated_at'
      )
    then
      return new;
    end if;

    raise exception 'terminal fred generation runs are immutable'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

create trigger fred_generation_runs_terminal_immutable
before update on public.fred_generation_runs
for each row
execute function public.prevent_terminal_fred_generation_run_update();

-- INSERT takes the same domain-separated provider-session advisory lock as
-- record_fred_bridge_event and record_fred_webhook_event. Session updates are
-- prohibited outright: provider provenance is immutable, and allowing such an
-- update would acquire a row lock before this trigger could take the advisory
-- lock, reversing the deletion lock order.
create function public.guard_deleted_fred_conversation_session()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.weknora_channel_id is distinct from old.weknora_channel_id
      or new.weknora_session_id is distinct from old.weknora_session_id
    then
      raise exception 'fred conversation provider session is immutable'
        using errcode = '23514';
    end if;
    return new;
  end if;

  -- Account deletion already owns this row before its BEFORE DELETE trigger
  -- takes provider-session locks. Take the same lock class first for every
  -- direct conversation insert so no event path can invert that order.
  if not public.lock_existing_findog_account(new.client_id) then
    raise exception 'fred conversation client does not exist'
      using errcode = '23503';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'fred:' || new.weknora_channel_id || ':' || new.weknora_session_id,
      0
    )
  );

  if exists (
    select 1
    from public.fred_conversation_tombstones as tombstone
    where tombstone.session_key_sha256 = public.fred_conversation_session_sha256(
      new.weknora_channel_id,
      new.weknora_session_id
    )
  ) then
    raise exception 'fred conversation provider session was deleted'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

create trigger fred_conversations_reject_deleted_session_insert
before insert on public.fred_conversations
for each row
execute function public.guard_deleted_fred_conversation_session();

create trigger fred_conversations_reject_session_update
before update of weknora_channel_id, weknora_session_id
on public.fred_conversations
for each row
execute function public.guard_deleted_fred_conversation_session();

-- Keep the deployed bridge function's OID (and therefore every native-event
-- wrapper dependency) while adding the account-row fence ahead of its existing
-- provider-session lock. This is deliberately CREATE OR REPLACE rather than a
-- renamed helper: dependent SQL/PLpgSQL functions may retain an OID reference.
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

  -- Match account deletion's lock order before serializing the provider
  -- session. Holding KEY SHARE also keeps the payload owner valid through
  -- all conversation and message FK writes performed below.
  if not public.lock_existing_findog_account(client_id_value) then
    raise exception 'fred bridge client does not exist'
      using errcode = '23503';
  end if;

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

-- Preserve the existing webhook validation, deduplication, provenance, and
-- ownership behavior. The new check runs under the same advisory lock and
-- returns success without storing either content or raw_event for a deleted
-- provider session.
create or replace function public.record_fred_webhook_event(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  delivery_sha256_value text;
  client_id_value uuid;
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
  account_lock_acquired boolean := false;
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

  -- If this provider session is already attached to an account, fence account
  -- deletion before taking the session lock. A webhook for a not-yet-known
  -- session has no account FK to lock and remains a pending provider event.
  select conversation.client_id
  into client_id_value
  from public.fred_conversations as conversation
  where conversation.weknora_channel_id = channel_id_value
    and conversation.weknora_session_id = session_id_value;

  if found then
    if not public.lock_existing_findog_account(client_id_value) then
      return jsonb_build_object(
        'duplicate', false,
        'pending', false,
        'discarded', true
      );
    end if;
    account_lock_acquired := true;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('fred:' || channel_id_value || ':' || session_id_value, 0)
  );

  -- A bridge transaction may have created this conversation between the
  -- unlocked pre-read and the session lock. Never acquire its account/FK lock
  -- after the session; retry the whole RPC so the global auth -> session order
  -- is used from the start.
  if not account_lock_acquired and exists (
    select 1
    from public.fred_conversations as conversation
    where conversation.weknora_channel_id = channel_id_value
      and conversation.weknora_session_id = session_id_value
  ) then
    raise exception 'fred webhook owner discovered after session lock'
      using errcode = '40001';
  end if;

  if exists (
    select 1
    from public.fred_conversation_tombstones as tombstone
    where tombstone.session_key_sha256 = public.fred_conversation_session_sha256(
      channel_id_value,
      session_id_value
    )
  ) then
    return jsonb_build_object(
      'duplicate', false,
      'pending', false,
      'discarded', true
    );
  end if;

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

-- Acquire every provider-session advisory lock in one globally deterministic
-- order before taking any conversation row lock. Event persistence takes the
-- same lock first, so either the event commits and is then deleted or deletion
-- commits the tombstone and the stale event is rejected.
create or replace function public.delete_owned_fred_conversations(
  p_client_id uuid,
  p_conversation_ids uuid[]
)
returns table (id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  owned_conversation_ids uuid[];
  request_ids uuid[];
  telegram_update_ids bigint[];
  session_row record;
  deletion_time timestamptz := now();
begin
  if p_client_id is null
    or p_conversation_ids is null
    or cardinality(p_conversation_ids) < 1
  then
    raise exception 'fred conversation deletion parameters are invalid'
      using errcode = '22023';
  end if;

  -- Use one global lock order for normal conversation deletion and the
  -- auth.users BEFORE DELETE trigger: account row, provider session, rows.
  if not public.lock_existing_findog_account(p_client_id) then
    raise exception 'fred conversation owner does not exist'
      using errcode = '23503';
  end if;

  for session_row in
    select
      conversation.id,
      hashtextextended(
        'fred:' || conversation.weknora_channel_id || ':' || conversation.weknora_session_id,
        0
      ) as lock_key
    from public.fred_conversations as conversation
    where conversation.client_id = p_client_id
      and conversation.id = any(p_conversation_ids)
    order by lock_key, conversation.id
  loop
    perform pg_advisory_xact_lock(session_row.lock_key);
  end loop;

  perform conversation.id
  from public.fred_conversations as conversation
  where conversation.client_id = p_client_id
    and conversation.id = any(p_conversation_ids)
  order by conversation.id
  for update;

  select coalesce(array_agg(conversation.id order by conversation.id), '{}'::uuid[])
  into owned_conversation_ids
  from public.fred_conversations as conversation
  where conversation.client_id = p_client_id
    and conversation.id = any(p_conversation_ids);

  insert into public.fred_conversation_tombstones (
    conversation_id,
    client_id,
    session_key_sha256,
    deleted_at,
    deletion_reason
  )
  select
    conversation.id,
    conversation.client_id,
    public.fred_conversation_session_sha256(
      conversation.weknora_channel_id,
      conversation.weknora_session_id
    ),
    deletion_time,
    'user_conversation_delete'
  from public.fred_conversations as conversation
  where conversation.id = any(owned_conversation_ids)
  order by conversation.id;

  select
    coalesce(array_agg(receipt.id order by receipt.id), '{}'::uuid[]),
    coalesce(
      array_agg(distinct receipt.telegram_update_id order by receipt.telegram_update_id)
        filter (where receipt.telegram_update_id is not null),
      '{}'::bigint[]
    )
  into request_ids, telegram_update_ids
  from public.fred_request_ledger as receipt
  where receipt.client_id = p_client_id
    and (
      receipt.conversation_id = any(owned_conversation_ids)
      or exists (
        select 1
        from public.fred_messages as message
        where message.conversation_id = any(owned_conversation_ids)
          and message.bridge_event_id in (
            receipt.user_event_id,
            receipt.assistant_event_id
          )
      )
    );

  update public.telegram_chat_bindings as binding
  set active_conversation_id = null
  where binding.active_conversation_id = any(owned_conversation_ids);

  -- Clear queued and leased raw input in the deletion transaction. A late
  -- worker transition fails closed because the row is terminal and lease-less.
  update public.telegram_updates as telegram_update
  set status = 'cancelled',
      cancel_requested = true,
      lease_id = null,
      lease_expires_at = null,
      raw_update = '{}'::jsonb,
      last_error_code = 'CONVERSATION_DELETED',
      cancelled_at = deletion_time,
      updated_at = deletion_time
  where telegram_update.id = any(telegram_update_ids)
    and telegram_update.status in ('pending', 'retry', 'processing');

  update public.fred_generation_runs as generation_run
  set status = 'cancelled',
      conversation_id = null,
      completed_at = coalesce(generation_run.completed_at, deletion_time)
  where generation_run.client_id = p_client_id
    and generation_run.status in ('preprocessing', 'connecting', 'streaming')
    and (
      generation_run.conversation_id = any(owned_conversation_ids)
      or generation_run.request_id = any(request_ids)
    );

  delete from public.admin_request_history as audit
  where audit.user_id = p_client_id
    and audit.conversation_id = any(owned_conversation_ids);

  update public.telegram_deliveries
  set message_content = '',
      updated_at = deletion_time
  where update_id = any(telegram_update_ids)
    and message_content <> '';

  -- Cancel every active receipt, preserve already terminal outcomes, redact its
  -- content, and detach all message/conversation FKs before cascade deletion.
  -- A prior quality-batch reason remains the original content-deletion reason.
  update public.fred_request_ledger as receipt
  set status = case
        when receipt.status in ('received', 'user_persisted', 'generating') then 'cancelled'
        else receipt.status
      end,
      failure_phase = case receipt.status
        when 'received' then 'ingress'
        when 'user_persisted' then 'connecting'
        when 'generating' then 'streaming'
        else receipt.failure_phase
      end,
      error_code = case
        when receipt.status in ('received', 'user_persisted', 'generating')
          then 'conversation_deleted'
        else receipt.error_code
      end,
      terminal_at = case
        when receipt.status in ('received', 'user_persisted', 'generating')
          then deletion_time
        else receipt.terminal_at
      end,
      request_content = null,
      request_content_sha256 = null,
      content_deleted_at = coalesce(receipt.content_deleted_at, deletion_time),
      content_deletion_reason = coalesce(
        receipt.content_deletion_reason,
        'user_conversation_delete'
      ),
      conversation_id = null,
      user_message_id = null,
      assistant_message_id = null
  where receipt.client_id = p_client_id
    and receipt.id = any(request_ids);

  -- Pending rows are not attached to the conversation and therefore would not
  -- be removed by its FK cascade. Delete them while the session lock is held.
  delete from public.fred_webhook_events as webhook
  using public.fred_conversations as conversation
  where conversation.id = any(owned_conversation_ids)
    and webhook.weknora_channel_id = conversation.weknora_channel_id
    and webhook.weknora_session_id = conversation.weknora_session_id
    and webhook.processed_at is null;

  return query
  delete from public.fred_conversations as conversation
  where conversation.client_id = p_client_id
    and conversation.id = any(owned_conversation_ids)
  returning conversation.id;
end;
$$;

-- Auth deletion would otherwise cascade directly into fred_conversations and
-- bypass the tombstone fence. Run the same privacy-complete deletion path for
-- every owned Fred conversation before any auth.users cascade starts. The HTTP
-- bulk endpoint still enforces its 100-item request limit; this database path
-- intentionally accepts the owner's complete history atomically.
create function public.tombstone_fred_conversations_before_user_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  conversation_ids uuid[];
begin
  select coalesce(array_agg(conversation.id order by conversation.id), '{}'::uuid[])
  into conversation_ids
  from public.fred_conversations as conversation
  where conversation.client_id = old.id;

  if cardinality(conversation_ids) > 0 then
    perform public.delete_owned_fred_conversations(old.id, conversation_ids);
  end if;

  return old;
end;
$$;

create trigger auth_users_tombstone_fred_conversations
before delete on auth.users
for each row
execute function public.tombstone_fred_conversations_before_user_delete();

revoke all on function public.fred_conversation_session_sha256(text, text)
from public, anon, authenticated, service_role;
grant execute on function public.fred_conversation_session_sha256(text, text)
to service_role;

revoke all on function public.prevent_fred_conversation_tombstone_update()
from public, anon, authenticated, service_role;

revoke all on function public.prevent_terminal_fred_generation_run_update()
from public, anon, authenticated, service_role;

revoke all on function public.guard_deleted_fred_conversation_session()
from public, anon, authenticated, service_role;

revoke all on function public.record_fred_webhook_event(jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.record_fred_webhook_event(jsonb)
to service_role;

revoke all on function public.record_fred_bridge_event(jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.record_fred_bridge_event(jsonb)
to service_role;

revoke all on function public.delete_owned_fred_conversations(uuid, uuid[])
from public, anon, authenticated, service_role;
grant execute on function public.delete_owned_fred_conversations(uuid, uuid[])
to service_role;

revoke all on function public.tombstone_fred_conversations_before_user_delete()
from public, anon, authenticated, service_role;
grant execute on function public.tombstone_fred_conversations_before_user_delete()
to service_role;

-- Both confirmation gates must reject NULL and malformed hashes explicitly.
-- SQL's three-valued comparison would otherwise let a NULL expected hash pass
-- the original mismatch branch.
create or replace function public.mark_fred_quality_review_batch_reviewed(
  p_batch_id uuid,
  p_expected_set_sha256 text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  batch public.fred_quality_review_batches%rowtype;
  candidate_ids uuid[];
  candidate_hash text;
  expected_set_sha256 text;
begin
  if p_batch_id is null
    or p_expected_set_sha256 is null
    or btrim(p_expected_set_sha256) !~ '^[0-9A-Fa-f]{64}$'
  then
    raise exception 'fred quality batch review hash is invalid' using errcode = '22023';
  end if;

  expected_set_sha256 := lower(btrim(p_expected_set_sha256));

  select * into batch
  from public.fred_quality_review_batches
  where id = p_batch_id
  for update;

  if not found or batch.status not in ('awaiting_review', 'pending_confirmation') then
    raise exception 'fred quality batch cannot be marked reviewed' using errcode = '55000';
  end if;

  select coalesce(array_agg(receipt.id order by receipt.id), '{}'::uuid[])
  into candidate_ids
  from public.fred_request_ledger as receipt
  where receipt.quality_batch_id = batch.id
    and receipt.content_deleted_at is null;

  candidate_hash := encode(
    extensions.digest(
      convert_to(coalesce(array_to_string(candidate_ids, ','), ''), 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  if batch.candidate_count is distinct from cardinality(candidate_ids)
    or batch.candidate_set_sha256 is distinct from candidate_hash
    or batch.candidate_set_sha256 is distinct from expected_set_sha256
  then
    raise exception 'fred quality batch review hash mismatch' using errcode = '22023';
  end if;

  if batch.status = 'awaiting_review' then
    update public.fred_quality_review_batches
    set status = 'pending_confirmation',
        reviewed_at = now()
    where id = batch.id
    returning * into batch;
  end if;

  return jsonb_build_object(
    'batch_id', batch.id,
    'candidate_count', batch.candidate_count,
    'candidate_set_sha256', batch.candidate_set_sha256,
    'status', batch.status,
    'reviewed_at', batch.reviewed_at
  );
end;
$$;

-- Confirmed QA cleanup preserves the user's conversation and messages. It
-- enters the same global lock hierarchy as request persistence and deletion:
-- every account, every provider session, every conversation, Telegram queue
-- rows, and only then the frozen receipt set. All snapshots are revalidated
-- under those locks before any QA content is removed.
create or replace function public.delete_confirmed_fred_quality_batch(
  p_batch_id uuid,
  p_expected_set_sha256 text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  batch public.fred_quality_review_batches%rowtype;
  candidate_ids uuid[];
  revalidated_candidate_ids uuid[];
  account_ids uuid[];
  revalidated_account_ids uuid[];
  conversation_ids uuid[];
  locked_conversation_ids uuid[] := '{}'::uuid[];
  revalidated_conversation_ids uuid[];
  telegram_update_ids bigint[];
  locked_telegram_update_ids bigint[] := '{}'::bigint[];
  revalidated_telegram_update_ids bigint[];
  locked_candidate_ids uuid[] := '{}'::uuid[];
  candidate_hash text;
  expected_set_sha256 text;
  account_id_value uuid;
  session_row record;
  conversation_row record;
  telegram_update_row record;
  receipt_row record;
  deleted_admin_count bigint;
  preserved_message_count bigint;
  cleared_delivery_count bigint;
  redacted_receipt_count bigint;
  updated_batch_count bigint;
  deletion_time timestamptz := now();
begin
  if p_batch_id is null
    or p_expected_set_sha256 is null
    or btrim(p_expected_set_sha256) !~ '^[0-9A-Fa-f]{64}$'
  then
    raise exception 'fred quality batch confirmation hash is invalid' using errcode = '22023';
  end if;

  expected_set_sha256 := lower(btrim(p_expected_set_sha256));

  select * into batch
  from public.fred_quality_review_batches
  where id = p_batch_id
  for update;

  if not found or batch.status is distinct from 'pending_confirmation' then
    raise exception 'fred quality batch is not pending confirmation' using errcode = '55000';
  end if;

  select coalesce(array_agg(receipt.id order by receipt.id), '{}'::uuid[])
  into candidate_ids
  from public.fred_request_ledger as receipt
  where receipt.quality_batch_id = batch.id
    and receipt.content_deleted_at is null;

  candidate_hash := encode(
    extensions.digest(
      convert_to(coalesce(array_to_string(candidate_ids, ','), ''), 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  if batch.candidate_count is distinct from cardinality(candidate_ids)
    or batch.candidate_set_sha256 is distinct from candidate_hash
    or batch.candidate_set_sha256 is distinct from expected_set_sha256
  then
    raise exception 'fred quality batch confirmation hash mismatch' using errcode = '22023';
  end if;

  select coalesce(array_agg(linked.conversation_id order by linked.conversation_id), '{}'::uuid[])
  into conversation_ids
  from (
    select receipt.conversation_id
    from public.fred_request_ledger as receipt
    where receipt.id = any(candidate_ids)
      and receipt.conversation_id is not null
    union
    select message.conversation_id
    from public.fred_request_ledger as receipt
    join public.fred_messages as message
      on message.bridge_event_id in (receipt.user_event_id, receipt.assistant_event_id)
    where receipt.id = any(candidate_ids)
  ) as linked;

  select coalesce(
    array_agg(distinct receipt.telegram_update_id order by receipt.telegram_update_id)
      filter (where receipt.telegram_update_id is not null),
    '{}'::bigint[]
  )
  into telegram_update_ids
  from public.fred_request_ledger as receipt
  where receipt.id = any(candidate_ids);

  select coalesce(array_agg(owner.client_id order by owner.client_id), '{}'::uuid[])
  into account_ids
  from (
    select receipt.client_id
    from public.fred_request_ledger as receipt
    where receipt.id = any(candidate_ids)
    union
    select conversation.client_id
    from public.fred_conversations as conversation
    where conversation.id = any(conversation_ids)
    union
    select integration.client_id
    from public.telegram_updates as telegram_update
    join public.telegram_integrations as integration
      on integration.id = telegram_update.integration_id
    where telegram_update.id = any(telegram_update_ids)
  ) as owner
  where owner.client_id is not null;

  foreach account_id_value in array account_ids
  loop
    if not public.lock_existing_findog_account(account_id_value) then
      raise exception 'fred quality batch account changed during lock acquisition'
        using errcode = '40001';
    end if;
  end loop;

  for session_row in
    select
      conversation.id,
      hashtextextended(
        'fred:' || conversation.weknora_channel_id || ':' || conversation.weknora_session_id,
        0
      ) as lock_key
    from public.fred_conversations as conversation
    where conversation.id = any(conversation_ids)
    order by lock_key, conversation.id
  loop
    perform pg_advisory_xact_lock(session_row.lock_key);
  end loop;

  for conversation_row in
    select conversation.id
    from public.fred_conversations as conversation
    where conversation.id = any(conversation_ids)
    order by conversation.id
    for key share
  loop
    locked_conversation_ids := array_append(
      locked_conversation_ids,
      conversation_row.id
    );
  end loop;

  if locked_conversation_ids is distinct from conversation_ids then
    raise exception 'fred quality batch conversations changed during lock acquisition'
      using errcode = '40001';
  end if;

  -- Queue rows precede receipts in every Telegram transition. Keeping that
  -- order also lets us reject a completed receipt whose answer has not yet
  -- reached Telegram without introducing a receipt-to-queue deadlock.
  for telegram_update_row in
    select telegram_update.id
    from public.telegram_updates as telegram_update
    where telegram_update.id = any(telegram_update_ids)
    order by telegram_update.id
    for update
  loop
    locked_telegram_update_ids := array_append(
      locked_telegram_update_ids,
      telegram_update_row.id
    );
  end loop;

  if locked_telegram_update_ids is distinct from telegram_update_ids then
    raise exception 'fred quality batch telegram updates changed during lock acquisition'
      using errcode = '40001';
  end if;

  for receipt_row in
    select receipt.id
    from public.fred_request_ledger as receipt
    where receipt.id = any(candidate_ids)
    order by receipt.id
    for update
  loop
    locked_candidate_ids := array_append(locked_candidate_ids, receipt_row.id);
  end loop;

  if locked_candidate_ids is distinct from candidate_ids then
    raise exception 'fred quality batch receipts changed during lock acquisition'
      using errcode = '40001';
  end if;

  select coalesce(array_agg(receipt.id order by receipt.id), '{}'::uuid[])
  into revalidated_candidate_ids
  from public.fred_request_ledger as receipt
  where receipt.quality_batch_id = batch.id
    and receipt.content_deleted_at is null;

  if revalidated_candidate_ids is distinct from candidate_ids then
    raise exception 'fred quality batch candidate set changed during lock acquisition'
      using errcode = '40001';
  end if;

  candidate_hash := encode(
    extensions.digest(
      convert_to(coalesce(array_to_string(revalidated_candidate_ids, ','), ''), 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  if batch.candidate_count is distinct from cardinality(revalidated_candidate_ids)
    or batch.candidate_set_sha256 is distinct from candidate_hash
    or batch.candidate_set_sha256 is distinct from expected_set_sha256
  then
    raise exception 'fred quality batch confirmation changed during lock acquisition'
      using errcode = '40001';
  end if;

  select coalesce(array_agg(linked.conversation_id order by linked.conversation_id), '{}'::uuid[])
  into revalidated_conversation_ids
  from (
    select receipt.conversation_id
    from public.fred_request_ledger as receipt
    where receipt.id = any(revalidated_candidate_ids)
      and receipt.conversation_id is not null
    union
    select message.conversation_id
    from public.fred_request_ledger as receipt
    join public.fred_messages as message
      on message.bridge_event_id in (receipt.user_event_id, receipt.assistant_event_id)
    where receipt.id = any(revalidated_candidate_ids)
  ) as linked;

  if revalidated_conversation_ids is distinct from conversation_ids then
    raise exception 'fred quality batch conversation set changed during lock acquisition'
      using errcode = '40001';
  end if;

  select coalesce(
    array_agg(distinct receipt.telegram_update_id order by receipt.telegram_update_id)
      filter (where receipt.telegram_update_id is not null),
    '{}'::bigint[]
  )
  into revalidated_telegram_update_ids
  from public.fred_request_ledger as receipt
  where receipt.id = any(revalidated_candidate_ids);

  if revalidated_telegram_update_ids is distinct from telegram_update_ids then
    raise exception 'fred quality batch telegram update set changed during lock acquisition'
      using errcode = '40001';
  end if;

  select coalesce(array_agg(owner.client_id order by owner.client_id), '{}'::uuid[])
  into revalidated_account_ids
  from (
    select receipt.client_id
    from public.fred_request_ledger as receipt
    where receipt.id = any(revalidated_candidate_ids)
    union
    select conversation.client_id
    from public.fred_conversations as conversation
    where conversation.id = any(revalidated_conversation_ids)
    union
    select integration.client_id
    from public.telegram_updates as telegram_update
    join public.telegram_integrations as integration
      on integration.id = telegram_update.integration_id
    where telegram_update.id = any(revalidated_telegram_update_ids)
  ) as owner
  where owner.client_id is not null;

  if revalidated_account_ids is distinct from account_ids then
    raise exception 'fred quality batch account set changed during lock acquisition'
      using errcode = '40001';
  end if;

  if exists (
    select 1
    from public.fred_request_ledger as receipt
    where receipt.id = any(revalidated_candidate_ids)
      and receipt.status not in ('completed', 'failed', 'cancelled')
  ) then
    raise exception 'fred quality batch still contains active requests' using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.telegram_updates as telegram_update
    where telegram_update.id = any(revalidated_telegram_update_ids)
      and telegram_update.status in ('pending', 'retry', 'processing')
  ) then
    raise exception 'fred quality batch still contains undelivered telegram requests'
      using errcode = '55000';
  end if;

  select count(*)
  into preserved_message_count
  from public.fred_messages as message
  where message.id in (
    select receipt.user_message_id
    from public.fred_request_ledger as receipt
    where receipt.id = any(revalidated_candidate_ids)
      and receipt.user_message_id is not null
    union
    select receipt.assistant_message_id
    from public.fred_request_ledger as receipt
    where receipt.id = any(revalidated_candidate_ids)
      and receipt.assistant_message_id is not null
  );

  delete from public.admin_request_history as audit
  where audit.request_id = any(revalidated_candidate_ids);
  get diagnostics deleted_admin_count = row_count;

  update public.telegram_deliveries as delivery
  set message_content = ''
  where delivery.update_id = any(revalidated_telegram_update_ids)
    and delivery.message_content <> '';
  get diagnostics cleared_delivery_count = row_count;

  update public.fred_request_ledger as receipt
  set request_content = null,
      request_content_sha256 = null,
      content_deleted_at = deletion_time,
      content_deletion_reason = 'quality_batch'
  where receipt.id = any(revalidated_candidate_ids)
    and receipt.quality_batch_id = batch.id
    and receipt.content_deleted_at is null
    and receipt.content_deletion_reason is null;
  get diagnostics redacted_receipt_count = row_count;

  if redacted_receipt_count is distinct from cardinality(revalidated_candidate_ids)::bigint then
    raise exception 'fred quality batch receipt redaction count changed'
      using errcode = '40001';
  end if;

  update public.fred_quality_review_batches as quality_batch
  set status = 'deleted',
      deleted_at = deletion_time
  where quality_batch.id = batch.id
    and quality_batch.status = 'pending_confirmation';
  get diagnostics updated_batch_count = row_count;

  if updated_batch_count is distinct from 1::bigint then
    raise exception 'fred quality batch status changed during deletion'
      using errcode = '40001';
  end if;

  return jsonb_build_object(
    'batch_id', batch.id,
    'candidate_count', cardinality(revalidated_candidate_ids),
    'candidate_set_sha256', candidate_hash,
    'deleted_admin_requests', deleted_admin_count,
    'deleted_messages', 0,
    'preserved_user_messages', preserved_message_count,
    'cleared_telegram_deliveries', cleared_delivery_count,
    'deleted_at', deletion_time
  );
end;
$$;

revoke all on function public.mark_fred_quality_review_batch_reviewed(uuid, text)
from public, anon, authenticated;
grant execute on function public.mark_fred_quality_review_batch_reviewed(uuid, text)
to service_role;

revoke all on function public.delete_confirmed_fred_quality_batch(uuid, text)
from public, anon, authenticated;
grant execute on function public.delete_confirmed_fred_quality_batch(uuid, text)
to service_role;
