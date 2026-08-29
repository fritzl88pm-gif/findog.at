-- Durable, content-bearing ingress receipts for every accepted Fred request.
-- The ledger is the independent denominator for daily completeness checks.
-- Request content is retained only until a hash-bound quality batch is
-- explicitly confirmed for deletion.

create table public.fred_request_ledger (
  id uuid primary key,
  client_id uuid not null references auth.users(id) on delete cascade,
  origin text not null
    constraint fred_request_ledger_origin_values
      check (origin in ('web', 'telegram')),
  telegram_update_id bigint null
    references public.telegram_updates(id) on delete set null,
  agent_key text not null
    constraint fred_request_ledger_agent_values
      check (agent_key in ('fred', 'quickfred')),
  user_event_id uuid not null unique,
  assistant_event_id uuid not null unique,
  request_content text null,
  request_content_sha256 char(64) null,
  status text not null default 'received'
    constraint fred_request_ledger_status_values
      check (status in (
        'received',
        'user_persisted',
        'generating',
        'completed',
        'failed',
        'cancelled'
      )),
  failure_phase text null
    constraint fred_request_ledger_failure_phase_values
      check (failure_phase in ('ingress', 'preprocessing', 'connecting', 'streaming', 'delivery')),
  error_code varchar(64) null,
  conversation_id uuid null
    references public.fred_conversations(id) on delete set null,
  user_message_id bigint null
    references public.fred_messages(id) on delete set null,
  assistant_message_id bigint null
    references public.fred_messages(id) on delete set null,
  quality_batch_id uuid null,
  received_at timestamptz not null default now(),
  user_persisted_at timestamptz null,
  generation_started_at timestamptz null,
  terminal_at timestamptz null,
  content_deleted_at timestamptz null,
  content_deletion_reason text null
    constraint fred_request_ledger_deletion_reason_values
      check (content_deletion_reason in ('quality_batch', 'user_conversation_delete')),
  updated_at timestamptz not null default now(),
  constraint fred_request_ledger_event_ids_distinct
    check (user_event_id <> assistant_event_id),
  constraint fred_request_ledger_content_lifecycle
    check (
      (
        content_deleted_at is null
        and content_deletion_reason is null
        and request_content is not null
        and char_length(request_content) between 1 and 500000
        and request_content_sha256 ~ '^[0-9a-f]{64}$'
      )
      or (
        content_deleted_at is not null
        and content_deletion_reason is not null
        and request_content is null
        and request_content_sha256 is null
      )
    ),
  constraint fred_request_ledger_message_roles
    check (
      conversation_id is not null
      or (user_message_id is null and assistant_message_id is null)
    ),
  constraint fred_request_ledger_terminal_timestamp
    check (
      (status in ('completed', 'failed', 'cancelled') and terminal_at is not null)
      or (status in ('received', 'user_persisted', 'generating') and terminal_at is null)
    )
);

create unique index fred_request_ledger_telegram_update_unique
  on public.fred_request_ledger (telegram_update_id)
  where telegram_update_id is not null;

create index fred_request_ledger_received_idx
  on public.fred_request_ledger (received_at desc, id);

create index fred_request_ledger_client_idx
  on public.fred_request_ledger (client_id);

create index fred_request_ledger_conversation_idx
  on public.fred_request_ledger (conversation_id)
  where conversation_id is not null;

create index fred_request_ledger_user_message_idx
  on public.fred_request_ledger (user_message_id)
  where user_message_id is not null;

create index fred_request_ledger_assistant_message_idx
  on public.fred_request_ledger (assistant_message_id)
  where assistant_message_id is not null;

create index fred_request_ledger_unfinished_idx
  on public.fred_request_ledger (updated_at, id)
  where status in ('received', 'user_persisted', 'generating');

