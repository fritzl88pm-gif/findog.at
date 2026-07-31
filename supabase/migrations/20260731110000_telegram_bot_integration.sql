-- Telegram bot integration: encrypted credentials, chat bindings,
-- durable update queue, and delivery ledger.
-- All tables are service_role only (RLS enabled, anon/authenticated revoked).

-- 1. telegram_integrations ------------------------------------------------
create table public.telegram_integrations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references auth.users(id) on delete cascade,
  bot_user_id bigint not null,
  bot_username text not null,
  encrypted_token text not null,
  webhook_id uuid not null default gen_random_uuid(),
  webhook_secret_sha256 char(64) not null,
  pairing_token_sha256 char(64),
  pairing_expires_at timestamptz,
  paired_telegram_user_id bigint,
  paired_telegram_chat_id bigint,
  status text not null default 'awaiting_pairing'
    check (status in ('awaiting_pairing', 'active', 'disconnecting', 'error')),
  last_error_code integer,
  last_error_description text,
  last_error_retry_after integer,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint telegram_integrations_bot_user_unique unique (bot_user_id),
  constraint telegram_integrations_client_unique unique (client_id),
  constraint telegram_integrations_webhook_unique unique (webhook_id),
  constraint telegram_integrations_bot_username_format
    check (bot_username ~ '^[A-Za-z][A-Za-z0-9_]{1,28}[Bb][Oo][Tt]$'),
  constraint telegram_integrations_encrypted_token_not_empty
    check (char_length(encrypted_token) > 0),
  constraint telegram_integrations_pairing_fields_consistency
    check (
      (pairing_token_sha256 is null and pairing_expires_at is null)
      or (pairing_token_sha256 is not null and pairing_expires_at is not null)
    ),
  constraint telegram_integrations_paired_fields_consistency
    check (
      (paired_telegram_user_id is null and paired_telegram_chat_id is null)
      or (paired_telegram_user_id is not null and paired_telegram_chat_id is not null)
    )
);

create index telegram_integrations_webhook_idx
  on public.telegram_integrations (webhook_id);

-- 2. telegram_chat_bindings ------------------------------------------------
create table public.telegram_chat_bindings (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null
    references public.telegram_integrations(id) on delete cascade,
  telegram_chat_id bigint not null,
  active_conversation_id uuid null
    references public.fred_conversations(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint telegram_chat_bindings_integration_chat_unique
    unique (integration_id, telegram_chat_id)
);

create index telegram_chat_bindings_active_conversation_idx
  on public.telegram_chat_bindings (active_conversation_id)
  where active_conversation_id is not null;

-- 3. telegram_updates (durable queue) --------------------------------------
create table public.telegram_updates (
  id bigserial primary key,
  integration_id uuid not null
    references public.telegram_integrations(id) on delete cascade,
  update_id bigint not null,
  raw_update jsonb not null
    check (jsonb_typeof(raw_update) = 'object'),
  telegram_chat_id bigint not null,
  telegram_message_id bigint,
  update_kind text not null default 'message'
    check (update_kind in ('message', 'command', 'my_chat_member', 'other')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'retry', 'failed', 'cancelled')),
  lease_id uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  available_at timestamptz not null default now(),
  cancel_requested boolean not null default false,
  last_error_code varchar(64),
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint telegram_updates_integration_update_unique
    unique (integration_id, update_id),
  constraint telegram_updates_raw_cleared_on_terminal
    check (
      status in ('pending', 'processing', 'retry')
      or raw_update = '{}'::jsonb
    )
);

create index telegram_updates_pending_idx
  on public.telegram_updates (integration_id, created_at)
  where status = 'pending';

create index telegram_updates_retry_idx
  on public.telegram_updates (integration_id, updated_at)
  where status = 'retry';

create index telegram_updates_lease_idx
  on public.telegram_updates (lease_id)
  where lease_id is not null;

create index telegram_updates_chat_processing_idx
  on public.telegram_updates (integration_id, telegram_chat_id)
  where status = 'processing';

-- 4. telegram_deliveries ---------------------------------------------------
create table public.telegram_deliveries (
  id bigserial primary key,
  update_id bigint not null
    references public.telegram_updates(id) on delete cascade,
  chunk_index integer not null default 0,
  message_content text not null check (char_length(message_content) between 0 and 500000),
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'uncertain', 'failed')),
  telegram_message_id bigint,
  sent_at timestamptz,
  last_error_code varchar(64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint telegram_deliveries_update_chunk_unique
    unique (update_id, chunk_index)
);

