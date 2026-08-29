-- A confirmed quality cleanup removes only the temporary QA copies.
-- The user's Fred conversation, messages, attachments and provider session
-- remain available until the user deletes the conversation or account.

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
  candidate_hash text;
  telegram_update_ids bigint[];
  deleted_admin_count bigint;
  preserved_message_count bigint;
  cleared_delivery_count bigint;
begin
  select * into batch
  from public.fred_quality_review_batches
  where id = p_batch_id
  for update;

  if not found or batch.status <> 'pending_confirmation' then
    raise exception 'fred quality batch is not pending confirmation' using errcode = '55000';
  end if;

  select coalesce(array_agg(id order by id), '{}'::uuid[])
  into candidate_ids
  from public.fred_request_ledger
  where quality_batch_id = batch.id
    and content_deleted_at is null;

  candidate_hash := encode(
    extensions.digest(convert_to(coalesce(array_to_string(candidate_ids, ','), ''), 'UTF8'), 'sha256'),
    'hex'
  );

  if batch.candidate_count <> cardinality(candidate_ids)
    or batch.candidate_set_sha256 <> candidate_hash
    or batch.candidate_set_sha256 <> lower(btrim(p_expected_set_sha256))
  then
    raise exception 'fred quality batch confirmation hash mismatch' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.fred_request_ledger
    where id = any(candidate_ids)
      and status not in ('completed', 'failed', 'cancelled')
  ) then
    raise exception 'fred quality batch still contains active requests' using errcode = '55000';
  end if;

  select coalesce(array_agg(distinct telegram_update_id)
    filter (where telegram_update_id is not null), '{}'::bigint[])
  into telegram_update_ids
  from public.fred_request_ledger
  where id = any(candidate_ids);

  select count(*)
  into preserved_message_count
  from public.fred_messages as message
  where message.id in (
    select receipt.user_message_id
    from public.fred_request_ledger as receipt
    where receipt.id = any(candidate_ids)
      and receipt.user_message_id is not null
    union
    select receipt.assistant_message_id
    from public.fred_request_ledger as receipt
    where receipt.id = any(candidate_ids)
      and receipt.assistant_message_id is not null
  );

  delete from public.admin_request_history
  where request_id = any(candidate_ids);
  get diagnostics deleted_admin_count = row_count;

  update public.telegram_deliveries
  set message_content = ''
  where update_id = any(telegram_update_ids)
    and message_content <> '';
  get diagnostics cleared_delivery_count = row_count;

  update public.fred_request_ledger
  set request_content = null,
      request_content_sha256 = null,
      content_deleted_at = now(),
      content_deletion_reason = 'quality_batch'
  where id = any(candidate_ids);

  update public.fred_quality_review_batches
  set status = 'deleted',
      deleted_at = now()
  where id = batch.id;

  return jsonb_build_object(
    'batch_id', batch.id,
    'candidate_count', cardinality(candidate_ids),
    'candidate_set_sha256', candidate_hash,
    'deleted_admin_requests', deleted_admin_count,
    'deleted_messages', 0,
    'preserved_user_messages', preserved_message_count,
    'cleared_telegram_deliveries', cleared_delivery_count,
    'deleted_at', now()
  );
end;
$$;

revoke all on function public.delete_confirmed_fred_quality_batch(uuid, text)
from public, anon, authenticated;
grant execute on function public.delete_confirmed_fred_quality_batch(uuid, text)
to service_role;
