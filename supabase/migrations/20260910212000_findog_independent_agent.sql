-- Findog Independent Agent (Preview) — Package 1 persistence foundation.
--
-- Feature-local tables for immutable settings revisions, conversations, messages,
-- runs and run events. All objects are deny-by-default (RLS enabled, no PUBLIC or
-- anon/authenticated grants) and only exposed to service_role. Lifecycle mutations
-- happen exclusively through the SQL functions below, which pin `search_path = ''`,
-- qualify every identifier, validate owner relationships and enforce lease fencing.
--
-- Note: `on delete set null (column)` requires PostgreSQL 15+ (Supabase is on 15+).

-- ==========================================================================
-- Tables
-- ==========================================================================

create table public.findog_agent_settings_versions (
  revision bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  settings jsonb not null,
  encrypted_credentials jsonb not null default '{}'::jsonb,
  constraint findog_agent_settings_versions_settings_object_check
    check (pg_catalog.jsonb_typeof(settings) = 'object'),
  constraint findog_agent_settings_versions_credentials_object_check
    check (pg_catalog.jsonb_typeof(encrypted_credentials) = 'object'),
  constraint findog_agent_settings_versions_settings_size_check
    check (pg_catalog.pg_column_size(settings) <= 262144),
  constraint findog_agent_settings_versions_credentials_size_check
    check (pg_catalog.pg_column_size(encrypted_credentials) <= 262144)
);

comment on table public.findog_agent_settings_versions is
  'Append-only immutable Findog Agent configuration revisions. Secrets live in encrypted_credentials only.';

create table public.findog_agent_settings_current (
  id integer primary key default 1,
  revision bigint not null references public.findog_agent_settings_versions(revision) on delete restrict,
  active_model_id text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint findog_agent_settings_current_singleton_check check (id = 1)
);

comment on table public.findog_agent_settings_current is
  'Singleton pointer to the active Findog Agent settings revision.';

create table public.findog_agent_conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint findog_agent_conversations_title_check
    check (title is null or pg_catalog.length(title) between 1 and 300),
  constraint findog_agent_conversations_id_owner_key unique (id, owner_id)
);

create index findog_agent_conversations_owner_created_idx
  on public.findog_agent_conversations (owner_id, created_at desc);

create table public.findog_agent_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  owner_id uuid not null,
  run_id uuid,
  role text not null,
  content text not null,
  is_partial boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint findog_agent_messages_role_check check (role in ('user', 'assistant')),
  constraint findog_agent_messages_content_check check (pg_catalog.length(content) <= 200000),
  constraint findog_agent_messages_id_owner_key unique (id, owner_id),
  constraint findog_agent_messages_conversation_owner_fkey
    foreign key (conversation_id, owner_id)
    references public.findog_agent_conversations (id, owner_id) on delete cascade
);

create index findog_agent_messages_conversation_created_idx
  on public.findog_agent_messages (conversation_id, created_at, id);
create index findog_agent_messages_run_idx
  on public.findog_agent_messages (run_id) where run_id is not null;

create table public.findog_agent_runs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  owner_id uuid not null,
  idempotency_key text not null,
  state text not null default 'queued',
  settings_revision bigint not null
    references public.findog_agent_settings_versions(revision) on delete restrict,
  user_message_id uuid,
  assistant_message_id uuid,
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  cancel_requested boolean not null default false,
  result jsonb,
  error jsonb,
  usage jsonb,
  cost jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  constraint findog_agent_runs_state_check
    check (state in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  constraint findog_agent_runs_idempotency_key_check
    check (pg_catalog.length(idempotency_key) between 1 and 200),
  constraint findog_agent_runs_attempt_count_check check (attempt_count >= 0),
  constraint findog_agent_runs_lease_consistency_check check (
    (state = 'running' and lease_token is not null and lease_expires_at is not null)
    or (state <> 'running' and lease_token is null and lease_expires_at is null)
  ),
  constraint findog_agent_runs_terminal_timestamp_check check (
    (state in ('succeeded', 'failed', 'cancelled')) = (finished_at is not null)
  ),
  constraint findog_agent_runs_cancel_consistency_check check (
    state <> 'cancelled' or cancel_requested
  ),
  constraint findog_agent_runs_owner_idempotency_key
    unique (owner_id, idempotency_key),
  constraint findog_agent_runs_id_owner_key unique (id, owner_id),
  constraint findog_agent_runs_conversation_owner_fkey
    foreign key (conversation_id, owner_id)
    references public.findog_agent_conversations (id, owner_id) on delete cascade,
  constraint findog_agent_runs_user_message_owner_fkey
    foreign key (user_message_id, owner_id)
    references public.findog_agent_messages (id, owner_id) on delete set null (user_message_id),
  constraint findog_agent_runs_assistant_message_owner_fkey
    foreign key (assistant_message_id, owner_id)
    references public.findog_agent_messages (id, owner_id) on delete set null (assistant_message_id)
);

