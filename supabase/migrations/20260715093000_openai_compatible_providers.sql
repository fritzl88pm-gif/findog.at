alter table public.model_settings
  add column base_url text,
  add column access_scope text,
  add column api_key_ciphertext text;

alter table public.model_settings_history
  add column base_url text,
  add column access_scope text;

alter table public.model_settings_history
  alter column display_name drop not null;

delete from public.model_settings
where provider = 'laozhang';

drop index if exists public.model_settings_dynamic_provider_upstream_unique;

alter table public.model_settings
  alter column display_name drop not null;

alter table public.model_settings
  drop constraint if exists model_settings_model_id_check,
  drop constraint if exists model_settings_reasoning_check,
  drop constraint if exists model_settings_dynamic_reasoning_check,
  drop constraint if exists model_settings_dynamic_enabled_check,
  drop constraint if exists model_settings_provider_check,
  drop constraint if exists model_settings_catalog_metadata_check,
  drop constraint if exists model_settings_display_name_check,
  drop constraint if exists model_settings_upstream_model_check;

alter table public.model_settings
  add constraint model_settings_model_id_check check (
    model_id in ('deepseek-v4-flash', 'deepseek-v4-pro', 'glm-5.2', 'glm-5-turbo')
    or model_id ~ '^openai:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  add constraint model_settings_reasoning_check check (
    (model_id in ('deepseek-v4-flash', 'deepseek-v4-pro', 'glm-5.2') and reasoning_setting in ('disabled', 'high', 'max'))
    or (model_id = 'glm-5-turbo' and reasoning_setting in ('disabled', 'enabled'))
    or (is_dynamic and reasoning_setting = 'disabled')
  ),
  add constraint model_settings_dynamic_enabled_check check (not is_dynamic or not always_enabled),
  add constraint model_settings_provider_check check (
    (not is_dynamic and provider in ('deepseek', 'zai'))
    or (is_dynamic and provider = 'openai_compatible')
  ),
  add constraint model_settings_catalog_metadata_check check (
    (model_id = 'deepseek-v4-flash' and not is_dynamic and display_name = 'DeepSeek v4 Flash' and provider = 'deepseek' and upstream_model = 'deepseek-v4-flash' and always_enabled)
    or (model_id = 'deepseek-v4-pro' and not is_dynamic and display_name = 'DeepSeek v4 Pro' and provider = 'deepseek' and upstream_model = 'deepseek-v4-pro' and not always_enabled)
    or (model_id = 'glm-5.2' and not is_dynamic and display_name = 'GLM-5.2' and provider = 'zai' and upstream_model = 'glm-5.2' and not always_enabled)
    or (model_id = 'glm-5-turbo' and not is_dynamic and display_name = 'GLM-5-Turbo' and provider = 'zai' and upstream_model = 'glm-5-turbo' and not always_enabled)
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
  ),
  add constraint model_settings_display_name_check check (
    display_name is null
    or (length(display_name) between 1 and 120 and display_name !~ '[[:cntrl:]]')
  ),
  add constraint model_settings_upstream_model_check check (
    length(upstream_model) between 1 and 120 and upstream_model !~ '[[:cntrl:]]'
  ),
  add constraint model_settings_base_url_check check (
    (not is_dynamic and base_url is null)
    or (
      is_dynamic
      and length(base_url) between 1 and 2048
      and base_url ~ '^https?://[^/?#]+(?:/[^?#]*)?$'
      and position('?' in base_url) = 0
      and position('#' in base_url) = 0
      and position('@' in split_part(split_part(base_url, '://', 2), '/', 1)) = 0
    )
  ),
  add constraint model_settings_access_scope_check check (
    (not is_dynamic and access_scope is null)
    or (is_dynamic and access_scope in ('disabled', 'admins', 'all'))
  ),
  add constraint model_settings_dynamic_enabled_scope_check check (
    not is_dynamic or enabled = (access_scope <> 'disabled')
  ),
  add constraint model_settings_api_key_ciphertext_check check (
    (not is_dynamic and api_key_ciphertext is null)
    or (is_dynamic and length(api_key_ciphertext) between 1 and 2048 and api_key_ciphertext ~ '^v1[.]')
  );

create unique index model_settings_dynamic_provider_url_upstream_unique
  on public.model_settings (provider, base_url, upstream_model)
  where is_dynamic;

alter table public.model_settings_history
  drop constraint if exists model_settings_history_model_id_check,
  drop constraint if exists model_settings_history_reasoning_check,
  drop constraint if exists model_settings_history_provider_check,
  drop constraint if exists model_settings_history_catalog_metadata_check,
  drop constraint if exists model_settings_history_display_name_check,
  drop constraint if exists model_settings_history_upstream_model_check;

