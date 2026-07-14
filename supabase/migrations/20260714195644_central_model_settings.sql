create sequence public.model_settings_revision_seq as bigint;

create table public.model_settings (
  model_id text primary key,
  enabled boolean not null,
  reasoning_setting text not null,
  revision bigint not null,
  updated_at timestamptz not null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint model_settings_model_id_check check (
    model_id in (
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'glm-5.2',
      'glm-5-turbo'
    )
  ),
  constraint model_settings_reasoning_check check (
    (
      model_id in ('deepseek-v4-flash', 'deepseek-v4-pro', 'glm-5.2')
      and reasoning_setting in ('disabled', 'high', 'max')
    )
    or (
      model_id = 'glm-5-turbo'
      and reasoning_setting in ('disabled', 'enabled')
    )
  ),
  constraint model_settings_flash_enabled_check check (
    model_id <> 'deepseek-v4-flash' or enabled
  )
);

create table public.model_settings_history (
  revision bigint primary key,
  model_id text not null,
  operation text not null check (operation in ('insert', 'update')),
  enabled boolean not null,
  reasoning_setting text not null,
  previous_enabled boolean,
  previous_reasoning_setting text,
  changed_at timestamptz not null,
  changed_by uuid,
  constraint model_settings_history_model_id_check check (
    model_id in (
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'glm-5.2',
      'glm-5-turbo'
    )
  ),
  constraint model_settings_history_reasoning_check check (
    (
      model_id in ('deepseek-v4-flash', 'deepseek-v4-pro', 'glm-5.2')
      and reasoning_setting in ('disabled', 'high', 'max')
    )
    or (
      model_id = 'glm-5-turbo'
      and reasoning_setting in ('disabled', 'enabled')
    )
  ),
  constraint model_settings_history_revision_model_reasoning_key
    unique (revision, model_id, reasoning_setting)
);

create index model_settings_updated_by_idx
  on public.model_settings (updated_by)
  where updated_by is not null;

create index model_settings_history_model_changed_idx
  on public.model_settings_history (model_id, changed_at desc, revision desc);

create index model_settings_history_changed_by_idx
  on public.model_settings_history (changed_by)
  where changed_by is not null;

create function public.prepare_model_settings_change()
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

create function public.append_model_settings_history()
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
    case when tg_op = 'UPDATE' then old.enabled else null end,
    case when tg_op = 'UPDATE' then old.reasoning_setting else null end,
    new.updated_at,
    new.updated_by
  );

  return new;
end;
$$;

create trigger model_settings_prepare_change
before insert or update on public.model_settings
for each row execute function public.prepare_model_settings_change();

create trigger model_settings_append_history
after insert or update on public.model_settings
for each row execute function public.append_model_settings_history();

revoke all on function public.prepare_model_settings_change()
  from public, anon, authenticated;
revoke all on function public.append_model_settings_history()
  from public, anon, authenticated;

insert into public.model_settings (model_id, enabled, reasoning_setting, revision, updated_at)
values
  ('deepseek-v4-flash', true, 'disabled', 0, statement_timestamp()),
  ('deepseek-v4-pro', true, 'high', 0, statement_timestamp()),
  ('glm-5.2', false, 'max', 0, statement_timestamp()),
  ('glm-5-turbo', false, 'enabled', 0, statement_timestamp());

alter table public.model_settings enable row level security;
alter table public.model_settings_history enable row level security;

revoke all on public.model_settings from anon, authenticated;
revoke all on public.model_settings_history from anon, authenticated;
revoke all on sequence public.model_settings_revision_seq from anon, authenticated;

grant usage on schema public to service_role;
grant select, insert, update on public.model_settings to service_role;
grant select on public.model_settings_history to service_role;

create function public.update_model_settings(
  p_admin_user_id uuid,
  p_changes jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  setting record;
begin
  if p_admin_user_id is null then
    raise exception 'administrator id is required' using errcode = '22023';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) is distinct from 'array' then
    raise exception 'model setting changes must be a non-empty array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_changes) = 0 then
    raise exception 'model setting changes must be a non-empty array' using errcode = '22023';
  end if;

  for setting in
    select *
    from jsonb_to_recordset(p_changes) as change(
      model_id text,
      enabled boolean,
      reasoning_setting text,
      expected_revision bigint
    )
  loop
    if setting.model_id is null
      or setting.enabled is null
      or setting.reasoning_setting is null
      or setting.expected_revision is null then
      raise exception 'model setting change is incomplete' using errcode = '22023';
    end if;

    update public.model_settings
    set
      enabled = setting.enabled,
      reasoning_setting = setting.reasoning_setting,
      updated_by = p_admin_user_id
    where model_id = setting.model_id
      and revision = setting.expected_revision;

    if not found then
      raise exception 'model settings changed concurrently' using errcode = '40001';
    end if;
  end loop;
end;
$$;