comment on table public.findog_agent_runs is
  'Durable Findog Agent runs. At most one queued/running run per conversation.';

-- Database-enforced invariant: one active run per conversation.
create unique index findog_agent_runs_active_conversation_key
  on public.findog_agent_runs (conversation_id)
  where state in ('queued', 'running');

create index findog_agent_runs_queue_idx
  on public.findog_agent_runs (created_at, id)
  where state = 'queued';
create index findog_agent_runs_owner_created_idx
  on public.findog_agent_runs (owner_id, created_at desc);
create index findog_agent_runs_lease_idx
  on public.findog_agent_runs (lease_expires_at)
  where state = 'running';

create table public.findog_agent_run_events (
  id bigint generated always as identity primary key,
  run_id uuid not null,
  owner_id uuid not null,
  sequence bigint not null,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint findog_agent_run_events_kind_check check (kind in (
    'status', 'plan', 'step', 'tool_call', 'tool_result', 'source',
    'usage', 'output', 'error', 'heartbeat'
  )),
  constraint findog_agent_run_events_sequence_check check (sequence >= 1),
  constraint findog_agent_run_events_payload_check
    check (pg_catalog.jsonb_typeof(payload) = 'object'),
  constraint findog_agent_run_events_run_sequence_key unique (run_id, sequence),
  constraint findog_agent_run_events_run_owner_fkey
    foreign key (run_id, owner_id)
    references public.findog_agent_runs (id, owner_id) on delete cascade
);

comment on table public.findog_agent_run_events is
  'Append-only, per-run monotonic event stream used for reconnectable transport.';

-- ==========================================================================
-- Lifecycle functions
-- ==========================================================================

create or replace function public.reap_findog_agent_runs(p_limit integer default 200)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_expired integer := 0;
  v_unauthorized integer := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'findog agent reap limit is invalid' using errcode = '22023';
  end if;

  -- An expired active run is terminal. It is never silently retried against a
  -- paid provider; the operator has to start a new run explicitly.
  with expired as (
    select stale.id
    from public.findog_agent_runs as stale
    where stale.state = 'running'
      and (stale.lease_expires_at is null or stale.lease_expires_at <= now())
    order by stale.lease_expires_at asc nulls first
    limit p_limit
    for update skip locked
  )
  update public.findog_agent_runs as target
  set state = 'failed',
      error = pg_catalog.jsonb_build_object(
        'code', 'lease_expired',
        'message', 'findog agent run lease expired before completion'
      ),
      lease_token = null,
      lease_expires_at = null,
      finished_at = now(),
      updated_at = now()
  from expired
  where target.id = expired.id;
  get diagnostics v_expired = row_count;

  -- Queued or running work owned by a revoked administrator is failed, not executed.
  with unauthorized as (
    select orphaned.id
    from public.findog_agent_runs as orphaned
    where orphaned.state in ('queued', 'running')
      and not exists (
        select 1 from public.admin_users as admin where admin.user_id = orphaned.owner_id
      )
    order by orphaned.created_at, orphaned.id
    limit p_limit
    for update skip locked
  )
  update public.findog_agent_runs as target
  set state = 'failed',
      error = pg_catalog.jsonb_build_object(
        'code', 'owner_not_admin',
        'message', 'findog agent owner no longer has administrator access'
      ),
      lease_token = null,
      lease_expires_at = null,
      finished_at = now(),
      updated_at = now()
  from unauthorized
  where target.id = unauthorized.id;
  get diagnostics v_unauthorized = row_count;

  return v_expired + v_unauthorized;
