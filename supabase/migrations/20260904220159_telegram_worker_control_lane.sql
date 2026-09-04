-- Keep the old claim API compatible; reserve a separate lane for /stop.
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

create or replace function public.claim_pending_telegram_updates(
  p_lease_id uuid, p_lease_seconds integer default 60, p_limit integer default 10
) returns setof public.telegram_updates
language sql security invoker set search_path = ''
as $$
  select * from public.claim_telegram_updates_for_lane(p_lease_id, p_lease_seconds, p_limit, false);
$$;
revoke all on function public.claim_pending_telegram_updates(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_pending_telegram_updates(uuid, integer, integer) to service_role;

create or replace function public.claim_pending_telegram_control_updates(
  p_lease_id uuid, p_lease_seconds integer default 60, p_limit integer default 10
) returns setof public.telegram_updates
language sql security invoker set search_path = ''
as $$
  select * from public.claim_telegram_updates_for_lane(p_lease_id, p_lease_seconds, p_limit, true);
$$;
revoke all on function public.claim_pending_telegram_control_updates(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_pending_telegram_control_updates(uuid, integer, integer) to service_role;

revoke all on function public.claim_telegram_updates_for_lane(uuid, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.claim_telegram_updates_for_lane(uuid, integer, integer, boolean) to service_role;
