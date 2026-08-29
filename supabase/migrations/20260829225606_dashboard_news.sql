create table if not exists public.dashboard_news_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  title varchar(160) not null,
  summary varchar(600) not null,
  status text not null default 'draft',
  pinned boolean not null default false,
  published_at timestamptz,
  source_system text,
  document_kind text,
  source_identifier varchar(200),
  source_url text,
  document_date date,
  as_of_date date,
  created_by uuid not null,
  updated_by uuid not null,
  deleted_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint dashboard_news_items_kind_check
    check (kind in ('product', 'legal')),
  constraint dashboard_news_items_status_check
    check (status in ('draft', 'published', 'archived')),
  constraint dashboard_news_items_document_kind_check
    check (document_kind is null or document_kind in ('norm', 'rechtssatz', 'entscheidungsdokument')),
  constraint dashboard_news_items_source_system_check
    check (source_system is null or source_system in ('ris', 'evi')),
  constraint dashboard_news_items_title_check
    check (length(btrim(title)) between 1 and 160),
  constraint dashboard_news_items_summary_check
    check (length(btrim(summary)) between 1 and 600),
  constraint dashboard_news_items_publication_check
    check (
      (status = 'draft' and published_at is null)
      or (status in ('published', 'archived') and published_at is not null)
    ),
  constraint dashboard_news_items_legal_fields_check
    check (
      (
        kind = 'product'
        and source_system is null
        and document_kind is null
        and source_identifier is null
        and source_url is null
        and document_date is null
        and as_of_date is null
      )
      or (
        kind = 'legal'
        and source_system is not null
        and document_kind is not null
        and length(btrim(source_identifier)) between 1 and 200
        and source_url is not null
        and document_date is not null
        and as_of_date is not null
      )
    ),
  constraint dashboard_news_items_source_url_check
    check (
      source_url is null
      or (source_system = 'ris' and source_url ~ '^https://(www\.)?ris\.bka\.gv\.at([/?#:]|$)')
      or (source_system = 'evi' and source_url ~ '^https://(www\.)?evi\.gv\.at([/?#:]|$)')
    ),
  constraint dashboard_news_items_soft_delete_check
    check (
      (deleted_at is null and deleted_by is null)
      or (deleted_at is not null and deleted_by is not null)
    )
);

comment on table public.dashboard_news_items is
  'Administrativ gepflegte Produkt- und Rechtsmeldungen fuer die eingeloggte Startseite.';
comment on column public.dashboard_news_items.as_of_date is
  'Expliziter rechtlicher Stichtag der redaktionellen Rechtsmeldung.';

create unique index if not exists dashboard_news_items_active_legal_source_uidx
  on public.dashboard_news_items (source_system, lower(source_identifier))
  where kind = 'legal' and deleted_at is null;

create index if not exists dashboard_news_items_published_idx
  on public.dashboard_news_items (kind, pinned desc, published_at desc, id desc)
  where status = 'published' and deleted_at is null;

create table if not exists public.dashboard_news_audit (
  id bigint generated always as identity primary key,
  news_id uuid not null,
  action text not null,
  actor_user_id uuid not null,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now(),
  constraint dashboard_news_audit_action_check
    check (action in ('created', 'updated', 'soft_deleted')),
  constraint dashboard_news_audit_state_check
    check (
      (action = 'created' and before_state is null and after_state is not null)
      or (action in ('updated', 'soft_deleted') and before_state is not null and after_state is not null)
    )
);

comment on table public.dashboard_news_audit is
  'Append-only Auditprotokoll fuer Startseiten-News inklusive Vorher-/Nachher-Zustand.';

create or replace function public.dashboard_news_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.dashboard_news_write_audit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  audit_action text;
  audit_actor uuid;
begin
  if tg_op = 'INSERT' then
    audit_action := 'created';
    audit_actor := new.created_by;
    insert into public.dashboard_news_audit (
      news_id, action, actor_user_id, before_state, after_state
    ) values (
      new.id, audit_action, audit_actor, null, to_jsonb(new)
    );
    return new;
  end if;

  audit_action := case
    when old.deleted_at is null and new.deleted_at is not null then 'soft_deleted'
    else 'updated'
  end;
  audit_actor := case
    when audit_action = 'soft_deleted' then new.deleted_by
    else new.updated_by
  end;

  insert into public.dashboard_news_audit (
    news_id, action, actor_user_id, before_state, after_state
  ) values (
    new.id, audit_action, audit_actor, to_jsonb(old), to_jsonb(new)
  );
  return new;
end;
$$;

drop trigger if exists dashboard_news_items_set_updated_at on public.dashboard_news_items;
create trigger dashboard_news_items_set_updated_at
before update on public.dashboard_news_items
for each row execute function public.dashboard_news_set_updated_at();

drop trigger if exists dashboard_news_items_audit on public.dashboard_news_items;
create trigger dashboard_news_items_audit
after insert or update on public.dashboard_news_items
for each row execute function public.dashboard_news_write_audit();

alter table public.dashboard_news_items enable row level security;
alter table public.dashboard_news_audit enable row level security;

revoke all on table public.dashboard_news_items from public, anon, authenticated, service_role;
revoke all on table public.dashboard_news_audit from public, anon, authenticated, service_role;
revoke all on sequence public.dashboard_news_audit_id_seq from public, anon, authenticated, service_role;
revoke all on function public.dashboard_news_set_updated_at() from public, anon, authenticated, service_role;
revoke all on function public.dashboard_news_write_audit() from public, anon, authenticated, service_role;

grant select, insert, update on table public.dashboard_news_items to service_role;
grant select, insert on table public.dashboard_news_audit to service_role;
grant select, usage on sequence public.dashboard_news_audit_id_seq to service_role;
grant execute on function public.dashboard_news_set_updated_at() to service_role;
grant execute on function public.dashboard_news_write_audit() to service_role;