create index telegram_deliveries_pending_idx
  on public.telegram_deliveries (update_id)
  where status = 'pending';

-- 5. Alter fred_conversations: add origin and telegram_integration_id ------
alter table public.fred_conversations
  add column origin text not null default 'web'
    check (origin in ('web', 'telegram')),
  add column telegram_integration_id uuid
    references public.telegram_integrations(id) on delete set null;

create index fred_conversations_telegram_integration_idx
  on public.fred_conversations (telegram_integration_id)
  where telegram_integration_id is not null;

-- 6. RLS: enable, revoke anon/authenticated, grant service_role -------------
alter table public.telegram_integrations enable row level security;
alter table public.telegram_chat_bindings enable row level security;
alter table public.telegram_updates enable row level security;
alter table public.telegram_deliveries enable row level security;

revoke all on table
  public.telegram_integrations,
  public.telegram_chat_bindings,
  public.telegram_updates,
  public.telegram_deliveries
from public, anon, authenticated;

revoke all on sequence
  public.telegram_updates_id_seq,
  public.telegram_deliveries_id_seq
from public, anon, authenticated;

grant usage on schema public to service_role;
grant select, insert, update, delete on table
  public.telegram_integrations,
  public.telegram_chat_bindings,
  public.telegram_updates,
  public.telegram_deliveries
to service_role;

grant usage, select on sequence
  public.telegram_updates_id_seq,
  public.telegram_deliveries_id_seq
to service_role;

-- 7. RPC: enqueue_telegram_update (idempotent enqueue) ---------------------
create function public.enqueue_telegram_update(
  p_integration_id uuid,
  p_update_id bigint,
  p_raw_update jsonb,
  p_telegram_chat_id bigint,
  p_telegram_message_id bigint default null,
  p_update_kind text default 'message'
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id bigint;
  v_status text;
  v_queued_question_count bigint;
begin
  if p_integration_id is null or p_update_id is null
    or p_raw_update is null
    or jsonb_typeof(p_raw_update) is distinct from 'object'
    or p_telegram_chat_id is null
    or p_update_kind not in ('message', 'command', 'my_chat_member', 'other')
  then
    raise exception 'telegram enqueue payload fields are invalid' using errcode = '22023';
  end if;

  if p_update_kind = 'message' then
    -- Serialize admission for this tenant+chat. Counting processing work as
    -- outstanding also prevents a concurrent retry transition from making
    -- the durable question backlog exceed five.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        p_integration_id::text || ':' || p_telegram_chat_id::text,
        0
      )
    );

    -- Dedupe precedes capacity checks so a retried webhook acknowledgement
    -- receives the original durable row instead of a spurious Busy response.
    select id, status
    into v_id, v_status
    from public.telegram_updates
    where integration_id = p_integration_id
      and update_id = p_update_id;

    if found then
      return jsonb_build_object('id', v_id, 'status', v_status);
    end if;

    select count(*)
    into v_queued_question_count
    from public.telegram_updates
    where integration_id = p_integration_id
      and telegram_chat_id = p_telegram_chat_id
      and update_kind = 'message'
      and status in ('pending', 'processing', 'retry');

    if v_queued_question_count >= 5 then
      return jsonb_build_object('id', null, 'status', 'busy');
    end if;
  end if;

  insert into public.telegram_updates (
    integration_id, update_id, raw_update,
    telegram_chat_id, telegram_message_id, update_kind
  )
  values (
    p_integration_id, p_update_id, p_raw_update,
    p_telegram_chat_id, p_telegram_message_id, p_update_kind
  )
  on conflict (integration_id, update_id) do nothing
  returning id, status into v_id, v_status;

  if not found then
    select id, status
    into v_id, v_status
    from public.telegram_updates
    where integration_id = p_integration_id
      and update_id = p_update_id;
  end if;

  return jsonb_build_object('id', v_id, 'status', v_status);
end;
$$;

revoke all on function public.enqueue_telegram_update(uuid, bigint, jsonb, bigint, bigint, text)
from public, anon, authenticated;
grant execute on function public.enqueue_telegram_update(uuid, bigint, jsonb, bigint, bigint, text)
to service_role;

