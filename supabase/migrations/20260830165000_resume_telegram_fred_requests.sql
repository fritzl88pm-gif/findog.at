-- Make Telegram's at-least-once queue resume one durable Fred request instead
-- of reopening its terminal lifecycle. The ingress context is frozen on the
-- first call; deterministic retries may carry newer chat settings, but those
-- must never change the original request.

-- Runtime RPCs must not receive broad SELECT rights on Supabase's auth.users
-- table. This narrow definer helper exposes only an existence check while
-- retaining the row-level KEY SHARE lock until the caller transaction ends.
create function public.lock_existing_findog_account(p_client_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_client_id is null then
    raise exception 'findog account lock id is required' using errcode = '22023';
  end if;

  perform 1
  from auth.users as account
  where account.id = p_client_id
  for key share;

  return found;
end;
$$;

alter function public.lock_existing_findog_account(uuid) owner to postgres;

alter table public.fred_request_ledger
  add column web_search_enabled boolean not null default false,
  add column pro_mode_enabled boolean not null default false,
  add column ingress_context_recorded boolean not null default false;

-- A durable chunk claim closes the gap between queue-lease ownership and the
-- external Telegram send. An inherited pending row has an unknowable outcome
-- during a rolling deploy, so preserve the no-duplicate invariant by making
-- it uncertain before lease ownership is introduced.
update public.telegram_deliveries
set status = 'uncertain',
    last_error_code = 'DELIVERY_LEASE_MIGRATION',
    updated_at = now()
where status = 'pending';

alter table public.telegram_deliveries
  add column delivery_lease_id uuid null;

-- No terminal queue row may retain a retry-looking delivery claim. This also
-- covers conversation/account deletion and any future terminal RPC: a pending
-- external call has an unknowable outcome and must become uncertain, while all
-- answer content is redacted from the delivery ledger.
create function public.normalize_terminal_telegram_deliveries()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.telegram_deliveries
  set status = case when status = 'pending' then 'uncertain' else status end,
      last_error_code = case
        when status = 'pending' then coalesce(last_error_code, 'QUEUE_TERMINAL_PENDING')
        else last_error_code
      end,
      message_content = '',
      updated_at = now()
  where update_id = new.id;

  return new;
end;
$$;

create trigger telegram_updates_normalize_terminal_deliveries
after update of status on public.telegram_updates
for each row
when (
  old.status is distinct from new.status
  and new.status in ('completed', 'cancelled', 'failed')
)
execute function public.normalize_terminal_telegram_deliveries();

create function public.claim_telegram_delivery_chunk(
  p_update_id bigint,
  p_chunk_index integer,
  p_lease_id uuid,
  p_message_content text
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  delivery public.telegram_deliveries%rowtype;
  update_cancel_requested boolean;
begin
  if p_update_id is null
    or p_chunk_index is null
    or p_chunk_index < 0
    or p_lease_id is null
    or p_message_content is null
    or char_length(p_message_content) not between 1 and 500000
  then
    raise exception 'telegram delivery claim fields are invalid' using errcode = '22023';
  end if;

  select cancel_requested into update_cancel_requested
  from public.telegram_updates
  where id = p_update_id
    and status = 'processing'
    and lease_id = p_lease_id
    and lease_expires_at > now()
  for update;

  if not found then
    return 'lease_lost';
  end if;
  if update_cancel_requested then
    update public.telegram_updates
    set status = 'cancelled',
        lease_id = null,
        lease_expires_at = null,
        raw_update = '{}'::jsonb,
        cancelled_at = now(),
        updated_at = now()
    where id = p_update_id
      and status = 'processing'
      and lease_id = p_lease_id;

    if not found then
      return 'lease_lost';
    end if;
    return 'cancelled';
  end if;

  select * into delivery
  from public.telegram_deliveries
  where update_id = p_update_id
    and chunk_index = p_chunk_index
  for update;

  if not found then
    insert into public.telegram_deliveries (
      update_id,
      chunk_index,
      message_content,
      status,
      delivery_lease_id
    ) values (
      p_update_id,
      p_chunk_index,
      p_message_content,
      'pending',
      p_lease_id
    );
    return 'claimed';
  end if;

  if delivery.message_content is distinct from p_message_content then
    raise exception 'telegram delivery chunk content mismatch' using errcode = '23505';
  end if;

  if delivery.status = 'sent' then
    return 'sent';
  end if;
  if delivery.status = 'uncertain' then
    return 'uncertain';
  end if;
  if delivery.status = 'pending' then
    if delivery.delivery_lease_id = p_lease_id then
      return 'claimed';
    end if;

    update public.telegram_deliveries
    set status = 'uncertain',
        last_error_code = 'DELIVERY_LEASE_CHANGED',
        updated_at = now()
    where id = delivery.id;
    return 'uncertain';
  end if;

  update public.telegram_deliveries
  set status = 'pending',
      delivery_lease_id = p_lease_id,
      telegram_message_id = null,
      sent_at = null,
      last_error_code = null,
      updated_at = now()
  where id = delivery.id;
  return 'claimed';
end;
$$;

-- Linearize /stop against the durable delivery claim on the same queue-row
-- lock. If a current-lease chunk is already pending, the external send has
-- started and /stop must report that it was too late instead of promising a
-- cancellation. Otherwise cancel_requested is committed before any later
-- claim can pass its own locked check.
create or replace function public.request_cancel_telegram_update_for_chat(
  p_integration_id uuid,
  p_telegram_chat_id bigint,
  p_exclude_update_id bigint default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target public.telegram_updates%rowtype;
begin
  if p_integration_id is null or p_telegram_chat_id is null then
    raise exception 'telegram cancel-request payload fields are invalid' using errcode = '22023';
  end if;

  select * into target
  from public.telegram_updates as telegram_update
  where telegram_update.integration_id = p_integration_id
    and telegram_update.telegram_chat_id = p_telegram_chat_id
    and telegram_update.status = 'processing'
    and (p_exclude_update_id is null or telegram_update.id <> p_exclude_update_id)
  order by telegram_update.created_at, telegram_update.id
  limit 1
  for update;

  if not found then
    return false;
  end if;

  if exists (
    select 1
    from public.telegram_deliveries as delivery
    where delivery.update_id = target.id
      and delivery.status = 'pending'
      and delivery.delivery_lease_id = target.lease_id
  ) then
    return false;
  end if;

  update public.telegram_updates
  set cancel_requested = true,
      updated_at = now()
  where id = target.id
    and status = 'processing'
    and lease_id = target.lease_id;

  return found;
end;
$$;

-- A retry decision and a concurrent /stop request must serialize on the queue
-- row. When cancellation already won, keep the active lease in place so the
-- worker can first settle the deterministic Fred receipt and then use the
-- ordinary lease-checked cancel transition. Returning `retried` means /stop
-- can no longer flag this row because it is already in retry state.
create function public.retry_or_cancel_telegram_update(
  p_update_id bigint,
  p_lease_id uuid,
  p_retry_delay_seconds integer default 0,
  p_last_error_code varchar(64) default null
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target public.telegram_updates%rowtype;
begin
  if p_update_id is null or p_lease_id is null
    or p_retry_delay_seconds < 0 or p_retry_delay_seconds > 86400
  then
    raise exception 'telegram retry payload fields are invalid' using errcode = '22023';
  end if;

  select * into target
  from public.telegram_updates as telegram_update
  where telegram_update.id = p_update_id
    and telegram_update.status = 'processing'
    and telegram_update.lease_id = p_lease_id
  for update;

  if not found then
    return 'lease_lost';
  end if;

  if target.cancel_requested then
    return 'cancel_requested';
  end if;

  update public.telegram_updates
  set status = 'retry',
      lease_id = null,
      lease_expires_at = null,
      available_at = now() + (p_retry_delay_seconds || ' seconds')::interval,
      last_error_code = coalesce(p_last_error_code, last_error_code),
      updated_at = now()
  where id = target.id
    and status = 'processing'
    and lease_id = target.lease_id;

  if not found then
    return 'lease_lost';
  end if;
  return 'retried';
end;
$$;

-- Reclaim cancellation or exhausted-attempt cleanup after a worker crash. The
-- old claim excluded these retry rows forever. A cleanup claim preserves
-- attempt_count; cancel cleanup settles the receipt before any external call,
-- while exhausted work gets one deterministic reconciliation/terminal pass.
create or replace function public.claim_pending_telegram_updates(
  p_lease_id uuid,
  p_lease_seconds integer default 60,
  p_limit integer default 10
)
returns setof public.telegram_updates
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_lease_id is null
    or p_lease_seconds < 1 or p_lease_seconds > 3600
    or p_limit < 1 or p_limit > 100
  then
    raise exception 'telegram claim payload fields are invalid' using errcode = '22023';
  end if;

  update public.telegram_updates
  set status = 'retry',
      lease_id = null,
      lease_expires_at = null,
      available_at = now(),
      updated_at = now()
  where status = 'processing'
    and lease_expires_at <= now();

  return query
  with candidates as (
    select distinct on (telegram_update.integration_id, telegram_update.telegram_chat_id)
      telegram_update.id,
      telegram_update.created_at,
      telegram_update.cancel_requested as is_cancel_cleanup,
      (
        telegram_update.cancel_requested
        or telegram_update.attempt_count >= telegram_update.max_attempts
      ) as is_terminal_cleanup,
      (
        telegram_update.update_kind = 'command'
        and pg_catalog.btrim(coalesce(telegram_update.raw_update #>> '{message,text}', ''))
          ~* '^/stop(@[a-z][a-z0-9_]{0,31})?([[:space:]].*)?$'
      ) as is_stop
    from public.telegram_updates as telegram_update
    where telegram_update.status in ('pending', 'retry')
      and telegram_update.available_at <= now()
      and (
        telegram_update.cancel_requested
        or (
          telegram_update.update_kind = 'command'
          and pg_catalog.btrim(coalesce(telegram_update.raw_update #>> '{message,text}', ''))
            ~* '^/stop(@[a-z][a-z0-9_]{0,31})?([[:space:]].*)?$'
        )
        or not exists (
          select 1
          from public.telegram_updates as busy
          where busy.integration_id = telegram_update.integration_id
            and busy.telegram_chat_id = telegram_update.telegram_chat_id
            and busy.status = 'processing'
        )
      )
    order by
      telegram_update.integration_id,
      telegram_update.telegram_chat_id,
      is_terminal_cleanup desc,
      is_cancel_cleanup desc,
      is_stop desc,
      telegram_update.created_at
  ),
  claimed as (
    select queued_update.id
    from public.telegram_updates as queued_update
    join candidates as candidate on candidate.id = queued_update.id
    order by
      candidate.is_terminal_cleanup desc,
      candidate.is_cancel_cleanup desc,
      candidate.is_stop desc,
      queued_update.created_at
    limit p_limit
    for update of queued_update skip locked
  )
  update public.telegram_updates as queued_update
  set status = 'processing',
      lease_id = p_lease_id,
      lease_expires_at = now() + (p_lease_seconds || ' seconds')::interval,
      attempt_count = case
        when queued_update.cancel_requested then queued_update.attempt_count
        when queued_update.attempt_count >= queued_update.max_attempts
          then queued_update.max_attempts + 1
        else queued_update.attempt_count + 1
      end,
      updated_at = now()
  from claimed
  where queued_update.id = claimed.id
  returning queued_update.*;
end;
$$;

create function public.finish_telegram_delivery_chunk(
  p_update_id bigint,
  p_chunk_index integer,
  p_lease_id uuid,
  p_status text,
  p_telegram_message_id bigint default null,
  p_last_error_code text default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  delivery public.telegram_deliveries%rowtype;
begin
  if p_update_id is null
    or p_chunk_index is null
    or p_chunk_index < 0
    or p_lease_id is null
    or p_status not in ('sent', 'uncertain', 'failed')
    or (p_status = 'sent' and p_telegram_message_id is null)
    or (p_last_error_code is not null and char_length(p_last_error_code) > 64)
  then
    raise exception 'telegram delivery finish fields are invalid' using errcode = '22023';
  end if;

  select * into delivery
  from public.telegram_deliveries
  where update_id = p_update_id
    and chunk_index = p_chunk_index
  for update;

  if not found or delivery.delivery_lease_id is distinct from p_lease_id then
    return false;
  end if;

  if delivery.status = 'sent' then
    return p_status = 'sent';
  end if;

  -- Once the external outcome is uncertain, only a confirmed Telegram
  -- message id may strengthen it to sent; never downgrade it to retryable.
  if delivery.status = 'uncertain' and p_status <> 'sent' then
    return true;
  end if;

  update public.telegram_deliveries
  set status = p_status,
      telegram_message_id = case
        when p_status = 'sent' then p_telegram_message_id
        else null
      end,
      sent_at = case when p_status = 'sent' then now() else null end,
      last_error_code = case
        when p_status = 'sent' then null
        else p_last_error_code
      end,
      updated_at = now()
  where id = delivery.id;

  return true;
end;
$$;

update public.fred_request_ledger as receipt
set web_search_enabled = message.web_search_enabled,
    pro_mode_enabled = message.pro_mode_enabled,
    ingress_context_recorded = true
from public.fred_messages as message
where message.id = receipt.user_message_id
  and message.client_id = receipt.client_id
  and message.role = 'user'
  and message.bridge_event_id = receipt.user_event_id;

update public.fred_request_ledger
set ingress_context_recorded = true
where status <> 'received'
  and not ingress_context_recorded;

-- Bridge persistence and a terminal worker decision serialize on the same
-- receipt. A late worker may not add or attach a deterministic event after
-- that request was failed, cancelled, or privacy-redacted.
create function public.guard_terminal_fred_request_bridge_event()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  receipt public.fred_request_ledger%rowtype;
begin
  if new.bridge_event_id is null
    or (tg_op = 'UPDATE' and new.bridge_event_id is not distinct from old.bridge_event_id)
  then
    return new;
  end if;

  select * into receipt
  from public.fred_request_ledger
  where user_event_id = new.bridge_event_id
    or assistant_event_id = new.bridge_event_id
  for update;

  if not found then
    return new;
  end if;

  if receipt.content_deleted_at is not null
    or receipt.status in ('completed', 'failed', 'cancelled')
  then
    raise exception 'fred bridge event belongs to a terminal request'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

create trigger fred_messages_guard_terminal_bridge_event
before insert or update of bridge_event_id on public.fred_messages
for each row
execute function public.guard_terminal_fred_request_bridge_event();

create or replace function public.create_fred_request_receipt(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request_id_value uuid;
  client_id_value uuid;
  origin_value text;
  telegram_update_id_value bigint;
  update_row_id_value bigint;
  lease_id_value uuid;
  agent_key_value text;
  user_event_id_value uuid;
  assistant_event_id_value uuid;
  conversation_id_value uuid;
  web_search_enabled_value boolean;
  pro_mode_enabled_value boolean;
  content_value text;
  content_sha256_value text;
  locked_conversation_id uuid;
  channel_id_value text;
  session_id_value text;
  telegram_update public.telegram_updates%rowtype;
  receipt public.fred_request_ledger%rowtype;
begin
  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'fred request receipt payload must be an object' using errcode = '22023';
  end if;

  if (payload ? 'web_search_enabled'
      and jsonb_typeof(payload -> 'web_search_enabled') is distinct from 'boolean')
    or (payload ? 'pro_mode_enabled'
      and jsonb_typeof(payload -> 'pro_mode_enabled') is distinct from 'boolean')
  then
    raise exception 'fred request receipt mode fields are invalid' using errcode = '22023';
  end if;

  request_id_value := (payload ->> 'request_id')::uuid;
  client_id_value := (payload ->> 'client_id')::uuid;
  origin_value := btrim(payload ->> 'origin');
  telegram_update_id_value := nullif(payload ->> 'telegram_update_id', '')::bigint;
  update_row_id_value := nullif(payload ->> 'telegram_update_row_id', '')::bigint;
  lease_id_value := nullif(payload ->> 'telegram_lease_id', '')::uuid;
  agent_key_value := btrim(payload ->> 'agent_key');
  user_event_id_value := (payload ->> 'user_event_id')::uuid;
  assistant_event_id_value := (payload ->> 'assistant_event_id')::uuid;
  conversation_id_value := nullif(payload ->> 'conversation_id', '')::uuid;
  web_search_enabled_value := coalesce((payload ->> 'web_search_enabled')::boolean, false);
  pro_mode_enabled_value := coalesce((payload ->> 'pro_mode_enabled')::boolean, false);
  content_value := btrim(payload ->> 'content');
  content_sha256_value := encode(
    extensions.digest(convert_to(content_value, 'UTF8'), 'sha256'),
    'hex'
  );

  if origin_value not in ('web', 'telegram')
    or agent_key_value not in ('fred', 'quickfred')
    or user_event_id_value = assistant_event_id_value
    or char_length(content_value) not between 1 and 500000
    or (
      origin_value = 'web'
      and (
        telegram_update_id_value is not null
        or update_row_id_value is not null
        or lease_id_value is not null
      )
    )
    or (
      origin_value = 'telegram'
      and (
        telegram_update_id_value is null
        or update_row_id_value is null
        or lease_id_value is null
        or telegram_update_id_value <> update_row_id_value
      )
    )
  then
    raise exception 'fred request receipt fields are invalid' using errcode = '22023';
  end if;

  -- The account row is first in every create/delete lock hierarchy. Besides
  -- preventing an FK race, this keeps account deletion from owning the account
  -- while waiting on a provider session or queue row held below.
  if not public.lock_existing_findog_account(client_id_value) then
    raise exception 'fred request client does not exist' using errcode = '23503';
  end if;

  if conversation_id_value is not null then
    select
      conversation.weknora_channel_id,
      conversation.weknora_session_id
    into channel_id_value, session_id_value
    from public.fred_conversations as conversation
    where conversation.id = conversation_id_value
      and conversation.client_id = client_id_value
      and conversation.agent_key = agent_key_value;

    if not found then
      raise exception 'fred request conversation ownership mismatch' using errcode = '42501';
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended('fred:' || channel_id_value || ':' || session_id_value, 0)
    );

    -- Revalidate after taking the provider-session lock, then retain a weak row
    -- lock until every receipt FK write has completed.
    select conversation.id into locked_conversation_id
    from public.fred_conversations as conversation
    where conversation.id = conversation_id_value
      and conversation.client_id = client_id_value
      and conversation.agent_key = agent_key_value
      and conversation.weknora_channel_id = channel_id_value
      and conversation.weknora_session_id = session_id_value
    for key share;

    if not found then
      raise exception 'fred request conversation changed during lock acquisition'
        using errcode = '40001';
    end if;
  end if;

  if origin_value = 'telegram' then
    select queued_update.* into telegram_update
    from public.telegram_updates as queued_update
    join public.telegram_integrations as integration
      on integration.id = queued_update.integration_id
    where queued_update.id = update_row_id_value
      and integration.client_id = client_id_value
    for update of queued_update;

    if not found
      or telegram_update.status is distinct from 'processing'
      or telegram_update.lease_id is distinct from lease_id_value
      or telegram_update.lease_expires_at is null
      or telegram_update.lease_expires_at <= now()
    then
      return 'false'::jsonb;
    end if;
  end if;

  insert into public.fred_request_ledger (
    id,
    client_id,
    origin,
    telegram_update_id,
    agent_key,
    user_event_id,
    assistant_event_id,
    request_content,
    request_content_sha256,
    conversation_id,
    web_search_enabled,
    pro_mode_enabled,
    ingress_context_recorded
  ) values (
    request_id_value,
    client_id_value,
    origin_value,
    telegram_update_id_value,
    agent_key_value,
    user_event_id_value,
    assistant_event_id_value,
    content_value,
    content_sha256_value,
    conversation_id_value,
    web_search_enabled_value,
    pro_mode_enabled_value,
    true
  )
  on conflict (id) do nothing;

  select * into receipt
  from public.fred_request_ledger
  where id = request_id_value
  for update;

  if receipt.client_id is distinct from client_id_value
    or receipt.origin is distinct from origin_value
    or receipt.telegram_update_id is distinct from telegram_update_id_value
    or receipt.agent_key is distinct from agent_key_value
    or receipt.user_event_id is distinct from user_event_id_value
    or receipt.assistant_event_id is distinct from assistant_event_id_value
    or (
      receipt.content_deleted_at is null
      and receipt.request_content_sha256 is distinct from content_sha256_value
    )
  then
    raise exception 'fred request receipt id reuse mismatch' using errcode = '23505';
  end if;

  -- Receipts that predate this migration did not freeze modes or a possible
  -- existing conversation at ingress. Fill that context once, then preserve it.
  if not receipt.ingress_context_recorded then
    update public.fred_request_ledger
    set conversation_id = coalesce(receipt.conversation_id, conversation_id_value),
        web_search_enabled = web_search_enabled_value,
        pro_mode_enabled = pro_mode_enabled_value,
        ingress_context_recorded = true
    where id = receipt.id
    returning * into receipt;
  end if;

  return jsonb_build_object(
    'request_id', receipt.id,
    'user_event_id', receipt.user_event_id,
    'assistant_event_id', receipt.assistant_event_id,
    'status', receipt.status,
    'received_at', receipt.received_at
  );
end;
$$;

-- Repeated non-terminal transitions are idempotent only when they point to
-- the exact persisted messages. Terminal states remain immutable.
create or replace function public.transition_fred_request_receipt(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request_id_value uuid;
  target_status_value text;
  conversation_id_value uuid;
  user_message_id_value bigint;
  assistant_message_id_value bigint;
  failure_phase_value text;
  error_code_value text;
  receipt public.fred_request_ledger%rowtype;
  unlocked_client_id uuid;
  session_conversation_id uuid;
  locked_conversation_id uuid;
  channel_id_value text;
  session_id_value text;
  session_lock_acquired boolean := false;
begin
  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'fred request transition payload must be an object' using errcode = '22023';
  end if;

  request_id_value := (payload ->> 'request_id')::uuid;
  target_status_value := btrim(payload ->> 'status');
  conversation_id_value := nullif(payload ->> 'conversation_id', '')::uuid;
  user_message_id_value := nullif(payload ->> 'user_message_id', '')::bigint;
  assistant_message_id_value := nullif(payload ->> 'assistant_message_id', '')::bigint;
  failure_phase_value := nullif(btrim(payload ->> 'failure_phase'), '');
  error_code_value := nullif(btrim(payload ->> 'error_code'), '');

  if target_status_value not in ('user_persisted', 'generating', 'completed', 'failed', 'cancelled')
    or (failure_phase_value is not null and failure_phase_value not in ('ingress', 'preprocessing', 'connecting', 'streaming', 'delivery'))
    or (error_code_value is not null and char_length(error_code_value) > 64)
  then
    raise exception 'fred request transition fields are invalid' using errcode = '22023';
  end if;

  -- Discover provenance without row locks, then enter the global hierarchy at
  -- auth.users before taking a provider-session or receipt lock.
  select * into receipt
  from public.fred_request_ledger
  where id = request_id_value;

  if not found then
    raise exception 'fred request receipt not found' using errcode = 'P0002';
  end if;

  unlocked_client_id := receipt.client_id;
  if not public.lock_existing_findog_account(unlocked_client_id) then
    raise exception 'fred request client does not exist' using errcode = '23503';
  end if;

  if target_status_value = 'user_persisted' and conversation_id_value is not null then
    select
      conversation.id,
      conversation.weknora_channel_id,
      conversation.weknora_session_id
    into session_conversation_id, channel_id_value, session_id_value
    from public.fred_conversations as conversation
    where conversation.id = conversation_id_value
      and conversation.client_id = unlocked_client_id;
  elsif receipt.conversation_id is not null then
    select
      conversation.id,
      conversation.weknora_channel_id,
      conversation.weknora_session_id
    into session_conversation_id, channel_id_value, session_id_value
    from public.fred_conversations as conversation
    where conversation.id = receipt.conversation_id
      and conversation.client_id = unlocked_client_id;
  else
    select
      conversation.id,
      conversation.weknora_channel_id,
      conversation.weknora_session_id
    into session_conversation_id, channel_id_value, session_id_value
    from public.fred_messages as message
    join public.fred_conversations as conversation
      on conversation.id = message.conversation_id
    where message.bridge_event_id in (receipt.user_event_id, receipt.assistant_event_id)
      and message.client_id = unlocked_client_id
    order by message.id
    limit 1;
  end if;

  if session_conversation_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('fred:' || channel_id_value || ':' || session_id_value, 0)
    );
    session_lock_acquired := true;

    select conversation.id into locked_conversation_id
    from public.fred_conversations as conversation
    where conversation.id = session_conversation_id
      and conversation.client_id = unlocked_client_id
      and conversation.weknora_channel_id = channel_id_value
      and conversation.weknora_session_id = session_id_value
    for key share;

    if not found then
      raise exception 'fred transition conversation changed during lock acquisition'
        using errcode = '40001';
    end if;
  end if;

  select * into receipt
  from public.fred_request_ledger
  where id = request_id_value
  for update;

  if not found then
    raise exception 'fred request receipt not found' using errcode = 'P0002';
  end if;

  if receipt.client_id is distinct from unlocked_client_id then
    raise exception 'fred request receipt owner changed' using errcode = '23514';
  end if;

  if receipt.content_deleted_at is not null then
    raise exception 'fred request receipt content already deleted' using errcode = '55000';
  end if;

  if receipt.status in ('completed', 'failed', 'cancelled') then
    if receipt.status <> target_status_value then
      raise exception 'fred request terminal state is immutable' using errcode = '55000';
    end if;
    return jsonb_build_object('request_id', receipt.id, 'status', receipt.status);
  end if;

  if not session_lock_acquired and (
    (
      target_status_value = 'user_persisted'
      and conversation_id_value is not null
      and exists (
        select 1 from public.fred_conversations as conversation
        where conversation.id = conversation_id_value
          and conversation.client_id = receipt.client_id
      )
    )
    or (
      receipt.conversation_id is not null
      and exists (
        select 1 from public.fred_conversations as conversation
        where conversation.id = receipt.conversation_id
          and conversation.client_id = receipt.client_id
      )
    )
    or exists (
      select 1
      from public.fred_messages as message
      join public.fred_conversations as conversation
        on conversation.id = message.conversation_id
      where message.bridge_event_id in (receipt.user_event_id, receipt.assistant_event_id)
        and message.client_id = receipt.client_id
    )
  ) then
    raise exception 'fred transition provider session discovered after receipt lock'
      using errcode = '40001';
  end if;

  if target_status_value = 'user_persisted' then
    if receipt.status not in ('received', 'user_persisted', 'generating')
      or conversation_id_value is null
      or user_message_id_value is null
      or (receipt.conversation_id is not null and receipt.conversation_id <> conversation_id_value)
      or (receipt.user_message_id is not null and receipt.user_message_id <> user_message_id_value)
      or not exists (
        select 1
        from public.fred_messages as message
        where message.id = user_message_id_value
          and message.client_id = receipt.client_id
          and message.conversation_id = conversation_id_value
          and message.role = 'user'
          and message.bridge_event_id = receipt.user_event_id
      )
    then
      raise exception 'fred user message transition mismatch' using errcode = '23514';
    end if;

    update public.fred_request_ledger
    set status = case when receipt.status = 'received' then 'user_persisted' else receipt.status end,
        conversation_id = conversation_id_value,
        user_message_id = user_message_id_value,
        user_persisted_at = coalesce(user_persisted_at, now())
    where id = receipt.id
    returning * into receipt;

  elsif target_status_value = 'generating' then
    if receipt.status not in ('user_persisted', 'generating') then
      raise exception 'fred generating transition mismatch' using errcode = '23514';
    end if;

    update public.fred_request_ledger
    set status = 'generating',
        generation_started_at = coalesce(generation_started_at, now())
    where id = receipt.id
    returning * into receipt;

  elsif target_status_value = 'completed' then
    if receipt.status not in ('user_persisted', 'generating')
      or assistant_message_id_value is null
      or not exists (
        select 1
        from public.fred_messages as message
        where message.id = assistant_message_id_value
          and message.client_id = receipt.client_id
          and message.conversation_id = receipt.conversation_id
          and message.role = 'assistant'
          and message.bridge_event_id = receipt.assistant_event_id
      )
    then
      raise exception 'fred assistant message transition mismatch' using errcode = '23514';
    end if;

    update public.fred_request_ledger
    set status = 'completed',
        assistant_message_id = assistant_message_id_value,
        terminal_at = now(),
        failure_phase = null,
        error_code = null
    where id = receipt.id
    returning * into receipt;

  else
    update public.fred_request_ledger
    set status = target_status_value,
        terminal_at = now(),
        failure_phase = failure_phase_value,
        error_code = error_code_value
    where id = receipt.id
    returning * into receipt;
  end if;

  return jsonb_build_object('request_id', receipt.id, 'status', receipt.status);
end;
$$;

-- Reconcile commits that happened immediately before a worker crash and return
-- the exact persisted answer when generation is already complete.
create function public.resume_fred_request_receipt(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request_id_value uuid;
  client_id_value uuid;
  telegram_update_id_value bigint;
  receipt public.fred_request_ledger%rowtype;
  user_message public.fred_messages%rowtype;
  assistant_message public.fred_messages%rowtype;
  session_conversation_id uuid;
  locked_conversation_id uuid;
  channel_id_value text;
  session_id_value text;
  session_lock_acquired boolean := false;
  user_found boolean := false;
  assistant_found boolean := false;
begin
  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'fred request resume payload must be an object' using errcode = '22023';
  end if;

  request_id_value := (payload ->> 'request_id')::uuid;
  client_id_value := (payload ->> 'client_id')::uuid;
  telegram_update_id_value := (payload ->> 'telegram_update_id')::bigint;

  if request_id_value is null
    or client_id_value is null
    or telegram_update_id_value is null
  then
    raise exception 'fred request resume fields are invalid' using errcode = '22023';
  end if;

  if not public.lock_existing_findog_account(client_id_value) then
    raise exception 'fred request client does not exist' using errcode = '23503';
  end if;

  select * into receipt
  from public.fred_request_ledger
  where id = request_id_value;

  if not found then
    raise exception 'fred request receipt not found' using errcode = 'P0002';
  end if;
  if receipt.client_id is distinct from client_id_value
    or receipt.origin is distinct from 'telegram'
    or receipt.telegram_update_id is distinct from telegram_update_id_value
  then
    raise exception 'fred request resume ownership mismatch' using errcode = '42501';
  end if;

  if receipt.conversation_id is not null then
    select
      conversation.id,
      conversation.weknora_channel_id,
      conversation.weknora_session_id
    into session_conversation_id, channel_id_value, session_id_value
    from public.fred_conversations as conversation
    where conversation.id = receipt.conversation_id
      and conversation.client_id = client_id_value;
  else
    select
      conversation.id,
      conversation.weknora_channel_id,
      conversation.weknora_session_id
    into session_conversation_id, channel_id_value, session_id_value
    from public.fred_messages as message
    join public.fred_conversations as conversation
      on conversation.id = message.conversation_id
    where message.bridge_event_id in (receipt.user_event_id, receipt.assistant_event_id)
      and message.client_id = client_id_value
    order by message.id
    limit 1;
  end if;

  if session_conversation_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('fred:' || channel_id_value || ':' || session_id_value, 0)
    );
    session_lock_acquired := true;

    select conversation.id into locked_conversation_id
    from public.fred_conversations as conversation
    where conversation.id = session_conversation_id
      and conversation.client_id = client_id_value
      and conversation.weknora_channel_id = channel_id_value
      and conversation.weknora_session_id = session_id_value
    for key share;

    if not found then
      raise exception 'fred resume conversation changed during lock acquisition'
        using errcode = '40001';
    end if;
  end if;

  select * into receipt
  from public.fred_request_ledger
  where id = request_id_value
  for update;

  if not found then
    raise exception 'fred request receipt not found' using errcode = 'P0002';
  end if;
  if receipt.client_id is distinct from client_id_value
    or receipt.origin is distinct from 'telegram'
    or receipt.telegram_update_id is distinct from telegram_update_id_value
  then
    raise exception 'fred request resume ownership mismatch' using errcode = '42501';
  end if;

  if receipt.content_deleted_at is not null then
    return jsonb_build_object(
      'status', receipt.status,
      'content_deleted', true,
      'web_search_enabled', receipt.web_search_enabled,
      'pro_mode_enabled', receipt.pro_mode_enabled
    );
  end if;

  select * into user_message
  from public.fred_messages as message
  where message.bridge_event_id = receipt.user_event_id
    and message.client_id = receipt.client_id;
  user_found := found;

  select * into assistant_message
  from public.fred_messages as message
  where message.bridge_event_id = receipt.assistant_event_id
    and message.client_id = receipt.client_id;
  assistant_found := found;

  if not session_lock_acquired and (
    (
      receipt.conversation_id is not null
      and exists (
        select 1 from public.fred_conversations as conversation
        where conversation.id = receipt.conversation_id
          and conversation.client_id = receipt.client_id
      )
    )
    or user_found
    or assistant_found
  ) then
    raise exception 'fred resume provider session discovered after receipt lock'
      using errcode = '40001';
  end if;

  if user_found and (
    user_message.role <> 'user'
    or (receipt.conversation_id is not null and receipt.conversation_id <> user_message.conversation_id)
    or (receipt.user_message_id is not null and receipt.user_message_id <> user_message.id)
  ) then
    raise exception 'fred request resume user provenance mismatch' using errcode = '23514';
  end if;

  if assistant_found and (
    not user_found
    or assistant_message.role <> 'assistant'
    or assistant_message.conversation_id <> user_message.conversation_id
    or (receipt.assistant_message_id is not null and receipt.assistant_message_id <> assistant_message.id)
  ) then
    raise exception 'fred request resume assistant provenance mismatch' using errcode = '23514';
  end if;

  if receipt.status in ('received', 'user_persisted', 'generating') and assistant_found then
    update public.fred_request_ledger
    set status = 'completed',
        conversation_id = user_message.conversation_id,
        user_message_id = user_message.id,
        assistant_message_id = assistant_message.id,
        user_persisted_at = coalesce(user_persisted_at, user_message.created_at),
        generation_started_at = coalesce(generation_started_at, user_message.created_at),
        terminal_at = coalesce(terminal_at, assistant_message.created_at, now()),
        failure_phase = null,
        error_code = null
    where id = receipt.id
    returning * into receipt;
  elsif receipt.status = 'received' and user_found then
    update public.fred_request_ledger
    set status = 'user_persisted',
        conversation_id = user_message.conversation_id,
        user_message_id = user_message.id,
        user_persisted_at = coalesce(user_persisted_at, user_message.created_at)
    where id = receipt.id
    returning * into receipt;
  end if;

  if receipt.status in ('user_persisted', 'generating', 'completed') and not user_found then
    raise exception 'fred request resume user message missing' using errcode = '23514';
  end if;
  if receipt.status = 'completed' and not assistant_found then
    raise exception 'fred request resume assistant message missing' using errcode = '23514';
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'status', receipt.status,
    'content_deleted', false,
    'conversation_id', coalesce(receipt.conversation_id, user_message.conversation_id),
    'user_message_id', coalesce(receipt.user_message_id, user_message.id),
    'assistant_message_id', coalesce(receipt.assistant_message_id, assistant_message.id),
    'answer', case when receipt.status = 'completed'
      then coalesce(assistant_message.display_content, assistant_message.content)
      else null
    end,
    -- The receipt is the ingress snapshot. Message metadata is checked above
    -- for provenance, but must not become a mutable source of retry settings.
    'web_search_enabled', receipt.web_search_enabled,
    'pro_mode_enabled', receipt.pro_mode_enabled
  ));
end;
$$;

-- Some terminal worker gates run before it is known whether an earlier
-- attempt already created a receipt. Resolve and lock a known provider session
-- first (the global deletion/bridge lock order), then lock the queue row and
-- verify its exact current lease before any receipt is reconciled or mutated.
create function public.transition_fred_request_receipt_if_present(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request_id_value uuid;
  update_row_id_value bigint;
  lease_id_value uuid;
  telegram_update public.telegram_updates%rowtype;
  receipt public.fred_request_ledger%rowtype;
  unlocked_client_id uuid;
  session_conversation_id uuid;
  locked_conversation_id uuid;
  channel_id_value text;
  session_id_value text;
  client_lock_acquired boolean := false;
  session_lock_acquired boolean := false;
  resume_result jsonb;
begin
  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'fred request transition payload must be an object' using errcode = '22023';
  end if;

  request_id_value := (payload ->> 'request_id')::uuid;
  update_row_id_value := (payload ->> 'telegram_update_row_id')::bigint;
  lease_id_value := (payload ->> 'telegram_lease_id')::uuid;

  if request_id_value is null
    or update_row_id_value is null
    or lease_id_value is null
  then
    raise exception 'fred optional transition lease fields are invalid' using errcode = '22023';
  end if;

  -- Resolve this without a row lock so the provider-session advisory lock stays
  -- ahead of both telegram_updates and the receipt in the global lock order.
  select * into receipt
  from public.fred_request_ledger
  where id = request_id_value;

  if found then
    unlocked_client_id := receipt.client_id;
    if not public.lock_existing_findog_account(unlocked_client_id) then
      raise exception 'fred optional transition client does not exist' using errcode = '23503';
    end if;
    client_lock_acquired := true;

    select
      conversation.id,
      conversation.weknora_channel_id,
      conversation.weknora_session_id
    into session_conversation_id, channel_id_value, session_id_value
    from public.fred_conversations as conversation
    where conversation.id = receipt.conversation_id
      and conversation.client_id = unlocked_client_id;

    if not found then
      select
        conversation.id,
        conversation.weknora_channel_id,
        conversation.weknora_session_id
      into session_conversation_id, channel_id_value, session_id_value
      from public.fred_messages as message
      join public.fred_conversations as conversation
        on conversation.id = message.conversation_id
      where message.bridge_event_id in (receipt.user_event_id, receipt.assistant_event_id)
        and message.client_id = unlocked_client_id
      order by message.id
      limit 1;
    end if;

    if session_conversation_id is not null then
      perform pg_advisory_xact_lock(
        hashtextextended('fred:' || channel_id_value || ':' || session_id_value, 0)
      );
      session_lock_acquired := true;

      select conversation.id into locked_conversation_id
      from public.fred_conversations as conversation
      where conversation.id = session_conversation_id
        and conversation.client_id = unlocked_client_id
        and conversation.weknora_channel_id = channel_id_value
        and conversation.weknora_session_id = session_id_value
      for key share;

      if not found then
        raise exception 'fred optional transition conversation changed during lock acquisition'
          using errcode = '40001';
      end if;
    end if;
  end if;

  -- This lock is the authorization boundary for every mutation below. A stale
  -- worker must not poison a receipt after another attempt has reclaimed the
  -- durable update.
  select * into telegram_update
  from public.telegram_updates
  where id = update_row_id_value
  for update;

  if not found
    or telegram_update.status is distinct from 'processing'
    or telegram_update.lease_id is distinct from lease_id_value
  then
    return jsonb_build_object('lease_valid', false, 'receipt_present', false);
  end if;

  select * into receipt
  from public.fred_request_ledger
  where id = request_id_value
  for update;

  if not found then
    -- The operation is optional: no receipt under a valid lease is a successful
    -- no-op, reported separately from lease loss in the structured result.
    return jsonb_build_object('lease_valid', true, 'receipt_present', false);
  end if;

  if receipt.origin is distinct from 'telegram'
    or receipt.telegram_update_id is distinct from update_row_id_value
    or (client_lock_acquired and receipt.client_id is distinct from unlocked_client_id)
  then
    raise exception 'fred optional transition telegram update mismatch' using errcode = '23514';
  end if;

  if not client_lock_acquired then
    raise exception 'fred optional transition receipt discovered after queue lock'
      using errcode = '40001';
  end if;

  -- A provider session may have become discoverable after the initial unlocked
  -- lookup. Never invert session -> queue by acquiring it now: abort this RPC
  -- so the next transaction resolves and locks the session first.
  if not session_lock_acquired and (
    (
      receipt.conversation_id is not null
      and exists (
        select 1
        from public.fred_conversations as conversation
        where conversation.id = receipt.conversation_id
      )
    )
    or exists (
      select 1
      from public.fred_messages as message
      join public.fred_conversations as conversation
        on conversation.id = message.conversation_id
      where message.bridge_event_id in (receipt.user_event_id, receipt.assistant_event_id)
    )
  ) then
    raise exception 'fred optional transition provider session discovered after queue lock'
      using errcode = '40001';
  end if;

  resume_result := public.resume_fred_request_receipt(jsonb_build_object(
    'request_id', receipt.id,
    'client_id', receipt.client_id,
    'telegram_update_id', receipt.telegram_update_id
  ));

  select * into receipt
  from public.fred_request_ledger
  where id = request_id_value;

  if receipt.status in ('completed', 'failed', 'cancelled') then
    return jsonb_build_object('lease_valid', true, 'receipt_present', true)
      || resume_result;
  end if;

  perform public.transition_fred_request_receipt(payload);
  resume_result := public.resume_fred_request_receipt(jsonb_build_object(
    'request_id', receipt.id,
    'client_id', receipt.client_id,
    'telegram_update_id', receipt.telegram_update_id
  ));
  return jsonb_build_object('lease_valid', true, 'receipt_present', true)
    || resume_result;
end;
$$;

revoke all on function public.lock_existing_findog_account(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.lock_existing_findog_account(uuid)
to service_role;

revoke all on function public.create_fred_request_receipt(jsonb)
from public, anon, authenticated;
grant execute on function public.create_fred_request_receipt(jsonb)
to service_role;

revoke all on function public.guard_terminal_fred_request_bridge_event()
from public, anon, authenticated, service_role;

revoke all on function public.normalize_terminal_telegram_deliveries()
from public, anon, authenticated, service_role;

revoke all on function public.claim_telegram_delivery_chunk(bigint, integer, uuid, text)
from public, anon, authenticated;
grant execute on function public.claim_telegram_delivery_chunk(bigint, integer, uuid, text)
to service_role;

revoke all on function public.finish_telegram_delivery_chunk(bigint, integer, uuid, text, bigint, text)
from public, anon, authenticated;
grant execute on function public.finish_telegram_delivery_chunk(bigint, integer, uuid, text, bigint, text)
to service_role;

revoke all on function public.request_cancel_telegram_update_for_chat(uuid, bigint, bigint)
from public, anon, authenticated;
grant execute on function public.request_cancel_telegram_update_for_chat(uuid, bigint, bigint)
to service_role;

revoke all on function public.retry_or_cancel_telegram_update(bigint, uuid, integer, varchar)
from public, anon, authenticated;
grant execute on function public.retry_or_cancel_telegram_update(bigint, uuid, integer, varchar)
to service_role;

revoke all on function public.claim_pending_telegram_updates(uuid, integer, integer)
from public, anon, authenticated;
grant execute on function public.claim_pending_telegram_updates(uuid, integer, integer)
to service_role;

revoke all on function public.transition_fred_request_receipt(jsonb)
from public, anon, authenticated;
grant execute on function public.transition_fred_request_receipt(jsonb)
to service_role;

revoke all on function public.transition_fred_request_receipt_if_present(jsonb)
from public, anon, authenticated;
grant execute on function public.transition_fred_request_receipt_if_present(jsonb)
to service_role;

revoke all on function public.resume_fred_request_receipt(jsonb)
from public, anon, authenticated;
grant execute on function public.resume_fred_request_receipt(jsonb)
to service_role;
