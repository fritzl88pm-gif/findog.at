-- Admin-managed download library. Binary files live in a private Storage bucket;
-- only server routes using the service role access these tables and objects.

create table public.download_categories (
  id uuid primary key default gen_random_uuid(),
  name varchar(80) not null check (
    char_length(btrim(name)) between 1 and 80
    and name !~ '[[:cntrl:]]'
  ),
  description varchar(240) not null default '' check (
    char_length(description) <= 240
    and description !~ '[[:cntrl:]]'
  ),
  sort_order integer not null default 0 check (sort_order between 0 and 1000000),
  created_by uuid not null,
  updated_by uuid not null,
  deleted_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((deleted_at is null) = (deleted_by is null))
);

create unique index download_categories_active_name_idx
  on public.download_categories (lower(btrim(name)))
  where deleted_at is null;

create index download_categories_active_sort_idx
  on public.download_categories (sort_order, lower(name), id)
  where deleted_at is null;

create table public.download_documents (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.download_categories(id) on delete restrict,
  title varchar(160) not null check (
    char_length(btrim(title)) between 1 and 160
    and title !~ '[[:cntrl:]]'
  ),
  description varchar(500) not null default '' check (
    char_length(description) <= 500
    and description !~ '[[:cntrl:]]'
  ),
  storage_path varchar(400) not null unique check (
    char_length(btrim(storage_path)) between 1 and 400
    and storage_path !~ '(^|/)\.\.(/|$)'
    and storage_path !~ '[[:cntrl:]]'
  ),
  original_filename varchar(255) not null check (
    char_length(btrim(original_filename)) between 1 and 255
    and original_filename !~ '[[:cntrl:]/\\]'
  ),
  mime_type varchar(127) not null check (mime_type in (
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/markdown',
    'text/csv'
  )),
  file_extension varchar(10) not null check (file_extension in (
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv'
  )),
  file_size bigint not null check (file_size between 1 and 20971520),
  content_sha256 char(64) not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  sort_order integer not null default 0 check (sort_order between 0 and 1000000),
  created_by uuid not null,
  updated_by uuid not null,
  deleted_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((deleted_at is null) = (deleted_by is null))
);

create index download_documents_active_category_sort_idx
  on public.download_documents (category_id, sort_order, lower(title), id)
  where deleted_at is null;

create table public.download_admin_audit (
  id bigint generated always as identity primary key,
  entity_type text not null check (entity_type in ('category', 'document')),
  entity_id uuid not null,
  action text not null check (action in ('created', 'updated', 'deleted', 'purged')),
  actor_user_id uuid not null,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now(),
  check (before_state is not null or after_state is not null)
);

create index download_admin_audit_entity_created_idx
  on public.download_admin_audit (entity_type, entity_id, created_at desc, id desc);

create function public.audit_download_library_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor_id uuid;
  audit_action text;
  entity_kind text;
begin
  entity_kind := case tg_table_name
    when 'download_categories' then 'category'
    when 'download_documents' then 'document'
    else null
  end;

  if entity_kind is null then
    raise exception 'unsupported download audit table: %', tg_table_name;
  end if;

  if tg_op = 'INSERT' then
    actor_id := new.created_by;
    audit_action := 'created';
    insert into public.download_admin_audit (
      entity_type, entity_id, action, actor_user_id, after_state
    ) values (
      entity_kind, new.id, audit_action, actor_id, to_jsonb(new)
    );
    return new;
  end if;

  if tg_op = 'UPDATE' then
    actor_id := coalesce(new.deleted_by, new.updated_by);
    audit_action := case
      when old.deleted_at is null and new.deleted_at is not null then 'deleted'
      else 'updated'
    end;
    insert into public.download_admin_audit (
      entity_type, entity_id, action, actor_user_id, before_state, after_state
    ) values (
      entity_kind, new.id, audit_action, actor_id, to_jsonb(old), to_jsonb(new)
    );
    return new;
  end if;

  actor_id := coalesce(old.deleted_by, old.updated_by, old.created_by);
  insert into public.download_admin_audit (
    entity_type, entity_id, action, actor_user_id, before_state
  ) values (
    entity_kind, old.id, 'purged', actor_id, to_jsonb(old)
  );
  return old;
end;
$$;

create function public.set_download_library_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create function public.prevent_nonempty_download_category_deletion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null and exists (
    select 1
    from public.download_documents
    where category_id = old.id
      and deleted_at is null
  ) then
    raise exception 'download category still contains active documents'
      using errcode = '23503';
  end if;
  return new;
end;
$$;

create function public.require_active_download_document_category()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The row lock serializes category deletion with document creation/moves,
  -- preventing an active document from being committed into a deleted category.
  perform 1
  from public.download_categories
  where id = new.category_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'download category is not active'
      using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger download_categories_set_updated_at
before update on public.download_categories
for each row execute function public.set_download_library_updated_at();

create trigger download_categories_prevent_nonempty_delete
before update of deleted_at on public.download_categories
for each row execute function public.prevent_nonempty_download_category_deletion();

create trigger download_categories_audit
after insert or update or delete on public.download_categories
for each row execute function public.audit_download_library_change();

create trigger download_documents_set_updated_at
before update on public.download_documents
for each row execute function public.set_download_library_updated_at();

create trigger download_documents_require_active_category
before insert or update of category_id on public.download_documents
for each row execute function public.require_active_download_document_category();

create trigger download_documents_audit
after insert or update or delete on public.download_documents
for each row execute function public.audit_download_library_change();

alter table public.download_categories enable row level security;
alter table public.download_documents enable row level security;
alter table public.download_admin_audit enable row level security;

revoke all on public.download_categories from public, anon, authenticated;
revoke all on public.download_documents from public, anon, authenticated;
revoke all on public.download_admin_audit from public, anon, authenticated;
revoke all on function public.audit_download_library_change() from public, anon, authenticated;
revoke all on function public.set_download_library_updated_at() from public, anon, authenticated;
revoke all on function public.prevent_nonempty_download_category_deletion() from public, anon, authenticated;
revoke all on function public.require_active_download_document_category() from public, anon, authenticated;

grant select, insert, update, delete on public.download_categories to service_role;
grant select, insert, update, delete on public.download_documents to service_role;
grant select, insert on public.download_admin_audit to service_role;
grant usage, select on sequence public.download_admin_audit_id_seq to service_role;
grant execute on function public.audit_download_library_change() to service_role;
grant execute on function public.set_download_library_updated_at() to service_role;
grant execute on function public.prevent_nonempty_download_category_deletion() to service_role;
grant execute on function public.require_active_download_document_category() to service_role;

comment on table public.download_admin_audit is
  'Append-only provenance log for every administrative download-library mutation.';
comment on column public.download_categories.created_by is
  'Supabase auth user UUID retained without a foreign key so provenance survives user deletion.';
comment on column public.download_documents.content_sha256 is
  'SHA-256 of the uploaded bytes for integrity and provenance checks.';

-- The bucket is deliberately private. Public and authenticated clients receive no
-- storage.objects policies; the authenticated Next.js download route streams files.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'downloads',
  'downloads',
  false,
  20971520,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/markdown',
    'text/csv'
  ]::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