end;
$$;

comment on function public.reap_findog_agent_runs(integer) is
  'Terminates expired leases and runs owned by revoked administrators. Returns the number of affected runs.';

create or replace function public.set_findog_agent_settings(
  p_expected_revision bigint,
  p_created_by uuid,
  p_settings jsonb,
  p_encrypted_credentials jsonb
)
returns table (revision bigint, created_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current bigint;
  v_revision bigint;
  v_created_at timestamptz;
begin
  if p_settings is null or pg_catalog.jsonb_typeof(p_settings) <> 'object'
    or p_encrypted_credentials is null
    or pg_catalog.jsonb_typeof(p_encrypted_credentials) <> 'object'
  then
    raise exception 'findog agent settings payload is invalid' using errcode = '22023';
  end if;

  if p_created_by is null
    or not exists (select 1 from public.admin_users as admin where admin.user_id = p_created_by)
  then
    raise exception 'findog agent settings author is not an administrator' using errcode = '42501';
  end if;

  if pg_catalog.jsonb_typeof(p_settings -> 'activeModelId') = 'string'
    and pg_catalog.btrim(p_settings ->> 'activeModelId') <> ''
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        case
          when pg_catalog.jsonb_typeof(p_settings -> 'models') = 'array'
            then p_settings -> 'models'
          else '[]'::jsonb
        end
      ) as model
      where model ->> 'id' = p_settings ->> 'activeModelId'
    )
  then
    raise exception 'findog agent active model is not part of the settings catalog'
      using errcode = '22023';
  end if;

  -- Serialize concurrent settings writers across the whole catalog.
  perform pg_catalog.pg_advisory_xact_lock(20260910212000);

  select current_settings.revision
  into v_current
  from public.findog_agent_settings_current as current_settings
  where current_settings.id = 1;

  if not found then
    if p_expected_revision is not null then
      raise exception 'findog agent settings changed concurrently' using errcode = '40001';
    end if;
  elsif p_expected_revision is distinct from v_current then
    raise exception 'findog agent settings changed concurrently' using errcode = '40001';
  end if;

  insert into public.findog_agent_settings_versions (created_by, settings, encrypted_credentials)
  values (p_created_by, p_settings, p_encrypted_credentials)
  returning findog_agent_settings_versions.revision, findog_agent_settings_versions.created_at
  into v_revision, v_created_at;

  insert into public.findog_agent_settings_current as current_settings (
    id, revision, active_model_id, updated_at, updated_by
  )
  values (
    1,
    v_revision,
    case
      when pg_catalog.jsonb_typeof(p_settings -> 'activeModelId') = 'string'
        and pg_catalog.btrim(p_settings ->> 'activeModelId') <> ''
        then p_settings ->> 'activeModelId'
      else null
    end,
    now(),
    p_created_by
  )
  on conflict (id) do update
  set revision = excluded.revision,
      active_model_id = excluded.active_model_id,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by;

  revision := v_revision;
  created_at := v_created_at;
  return next;
end;
$$;

comment on function public.set_findog_agent_settings(bigint, uuid, jsonb, jsonb) is
  'Appends an immutable settings revision and moves the singleton pointer with optimistic revision checking.';

create or replace function public.enqueue_findog_agent_run(
  p_owner_id uuid,
  p_conversation_id uuid,
  p_idempotency_key text,
  p_settings_revision bigint,
  p_question text,
  p_conversation_title text default null
)
returns setof public.findog_agent_runs
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run public.findog_agent_runs;
  v_message_id uuid;
