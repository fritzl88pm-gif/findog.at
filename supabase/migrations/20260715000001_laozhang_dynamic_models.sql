-- Add dynamic model columns to model_settings
alter table public.model_settings
  add column display_name text,
  add column upstream_model text,
  add column is_dynamic boolean not null default false,
  add column always_enabled boolean not null default false;

-- Update check constraints
alter table public.model_settings
  drop constraint if exists model_settings_model_id_check;

alter table public.model_settings
  add constraint model_settings_model_id_check check (
    model_id in (
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'glm-5.2',
      'glm-5-turbo'
    )
    or model_id ~ '^laozhang:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );

alter table public.model_settings
  drop constraint if exists model_settings_reasoning_check;

alter table public.model_settings
  add constraint model_settings_reasoning_check check (
    (
      is_dynamic
      and reasoning_setting = 'disabled'
    )
    or (
      not is_dynamic
      and model_id in ('deepseek-v4-flash', 'deepseek-v4-pro', 'glm-5.2')
      and reasoning_setting in ('disabled', 'high', 'max')
    )
    or (
      not is_dynamic
      and model_id = 'glm-5-turbo'
      and reasoning_setting in ('disabled', 'enabled')
    )
  );

-- Dynamic models always have reasoning disabled, start disabled, never always-enabled
alter table public.model_settings
  add constraint model_settings_dynamic_reasoning_check check (
    not is_dynamic or reasoning_setting = 'disabled'
  );

alter table public.model_settings
  add constraint model_settings_dynamic_enabled_check check (
    not is_dynamic or (always_enabled = false)
  );

-- Enforce uniqueness of (provider, upstream_model) for dynamic models
-- Backfill upstream_model for built-ins first
-- These deterministic schema backfills have no administrator actor. The
-- existing BEFORE trigger rejects actor-less updates and the AFTER trigger
-- would write history rows before the matching history columns exist. History
-- itself is backfilled below, so suspend both triggers only for this block.
alter table public.model_settings disable trigger model_settings_prepare_change;
alter table public.model_settings disable trigger model_settings_append_history;

update public.model_settings set upstream_model = model_id where upstream_model is null;

alter table public.model_settings
  alter column upstream_model set not null;

-- For built-in models, provider is inherent. Dynamic models must have provider='laozhang'.
alter table public.model_settings
  add column provider text;

update public.model_settings set provider = 'deepseek' where model_id in ('deepseek-v4-flash', 'deepseek-v4-pro');
update public.model_settings set provider = 'zai' where model_id in ('glm-5.2', 'glm-5-turbo');

alter table public.model_settings
  alter column provider set not null;

-- Backfill display_name for built-in models
update public.model_settings set display_name = 'DeepSeek v4 Flash' where model_id = 'deepseek-v4-flash';
update public.model_settings set display_name = 'DeepSeek v4 Pro' where model_id = 'deepseek-v4-pro';
update public.model_settings set display_name = 'GLM-5.2' where model_id = 'glm-5.2';
update public.model_settings set display_name = 'GLM-5-Turbo' where model_id = 'glm-5-turbo';

alter table public.model_settings
  alter column display_name set not null;

-- Backfill always_enabled for built-in models
update public.model_settings set always_enabled = true where model_id = 'deepseek-v4-flash';

alter table public.model_settings enable trigger model_settings_append_history;
alter table public.model_settings enable trigger model_settings_prepare_change;

-- Add provider check: built-in must be deepseek/zai, dynamic must be laozhang
alter table public.model_settings
  add constraint model_settings_provider_check check (
    (is_dynamic and provider = 'laozhang')
    or (not is_dynamic and provider in ('deepseek', 'zai'))
  );

alter table public.model_settings
  add constraint model_settings_catalog_metadata_check check (
    (
      is_dynamic
      and model_id ~ '^laozhang:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and provider = 'laozhang'
      and always_enabled = false
      and reasoning_setting = 'disabled'
    )
    or (
      not is_dynamic
      and (
        (
          model_id = 'deepseek-v4-flash'
          and display_name = 'DeepSeek v4 Flash'
          and provider = 'deepseek'
          and upstream_model = 'deepseek-v4-flash'
          and always_enabled = true
        )
        or (
          model_id = 'deepseek-v4-pro'
          and display_name = 'DeepSeek v4 Pro'
          and provider = 'deepseek'
          and upstream_model = 'deepseek-v4-pro'
          and always_enabled = false
        )
        or (
          model_id = 'glm-5.2'
          and display_name = 'GLM-5.2'
          and provider = 'zai'
          and upstream_model = 'glm-5.2'
          and always_enabled = false
        )
        or (
          model_id = 'glm-5-turbo'
          and display_name = 'GLM-5-Turbo'
          and provider = 'zai'
          and upstream_model = 'glm-5-turbo'
          and always_enabled = false
        )
      )
    )
  );

-- Unique constraint: for dynamic models, (provider, upstream_model) must be unique
create unique index model_settings_dynamic_provider_upstream_unique
  on public.model_settings (provider, upstream_model)
  where is_dynamic;

-- Add length and control-character constraints for display_name and upstream_model
alter table public.model_settings
  add constraint model_settings_display_name_check check (
    length(display_name) between 1 and 120
    and display_name !~ '[\x00-\x1f\x7f]'
  );

alter table public.model_settings
  add constraint model_settings_upstream_model_check check (
    length(upstream_model) between 1 and 120
    and upstream_model !~ '[\x00-\x1f\x7f]'
  );

-- Now update model_settings_history with matching columns
alter table public.model_settings_history
  add column display_name text,
  add column upstream_model text,
  add column is_dynamic boolean not null default false,
  add column always_enabled boolean not null default false,
  add column provider text;

update public.model_settings_history set upstream_model = model_id where upstream_model is null;
update public.model_settings_history set provider = 'deepseek' where model_id in ('deepseek-v4-flash', 'deepseek-v4-pro');
update public.model_settings_history set provider = 'zai' where model_id in ('glm-5.2', 'glm-5-turbo');

update public.model_settings_history set display_name = 'DeepSeek v4 Flash' where model_id = 'deepseek-v4-flash';
update public.model_settings_history set display_name = 'DeepSeek v4 Pro' where model_id = 'deepseek-v4-pro';
update public.model_settings_history set display_name = 'GLM-5.2' where model_id = 'glm-5.2';
update public.model_settings_history set display_name = 'GLM-5-Turbo' where model_id = 'glm-5-turbo';
update public.model_settings_history set always_enabled = true where model_id = 'deepseek-v4-flash';

alter table public.model_settings_history
  alter column upstream_model set not null,
  alter column provider set not null,
  alter column display_name set not null;

alter table public.model_settings_history
  add constraint model_settings_history_provider_check check (
    (is_dynamic and provider = 'laozhang')
    or (not is_dynamic and provider in ('deepseek', 'zai'))
  );

alter table public.model_settings_history
  add constraint model_settings_history_catalog_metadata_check check (
    (
      is_dynamic
      and model_id ~ '^laozhang:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and provider = 'laozhang'
      and always_enabled = false
      and reasoning_setting = 'disabled'
    )
    or (
      not is_dynamic
      and (
        (
          model_id = 'deepseek-v4-flash'
          and display_name = 'DeepSeek v4 Flash'
          and provider = 'deepseek'
          and upstream_model = 'deepseek-v4-flash'
          and always_enabled = true
        )
        or (
          model_id = 'deepseek-v4-pro'
          and display_name = 'DeepSeek v4 Pro'
          and provider = 'deepseek'
          and upstream_model = 'deepseek-v4-pro'
          and always_enabled = false
        )
        or (
          model_id = 'glm-5.2'
          and display_name = 'GLM-5.2'
          and provider = 'zai'
          and upstream_model = 'glm-5.2'
          and always_enabled = false
        )
        or (
          model_id = 'glm-5-turbo'
          and display_name = 'GLM-5-Turbo'
          and provider = 'zai'
          and upstream_model = 'glm-5-turbo'
          and always_enabled = false
        )
      )
    )
  );

alter table public.model_settings_history
  drop constraint if exists model_settings_history_model_id_check;

alter table public.model_settings_history
  add constraint model_settings_history_model_id_check check (
    model_id in (
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'glm-5.2',
      'glm-5-turbo'
    )
    or model_id ~ '^laozhang:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );

alter table public.model_settings_history
  drop constraint if exists model_settings_history_reasoning_check;

alter table public.model_settings_history
  add constraint model_settings_history_reasoning_check check (
    (
      is_dynamic
      and reasoning_setting = 'disabled'
    )
    or (
      not is_dynamic
      and model_id in ('deepseek-v4-flash', 'deepseek-v4-pro', 'glm-5.2')
      and reasoning_setting in ('disabled', 'high', 'max')
    )
    or (
      not is_dynamic
      and model_id = 'glm-5-turbo'
      and reasoning_setting in ('disabled', 'enabled')
    )
  );

-- Add length and control-character constraints to history
alter table public.model_settings_history
  add constraint model_settings_history_display_name_check check (
    length(display_name) between 1 and 120
    and display_name !~ '[\x00-\x1f\x7f]'
  );

alter table public.model_settings_history
  add constraint model_settings_history_upstream_model_check check (
    length(upstream_model) between 1 and 120
    and upstream_model !~ '[\x00-\x1f\x7f]'
  );

-- Replace the append_model_settings_history function to write all new columns
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
    previous_enabled,
    previous_reasoning_setting,
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
    case when tg_op = 'UPDATE' then old.enabled else null end,
    case when tg_op = 'UPDATE' then old.reasoning_setting else null end,
    new.updated_at,
    new.updated_by
  );

  return new;
end;
$$;

revoke all on function public.append_model_settings_history()
  from public, anon, authenticated;

-- Update agent_runs and messages constraints to allow laozhang provider and dynamic model IDs

-- agent_runs
alter table public.agent_runs
  drop constraint if exists agent_runs_model_provider_check;

alter table public.agent_runs
  add constraint agent_runs_model_provider_check
    check (model_provider is null or model_provider in ('deepseek', 'zai', 'laozhang'));

alter table public.agent_runs
  drop constraint if exists agent_runs_model_provider_upstream_check;

alter table public.agent_runs
  add constraint agent_runs_model_provider_upstream_check
    check (
      model_settings_source is null
      or model_settings_source = 'legacy'
      or (
        model = 'deepseek-v4-flash'
        and model_provider = 'deepseek'
        and upstream_model = 'deepseek-v4-flash'
      )
      or (
        model = 'deepseek-v4-pro'
        and model_provider = 'deepseek'
        and upstream_model = 'deepseek-v4-pro'
      )
      or (
        model = 'glm-5.2'
        and model_provider = 'zai'
        and upstream_model = 'glm-5.2'
      )
      or (
        model = 'glm-5-turbo'
        and model_provider = 'zai'
        and upstream_model = 'glm-5-turbo'
      )
      or (
        model ~ '^laozhang:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and model_provider = 'laozhang'
      )
    );

-- messages
alter table public.messages
  drop constraint if exists messages_model_provider_check;

alter table public.messages
  add constraint messages_model_provider_check
    check (model_provider is null or model_provider in ('deepseek', 'zai', 'laozhang'));

alter table public.messages
  drop constraint if exists messages_model_provider_upstream_check;

alter table public.messages
  add constraint messages_model_provider_upstream_check
    check (
      model_settings_source is null
      or model_settings_source = 'legacy'
      or (
        model = 'deepseek-v4-flash'
        and model_provider = 'deepseek'
        and upstream_model = 'deepseek-v4-flash'
      )
      or (
        model = 'deepseek-v4-pro'
        and model_provider = 'deepseek'
        and upstream_model = 'deepseek-v4-pro'
      )
      or (
        model = 'glm-5.2'
        and model_provider = 'zai'
        and upstream_model = 'glm-5.2'
      )
      or (
        model = 'glm-5-turbo'
        and model_provider = 'zai'
        and upstream_model = 'glm-5-turbo'
      )
      or (
        model ~ '^laozhang:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and model_provider = 'laozhang'
      )
    );

-- Create a function to insert a new dynamic model
-- Does NOT consume revision_seq directly; the BEFORE trigger assigns revision and timestamp.
create function public.create_dynamic_model(
  p_model_id text,
  p_display_name text,
  p_upstream_model text,
  p_created_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_model_id is null or not p_model_id ~ '^laozhang:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'invalid dynamic model id format' using errcode = '22023';
  end if;

  if p_created_by is null then
    raise exception 'administrator id is required' using errcode = '22023';
  end if;

  if p_display_name is null or length(trim(p_display_name)) = 0 then
    raise exception 'display name is required' using errcode = '22023';
  end if;

  if p_upstream_model is null or length(trim(p_upstream_model)) = 0 then
    raise exception 'upstream model id is required' using errcode = '22023';
  end if;

  insert into public.model_settings (
    model_id,
    display_name,
    provider,
    upstream_model,
    is_dynamic,
    always_enabled,
    enabled,
    reasoning_setting,
    updated_by
  ) values (
    p_model_id,
    trim(p_display_name),
    'laozhang',
    trim(p_upstream_model),
    true,
    false,
    false,
    'disabled',
    p_created_by
  );
end;
$$;

revoke all on function public.create_dynamic_model(text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.create_dynamic_model(text, text, text, uuid)
  to service_role;