alter table public.model_settings_history
  add constraint model_settings_history_model_id_check check (
    model_id in ('deepseek-v4-flash', 'deepseek-v4-pro', 'glm-5.2', 'glm-5-turbo')
    or model_id ~ '^openai:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or model_id ~ '^laozhang:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  add constraint model_settings_history_reasoning_check check (
    reasoning_setting in ('disabled', 'enabled', 'high', 'max')
  ),
  add constraint model_settings_history_provider_check check (
    provider in ('deepseek', 'zai', 'openai_compatible', 'laozhang')
  ),
  add constraint model_settings_history_catalog_metadata_check check (
    (not is_dynamic and provider in ('deepseek', 'zai'))
    or (is_dynamic and provider = 'openai_compatible' and model_id ~ '^openai:')
    or (is_dynamic and provider = 'laozhang' and model_id ~ '^laozhang:')
  ),
  add constraint model_settings_history_display_name_check check (
    display_name is null
    or (length(display_name) between 1 and 120 and display_name !~ '[[:cntrl:]]')
  ),
  add constraint model_settings_history_upstream_model_check check (
    length(upstream_model) between 1 and 120 and upstream_model !~ '[[:cntrl:]]'
  ),
  add constraint model_settings_history_base_url_check check (
    base_url is null or length(base_url) between 1 and 2048
  ),
  add constraint model_settings_history_access_scope_check check (
    access_scope is null or access_scope in ('disabled', 'admins', 'all')
  );

create or replace function public.append_model_settings_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.model_settings_history (
    revision, model_id, operation, enabled, reasoning_setting, display_name,
    provider, upstream_model, is_dynamic, always_enabled, base_url, access_scope,
    previous_enabled, previous_reasoning_setting, changed_at, changed_by
  ) values (
    new.revision, new.model_id, lower(tg_op), new.enabled, new.reasoning_setting,
    new.display_name, new.provider, new.upstream_model, new.is_dynamic,
    new.always_enabled, new.base_url, new.access_scope,
    case when tg_op = 'UPDATE' then old.enabled else null end,
    case when tg_op = 'UPDATE' then old.reasoning_setting else null end,
    new.updated_at, new.updated_by
  );
  return new;
end;
$$;

revoke all on function public.append_model_settings_history()
  from public, anon, authenticated;

alter table public.agent_runs
  drop constraint if exists agent_runs_model_provider_check,
  drop constraint if exists agent_runs_model_provider_upstream_check;

alter table public.agent_runs
  add constraint agent_runs_model_provider_check
    check (model_provider is null or model_provider in ('deepseek', 'zai', 'openai_compatible', 'laozhang')),
  add constraint agent_runs_model_provider_upstream_check check (
    model_settings_source is null or model_settings_source = 'legacy'
    or (model = 'deepseek-v4-flash' and model_provider = 'deepseek' and upstream_model = 'deepseek-v4-flash')
    or (model = 'deepseek-v4-pro' and model_provider = 'deepseek' and upstream_model = 'deepseek-v4-pro')
    or (model = 'glm-5.2' and model_provider = 'zai' and upstream_model = 'glm-5.2')
    or (model = 'glm-5-turbo' and model_provider = 'zai' and upstream_model = 'glm-5-turbo')
    or (model ~ '^openai:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and model_provider = 'openai_compatible')
    or (model ~ '^laozhang:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and model_provider = 'laozhang')
  );

alter table public.messages
  drop constraint if exists messages_model_provider_check,
  drop constraint if exists messages_model_provider_upstream_check;

alter table public.messages
  add constraint messages_model_provider_check
    check (model_provider is null or model_provider in ('deepseek', 'zai', 'openai_compatible', 'laozhang')),
  add constraint messages_model_provider_upstream_check check (
    model_settings_source is null or model_settings_source = 'legacy'
    or (model = 'deepseek-v4-flash' and model_provider = 'deepseek' and upstream_model = 'deepseek-v4-flash')
    or (model = 'deepseek-v4-pro' and model_provider = 'deepseek' and upstream_model = 'deepseek-v4-pro')
    or (model = 'glm-5.2' and model_provider = 'zai' and upstream_model = 'glm-5.2')
    or (model = 'glm-5-turbo' and model_provider = 'zai' and upstream_model = 'glm-5-turbo')
    or (model ~ '^openai:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and model_provider = 'openai_compatible')
    or (model ~ '^laozhang:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' and model_provider = 'laozhang')
  );

drop function if exists public.create_dynamic_model(text, text, text, uuid);

create function public.create_openai_compatible_model(
  p_model_id text,
  p_upstream_model text,
  p_display_name text,
  p_base_url text,
  p_access_scope text,
  p_api_key_ciphertext text,
  p_admin_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_model_id is null or p_model_id !~ '^openai:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_admin_user_id is null
    or p_upstream_model is null or length(trim(p_upstream_model)) not between 1 and 120 or p_upstream_model ~ '[[:cntrl:]]'
    or (p_display_name is not null and (length(trim(p_display_name)) not between 1 and 120 or p_display_name ~ '[[:cntrl:]]'))
    or p_base_url is null or length(trim(p_base_url)) not between 1 and 2048
    or trim(p_base_url) !~ '^https?://[^/?#]+(?:/[^?#]*)?$'
    or position('?' in p_base_url) > 0 or position('#' in p_base_url) > 0
    or position('@' in split_part(split_part(p_base_url, '://', 2), '/', 1)) > 0
    or p_access_scope is null or p_access_scope not in ('disabled', 'admins', 'all')
    or p_api_key_ciphertext is null or length(p_api_key_ciphertext) not between 1 and 2048
    or p_api_key_ciphertext !~ '^v1[.]' then
    raise exception 'invalid openai-compatible model' using errcode = '22023';
  end if;

  insert into public.model_settings (
    model_id, display_name, provider, upstream_model, is_dynamic, always_enabled,
    enabled, reasoning_setting, base_url, access_scope, api_key_ciphertext, updated_by
  ) values (
    p_model_id, nullif(trim(p_display_name), ''), 'openai_compatible', trim(p_upstream_model),
    true, false, p_access_scope <> 'disabled', 'disabled', trim(trailing '/' from trim(p_base_url)),
    p_access_scope, p_api_key_ciphertext, p_admin_user_id
  );
end;
$$;

create function public.update_openai_compatible_model(
  p_model_id text,
  p_expected_revision bigint,
  p_upstream_model text,
  p_display_name text,
  p_base_url text,
  p_access_scope text,
  p_api_key_ciphertext text,
  p_admin_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_model_id is null or p_model_id !~ '^openai:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_expected_revision is null or p_expected_revision <= 0 or p_admin_user_id is null
    or p_upstream_model is null or length(trim(p_upstream_model)) not between 1 and 120 or p_upstream_model ~ '[[:cntrl:]]'
    or (p_display_name is not null and (length(trim(p_display_name)) not between 1 and 120 or p_display_name ~ '[[:cntrl:]]'))
    or p_base_url is null or length(trim(p_base_url)) not between 1 and 2048
    or trim(p_base_url) !~ '^https?://[^/?#]+(?:/[^?#]*)?$'
    or position('?' in p_base_url) > 0 or position('#' in p_base_url) > 0
    or position('@' in split_part(split_part(p_base_url, '://', 2), '/', 1)) > 0
    or p_access_scope is null or p_access_scope not in ('disabled', 'admins', 'all')
    or (p_api_key_ciphertext is not null and p_api_key_ciphertext <> '' and (length(p_api_key_ciphertext) not between 1 and 2048 or p_api_key_ciphertext !~ '^v1[.]')) then
    raise exception 'invalid openai-compatible model' using errcode = '22023';
  end if;

  update public.model_settings
  set upstream_model = trim(p_upstream_model),
      display_name = nullif(trim(p_display_name), ''),
      base_url = trim(trailing '/' from trim(p_base_url)),
      access_scope = p_access_scope,
      enabled = p_access_scope <> 'disabled',
      api_key_ciphertext = coalesce(nullif(p_api_key_ciphertext, ''), api_key_ciphertext),
      updated_by = p_admin_user_id
  where model_id = p_model_id
    and provider = 'openai_compatible'
    and revision = p_expected_revision;

  if not found then
    raise exception 'openai-compatible model revision conflict' using errcode = '40001';
  end if;
end;
$$;

create function public.delete_openai_compatible_model(
  p_model_id text,
  p_expected_revision bigint,
  p_admin_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_admin_user_id is null or p_expected_revision is null or p_expected_revision <= 0
    or p_model_id is null or p_model_id !~ '^openai:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'invalid openai-compatible model deletion' using errcode = '22023';
  end if;

  delete from public.model_settings
  where model_id = p_model_id
    and provider = 'openai_compatible'
    and revision = p_expected_revision;

  if not found then
    raise exception 'openai-compatible model revision conflict' using errcode = '40001';
  end if;
end;
$$;

revoke all on function public.create_openai_compatible_model(text, text, text, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.create_openai_compatible_model(text, text, text, text, text, text, uuid)
  to service_role;
revoke all on function public.update_openai_compatible_model(text, bigint, text, text, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.update_openai_compatible_model(text, bigint, text, text, text, text, text, uuid)
  to service_role;
revoke all on function public.delete_openai_compatible_model(text, bigint, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_openai_compatible_model(text, bigint, uuid)
  to service_role;
