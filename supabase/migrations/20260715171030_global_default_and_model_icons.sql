create table public.model_image_assets (
  id uuid primary key,
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null,
  byte_size integer not null,
  created_at timestamptz not null default statement_timestamp(),
  created_by uuid references auth.users(id) on delete set null,
  constraint model_image_assets_storage_path_check check (
    storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](?:png|jpe?g|webp|avif)$'
  ),
  constraint model_image_assets_filename_check check (
    length(original_filename) between 1 and 160
    and original_filename !~ '[[:cntrl:]]'
  ),
  constraint model_image_assets_mime_type_check check (
    mime_type in ('image/png', 'image/jpeg', 'image/webp', 'image/avif')
  ),
  constraint model_image_assets_byte_size_check check (
    byte_size between 1 and 1000000
  )
);

create index model_image_assets_created_at_idx
  on public.model_image_assets (created_at desc, id);

create index model_image_assets_created_by_idx
  on public.model_image_assets (created_by)
  where created_by is not null;

alter table public.model_image_assets enable row level security;
revoke all on public.model_image_assets from anon, authenticated;
grant select, insert on public.model_image_assets to service_role;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'model-icons',
  'model-icons',
  true,
  1000000,
  array['image/png', 'image/jpeg', 'image/webp', 'image/avif']::text[]
);

alter table public.model_settings
  add column image_asset_id uuid
    references public.model_image_assets(id) on delete restrict;

alter table public.model_settings_history
  add column image_asset_id uuid,
  add column previous_image_asset_id uuid;

create index model_settings_image_asset_idx
  on public.model_settings (image_asset_id)
  where image_asset_id is not null;

create or replace function public.append_model_settings_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.model_settings_history (
    revision,
    model_id,
    operation,
    enabled,
    reasoning_setting,
    display_name,
    provider,
    upstream_model,
    is_dynamic,
    always_enabled,
    base_url,
    access_scope,
    image_asset_id,
    previous_enabled,
    previous_reasoning_setting,
    previous_image_asset_id,
    changed_at,
    changed_by
  ) values (
    new.revision,
    new.model_id,
    lower(tg_op),
    new.enabled,
    new.reasoning_setting,
    new.display_name,
    new.provider,
    new.upstream_model,
    new.is_dynamic,
    new.always_enabled,
    new.base_url,
    new.access_scope,
    new.image_asset_id,
    case when tg_op = 'UPDATE' then old.enabled else null end,
    case when tg_op = 'UPDATE' then old.reasoning_setting else null end,
    case when tg_op = 'UPDATE' then old.image_asset_id else null end,
    new.updated_at,
    new.updated_by
  );

  return new;
end;
$$;

revoke all on function public.append_model_settings_history()
  from public, anon, authenticated;

alter table public.model_settings
  drop constraint if exists model_settings_flash_enabled_check,
  drop constraint if exists model_settings_catalog_metadata_check;

-- Permit only this audited migration transition without an administrator UUID.
create or replace function public.prepare_model_settings_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and new.updated_by is null
    and not (
      old.model_id = 'deepseek-v4-flash'
      and old.always_enabled
      and not new.always_enabled
      and new.enabled = old.enabled
      and new.reasoning_setting = old.reasoning_setting
      and new.image_asset_id is not distinct from old.image_asset_id
    ) then
    raise exception 'model setting updates require an administrator id'
      using errcode = '23502';
  end if;

  if tg_op = 'UPDATE' and new.model_id <> old.model_id then
    raise exception 'model ids are immutable'
      using errcode = '23514';
  end if;

  new.revision := nextval('public.model_settings_revision_seq'::regclass);
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

update public.model_settings
set always_enabled = false
where model_id = 'deepseek-v4-flash';

create or replace function public.prepare_model_settings_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.updated_by is null then
    raise exception 'model setting updates require an administrator id'
      using errcode = '23502';
  end if;

  if tg_op = 'UPDATE' and new.model_id <> old.model_id then
    raise exception 'model ids are immutable'
      using errcode = '23514';
  end if;

  new.revision := nextval('public.model_settings_revision_seq'::regclass);
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

revoke all on function public.prepare_model_settings_change()
  from public, anon, authenticated;

alter table public.model_settings
  add constraint model_settings_catalog_metadata_check check (
    (
      model_id = 'deepseek-v4-flash'
      and not is_dynamic
      and display_name = 'DeepSeek v4 Flash'
      and provider = 'deepseek'
      and upstream_model = 'deepseek-v4-flash'
      and not always_enabled
    )
    or (
      model_id = 'deepseek-v4-pro'
      and not is_dynamic
      and display_name = 'DeepSeek v4 Pro'
      and provider = 'deepseek'
      and upstream_model = 'deepseek-v4-pro'
      and not always_enabled
    )
    or (
      model_id = 'glm-5.2'
      and not is_dynamic
      and display_name = 'GLM-5.2'
      and provider = 'zai'
      and upstream_model = 'glm-5.2'
      and not always_enabled
    )
    or (
      model_id = 'glm-5-turbo'
      and not is_dynamic
      and display_name = 'GLM-5-Turbo'
      and provider = 'zai'
      and upstream_model = 'glm-5-turbo'
      and not always_enabled
    )
    or (
      is_dynamic
      and model_id ~ '^openai:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and provider = 'openai_compatible'
      and not always_enabled
      and reasoning_setting = 'disabled'
      and base_url is not null
      and access_scope is not null
      and api_key_ciphertext is not null
    )
  );

create sequence public.model_default_policy_revision_seq as bigint;

