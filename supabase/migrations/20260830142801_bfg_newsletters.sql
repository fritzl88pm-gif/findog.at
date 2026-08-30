create table if not exists public.bfg_newsletters (
  id uuid primary key default gen_random_uuid(),
  publication_date date not null,
  content_markdown text not null,
  created_by uuid not null,
  updated_by uuid not null,
  deleted_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint bfg_newsletters_content_check
    check (
      char_length(content_markdown) between 1 and 100000
      and content_markdown ~ '[^[:space:]]'
    ),
  constraint bfg_newsletters_soft_delete_check
    check (
      (deleted_at is null and deleted_by is null)
      or (deleted_at is not null and deleted_by is not null)
    )
);

comment on table public.bfg_newsletters is
  'Administrativ gepflegte BFG-Newsletter aus Datum und reinem Text beziehungsweise Markdown.';
comment on column public.bfg_newsletters.publication_date is
  'Redaktionelles Newsletterdatum; die Anzeige erfolgt absteigend nach diesem Datum.';
comment on column public.bfg_newsletters.content_markdown is
  'Unveraenderter redaktioneller Text beziehungsweise Markdown ohne Datei- oder Bildanlage.';

create index if not exists bfg_newsletters_publication_idx
  on public.bfg_newsletters (publication_date desc, created_at desc, id desc)
  where deleted_at is null;

create table if not exists public.bfg_newsletter_audit (
  id bigint generated always as identity primary key,
  newsletter_id uuid not null,
  action text not null,
  actor_user_id uuid not null,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now(),
  constraint bfg_newsletter_audit_action_check
    check (action in ('created', 'updated', 'soft_deleted')),
  constraint bfg_newsletter_audit_state_check
    check (
      (action = 'created' and before_state is null and after_state is not null)
      or (action in ('updated', 'soft_deleted') and before_state is not null and after_state is not null)
    )
);

comment on table public.bfg_newsletter_audit is
  'Append-only Auditprotokoll fuer BFG-Newsletter inklusive Vorher-/Nachher-Zustand.';

create or replace function public.bfg_newsletters_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.bfg_newsletters_write_audit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  audit_action text;
  audit_actor uuid;
begin
  if tg_op = 'INSERT' then
    insert into public.bfg_newsletter_audit (
      newsletter_id, action, actor_user_id, before_state, after_state
    ) values (
      new.id, 'created', new.created_by, null, to_jsonb(new)
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

  insert into public.bfg_newsletter_audit (
    newsletter_id, action, actor_user_id, before_state, after_state
  ) values (
    new.id, audit_action, audit_actor, to_jsonb(old), to_jsonb(new)
  );
  return new;
end;
$$;

drop trigger if exists bfg_newsletters_set_updated_at on public.bfg_newsletters;
create trigger bfg_newsletters_set_updated_at
before update on public.bfg_newsletters
for each row execute function public.bfg_newsletters_set_updated_at();

drop trigger if exists bfg_newsletters_audit on public.bfg_newsletters;
create trigger bfg_newsletters_audit
after insert or update on public.bfg_newsletters
for each row execute function public.bfg_newsletters_write_audit();

alter table public.bfg_newsletters enable row level security;
alter table public.bfg_newsletter_audit enable row level security;

revoke all on table public.bfg_newsletters from public, anon, authenticated, service_role;
revoke all on table public.bfg_newsletter_audit from public, anon, authenticated, service_role;
revoke all on sequence public.bfg_newsletter_audit_id_seq from public, anon, authenticated, service_role;
revoke all on function public.bfg_newsletters_set_updated_at() from public, anon, authenticated, service_role;
revoke all on function public.bfg_newsletters_write_audit() from public, anon, authenticated, service_role;

grant select, insert, update on table public.bfg_newsletters to service_role;
grant select, insert on table public.bfg_newsletter_audit to service_role;
grant select, usage on sequence public.bfg_newsletter_audit_id_seq to service_role;
grant execute on function public.bfg_newsletters_set_updated_at() to service_role;
grant execute on function public.bfg_newsletters_write_audit() to service_role;