begin
  if p_owner_id is null
    or p_conversation_id is null
    or p_idempotency_key is null
    or pg_catalog.btrim(p_idempotency_key) = ''
    or pg_catalog.length(p_idempotency_key) > 200
    or p_question is null
    or pg_catalog.btrim(p_question) = ''
    or pg_catalog.length(p_question) > 200000
    or (p_conversation_title is not null and pg_catalog.length(p_conversation_title) > 300)
  then
    raise exception 'findog agent enqueue payload is invalid' using errcode = '22023';
  end if;

  if not exists (select 1 from public.admin_users as admin where admin.user_id = p_owner_id) then
    raise exception 'findog agent owner is not an administrator' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.findog_agent_settings_versions as version
    where version.revision = p_settings_revision
  ) then
    raise exception 'findog agent settings revision does not exist' using errcode = '22023';
  end if;

  -- Idempotent replay: return the existing run without duplicating question or run.
  select existing.*
  into v_run
  from public.findog_agent_runs as existing
  where existing.owner_id = p_owner_id
    and existing.idempotency_key = p_idempotency_key;

  if found then
    return next v_run;
    return;
  end if;

  insert into public.findog_agent_conversations (id, owner_id, title)
  values (
    p_conversation_id,
    p_owner_id,
    nullif(pg_catalog.btrim(coalesce(p_conversation_title, '')), '')
  )
  on conflict (id) do nothing;

  if not exists (
    select 1
    from public.findog_agent_conversations as conversation
    where conversation.id = p_conversation_id
      and conversation.owner_id = p_owner_id
  ) then
    raise exception 'findog agent conversation is not owned by the requesting administrator'
      using errcode = '42501';
  end if;

  insert into public.findog_agent_messages (conversation_id, owner_id, role, content)
  values (p_conversation_id, p_owner_id, 'user', p_question)
  returning id into v_message_id;

  insert into public.findog_agent_runs (
    conversation_id, owner_id, idempotency_key, state, settings_revision, user_message_id
  )
  values (
    p_conversation_id, p_owner_id, p_idempotency_key, 'queued', p_settings_revision, v_message_id
  )
  returning * into v_run;

  return next v_run;
exception
  when unique_violation then
    raise exception 'findog agent conversation already has an active run' using errcode = '23505';
end;
$$;

comment on function public.enqueue_findog_agent_run(uuid, uuid, text, bigint, text, text) is
  'Atomically records the administrator question, conversation and queued run with owner-scoped idempotency.';

create or replace function public.claim_findog_agent_runs(
  p_lease_token uuid,
  p_lease_seconds integer default 90,
  p_limit integer default 1
)
returns setof public.findog_agent_runs
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_reaped integer;
begin
  if p_lease_token is null
    or p_lease_seconds is null or p_lease_seconds < 1 or p_lease_seconds > 3600
    or p_limit is null or p_limit < 1 or p_limit > 50
  then
    raise exception 'findog agent claim payload is invalid' using errcode = '22023';
  end if;

  v_reaped := public.reap_findog_agent_runs(500);

  return query
  with candidate as (
    select queued.id
    from public.findog_agent_runs as queued
    where queued.state = 'queued'
      and exists (
        select 1 from public.admin_users as admin where admin.user_id = queued.owner_id
      )
    order by queued.created_at, queued.id
    limit p_limit
    for update of queued skip locked
  )
  update public.findog_agent_runs as target
  set state = 'running',
      lease_token = p_lease_token,
      lease_expires_at = now() + (p_lease_seconds || ' seconds')::interval,
      attempt_count = target.attempt_count + 1,
      started_at = coalesce(target.started_at, now()),
      updated_at = now()
  from candidate
  where target.id = candidate.id
  returning target.*;
end;
$$;

comment on function public.claim_findog_agent_runs(uuid, integer, integer) is
  'Leases queued runs for a worker after reaping expired leases and revoked owners.';

create or replace function public.heartbeat_findog_agent_run(
  p_run_id uuid,
  p_owner_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer default 90
)
returns setof public.findog_agent_runs
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run public.findog_agent_runs;
begin
  if p_run_id is null or p_owner_id is null or p_lease_token is null
    or p_lease_seconds is null or p_lease_seconds < 1 or p_lease_seconds > 3600
  then
    raise exception 'findog agent heartbeat payload is invalid' using errcode = '22023';
  end if;

  if not exists (select 1 from public.admin_users as admin where admin.user_id = p_owner_id) then
    raise exception 'findog agent owner is not an administrator' using errcode = '42501';
  end if;

  update public.findog_agent_runs as target
  set lease_expires_at = now() + (p_lease_seconds || ' seconds')::interval,
      updated_at = now()
  where target.id = p_run_id
    and target.owner_id = p_owner_id
    and target.state = 'running'
    and target.lease_token = p_lease_token
    and target.lease_expires_at > now()
  returning * into v_run;

  if not found then
    raise exception 'findog agent run lease is stale or not active' using errcode = '55000';
  end if;

  return next v_run;