create table public.model_default_policy (
  id boolean primary key default true check (id),
  model_id text not null
    references public.model_settings(model_id) on delete restrict,
  revision bigint not null,
  updated_at timestamptz not null,
  updated_by uuid references auth.users(id) on delete set null
);

create table public.model_default_policy_history (
  revision bigint primary key,
  model_id text not null,
  previous_model_id text,
  changed_at timestamptz not null,
  changed_by uuid
);

create index model_default_policy_updated_by_idx
  on public.model_default_policy (updated_by)
  where updated_by is not null;

create index model_default_policy_history_model_idx
  on public.model_default_policy_history (model_id, changed_at desc, revision desc);

create index model_default_policy_history_changed_by_idx
  on public.model_default_policy_history (changed_by)
  where changed_by is not null;

create function public.prepare_model_default_policy_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.updated_by is null then
    raise exception 'default model updates require an administrator id'
      using errcode = '23502';
  end if;

  new.id := true;
  new.revision := nextval('public.model_default_policy_revision_seq'::regclass);
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create function public.append_model_default_policy_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.model_default_policy_history (
    revision,
    model_id,
    previous_model_id,
    changed_at,
    changed_by
  ) values (
    new.revision,
    new.model_id,
    case when tg_op = 'UPDATE' then old.model_id else null end,
    new.updated_at,
    new.updated_by
  );
  return new;
end;
$$;

create trigger model_default_policy_prepare_change
before insert or update on public.model_default_policy
for each row execute function public.prepare_model_default_policy_change();

create trigger model_default_policy_append_history
after insert or update on public.model_default_policy
for each row execute function public.append_model_default_policy_history();

revoke all on function public.prepare_model_default_policy_change()
  from public, anon, authenticated;
revoke all on function public.append_model_default_policy_history()
  from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1
    from public.model_settings
    where model_id = 'deepseek-v4-pro'
      and enabled
  ) then
    raise exception 'initial default model deepseek-v4-pro must be enabled';
  end if;
end;
$$;

insert into public.model_default_policy (
  id,
  model_id,
  revision,
  updated_at
) values (
  true,
  'deepseek-v4-pro',
  0,
  statement_timestamp()
);

alter table public.model_default_policy enable row level security;
alter table public.model_default_policy_history enable row level security;

revoke all on public.model_default_policy from anon, authenticated;
revoke all on public.model_default_policy_history from anon, authenticated;
revoke all on sequence public.model_default_policy_revision_seq from anon, authenticated;

grant select, update on public.model_default_policy to service_role;
grant select on public.model_default_policy_history to service_role;

create function public.guard_global_default_model()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.model_default_policy as policy
    where policy.model_id = old.model_id
  ) then
    if tg_op = 'DELETE' then
      raise exception 'the global default model must remain available to all users'
        using errcode = '23514';
    end if;

    if not new.enabled
      or (new.is_dynamic and new.access_scope is distinct from 'all') then
      raise exception 'the global default model must remain available to all users'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger model_settings_guard_global_default
before update or delete on public.model_settings
for each row execute function public.guard_global_default_model();

revoke all on function public.guard_global_default_model()
  from public, anon, authenticated;

create function public.update_global_default_model(
  p_admin_user_id uuid,
  p_model_id text,
  p_expected_revision bigint
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  target record;
begin
  if p_admin_user_id is null
    or p_model_id is null
    or p_expected_revision is null
    or p_expected_revision <= 0 then
    raise exception 'default model change is incomplete' using errcode = '22023';
  end if;

  select enabled, is_dynamic, access_scope
  into target
  from public.model_settings
  where model_id = p_model_id;

  if not found then
    raise exception 'default model does not exist' using errcode = '23503';
  end if;

  if not target.enabled
    or (target.is_dynamic and target.access_scope is distinct from 'all') then
    raise exception 'default model must be available to all users' using errcode = '23514';
  end if;

  update public.model_default_policy
  set model_id = p_model_id,
      updated_by = p_admin_user_id
  where id
    and revision = p_expected_revision;

  if not found then
    raise exception 'default model policy changed concurrently' using errcode = '40001';
  end if;
end;
$$;

revoke all on function public.update_global_default_model(uuid, text, bigint)
  from public, anon, authenticated;
grant execute on function public.update_global_default_model(uuid, text, bigint)
  to service_role;

create function public.update_model_image(
  p_admin_user_id uuid,
  p_model_id text,
  p_expected_revision bigint,
  p_image_asset_id uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  current_image_asset_id uuid;
begin
  if p_admin_user_id is null
    or p_model_id is null
    or p_expected_revision is null
    or p_expected_revision <= 0 then
    raise exception 'model image change is incomplete' using errcode = '22023';
  end if;

  if p_image_asset_id is not null
    and not exists (
      select 1
      from public.model_image_assets
      where id = p_image_asset_id
    ) then
    raise exception 'model image does not exist' using errcode = '23503';
  end if;

  select image_asset_id
  into current_image_asset_id
  from public.model_settings
  where model_id = p_model_id
    and revision = p_expected_revision
  for update;

  if not found then
    raise exception 'model settings changed concurrently' using errcode = '40001';
  end if;

  if current_image_asset_id is not distinct from p_image_asset_id then
    return;
  end if;

  update public.model_settings
  set image_asset_id = p_image_asset_id,
      updated_by = p_admin_user_id
  where model_id = p_model_id
    and revision = p_expected_revision;

  if not found then
    raise exception 'model settings changed concurrently' using errcode = '40001';
  end if;
end;
$$;

revoke all on function public.update_model_image(uuid, text, bigint, uuid)
  from public, anon, authenticated;
grant execute on function public.update_model_image(uuid, text, bigint, uuid)
  to service_role;
