-- Stage 2: deploy the application without admin-copy writes before applying.
-- Re-running this file is safe; its audit record is written only once.
begin;
select pg_advisory_xact_lock(hashtextextended('fred:quality-review-batch', 0));

create table if not exists public.fred_quality_retirement_audit (
  migration_key text primary key,
  executed_at timestamptz not null default now(),
  reason text not null,
  ledger_contents_removed bigint not null,
  admin_contents_removed bigint not null,
  delivery_contents_removed bigint not null
);
alter table public.fred_quality_retirement_audit enable row level security;
revoke all on public.fred_quality_retirement_audit from public, anon, authenticated, service_role;
grant select on public.fred_quality_retirement_audit to service_role;

-- Older application instances can finish without retaining a new content copy.
create or replace function public.discard_retired_fred_quality_content()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_table_name = 'fred_request_ledger' then
    new.request_content := null;
  elsif tg_table_name = 'admin_request_history' then
    new.content := null;
  end if;
  return new;
end;
$$;
revoke all on function public.discard_retired_fred_quality_content()
  from public, anon, authenticated;

drop trigger if exists fred_request_ledger_discard_qa_content on public.fred_request_ledger;
create trigger fred_request_ledger_discard_qa_content
before insert or update on public.fred_request_ledger
for each row execute function public.discard_retired_fred_quality_content();
drop trigger if exists admin_request_history_discard_qa_content on public.admin_request_history;
create trigger admin_request_history_discard_qa_content
before insert or update on public.admin_request_history
for each row execute function public.discard_retired_fred_quality_content();

do $$
declare
  ledger_count bigint;
  admin_count bigint;
  delivery_count bigint;
begin
  -- Completed queue rows cannot be reopened. Active sends retain their payload.
  update public.telegram_deliveries as delivery
  set message_content = ''
  from public.telegram_updates as queued
  where queued.id = delivery.update_id
    and queued.status in ('completed', 'failed', 'cancelled')
    and delivery.message_content <> '';
  get diagnostics delivery_count = row_count;

  update public.fred_request_ledger
  set request_content = null,
      content_deleted_at = now(),
      content_deletion_reason = 'quality_retired'
  where request_content is not null;
  get diagnostics ledger_count = row_count;

  update public.admin_request_history
  set content = null
  where content is not null;
  get diagnostics admin_count = row_count;

  insert into public.fred_quality_retirement_audit (
    migration_key, reason, ledger_contents_removed,
    admin_contents_removed, delivery_contents_removed
  ) values (
    'remove_fred_quality_content', 'Daily QA retired; user history preserved',
    ledger_count, admin_count, delivery_count
  ) on conflict (migration_key) do nothing;
end;
$$;

alter table public.fred_request_ledger
  drop constraint if exists fred_request_ledger_no_qa_content,
  add constraint fred_request_ledger_no_qa_content check (request_content is null);
alter table public.admin_request_history
  drop constraint if exists admin_request_history_no_qa_content,
  add constraint admin_request_history_no_qa_content check (content is null);
commit;