end;
$$;

comment on function public.heartbeat_findog_agent_run(uuid, uuid, uuid, integer) is
  'Extends the lease of a running run. Requires the current unexpired token and an active owner.';

create or replace function public.append_findog_agent_run_event(
  p_run_id uuid,
  p_owner_id uuid,
  p_lease_token uuid,
  p_kind text,
  p_payload jsonb default '{}'::jsonb
)
returns setof public.findog_agent_run_events
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run public.findog_agent_runs;
  v_sequence bigint;
  v_event public.findog_agent_run_events;
begin
  if p_run_id is null or p_owner_id is null or p_lease_token is null or p_kind is null
    or p_kind not in (
      'status', 'plan', 'step', 'tool_call', 'tool_result', 'source',
      'usage', 'output', 'error', 'heartbeat'
    )
    or p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object'
  then
    raise exception 'findog agent event payload is invalid' using errcode = '22023';
  end if;

  select target.*
  into v_run
  from public.findog_agent_runs as target
  where target.id = p_run_id
    and target.owner_id = p_owner_id
    and target.state = 'running'
    and target.lease_token = p_lease_token
    and target.lease_expires_at > now()
  for update;

  if not found then
    raise exception 'findog agent run lease is stale or not active' using errcode = '55000';
  end if;

  select coalesce(pg_catalog.max(existing.sequence), 0) + 1
  into v_sequence
  from public.findog_agent_run_events as existing
  where existing.run_id = p_run_id;

  insert into public.findog_agent_run_events (run_id, owner_id, sequence, kind, payload)
  values (p_run_id, p_owner_id, v_sequence, p_kind, p_payload)
  returning * into v_event;

  return next v_event;
end;
$$;

comment on function public.append_findog_agent_run_event(uuid, uuid, uuid, text, jsonb) is
  'Appends a fenced event with a per-run monotonic sequence.';

create or replace function public.list_findog_agent_run_events(
  p_run_id uuid,
  p_owner_id uuid,
  p_after_sequence bigint default 0
)
returns setof public.findog_agent_run_events
language sql
security invoker
set search_path = ''
as $$
  select event.*
  from public.findog_agent_run_events as event
  join public.findog_agent_runs as run
    on run.id = event.run_id
   and run.owner_id = event.owner_id
  where event.run_id = p_run_id
    and event.owner_id = p_owner_id
    and run.owner_id = p_owner_id
    and event.sequence > coalesce(p_after_sequence, 0)
  order by event.sequence;
$$;

comment on function public.list_findog_agent_run_events(uuid, uuid, bigint) is
  'Owner-scoped event cursor read for reconnectable transport.';