revoke all on function public.update_model_settings(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.update_model_settings(uuid, jsonb)
  to service_role;

alter table public.agent_runs
  add column model_provider text,
  add column upstream_model text,
  add column reasoning_setting text,
  add column model_settings_revision bigint,
  add column model_settings_source text;

update public.agent_runs
set
  model_provider = 'deepseek',
  upstream_model = model,
  model_settings_source = 'legacy'
where model_provider is null;

alter table public.agent_runs
  add constraint agent_runs_model_provider_check
    check (model_provider is null or model_provider in ('deepseek', 'zai')),
  add constraint agent_runs_reasoning_setting_check
    check (
      reasoning_setting is null
      or reasoning_setting in ('disabled', 'enabled', 'high', 'max')
    ),
  add constraint agent_runs_model_settings_source_check
    check (
      model_settings_source is null
      or model_settings_source in ('database', 'fallback', 'legacy')
    ),
  add constraint agent_runs_model_settings_revision_source_check
    check (
      (model_settings_source is null and model_settings_revision is null)
      or (model_settings_source = 'database' and model_settings_revision is not null)
      or (model_settings_source in ('fallback', 'legacy') and model_settings_revision is null)
    ),
  add constraint agent_runs_model_provenance_completeness_check
    check (
      (
        model_settings_source is null
        and model_provider is null
        and upstream_model is null
        and reasoning_setting is null
        and model_settings_revision is null
      )
      or (
        model_settings_source = 'legacy'
        and model_provider is not null
        and upstream_model is not null
        and model_settings_revision is null
      )
      or (
        model_settings_source in ('database', 'fallback')
        and model_provider is not null
        and upstream_model is not null
        and reasoning_setting is not null
      )
    ),
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
    ),
  add constraint agent_runs_fallback_model_check
    check (
      model_settings_source is distinct from 'fallback'
      or (
        model = 'deepseek-v4-flash'
        and model_provider = 'deepseek'
        and upstream_model = 'deepseek-v4-flash'
        and reasoning_setting = 'disabled'
        and model_settings_revision is null
      )
    ),
  add constraint agent_runs_model_settings_revision_model_reasoning_fkey
    foreign key (model_settings_revision, model, reasoning_setting)
    references public.model_settings_history (revision, model_id, reasoning_setting);

create index agent_runs_model_settings_revision_idx
  on public.agent_runs (model_settings_revision)
  where model_settings_revision is not null;

alter table public.messages
  add column model text,
  add column model_provider text,
  add column upstream_model text,
  add column reasoning_setting text,
  add column model_settings_revision bigint,
  add column model_settings_source text;

update public.messages as message
set
  model = agent_run.model,
  model_provider = agent_run.model_provider,
  upstream_model = agent_run.upstream_model,
  reasoning_setting = agent_run.reasoning_setting,
  model_settings_revision = agent_run.model_settings_revision,
  model_settings_source = agent_run.model_settings_source
from public.agent_runs as agent_run
where agent_run.assistant_message_id = message.id
  and message.role = 'assistant';

alter table public.messages
  add constraint messages_model_provider_check
    check (model_provider is null or model_provider in ('deepseek', 'zai')),
  add constraint messages_reasoning_setting_check
    check (
      reasoning_setting is null
      or reasoning_setting in ('disabled', 'enabled', 'high', 'max')
    ),
  add constraint messages_model_settings_source_check
    check (
      model_settings_source is null
      or model_settings_source in ('database', 'fallback', 'legacy')
    ),
  add constraint messages_model_settings_revision_source_check
    check (
      (model_settings_source is null and model_settings_revision is null)
      or (model_settings_source = 'database' and model_settings_revision is not null)
      or (model_settings_source in ('fallback', 'legacy') and model_settings_revision is null)
    ),
  add constraint messages_model_provenance_completeness_check
    check (
      (
        model_settings_source is null
        and model is null
        and model_provider is null
        and upstream_model is null
        and reasoning_setting is null
      )
      or (
        role = 'assistant'
        and model_settings_source is not null
        and model is not null
        and model_provider is not null
        and upstream_model is not null
        and (model_settings_source = 'legacy' or reasoning_setting is not null)
      )
    ),
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
    ),
  add constraint messages_fallback_model_check
    check (
      model_settings_source is distinct from 'fallback'
      or (
        model = 'deepseek-v4-flash'
        and model_provider = 'deepseek'
        and upstream_model = 'deepseek-v4-flash'
        and reasoning_setting = 'disabled'
        and model_settings_revision is null
      )
    ),
  add constraint messages_model_settings_revision_model_reasoning_fkey
    foreign key (model_settings_revision, model, reasoning_setting)
    references public.model_settings_history (revision, model_id, reasoning_setting);

create index messages_model_settings_revision_idx
  on public.messages (model_settings_revision)
  where model_settings_revision is not null;

create function public.derive_agent_run_model_provenance()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  assistant_provenance record;
begin
  if new.assistant_message_id is null then
    return new;
  end if;

  select
    message.model,
    message.model_provider,
    message.upstream_model,
    message.reasoning_setting,
    message.model_settings_revision,
    message.model_settings_source
  into assistant_provenance
  from public.messages as message
  where message.id = new.assistant_message_id
    and message.role = 'assistant'
    and message.conversation_id = new.conversation_id
    and message.client_id = new.client_id;

  if not found then
    raise exception 'agent run requires an assistant message'
      using errcode = '23514';
  end if;

  if assistant_provenance.model_settings_source is null
    or assistant_provenance.model_settings_source not in ('database', 'fallback') then
    return new;
  end if;

  new.model := assistant_provenance.model;
  new.model_provider := assistant_provenance.model_provider;
  new.upstream_model := assistant_provenance.upstream_model;
  new.reasoning_setting := assistant_provenance.reasoning_setting;
  new.model_settings_revision := assistant_provenance.model_settings_revision;
  new.model_settings_source := assistant_provenance.model_settings_source;
  return new;
end;
$$;

create trigger agent_runs_derive_model_provenance
before insert on public.agent_runs
for each row execute function public.derive_agent_run_model_provenance();

revoke all on function public.derive_agent_run_model_provenance()
  from public, anon, authenticated;
