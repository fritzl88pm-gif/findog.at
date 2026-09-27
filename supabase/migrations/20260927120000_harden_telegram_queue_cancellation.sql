-- Harden the Telegram queue around concurrent claims, /stop and disconnects.
-- 1. A claim re-checks eligibility on the locked row, so a row committed as
--    'processing' by a concurrent claimer after this statement's snapshot is
--    skipped instead of being claimed a second time.
-- 2. /stop also cancels questions of the same chat that were sent before it
--    and are still queued or waiting for a retry; the claim orders /stop ahead
--    of them, so previously it found nothing running and they were answered.
-- 3. Disconnect and bot swap cancel the open Fred receipts of the queue rows
--    they cancel or delete. No worker can settle them afterwards: every
--    receipt transition needs the queue lease, and deleting the queue row or
--    the integration detaches the receipt.

create or replace function public.claim_telegram_updates_for_lane(
  p_lease_id uuid,
  p_lease_seconds integer default 60,
  p_limit integer default 10,
  p_controls_only boolean default false
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
      and (not p_controls_only or (
        telegram_update.update_kind = 'command'
        and pg_catalog.btrim(coalesce(telegram_update.raw_update #>> '{message,text}', ''))
          ~* '^/stop(@[a-z][a-z0-9_]{0,31})?([[:space:]].*)?$'
      ))
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
    -- The eligibility predicate must be on the locked relation: after waiting
    -- for or following a concurrent update, Postgres re-checks only these
    -- quals against the newest row version, never the candidates snapshot.
    select queued_update.id
    from public.telegram_updates as queued_update
    join candidates as candidate on candidate.id = queued_update.id
    where queued_update.status in ('pending', 'retry')
      and queued_update.available_at <= now()
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
    and queued_update.status in ('pending', 'retry')
  returning queued_update.*;
end;
$$;

revoke all on function public.claim_telegram_updates_for_lane(uuid, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.claim_telegram_updates_for_lane(uuid, integer, integer, boolean) to service_role;

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
  stop_update_id bigint;
  queued_cancelled boolean := false;
begin
  if p_integration_id is null or p_telegram_chat_id is null then
    raise exception 'telegram cancel-request payload fields are invalid' using errcode = '22023';
  end if;

  -- Questions sent before this /stop (Telegram update ids are sequential per
  -- bot) that are still queued or waiting for a retry are cancelled too; the
  -- claim settles them as cancel cleanup without starting a turn. Rows with a
  -- delivery claim are left alone because part of their answer may already be
  -- shown. This runs before the lookup below so a question claimed meanwhile
  -- is found there as processing.
  if p_exclude_update_id is not null then
    select telegram_update.update_id into stop_update_id
    from public.telegram_updates as telegram_update
    where telegram_update.id = p_exclude_update_id
      and telegram_update.integration_id = p_integration_id
      and telegram_update.telegram_chat_id = p_telegram_chat_id;

    if found then
      update public.telegram_updates as queued_update
      set cancel_requested = true,
          available_at = least(queued_update.available_at, now()),
          updated_at = now()
      where queued_update.integration_id = p_integration_id
        and queued_update.telegram_chat_id = p_telegram_chat_id
        and queued_update.status in ('pending', 'retry')
        and queued_update.update_kind = 'message'
        and queued_update.update_id < stop_update_id
        and not exists (
          select 1
          from public.telegram_deliveries as delivery
          where delivery.update_id = queued_update.id
        );
      queued_cancelled := found;
    end if;
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
    return queued_cancelled;
  end if;

  if exists (
    select 1
    from public.telegram_deliveries as delivery
    where delivery.update_id = target.id
      and delivery.status = 'pending'
      and delivery.delivery_lease_id = target.lease_id
  ) then
    return queued_cancelled;
  end if;

  update public.telegram_updates
  set cancel_requested = true,
      updated_at = now()
  where id = target.id
    and status = 'processing'
    and lease_id = target.lease_id;

  return found or queued_cancelled;
end;
$$;

revoke all on function public.request_cancel_telegram_update_for_chat(uuid, bigint, bigint)
from public, anon, authenticated;
grant execute on function public.request_cancel_telegram_update_for_chat(uuid, bigint, bigint)
to service_role;

create or replace function public.cancel_all_telegram_updates_for_integration(
  p_integration_id uuid
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count bigint;
  v_client_id uuid;
begin
  if p_integration_id is null then
    raise exception 'telegram cancel-all payload fields are invalid' using errcode = '22023';
  end if;

  -- Enter the global lock order at the account row before any queue row; the
  -- receipt update below follows the queue update (account, queue, receipt).
  select integration.client_id into v_client_id
  from public.telegram_integrations as integration
  where integration.id = p_integration_id;

  if v_client_id is not null then
    perform public.lock_existing_findog_account(v_client_id);
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

  update public.fred_request_ledger as receipt
  set status = 'cancelled',
      failure_phase = case receipt.status
        when 'received' then 'ingress'
        when 'user_persisted' then 'connecting'
        else 'streaming'
      end,
      error_code = 'telegram_integration_disconnected',
      terminal_at = now(),
      updated_at = now()
  where receipt.telegram_update_id in (
      select id
      from public.telegram_updates
      where integration_id = p_integration_id
    )
    and receipt.status in ('received', 'user_persisted', 'generating');

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

-- Used for in-place token/bot replacement without losing the integration id
-- or historical fred_conversations.telegram_integration_id references.
-- Must be SECURITY DEFINER so it can touch all tables in one atomic step.
-- Callers must pass verified bot credentials; this function performs no
-- Telegram API calls of its own.
create or replace function public.swap_telegram_bot(
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

  -- Enter the global lock order at the account row; open receipts are
  -- cancelled below after the queue rows (account, queue, receipt).
  perform public.lock_existing_findog_account(p_client_id);

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

  -- Settle open receipts while their queue rows still exist; the delete below
  -- detaches them from the queue for good.
  update public.fred_request_ledger as receipt
  set status = 'cancelled',
      failure_phase = case receipt.status
        when 'received' then 'ingress'
        when 'user_persisted' then 'connecting'
        else 'streaming'
      end,
      error_code = 'telegram_bot_swapped',
      terminal_at = now(),
      updated_at = now()
  where receipt.telegram_update_id in (
      select id
      from public.telegram_updates
      where integration_id = p_integration_id
    )
    and receipt.status in ('received', 'user_persisted', 'generating');

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