create or replace function public.save_findog_agent_run_partial_answer(
  p_run_id uuid,
  p_owner_id uuid,
  p_lease_token uuid,
  p_content text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run public.findog_agent_runs;
  v_message_id uuid;
begin
  if p_content is null or pg_catalog.length(p_content) > 200000 then
    raise exception 'findog agent partial answer payload is invalid' using errcode = '22023';
  end if;

  select target.*
  into v_run
  from public.findog_agent_runs as target
  where target.id = p_run_id
    and target.owner_id = p_owner_id
    and target.state = 'running'
    and target.lease_token = p_lease_token
    and target.lease_expires_at > now()
  for update;

  if not found then
    raise exception 'findog agent run lease is stale or not active' using errcode = '55000';
  end if;

  if v_run.assistant_message_id is null then
    insert into public.findog_agent_messages (
      conversation_id, owner_id, run_id, role, content, is_partial
    )
    values (v_run.conversation_id, v_run.owner_id, v_run.id, 'assistant', p_content, true)
    returning id into v_message_id;

    update public.findog_agent_runs as target
    set assistant_message_id = v_message_id,
        updated_at = now()
    where target.id = p_run_id;
  else
    v_message_id := v_run.assistant_message_id;
    update public.findog_agent_messages as message
    set content = p_content,
        is_partial = true,
        updated_at = now()
    where message.id = v_message_id
      and message.owner_id = p_owner_id;
  end if;

  return v_message_id;
end;
$$;

comment on function public.save_findog_agent_run_partial_answer(uuid, uuid, uuid, text) is
  'Persists a fenced partial assistant answer that cancellation removes.';

create or replace function public.finish_findog_agent_run(
  p_run_id uuid,
  p_owner_id uuid,
  p_lease_token uuid,
  p_status text,
  p_result jsonb default null,
  p_error jsonb default null,
  p_usage jsonb default null,
  p_cost jsonb default null,
  p_assistant_content text default null
)
returns setof public.findog_agent_runs
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run public.findog_agent_runs;
  v_message_id uuid;
begin
  if p_run_id is null or p_owner_id is null or p_lease_token is null
    or p_status is null or p_status not in ('succeeded', 'failed')
    or (p_result is not null and pg_catalog.jsonb_typeof(p_result) <> 'object')
    or (p_error is not null and pg_catalog.jsonb_typeof(p_error) <> 'object')
    or (p_usage is not null and pg_catalog.jsonb_typeof(p_usage) <> 'object')
    or (p_cost is not null and pg_catalog.jsonb_typeof(p_cost) <> 'object')
    or (p_assistant_content is not null and pg_catalog.length(p_assistant_content) > 200000)
  then
    raise exception 'findog agent finish payload is invalid' using errcode = '22023';
  end if;

  if p_status = 'succeeded' and p_assistant_content is null then
    raise exception 'findog agent succeeded run requires an assistant answer' using errcode = '22023';
  end if;

  select target.*
  into v_run
  from public.findog_agent_runs as target
  where target.id = p_run_id
    and target.owner_id = p_owner_id
    and target.state = 'running'
    and target.lease_token = p_lease_token
    and target.lease_expires_at > now()
  for update;

  if not found then
    raise exception 'findog agent run lease is stale or not active' using errcode = '55000';
  end if;

  if p_status = 'succeeded' then
    if v_run.assistant_message_id is null then
      insert into public.findog_agent_messages (
        conversation_id, owner_id, run_id, role, content, is_partial
      )
      values (v_run.conversation_id, v_run.owner_id, v_run.id, 'assistant', p_assistant_content, false)
      returning id into v_message_id;
    else
      v_message_id := v_run.assistant_message_id;
      update public.findog_agent_messages as message
      set content = p_assistant_content,
          is_partial = false,
          updated_at = now()
      where message.id = v_message_id
        and message.owner_id = p_owner_id;
    end if;
  end if;

  update public.findog_agent_runs as target
  set state = p_status,
      assistant_message_id = coalesce(v_message_id, target.assistant_message_id),
      result = p_result,
      error = p_error,
      usage = p_usage,
      cost = p_cost,
      lease_token = null,
      lease_expires_at = null,
      finished_at = now(),
      updated_at = now()
  where target.id = p_run_id
  returning * into v_run;

  if not found then
    raise exception 'findog agent run lease is stale or not active' using errcode = '55000';
  end if;

  return next v_run;
end;
$$;

comment on function public.finish_findog_agent_run(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb, text) is
  'Atomically persists the canonical answer and terminal run state under a valid lease.';

create or replace function public.cancel_findog_agent_run(
  p_run_id uuid,
  p_owner_id uuid
)
returns setof public.findog_agent_runs
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run public.findog_agent_runs;
begin
  if p_run_id is null or p_owner_id is null then
    raise exception 'findog agent cancel payload is invalid' using errcode = '22023';
  end if;

  select target.*
  into v_run
  from public.findog_agent_runs as target
  where target.id = p_run_id
    and target.owner_id = p_owner_id
  for update;

  if not found then
    raise exception 'findog agent run was not found for this administrator' using errcode = '42501';
  end if;

  if v_run.state in ('queued', 'running') then
    -- Stop discards partial assistant output but keeps the user question.
    delete from public.findog_agent_messages as message
    where message.owner_id = p_owner_id
      and message.run_id = p_run_id
      and message.role = 'assistant';

    update public.findog_agent_runs as target
    set state = 'cancelled',
        cancel_requested = true,
        assistant_message_id = null,
        lease_token = null,
        lease_expires_at = null,
        finished_at = now(),
        updated_at = now()
    where target.id = p_run_id
    returning * into v_run;
  end if;

  return next v_run;
end;
$$;

comment on function public.cancel_findog_agent_run(uuid, uuid) is
  'Owner-bound cancellation for queued and running runs; removes partial answers and clears the lease.';

-- ==========================================================================
-- Deny-by-default access control
-- ==========================================================================

alter table public.findog_agent_settings_versions enable row level security;
alter table public.findog_agent_settings_current enable row level security;
alter table public.findog_agent_conversations enable row level security;
alter table public.findog_agent_messages enable row level security;
alter table public.findog_agent_runs enable row level security;
alter table public.findog_agent_run_events enable row level security;

revoke all on public.findog_agent_settings_versions from public, anon, authenticated;
revoke all on public.findog_agent_settings_current from public, anon, authenticated;
revoke all on public.findog_agent_conversations from public, anon, authenticated;
revoke all on public.findog_agent_messages from public, anon, authenticated;
revoke all on public.findog_agent_runs from public, anon, authenticated;
revoke all on public.findog_agent_run_events from public, anon, authenticated;

revoke all on sequence public.findog_agent_settings_versions_revision_seq
  from public, anon, authenticated;
revoke all on sequence public.findog_agent_run_events_id_seq
  from public, anon, authenticated;

grant select, insert on public.findog_agent_settings_versions to service_role;
grant select, insert, update on public.findog_agent_settings_current to service_role;
grant select, insert, update, delete on public.findog_agent_conversations to service_role;
grant select, insert, update, delete on public.findog_agent_messages to service_role;
grant select, insert, update, delete on public.findog_agent_runs to service_role;
grant select, insert, delete on public.findog_agent_run_events to service_role;

grant usage, select on sequence public.findog_agent_settings_versions_revision_seq to service_role;
grant usage, select on sequence public.findog_agent_run_events_id_seq to service_role;

revoke all on function public.reap_findog_agent_runs(integer)
  from public, anon, authenticated;
revoke all on function public.set_findog_agent_settings(bigint, uuid, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.enqueue_findog_agent_run(uuid, uuid, text, bigint, text, text)
  from public, anon, authenticated;
revoke all on function public.claim_findog_agent_runs(uuid, integer, integer)
  from public, anon, authenticated;
revoke all on function public.heartbeat_findog_agent_run(uuid, uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.append_findog_agent_run_event(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.list_findog_agent_run_events(uuid, uuid, bigint)
  from public, anon, authenticated;
revoke all on function public.save_findog_agent_run_partial_answer(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.finish_findog_agent_run(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.cancel_findog_agent_run(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.reap_findog_agent_runs(integer) to service_role;
grant execute on function public.set_findog_agent_settings(bigint, uuid, jsonb, jsonb) to service_role;
grant execute on function public.enqueue_findog_agent_run(uuid, uuid, text, bigint, text, text) to service_role;
grant execute on function public.claim_findog_agent_runs(uuid, integer, integer) to service_role;
grant execute on function public.heartbeat_findog_agent_run(uuid, uuid, uuid, integer) to service_role;
grant execute on function public.append_findog_agent_run_event(uuid, uuid, uuid, text, jsonb) to service_role;
grant execute on function public.list_findog_agent_run_events(uuid, uuid, bigint) to service_role;
grant execute on function public.save_findog_agent_run_partial_answer(uuid, uuid, uuid, text) to service_role;
grant execute on function public.finish_findog_agent_run(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb, text) to service_role;
grant execute on function public.cancel_findog_agent_run(uuid, uuid) to service_role;