-- 7b. RPC: pair_telegram_integration (atomic pairing) -----------------------
create function public.pair_telegram_integration(
  p_integration_id uuid,
  p_pairing_hash char(64),
  p_telegram_user_id bigint,
  p_telegram_chat_id bigint
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_updated boolean;
begin
  if p_integration_id is null or p_pairing_hash is null
    or p_telegram_user_id is null or p_telegram_chat_id is null
  then
    raise exception 'pair parameters are invalid' using errcode = '22023';
  end if;

  with updated as (
    update public.telegram_integrations
    set status = 'active',
        pairing_token_sha256 = null,
        pairing_expires_at = null,
        paired_telegram_user_id = p_telegram_user_id,
        paired_telegram_chat_id = p_telegram_chat_id,
        updated_at = now()
    where id = p_integration_id
      and status = 'awaiting_pairing'
      and pairing_token_sha256 = p_pairing_hash
      and pairing_expires_at > now()
    returning id
  )
  select exists(select 1 from updated) into v_updated;

  return v_updated;
end;
$$;

revoke all on function public.pair_telegram_integration(uuid, char, bigint, bigint)
from public, anon, authenticated;
grant execute on function public.pair_telegram_integration(uuid, char, bigint, bigint)
to service_role;

-- 8. RPC: claim_pending_telegram_updates (SKIP LOCKED claim with retry/expired-reclaim) ---------------
-- Claims globally across all integrations. Normal work remains strictly
-- serialized per chat, while a syntactically valid /stop command may be
-- claimed beside the in-flight question it needs to cancel.
create function public.claim_pending_telegram_updates(
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

  -- Reclaim expired processing leases first, across all integrations.
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
    select distinct on (t.integration_id, t.telegram_chat_id)
      t.id,
      t.created_at,
      (
        t.update_kind = 'command'
        and pg_catalog.btrim(coalesce(t.raw_update #>> '{message,text}', ''))
          ~* '^/stop(@[a-z][a-z0-9_]{0,31})?([[:space:]].*)?$'
      ) as is_stop
    from public.telegram_updates t
    where t.status in ('pending', 'retry')
      and t.available_at <= now()
      and t.cancel_requested = false
      and t.attempt_count < t.max_attempts
      and (
        (
          t.update_kind = 'command'
          and pg_catalog.btrim(coalesce(t.raw_update #>> '{message,text}', ''))
            ~* '^/stop(@[a-z][a-z0-9_]{0,31})?([[:space:]].*)?$'
        )
        or not exists (
          select 1
          from public.telegram_updates busy
          where busy.integration_id = t.integration_id
            and busy.telegram_chat_id = t.telegram_chat_id
            and busy.status = 'processing'
        )
      )
    order by t.integration_id, t.telegram_chat_id, is_stop desc, t.created_at
  ),
  claimed as (
    select u.id
    from public.telegram_updates u
    join candidates c on c.id = u.id
    order by c.is_stop desc, u.created_at
    limit p_limit
    for update of u skip locked
  )
  update public.telegram_updates u
  set status = 'processing',
      lease_id = p_lease_id,
      lease_expires_at = now() + (p_lease_seconds || ' seconds')::interval,
      attempt_count = u.attempt_count + 1,
      updated_at = now()
  from claimed c
  where u.id = c.id
  returning u.*;
end;
$$;

revoke all on function public.claim_pending_telegram_updates(uuid, integer, integer)
from public, anon, authenticated;
grant execute on function public.claim_pending_telegram_updates(uuid, integer, integer)
to service_role;

-- 9. RPC: heartbeat_telegram_update ----------------------------------------
create function public.heartbeat_telegram_update(
  p_update_id bigint,
  p_lease_id uuid,
  p_lease_seconds integer default 60
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_update_id is null or p_lease_id is null
    or p_lease_seconds < 1 or p_lease_seconds > 3600
  then
    raise exception 'telegram heartbeat payload fields are invalid' using errcode = '22023';
  end if;

  update public.telegram_updates
  set lease_expires_at = now() + (p_lease_seconds || ' seconds')::interval,
      updated_at = now()
  where id = p_update_id
    and status = 'processing'
    and lease_id = p_lease_id;

  return found;
end;
$$;

revoke all on function public.heartbeat_telegram_update(bigint, uuid, integer)
from public, anon, authenticated;
grant execute on function public.heartbeat_telegram_update(bigint, uuid, integer)
to service_role;

-- 10. RPC: complete_telegram_update ----------------------------------------
create function public.complete_telegram_update(
  p_update_id bigint,
  p_lease_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_updated boolean;
begin
  if p_update_id is null or p_lease_id is null then
    raise exception 'telegram complete payload fields are invalid' using errcode = '22023';
  end if;

  update public.telegram_updates
  set status = 'completed',
      lease_id = null,
      lease_expires_at = null,
      raw_update = '{}'::jsonb,
      updated_at = now()
  where id = p_update_id
    and status = 'processing'
    and lease_id = p_lease_id;

  v_updated := found;
  if v_updated then
    update public.telegram_deliveries
    set message_content = '',
        updated_at = now()
    where update_id = p_update_id;
  end if;

  return v_updated;
end;
$$;

revoke all on function public.complete_telegram_update(bigint, uuid)
from public, anon, authenticated;
grant execute on function public.complete_telegram_update(bigint, uuid)
to service_role;

-- 11. RPC: retry_telegram_update (bounded retry delay, sets available_at) ---
create function public.retry_telegram_update(
  p_update_id bigint,
  p_lease_id uuid,
  p_retry_delay_seconds integer default 0,
  p_last_error_code varchar(64) default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_update_id is null or p_lease_id is null
    or p_retry_delay_seconds < 0 or p_retry_delay_seconds > 86400
  then
    raise exception 'telegram retry payload fields are invalid' using errcode = '22023';
  end if;

  update public.telegram_updates
  set status = 'retry',
      lease_id = null,
      lease_expires_at = null,
      available_at = now() + (p_retry_delay_seconds || ' seconds')::interval,
      last_error_code = coalesce(p_last_error_code, last_error_code),
      updated_at = now()
  where id = p_update_id
    and status = 'processing'
    and lease_id = p_lease_id;

  return found;
end;
$$;

revoke all on function public.retry_telegram_update(bigint, uuid, integer, varchar)
from public, anon, authenticated;
grant execute on function public.retry_telegram_update(bigint, uuid, integer, varchar)
to service_role;

-- 12. RPC: cancel_telegram_update ------------------------------------------
create function public.cancel_telegram_update(
  p_update_id bigint,
  p_lease_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_updated boolean;
begin
  if p_update_id is null or p_lease_id is null then
    raise exception 'telegram cancel payload fields are invalid' using errcode = '22023';
  end if;

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

  v_updated := found;
  if v_updated then
    update public.telegram_deliveries
    set message_content = '',
        updated_at = now()
    where update_id = p_update_id;
  end if;

  return v_updated;
end;
$$;

revoke all on function public.cancel_telegram_update(bigint, uuid)
from public, anon, authenticated;
grant execute on function public.cancel_telegram_update(bigint, uuid)
to service_role;

-- 13. RPC: cancel_all_telegram_updates_for_integration ---------------------
create function public.cancel_all_telegram_updates_for_integration(
  p_integration_id uuid
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count bigint;
begin
  if p_integration_id is null then
    raise exception 'telegram cancel-all payload fields are invalid' using errcode = '22023';
  end if;

  with cancelled as (
    update public.telegram_updates
    set status = 'cancelled',
        lease_id = null,
        lease_expires_at = null,
        raw_update = '{}'::jsonb,
        cancelled_at = now(),
        updated_at = now()
    where integration_id = p_integration_id
      and status in ('pending', 'processing', 'retry')
    returning id
  )
  select count(*) into v_count from cancelled;

  update public.telegram_deliveries
  set message_content = '',
      updated_at = now()
  where update_id in (
    select id
    from public.telegram_updates
    where integration_id = p_integration_id
      and status in ('completed', 'failed', 'cancelled')
  );

  return v_count;
end;
$$;

revoke all on function public.cancel_all_telegram_updates_for_integration(uuid)
from public, anon, authenticated;
grant execute on function public.cancel_all_telegram_updates_for_integration(uuid)
to service_role;

-- 14. RPC: fail_telegram_update (mark as failed, clear raw_update) ---------
create function public.fail_telegram_update(
  p_update_id bigint,
  p_lease_id uuid,
  p_last_error_code varchar(64) default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_updated boolean;
begin
  if p_update_id is null or p_lease_id is null then
    raise exception 'telegram fail payload fields are invalid' using errcode = '22023';
  end if;

  update public.telegram_updates
  set status = 'failed',
      lease_id = null,
      lease_expires_at = null,
      raw_update = '{}'::jsonb,
      last_error_code = coalesce(p_last_error_code, last_error_code),
      updated_at = now()
  where id = p_update_id
    and status = 'processing'
    and lease_id = p_lease_id;

  v_updated := found;
  if v_updated then
    update public.telegram_deliveries
    set message_content = '',
        updated_at = now()
    where update_id = p_update_id;
  end if;

  return v_updated;
end;
$$;

revoke all on function public.fail_telegram_update(bigint, uuid, varchar)
from public, anon, authenticated;
grant execute on function public.fail_telegram_update(bigint, uuid, varchar)
to service_role;

-- 15. RPC: request_cancel_telegram_update_for_chat -------------------------
-- Used by the /stop command handler to request cancellation of whichever
-- other update is currently being processed for the same integration+chat
-- (the /stop update itself is excluded via p_exclude_update_id).
create function public.request_cancel_telegram_update_for_chat(
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
  v_found boolean;
begin
  if p_integration_id is null or p_telegram_chat_id is null then
    raise exception 'telegram cancel-request payload fields are invalid' using errcode = '22023';
  end if;

  with target as (
    update public.telegram_updates
    set cancel_requested = true,
        updated_at = now()
    where integration_id = p_integration_id
      and telegram_chat_id = p_telegram_chat_id
      and status = 'processing'
      and (p_exclude_update_id is null or id <> p_exclude_update_id)
    returning id
  )
  select exists(select 1 from target) into v_found;

  return v_found;
end;
$$;

revoke all on function public.request_cancel_telegram_update_for_chat(uuid, bigint, bigint)
from public, anon, authenticated;
grant execute on function public.request_cancel_telegram_update_for_chat(uuid, bigint, bigint)
to service_role;

-- 16. RPC: check_telegram_update_cancelled ---------------------------------
-- Cheap poll used by an in-flight worker to observe cancel_requested without
-- extending or otherwise mutating the lease.
create function public.check_telegram_update_cancelled(
  p_update_id bigint,
  p_lease_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cancelled boolean;
begin
  if p_update_id is null or p_lease_id is null then
    raise exception 'telegram cancel-check payload fields are invalid' using errcode = '22023';
  end if;

  select cancel_requested
  into v_cancelled
  from public.telegram_updates
  where id = p_update_id
    and lease_id = p_lease_id
    and status = 'processing';

  return coalesce(v_cancelled, false);
end;
$$;

revoke all on function public.check_telegram_update_cancelled(bigint, uuid)
from public, anon, authenticated;
grant execute on function public.check_telegram_update_cancelled(bigint, uuid)
to service_role;

-- 17. RPC: delete_owned_fred_conversations --------------------------------
-- Clears Telegram's active pointer before deleting owner-scoped histories.
-- The function call is one database transaction, so a failure rolls back both.
create function public.delete_owned_fred_conversations(
  p_client_id uuid,
  p_conversation_ids uuid[]
)
returns table (id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_client_id is null
    or p_conversation_ids is null
    or cardinality(p_conversation_ids) < 1
    or cardinality(p_conversation_ids) > 100
  then
    raise exception 'fred conversation deletion parameters are invalid'
      using errcode = '22023';
  end if;

  perform conversation.id
  from public.fred_conversations as conversation
  where conversation.client_id = p_client_id
    and conversation.id = any(p_conversation_ids)
  for update;

  update public.telegram_chat_bindings as binding
  set active_conversation_id = null
  where binding.active_conversation_id in (
    select conversation.id
    from public.fred_conversations as conversation
    where conversation.client_id = p_client_id
      and conversation.id = any(p_conversation_ids)
  );

  return query
  delete from public.fred_conversations as conversation
  where conversation.client_id = p_client_id
    and conversation.id = any(p_conversation_ids)
  returning conversation.id;
end;
$$;

revoke all on function public.delete_owned_fred_conversations(uuid, uuid[])
from public, anon, authenticated;
grant execute on function public.delete_owned_fred_conversations(uuid, uuid[])
to service_role;

-- 18. RPC: swap_telegram_bot (atomic bot replacement) ----------------------
-- Used for in-place token/bot replacement without losing the integration id
-- or historical fred_conversations.telegram_integration_id references.
-- Must be SECURITY DEFINER so it can touch all tables in one atomic step.
-- Callers must pass verified bot credentials; this function performs no
-- Telegram API calls of its own.
create function public.swap_telegram_bot(
  p_integration_id uuid,
  p_client_id uuid,
  p_old_bot_user_id bigint,
  p_new_bot_user_id bigint,
  p_new_bot_username text,
  p_new_encrypted_token text,
  p_new_webhook_id uuid,
  p_new_webhook_secret_sha256 char(64),
  p_new_pairing_token_sha256 char(64),
  p_new_pairing_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_switched boolean;
begin
  if p_integration_id is null
    or p_client_id is null
    or p_old_bot_user_id is null
    or p_new_bot_user_id is null
    or p_new_bot_username is null or char_length(p_new_bot_username) = 0
    or p_new_encrypted_token is null or char_length(p_new_encrypted_token) = 0
    or p_new_webhook_id is null
    or p_new_webhook_secret_sha256 is null or char_length(p_new_webhook_secret_sha256) <> 64
    or p_new_pairing_token_sha256 is null or char_length(p_new_pairing_token_sha256) <> 64
    or p_new_pairing_expires_at is null
  then
    raise exception 'swap_telegram_bot parameters are invalid' using errcode = '22023';
  end if;

  -- Lock and verify the current integration before deleting any queue state.
  -- A stale/concurrent replacement attempt returns false without side effects.
  perform 1
  from public.telegram_integrations
  where id = p_integration_id
    and client_id = p_client_id
    and bot_user_id = p_old_bot_user_id
  for update;

  if not found then
    return false;
  end if;

  -- Cancel any in-flight processing so no old-bot work can run after the swap.
  update public.telegram_updates
  set status = 'cancelled',
      lease_id = null,
      lease_expires_at = null,
      raw_update = '{}'::jsonb,
      cancelled_at = now(),
      updated_at = now()
  where integration_id = p_integration_id
    and status in ('pending', 'processing', 'retry');

  -- Delete old deliveries to prevent cross-bot dedupe collisions.
  delete from public.telegram_deliveries
  where update_id in (
    select id from public.telegram_updates
    where integration_id = p_integration_id
  );

  -- Delete all old update rows (completed/failed/cancelled rows are stale;
  -- keeping them risks update_id collisions with the new bot).
  delete from public.telegram_updates
  where integration_id = p_integration_id;

  -- Remove old Telegram chat bindings so the new bot starts fresh.
  delete from public.telegram_chat_bindings
  where integration_id = p_integration_id;

  -- Atomic row switch: only updates if the caller-provided identity info
  -- matches the current row so concurrent swaps cannot overwrite each other.
  with updated as (
    update public.telegram_integrations
    set bot_user_id = p_new_bot_user_id,
        bot_username = p_new_bot_username,
        encrypted_token = p_new_encrypted_token,
        webhook_id = p_new_webhook_id,
        webhook_secret_sha256 = p_new_webhook_secret_sha256,
        pairing_token_sha256 = p_new_pairing_token_sha256,
        pairing_expires_at = p_new_pairing_expires_at,
        paired_telegram_user_id = null,
        paired_telegram_chat_id = null,
        status = 'awaiting_pairing',
        last_error_code = null,
        last_error_description = null,
        last_error_retry_after = null,
        last_error_at = null,
        updated_at = now()
    where id = p_integration_id
      and client_id = p_client_id
      and bot_user_id = p_old_bot_user_id
    returning id
  )
  select exists(select 1 from updated) into v_switched;

  return v_switched;
end;
$$;

revoke all on function public.swap_telegram_bot(
  uuid, uuid, bigint, bigint, text, text, uuid, char, char, timestamptz
)
from public, anon, authenticated;
grant execute on function public.swap_telegram_bot(
  uuid, uuid, bigint, bigint, text, text, uuid, char, char, timestamptz
)
to service_role;

-- 19. RPC: record_telegram_integration_warning ----------------------------
-- Records a bounded sanitized warning on the integration without changing
-- its usable status. Used for non-authoritative cleanup debt (e.g. old
-- webhook cleanup failure after a successful bot swap).
create function public.record_telegram_integration_warning(
  p_integration_id uuid,
  p_warning text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_integration_id is null or p_warning is null or char_length(p_warning) = 0 then
    raise exception 'record warning parameters are invalid' using errcode = '22023';
  end if;

  update public.telegram_integrations
  set last_error_description = left(p_warning, 500),
      updated_at = now()
  where id = p_integration_id;
end;
$$;

revoke all on function public.record_telegram_integration_warning(uuid, text)
from public, anon, authenticated;
grant execute on function public.record_telegram_integration_warning(uuid, text)
to service_role;