create table public.fred_quality_review_batches (
  id uuid primary key default gen_random_uuid(),
  cutoff_at timestamptz not null,
  time_zone text not null default 'Europe/Vienna'
    constraint fred_quality_review_batches_time_zone_length
      check (char_length(time_zone) between 1 and 64),
  candidate_count integer not null
    constraint fred_quality_review_batches_candidate_count_nonnegative
      check (candidate_count >= 0),
  candidate_set_sha256 char(64) not null
    constraint fred_quality_review_batches_hash_format
      check (candidate_set_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'awaiting_review'
    constraint fred_quality_review_batches_status_values
      check (status in ('awaiting_review', 'pending_confirmation', 'deleted', 'cancelled')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz null,
  deleted_at timestamptz null,
  updated_at timestamptz not null default now(),
  constraint fred_quality_review_batches_deleted_state
    check (
      (status = 'awaiting_review' and reviewed_at is null and deleted_at is null)
      or (status = 'pending_confirmation' and reviewed_at is not null and deleted_at is null)
      or (status = 'deleted' and reviewed_at is not null and deleted_at is not null)
      or (status = 'cancelled' and deleted_at is null)
    )
);

alter table public.fred_request_ledger
  add constraint fred_request_ledger_quality_batch_fk
  foreign key (quality_batch_id)
  references public.fred_quality_review_batches(id)
  on delete set null;

create index fred_request_ledger_quality_batch_idx
  on public.fred_request_ledger (quality_batch_id, id)
  where quality_batch_id is not null;

create index fred_quality_review_batches_status_idx
  on public.fred_quality_review_batches (status, created_at, id);

create function public.set_fred_request_ledger_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger fred_request_ledger_set_updated_at
  before update on public.fred_request_ledger
  for each row
  execute function public.set_fred_request_ledger_updated_at();

create trigger fred_quality_review_batches_set_updated_at
  before update on public.fred_quality_review_batches
  for each row
  execute function public.set_fred_request_ledger_updated_at();

alter table public.fred_request_ledger enable row level security;
alter table public.fred_quality_review_batches enable row level security;

revoke all on public.fred_request_ledger from public, anon, authenticated;
revoke all on public.fred_quality_review_batches from public, anon, authenticated;
grant select, insert, update on public.fred_request_ledger to service_role;
grant select, insert, update on public.fred_quality_review_batches to service_role;

-- The audit row now has an exact request-level provenance key. The legacy
-- conversation FK is added NOT VALID because production already contains
-- historical orphan rows; new writes are still checked immediately.
alter table public.admin_request_history
  add column request_id uuid null
    references public.fred_request_ledger(id) on delete cascade;

create unique index admin_request_history_request_id_unique
  on public.admin_request_history (request_id)
  where request_id is not null;

alter table public.admin_request_history
  add constraint admin_request_history_fred_conversation_fk
  foreign key (conversation_id)
  references public.fred_conversations(id)
  on delete cascade
  not valid;

create index admin_request_history_conversation_idx
  on public.admin_request_history (conversation_id);

alter table public.fred_generation_runs
  add column request_id uuid null
    references public.fred_request_ledger(id) on delete set null;

create unique index fred_generation_runs_request_id_unique
  on public.fred_generation_runs (request_id)
  where request_id is not null;

-- Idempotently record the first trusted-boundary receipt. Telegram retries
-- reuse a deterministic request id; mismatched re-use is rejected.
create function public.create_fred_request_receipt(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request_id_value uuid;
  client_id_value uuid;
  origin_value text;
  telegram_update_id_value bigint;
  agent_key_value text;
  user_event_id_value uuid;
  assistant_event_id_value uuid;
  content_value text;
  content_sha256_value text;
  receipt public.fred_request_ledger%rowtype;
begin
  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'fred request receipt payload must be an object' using errcode = '22023';
  end if;

  request_id_value := (payload ->> 'request_id')::uuid;
  client_id_value := (payload ->> 'client_id')::uuid;
  origin_value := btrim(payload ->> 'origin');
  telegram_update_id_value := nullif(payload ->> 'telegram_update_id', '')::bigint;
  agent_key_value := btrim(payload ->> 'agent_key');
  user_event_id_value := (payload ->> 'user_event_id')::uuid;
  assistant_event_id_value := (payload ->> 'assistant_event_id')::uuid;
  content_value := btrim(payload ->> 'content');
  content_sha256_value := encode(extensions.digest(convert_to(content_value, 'UTF8'), 'sha256'), 'hex');

  if origin_value not in ('web', 'telegram')
    or agent_key_value not in ('fred', 'quickfred')
    or user_event_id_value = assistant_event_id_value
    or char_length(content_value) not between 1 and 500000
    or (origin_value = 'web' and telegram_update_id_value is not null)
  then
    raise exception 'fred request receipt fields are invalid' using errcode = '22023';
  end if;

  insert into public.fred_request_ledger (
    id,
    client_id,
    origin,
    telegram_update_id,
    agent_key,
    user_event_id,
    assistant_event_id,
    request_content,
    request_content_sha256
  ) values (
    request_id_value,
    client_id_value,
    origin_value,
    telegram_update_id_value,
    agent_key_value,
    user_event_id_value,
    assistant_event_id_value,
    content_value,
    content_sha256_value
  )
  on conflict (id) do nothing;

  select * into receipt
  from public.fred_request_ledger
  where id = request_id_value
  for update;

  if receipt.client_id is distinct from client_id_value
    or receipt.origin is distinct from origin_value
    or receipt.telegram_update_id is distinct from telegram_update_id_value
    or receipt.agent_key is distinct from agent_key_value
    or receipt.user_event_id is distinct from user_event_id_value
    or receipt.assistant_event_id is distinct from assistant_event_id_value
    or receipt.request_content_sha256 is distinct from content_sha256_value
  then
    raise exception 'fred request receipt id reuse mismatch' using errcode = '23505';
  end if;

  return jsonb_build_object(
    'request_id', receipt.id,
    'user_event_id', receipt.user_event_id,
    'assistant_event_id', receipt.assistant_event_id,
    'status', receipt.status,
    'received_at', receipt.received_at
  );
end;
$$;

-- Enforce request/message ownership and event provenance while advancing the
-- receipt through its bounded lifecycle.
create function public.transition_fred_request_receipt(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request_id_value uuid;
  target_status_value text;
  conversation_id_value uuid;
  user_message_id_value bigint;
  assistant_message_id_value bigint;
  failure_phase_value text;
  error_code_value text;
  receipt public.fred_request_ledger%rowtype;
begin
  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'fred request transition payload must be an object' using errcode = '22023';
  end if;

  request_id_value := (payload ->> 'request_id')::uuid;
  target_status_value := btrim(payload ->> 'status');
  conversation_id_value := nullif(payload ->> 'conversation_id', '')::uuid;
  user_message_id_value := nullif(payload ->> 'user_message_id', '')::bigint;
  assistant_message_id_value := nullif(payload ->> 'assistant_message_id', '')::bigint;
  failure_phase_value := nullif(btrim(payload ->> 'failure_phase'), '');
  error_code_value := nullif(btrim(payload ->> 'error_code'), '');

  if target_status_value not in ('user_persisted', 'generating', 'completed', 'failed', 'cancelled')
    or (failure_phase_value is not null and failure_phase_value not in ('ingress', 'preprocessing', 'connecting', 'streaming', 'delivery'))
    or (error_code_value is not null and char_length(error_code_value) > 64)
  then
    raise exception 'fred request transition fields are invalid' using errcode = '22023';
  end if;

  select * into receipt
  from public.fred_request_ledger
  where id = request_id_value
  for update;

  if not found then
    raise exception 'fred request receipt not found' using errcode = 'P0002';
  end if;

  if receipt.content_deleted_at is not null then
    raise exception 'fred request receipt content already deleted' using errcode = '55000';
  end if;

  if receipt.status in ('completed', 'failed', 'cancelled') then
    if receipt.status <> target_status_value then
      raise exception 'fred request terminal state is immutable' using errcode = '55000';
    end if;
    return jsonb_build_object('request_id', receipt.id, 'status', receipt.status);
  end if;

  if target_status_value = 'user_persisted' then
    if receipt.status <> 'received'
      or conversation_id_value is null
      or user_message_id_value is null
      or not exists (
        select 1
        from public.fred_messages as message
        where message.id = user_message_id_value
          and message.client_id = receipt.client_id
          and message.conversation_id = conversation_id_value
          and message.role = 'user'
          and message.bridge_event_id = receipt.user_event_id
      )
    then
      raise exception 'fred user message transition mismatch' using errcode = '23514';
    end if;

    update public.fred_request_ledger
    set status = 'user_persisted',
        conversation_id = conversation_id_value,
        user_message_id = user_message_id_value,
        user_persisted_at = now()
    where id = receipt.id
    returning * into receipt;

  elsif target_status_value = 'generating' then
    if receipt.status <> 'user_persisted' then
      raise exception 'fred generating transition mismatch' using errcode = '23514';
    end if;

    update public.fred_request_ledger
    set status = 'generating',
        generation_started_at = now()
    where id = receipt.id
    returning * into receipt;

  elsif target_status_value = 'completed' then
    if receipt.status not in ('user_persisted', 'generating')
      or assistant_message_id_value is null
      or not exists (
        select 1
        from public.fred_messages as message
        where message.id = assistant_message_id_value
          and message.client_id = receipt.client_id
          and message.conversation_id = receipt.conversation_id
          and message.role = 'assistant'
          and message.bridge_event_id = receipt.assistant_event_id
      )
    then
      raise exception 'fred assistant message transition mismatch' using errcode = '23514';
    end if;

    update public.fred_request_ledger
    set status = 'completed',
        assistant_message_id = assistant_message_id_value,
        terminal_at = now(),
        failure_phase = null,
        error_code = null
    where id = receipt.id
    returning * into receipt;

  else
    update public.fred_request_ledger
    set status = target_status_value,
        terminal_at = now(),
        failure_phase = failure_phase_value,
        error_code = error_code_value
    where id = receipt.id
    returning * into receipt;
  end if;

  return jsonb_build_object('request_id', receipt.id, 'status', receipt.status);
end;
$$;

-- Freeze all previously unbatched receipts into an immutable candidate set.
-- An interrupted, not-yet-reviewed batch is returned idempotently. Batches
-- that already await confirmation do not block tomorrow's review.
create function public.prepare_fred_quality_review_batch(
  p_cutoff_at timestamptz default now(),
  p_time_zone text default 'Europe/Vienna'
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
begin
  if p_cutoff_at > now() + interval '5 minutes'
    or char_length(btrim(p_time_zone)) not between 1 and 64
  then
    raise exception 'fred quality batch parameters are invalid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('fred:quality-review-batch', 0));

  select * into batch
  from public.fred_quality_review_batches
  where status = 'awaiting_review'
  order by created_at, id
  limit 1
  for update;

  if found then
    return jsonb_build_object(
      'batch_id', batch.id,
      'cutoff_at', batch.cutoff_at,
      'time_zone', batch.time_zone,
      'candidate_count', batch.candidate_count,
      'candidate_set_sha256', batch.candidate_set_sha256,
      'status', batch.status
    );
  end if;

  select coalesce(array_agg(id order by id), '{}'::uuid[])
  into candidate_ids
  from public.fred_request_ledger
  where quality_batch_id is null
    and content_deleted_at is null
    and received_at < p_cutoff_at;

  candidate_hash := encode(
    extensions.digest(convert_to(coalesce(array_to_string(candidate_ids, ','), ''), 'UTF8'), 'sha256'),
    'hex'
  );

  if cardinality(candidate_ids) = 0 then
    return jsonb_build_object(
      'batch_id', null,
      'cutoff_at', p_cutoff_at,
      'time_zone', btrim(p_time_zone),
      'candidate_count', 0,
      'candidate_set_sha256', candidate_hash,
      'status', 'empty'
    );
  end if;

  insert into public.fred_quality_review_batches (
    cutoff_at,
    time_zone,
    candidate_count,
    candidate_set_sha256
  ) values (
    p_cutoff_at,
    btrim(p_time_zone),
    cardinality(candidate_ids),
    candidate_hash
  )
  returning * into batch;

  update public.fred_request_ledger
  set quality_batch_id = batch.id
  where id = any(candidate_ids)
    and quality_batch_id is null;

  if not found then
    raise exception 'fred quality batch candidate assignment failed' using errcode = '40001';
  end if;

  return jsonb_build_object(
    'batch_id', batch.id,
    'cutoff_at', batch.cutoff_at,
    'time_zone', batch.time_zone,
    'candidate_count', batch.candidate_count,
    'candidate_set_sha256', batch.candidate_set_sha256,
    'status', batch.status
  );
end;
$$;

-- Close the review phase only after every receipt in the frozen set was
-- evaluated. This separates a completed review from the user's later deletion
-- confirmation and permits independent daily batches.
create function public.mark_fred_quality_review_batch_reviewed(
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
begin
  select * into batch
  from public.fred_quality_review_batches
  where id = p_batch_id
  for update;

  if not found or batch.status not in ('awaiting_review', 'pending_confirmation') then
    raise exception 'fred quality batch cannot be marked reviewed' using errcode = '55000';
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
    raise exception 'fred quality batch review hash mismatch' using errcode = '22023';
  end if;

  if batch.status = 'awaiting_review' then
    update public.fred_quality_review_batches
    set status = 'pending_confirmation',
        reviewed_at = now()
    where id = batch.id
    returning * into batch;
  end if;

  return jsonb_build_object(
    'batch_id', batch.id,
    'candidate_count', batch.candidate_count,
    'candidate_set_sha256', batch.candidate_set_sha256,
    'status', batch.status,
    'reviewed_at', batch.reviewed_at
  );
end;
$$;

-- Delete only a previously frozen and hash-confirmed batch. No partial delete
-- is possible, and non-terminal requests keep the transaction from starting.
create function public.delete_confirmed_fred_quality_batch(
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
  message_ids bigint[];
  webhook_ids bigint[];
  conversation_ids uuid[];
  telegram_update_ids bigint[];
  deleted_admin_count bigint;
  deleted_message_count bigint;
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

  select
    coalesce(array_agg(distinct message_id) filter (where message_id is not null), '{}'::bigint[]),
    coalesce(array_agg(distinct conversation_id) filter (where conversation_id is not null), '{}'::uuid[]),
    coalesce(array_agg(distinct telegram_update_id) filter (where telegram_update_id is not null), '{}'::bigint[])
  into message_ids, conversation_ids, telegram_update_ids
  from (
    select user_message_id as message_id, conversation_id, telegram_update_id
    from public.fred_request_ledger where id = any(candidate_ids)
    union all
    select assistant_message_id as message_id, conversation_id, telegram_update_id
    from public.fred_request_ledger where id = any(candidate_ids)
  ) as targets;

  select coalesce(array_agg(distinct webhook_event_id) filter (where webhook_event_id is not null), '{}'::bigint[])
  into webhook_ids
  from public.fred_messages
  where id = any(message_ids);

  delete from public.admin_request_history
  where request_id = any(candidate_ids);
  get diagnostics deleted_admin_count = row_count;

  deleted_message_count := cardinality(message_ids);

  delete from public.fred_webhook_events
  where id = any(webhook_ids);

  delete from public.fred_messages
  where id = any(message_ids);

  update public.telegram_deliveries
  set message_content = ''
  where update_id = any(telegram_update_ids)
    and message_content <> '';
  get diagnostics cleared_delivery_count = row_count;

  delete from public.fred_conversations as conversation
  where conversation.id = any(conversation_ids)
    and not exists (
      select 1 from public.fred_messages as message
      where message.conversation_id = conversation.id
    );

  update public.fred_conversations as conversation
  set title = coalesce((
        select left(regexp_replace(message.content, E'\\s+', ' ', 'g'), 120)
        from public.fred_messages as message
        where message.conversation_id = conversation.id
          and message.role = 'user'
        order by coalesce(message.provider_created_at, message.created_at), message.id
        limit 1
      ), 'Neue Fred-Unterhaltung'),
      updated_at = coalesce((
        select max(message.created_at)
        from public.fred_messages as message
        where message.conversation_id = conversation.id
      ), conversation.updated_at)
  where conversation.id = any(conversation_ids);

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
    'deleted_messages', deleted_message_count,
    'cleared_telegram_deliveries', cleared_delivery_count,
    'deleted_at', now()
  );
end;
$$;

-- Stable review surface: one row per ingress receipt, with explicit
-- completeness flags and the persisted answer/evidence needed for evaluation.
create function public.get_fred_quality_review_batch(p_batch_id uuid)
returns table (
  batch_id uuid,
  candidate_set_sha256 char(64),
  request_id uuid,
  origin text,
  agent_key text,
  request_status text,
  failure_phase text,
  error_code varchar(64),
  received_at timestamptz,
  terminal_at timestamptz,
  content_deleted_at timestamptz,
  content_deletion_reason text,
  request_content text,
  question_message_present boolean,
  answer_message_present boolean,
  admin_audit_present boolean,
  answer_content text,
  research_trace jsonb,
  execution_trace jsonb,
  source_references jsonb,
  web_search_enabled boolean,
  pro_mode_enabled boolean,
  telegram_update_status text,
  telegram_deliveries jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    batch.id,
    batch.candidate_set_sha256,
    receipt.id,
    receipt.origin,
    receipt.agent_key,
    receipt.status,
    receipt.failure_phase,
    receipt.error_code,
    receipt.received_at,
    receipt.terminal_at,
    receipt.content_deleted_at,
    receipt.content_deletion_reason,
    receipt.request_content,
    user_message.id is not null,
    assistant_message.id is not null,
    audit.id is not null,
    coalesce(assistant_message.display_content, assistant_message.content),
    coalesce(assistant_message.research_trace, '[]'::jsonb),
    coalesce(assistant_message.execution_trace, '[]'::jsonb),
    coalesce(assistant_message.source_references, '[]'::jsonb),
    coalesce(user_message.web_search_enabled, false),
    coalesce(user_message.pro_mode_enabled, false),
    telegram_update.status,
    coalesce(delivery.rows, '[]'::jsonb)
  from public.fred_quality_review_batches as batch
  join public.fred_request_ledger as receipt
    on receipt.quality_batch_id = batch.id
  left join public.fred_messages as user_message
    on user_message.id = receipt.user_message_id
      and user_message.role = 'user'
      and user_message.bridge_event_id = receipt.user_event_id
  left join public.fred_messages as assistant_message
    on assistant_message.id = receipt.assistant_message_id
      and assistant_message.role = 'assistant'
      and assistant_message.bridge_event_id = receipt.assistant_event_id
  left join public.admin_request_history as audit
    on audit.request_id = receipt.id
  left join public.telegram_updates as telegram_update
    on telegram_update.id = receipt.telegram_update_id
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'chunk_index', delivery.chunk_index,
        'status', delivery.status,
        'sent_at', delivery.sent_at
      ) order by delivery.chunk_index
    ) as rows
    from public.telegram_deliveries as delivery
    where delivery.update_id = receipt.telegram_update_id
  ) as delivery on true
  where batch.id = p_batch_id
  order by receipt.received_at, receipt.id;
$$;

-- Keep the existing user-facing conversation deletion RPC privacy-complete:
-- deleting history also clears the ingress copy, audit copy, and Telegram
-- delivery copy in the same transaction.
create or replace function public.delete_owned_fred_conversations(
  p_client_id uuid,
  p_conversation_ids uuid[]
)
returns table (id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  owned_conversation_ids uuid[];
  telegram_update_ids bigint[];
begin
  if p_client_id is null
    or p_conversation_ids is null
    or cardinality(p_conversation_ids) < 1
    or cardinality(p_conversation_ids) > 100
  then
    raise exception 'fred conversation deletion parameters are invalid'
      using errcode = '22023';
  end if;

  perform conversation.id
  from public.fred_conversations as conversation
  where conversation.client_id = p_client_id
    and conversation.id = any(p_conversation_ids)
  for update;

  select coalesce(array_agg(conversation.id order by conversation.id), '{}'::uuid[])
  into owned_conversation_ids
  from public.fred_conversations as conversation
  where conversation.client_id = p_client_id
    and conversation.id = any(p_conversation_ids);

  select coalesce(array_agg(distinct receipt.telegram_update_id)
    filter (where receipt.telegram_update_id is not null), '{}'::bigint[])
  into telegram_update_ids
  from public.fred_request_ledger as receipt
  where receipt.client_id = p_client_id
    and receipt.conversation_id = any(owned_conversation_ids);

  update public.telegram_chat_bindings as binding
  set active_conversation_id = null
  where binding.active_conversation_id = any(owned_conversation_ids);

  delete from public.admin_request_history as audit
  where audit.user_id = p_client_id
    and audit.conversation_id = any(owned_conversation_ids);

  update public.telegram_deliveries
  set message_content = ''
  where update_id = any(telegram_update_ids)
    and message_content <> '';

  update public.fred_request_ledger as receipt
  set request_content = null,
      request_content_sha256 = null,
      content_deleted_at = now(),
      content_deletion_reason = 'user_conversation_delete'
  where receipt.client_id = p_client_id
    and receipt.conversation_id = any(owned_conversation_ids)
    and receipt.content_deleted_at is null;

  return query
  delete from public.fred_conversations as conversation
  where conversation.client_id = p_client_id
    and conversation.id = any(owned_conversation_ids)
  returning conversation.id;
end;
$$;

revoke all on function public.create_fred_request_receipt(jsonb)
from public, anon, authenticated;
grant execute on function public.create_fred_request_receipt(jsonb)
to service_role;

revoke all on function public.transition_fred_request_receipt(jsonb)
from public, anon, authenticated;
grant execute on function public.transition_fred_request_receipt(jsonb)
to service_role;

revoke all on function public.prepare_fred_quality_review_batch(timestamptz, text)
from public, anon, authenticated;
grant execute on function public.prepare_fred_quality_review_batch(timestamptz, text)
to service_role;

revoke all on function public.delete_confirmed_fred_quality_batch(uuid, text)
from public, anon, authenticated;
grant execute on function public.delete_confirmed_fred_quality_batch(uuid, text)
to service_role;

revoke all on function public.mark_fred_quality_review_batch_reviewed(uuid, text)
from public, anon, authenticated;
grant execute on function public.mark_fred_quality_review_batch_reviewed(uuid, text)
to service_role;

revoke all on function public.get_fred_quality_review_batch(uuid)
from public, anon, authenticated;
grant execute on function public.get_fred_quality_review_batch(uuid)
to service_role;

revoke all on function public.delete_owned_fred_conversations(uuid, uuid[])
from public, anon, authenticated;
grant execute on function public.delete_owned_fred_conversations(uuid, uuid[])
to service_role;

revoke all on function public.set_fred_request_ledger_updated_at()
from public, anon, authenticated;

-- Backfill the current Vienna day so the first quality run does not silently
-- omit requests accepted earlier on deployment day. Older histories predate
-- the completeness guarantee and are deliberately not pulled into the first
-- daily review batch. Alternating user/assistant rows are paired at
-- conversation grain; unmatched legacy users remain explicit failed receipts
-- instead of being guessed as successful.
with ordered_messages as (
  select
    message.*,
    lead(message.id) over message_order as next_id,
    lead(message.role) over message_order as next_role,
    lead(message.bridge_event_id) over message_order as next_bridge_event_id,
    lead(message.created_at) over message_order as next_created_at
  from public.fred_messages as message
  window message_order as (
    partition by message.conversation_id
    order by coalesce(message.provider_created_at, message.created_at), message.id
  )
)
insert into public.fred_request_ledger (
  id,
  client_id,
  origin,
  agent_key,
  user_event_id,
  assistant_event_id,
  request_content,
  request_content_sha256,
  status,
  failure_phase,
  error_code,
  conversation_id,
  user_message_id,
  assistant_message_id,
  received_at,
  user_persisted_at,
  generation_started_at,
  terminal_at
)
select
  gen_random_uuid(),
  message.client_id,
  conversation.origin,
  conversation.agent_key,
  coalesce(message.bridge_event_id, gen_random_uuid()),
  case
    when message.next_role = 'assistant'
      then coalesce(message.next_bridge_event_id, gen_random_uuid())
    else gen_random_uuid()
  end,
  btrim(message.content),
  encode(extensions.digest(convert_to(btrim(message.content), 'UTF8'), 'sha256'), 'hex'),
  case when message.next_role = 'assistant' then 'completed' else 'failed' end,
  case when message.next_role = 'assistant' then null else 'streaming' end,
  case when message.next_role = 'assistant' then null else 'legacy_unpaired' end,
  message.conversation_id,
  message.id,
  case when message.next_role = 'assistant' then message.next_id else null end,
  message.created_at,
  message.created_at,
  message.created_at,
  case when message.next_role = 'assistant' then message.next_created_at else message.created_at end
from ordered_messages as message
join public.fred_conversations as conversation
  on conversation.id = message.conversation_id
where message.role = 'user'
  and btrim(message.content) <> ''
  and message.created_at >= (
    date_trunc('day', now() at time zone 'Europe/Vienna')
    at time zone 'Europe/Vienna'
  )
on conflict (user_event_id) do nothing;

with ranked_audit as (
  select
    audit.id,
    audit.conversation_id,
    btrim(audit.content) as content,
    row_number() over (
      partition by audit.conversation_id, btrim(audit.content)
      order by audit.created_at, audit.id
    ) as occurrence
  from public.admin_request_history as audit
  where audit.request_id is null
    and audit.created_at >= (
      date_trunc('day', now() at time zone 'Europe/Vienna')
      at time zone 'Europe/Vienna'
    )
),
ranked_receipts as (
  select
    receipt.id,
    receipt.conversation_id,
    btrim(receipt.request_content) as content,
    row_number() over (
      partition by receipt.conversation_id, btrim(receipt.request_content)
      order by receipt.received_at, receipt.id
    ) as occurrence
  from public.fred_request_ledger as receipt
  where receipt.request_content is not null
)
update public.admin_request_history as audit
set request_id = receipt.id
from ranked_audit,
     ranked_receipts as receipt
where audit.id = ranked_audit.id
  and ranked_audit.conversation_id = receipt.conversation_id
  and ranked_audit.content = receipt.content
  and ranked_audit.occurrence = receipt.occurrence;

-- Historical audit rows whose conversations were already deleted still
-- represent accepted requests. Convert them into explicit failed receipts so
-- they are reviewed and deleted through the same confirmation-bound batch.
insert into public.fred_request_ledger (
  id,
  client_id,
  origin,
  agent_key,
  user_event_id,
  assistant_event_id,
  request_content,
  request_content_sha256,
  status,
  failure_phase,
  error_code,
  received_at,
  terminal_at
)
select
  (
    substr(md5('fred-legacy-audit-request:' || audit.id::text), 1, 8) || '-' ||
    substr(md5('fred-legacy-audit-request:' || audit.id::text), 9, 4) || '-' ||
    substr(md5('fred-legacy-audit-request:' || audit.id::text), 13, 4) || '-' ||
    substr(md5('fred-legacy-audit-request:' || audit.id::text), 17, 4) || '-' ||
    substr(md5('fred-legacy-audit-request:' || audit.id::text), 21, 12)
  )::uuid,
  audit.user_id,
  'web',
  'fred',
  (
    substr(md5('fred-legacy-audit-user:' || audit.id::text), 1, 8) || '-' ||
    substr(md5('fred-legacy-audit-user:' || audit.id::text), 9, 4) || '-' ||
    substr(md5('fred-legacy-audit-user:' || audit.id::text), 13, 4) || '-' ||
    substr(md5('fred-legacy-audit-user:' || audit.id::text), 17, 4) || '-' ||
    substr(md5('fred-legacy-audit-user:' || audit.id::text), 21, 12)
  )::uuid,
  (
    substr(md5('fred-legacy-audit-assistant:' || audit.id::text), 1, 8) || '-' ||
    substr(md5('fred-legacy-audit-assistant:' || audit.id::text), 9, 4) || '-' ||
    substr(md5('fred-legacy-audit-assistant:' || audit.id::text), 13, 4) || '-' ||
    substr(md5('fred-legacy-audit-assistant:' || audit.id::text), 17, 4) || '-' ||
    substr(md5('fred-legacy-audit-assistant:' || audit.id::text), 21, 12)
  )::uuid,
  btrim(audit.content),
  encode(extensions.digest(convert_to(btrim(audit.content), 'UTF8'), 'sha256'), 'hex'),
  'failed',
  'ingress',
  'legacy_orphan_audit',
  audit.created_at,
  audit.created_at
from public.admin_request_history as audit
where audit.request_id is null
  and btrim(audit.content) <> ''
  and audit.created_at >= (
    date_trunc('day', now() at time zone 'Europe/Vienna')
    at time zone 'Europe/Vienna'
  )
on conflict (id) do nothing;

update public.admin_request_history as audit
set request_id = (
  substr(md5('fred-legacy-audit-request:' || audit.id::text), 1, 8) || '-' ||
  substr(md5('fred-legacy-audit-request:' || audit.id::text), 9, 4) || '-' ||
  substr(md5('fred-legacy-audit-request:' || audit.id::text), 13, 4) || '-' ||
  substr(md5('fred-legacy-audit-request:' || audit.id::text), 17, 4) || '-' ||
  substr(md5('fred-legacy-audit-request:' || audit.id::text), 21, 12)
)::uuid
where audit.request_id is null
  and audit.created_at >= (
    date_trunc('day', now() at time zone 'Europe/Vienna')
    at time zone 'Europe/Vienna'
  );
