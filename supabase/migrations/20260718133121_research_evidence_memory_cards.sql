-- Store immutable retrieval provenance independently from the short agent-step
-- preview. Opaque MCP results remain discovery hints until a deterministic
-- structured adapter supplies complete legal metadata.

alter table public.agent_runs
  add column persistence_payload_sha256 char(64),
  add column research_result_limit integer,
  add column research_result_limit_source text,
  add column research_stichtag date,
  add column research_stichtag_kind text,
  add column research_stichtag_reason text,
  add column research_stichtag_matched_text text,
  add column research_reference_year integer,
  add constraint agent_runs_persistence_payload_sha256_check check (
    persistence_payload_sha256 is null
    or persistence_payload_sha256 ~ '^[0-9a-f]{64}$'
  ),
  add constraint agent_runs_research_provenance_check check (
    (
      research_stichtag_kind is null
      and research_stichtag is null
      and research_stichtag_reason is null
      and research_stichtag_matched_text is null
      and research_reference_year is null
      and research_result_limit is null
      and research_result_limit_source is null
    )
    or (
      research_result_limit is not null
      and research_result_limit between 1 and 50
      and research_result_limit_source is not null
      and research_result_limit_source in ('database', 'fallback')
      and research_stichtag_kind is not null
      and (
        (
          research_stichtag_kind = 'explicit'
          and research_stichtag is not null
          and research_stichtag_reason is null
          and research_stichtag_matched_text is not null
          and char_length(btrim(research_stichtag_matched_text)) between 1 and 100
          and research_reference_year is null
        )
        or (
          research_stichtag_kind = 'implicit'
          and research_stichtag is not null
          and research_stichtag_reason is not null
          and research_stichtag_reason in ('current_word', 'default_current')
          and research_stichtag_matched_text is null
          and research_reference_year is null
        )
        or (
          research_stichtag_kind = 'unknown'
          and research_stichtag is null
          and research_stichtag_reason is not null
          and research_stichtag_reason in ('ambiguous', 'year_only', 'anaphoric')
          and research_stichtag_matched_text is null
          and (
            (
              research_stichtag_reason = 'year_only'
              and research_reference_year is not null
              and research_reference_year between 1800 and 2999
            )
            or (research_stichtag_reason <> 'year_only' and research_reference_year is null)
          )
        )
      )
    )
  );

create table public.research_evidence (
  id uuid primary key,
  agent_run_id uuid not null references public.agent_runs(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  client_id uuid not null,
  result_step_order integer not null check (result_step_order >= 0),
  evidence_order integer not null check (evidence_order between 0 and 99),

  semantic_tool_name text not null check (
    char_length(btrim(semantic_tool_name)) between 1 and 120
    and semantic_tool_name !~ '[[:cntrl:]]'
  ),
  raw_tool_name text not null check (
    char_length(btrim(raw_tool_name)) between 1 and 120
    and raw_tool_name !~ '[[:cntrl:]]'
  ),
  source_key text check (
    source_key is null or char_length(btrim(source_key)) between 1 and 80
  ),
  source_name text check (
    source_name is null or char_length(btrim(source_name)) between 1 and 200
  ),
  source_kb_id text check (
    source_kb_id is null or char_length(btrim(source_kb_id)) between 1 and 200
  ),
  source_system text check (
    source_system is null or source_system in ('ris', 'evi', 'findok', 'internal', 'other')
  ),
  evidence_kind text not null check (
    evidence_kind in ('discovery', 'norm', 'rechtssatz', 'entscheidung_chunk', 'secondary')
  ),
  requery_required boolean not null,

  semantic_arguments jsonb not null check (
    jsonb_typeof(semantic_arguments) = 'object'
    and octet_length(semantic_arguments::text) <= 65536
  ),
  effective_arguments jsonb not null check (
    jsonb_typeof(effective_arguments) = 'object'
    and octet_length(effective_arguments::text) <= 65536
  ),
  result_limit_applied boolean not null,
  effective_result_limit integer,
  query_text text check (query_text is null or char_length(query_text) <= 4000),
  constraint research_evidence_result_limit_check check (
    (
      result_limit_applied
      and effective_result_limit is not null
      and effective_result_limit between 1 and 50
    )
    or (not result_limit_applied and effective_result_limit is null)
  ),

  retrieval_stichtag date,
  retrieval_stichtag_kind text not null,
  retrieval_stichtag_reason text,
  retrieval_stichtag_matched_text text,
  reference_year integer,
  constraint research_evidence_stichtag_check check (
    (
      retrieval_stichtag_kind = 'explicit'
      and retrieval_stichtag is not null
      and retrieval_stichtag_reason is null
      and retrieval_stichtag_matched_text is not null
      and char_length(btrim(retrieval_stichtag_matched_text)) between 1 and 100
      and reference_year is null
    )
    or (
      retrieval_stichtag_kind = 'implicit'
      and retrieval_stichtag is not null
      and retrieval_stichtag_reason is not null
      and retrieval_stichtag_reason in ('current_word', 'default_current')
      and retrieval_stichtag_matched_text is null
      and reference_year is null
    )
    or (
      retrieval_stichtag_kind = 'unknown'
      and retrieval_stichtag is null
      and retrieval_stichtag_reason is not null
      and retrieval_stichtag_reason in ('ambiguous', 'year_only', 'anaphoric')
      and retrieval_stichtag_matched_text is null
      and (
        (
          retrieval_stichtag_reason = 'year_only'
          and reference_year is not null
          and reference_year between 1800 and 2999
        )
        or (retrieval_stichtag_reason <> 'year_only' and reference_year is null)
      )
    )
  ),

  structured_content jsonb check (
    structured_content is null
    or (
      jsonb_typeof(structured_content) = 'object'
      and octet_length(structured_content::text) <= 262144
    )
  ),
  classification_metadata jsonb not null default '{}'::jsonb check (
    jsonb_typeof(classification_metadata) = 'object'
    and octet_length(classification_metadata::text) <= 65536
  ),

  canonical_id text check (canonical_id is null or char_length(btrim(canonical_id)) between 1 and 500),
  version_id text check (version_id is null or char_length(btrim(version_id)) between 1 and 500),
  official_uri text check (official_uri is null or char_length(btrim(official_uri)) between 1 and 2048),
  valid_from date,
  valid_to date,
  rechtssatz_id text check (rechtssatz_id is null or char_length(btrim(rechtssatz_id)) between 1 and 500),
  decision_id text check (decision_id is null or char_length(btrim(decision_id)) between 1 and 500),
  chunk_id text check (chunk_id is null or char_length(btrim(chunk_id)) between 1 and 500),
  decision_date date,

  content text not null check (
    char_length(btrim(content)) > 0 and char_length(content) <= 32000
  ),
  content_sha256 char(64) not null check (
    content_sha256 ~ '^[0-9a-f]{64}$'
    and content_sha256 = pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(content, 'UTF8')),
      'hex'
    )
  ),
  original_content_sha256 char(64) not null check (
    original_content_sha256 ~ '^[0-9a-f]{64}$'
  ),
  original_content_chars integer not null check (original_content_chars > 0),
  content_truncated boolean not null,
  constraint research_evidence_content_completeness_check check (
    (
      not content_truncated
      and original_content_chars = char_length(content)
      and original_content_sha256 = content_sha256
    )
    or (
      content_truncated
      and original_content_chars > char_length(content)
    )
  ),

  -- A card is optional so every successful evidence payload can be retained.
  -- If present, it belongs to exactly this evidence row (1:1 provenance).
  card_summary text check (
    card_summary is null or char_length(btrim(card_summary)) between 1 and 1500
  ),
  card_topics text[] not null default '{}',
  card_generation text check (card_generation is null or card_generation in ('llm', 'fallback')),
  card_model text check (card_model is null or char_length(btrim(card_model)) between 1 and 200),
  card_model_provider text check (
    card_model_provider is null or card_model_provider in ('deepseek', 'zai', 'openai_compatible')
  ),
  card_upstream_model text check (
    card_upstream_model is null or char_length(btrim(card_upstream_model)) between 1 and 200
  ),
  card_reasoning text check (card_reasoning is null or card_reasoning = 'disabled'),
  card_prompt_version integer check (card_prompt_version is null or card_prompt_version > 0),
  retrieved_at timestamptz not null,
  card_generated_at timestamptz,
  created_at timestamptz not null default now(),

  constraint research_evidence_step_fkey
    foreign key (agent_run_id, result_step_order)
    references public.agent_steps (agent_run_id, step_order)
    on delete cascade,
  constraint research_evidence_agent_run_order_key
    unique (agent_run_id, result_step_order, evidence_order),
  constraint research_evidence_validity_order_check check (
    valid_to is null or valid_from is null or valid_from < valid_to
  ),
  constraint research_evidence_topics_limit_check check (
    cardinality(card_topics) <= 8 and octet_length(card_topics::text) <= 2048
  ),
  constraint research_evidence_card_completeness_check check (
    (
      card_summary is null
      and cardinality(card_topics) = 0
      and card_generation is null
      and card_model is null
      and card_model_provider is null
      and card_upstream_model is null
      and card_reasoning is null
      and card_prompt_version is null
      and card_generated_at is null
    )
    or (
      card_summary is not null
      and card_generation is not null
      and card_prompt_version is not null
      and card_generated_at is not null
      and retrieved_at <= card_generated_at
      and (
        (
          card_generation = 'fallback'
          and card_model is null
          and card_model_provider is null
          and card_upstream_model is null
          and card_reasoning is null
        )
        or (
          card_generation = 'llm'
          and card_model is not null
          and card_model_provider is not null
          and card_upstream_model is not null
          and card_reasoning is not null
          and card_reasoning = 'disabled'
        )
      )
    )
  ),
  constraint research_evidence_non_primary_requery_check check (
    evidence_kind not in ('discovery', 'secondary') or requery_required
  ),
  constraint research_evidence_authoritative_metadata_check check (
    requery_required
    or (
      source_system is not null
      and source_system in ('ris', 'evi')
      and structured_content is not null
      and official_uri is not null
      and official_uri ~* '^https://(www\.)?(ris\.bka\.gv\.at|evi\.gv\.at)/'
      and (
        (
          evidence_kind = 'norm'
          and canonical_id is not null
          and version_id is not null
          and valid_from is not null
          and retrieval_stichtag is not null
          and valid_from <= retrieval_stichtag
          and (valid_to is null or retrieval_stichtag < valid_to)
        )
        or (
          evidence_kind = 'rechtssatz'
          and rechtssatz_id is not null
          and decision_date is not null
          and retrieval_stichtag is not null
          and decision_date <= retrieval_stichtag
        )
        or (
          evidence_kind = 'entscheidung_chunk'
          and decision_id is not null
          and chunk_id is not null
          and decision_date is not null
          and retrieval_stichtag is not null
          and decision_date <= retrieval_stichtag
        )
      )
    )
  )
);

create index research_evidence_conversation_scope_idx
  on public.research_evidence (
    conversation_id,
    client_id,
    retrieval_stichtag,
    created_at desc,
    retrieved_at desc,
    result_step_order desc,
    evidence_order desc,
    id desc
  );

create index research_evidence_client_created_at_idx
  on public.research_evidence (client_id, created_at desc);

create index research_evidence_norm_conflict_idx
  on public.research_evidence (
    conversation_id,
    client_id,
    retrieval_stichtag,
    canonical_id,
    version_id
  )
  where evidence_kind = 'norm'
    and not requery_required
    and card_summary is not null;

create function public.validate_research_evidence_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  run_scope record;
  step_scope record;
begin
  select
    agent_run.conversation_id,
    agent_run.client_id,
    agent_run.model,
    agent_run.model_provider,
    agent_run.upstream_model,
    agent_run.research_result_limit,
    agent_run.research_result_limit_source,
    agent_run.research_stichtag,
    agent_run.research_stichtag_kind,
    agent_run.research_stichtag_reason,
    agent_run.research_stichtag_matched_text,
    agent_run.research_reference_year
  into run_scope
  from public.agent_runs as agent_run
  where agent_run.id = new.agent_run_id;

  if not found then
    raise exception 'research evidence run scope missing' using errcode = '23514';
  end if;

  select step.step_type, step.tool_name, step.success
  into step_scope
  from public.agent_steps as step
  where step.agent_run_id = new.agent_run_id
    and step.step_order = new.result_step_order;

  if not found then
    raise exception 'research evidence step scope missing' using errcode = '23514';
  end if;

  if run_scope.research_result_limit is null
    or run_scope.research_result_limit_source is null
    or run_scope.conversation_id is distinct from new.conversation_id
    or run_scope.client_id is distinct from new.client_id
    or step_scope.step_type is distinct from 'tool_result'
    or step_scope.tool_name is distinct from new.semantic_tool_name
    or step_scope.success is distinct from true
    or run_scope.research_stichtag is distinct from new.retrieval_stichtag
    or run_scope.research_stichtag_kind is distinct from new.retrieval_stichtag_kind
    or run_scope.research_stichtag_reason is distinct from new.retrieval_stichtag_reason
    or run_scope.research_stichtag_matched_text is distinct from new.retrieval_stichtag_matched_text
    or run_scope.research_reference_year is distinct from new.reference_year
    or (
      new.result_limit_applied
      and run_scope.research_result_limit is distinct from new.effective_result_limit
    )
    or (
      new.card_generation = 'llm'
      and (
        run_scope.model is distinct from new.card_model
        or run_scope.model_provider is distinct from new.card_model_provider
        or run_scope.upstream_model is distinct from new.card_upstream_model
      )
    )
  then
    raise exception 'research evidence scope mismatch' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger validate_research_evidence_scope_before_write
before insert or update on public.research_evidence
for each row execute function public.validate_research_evidence_scope();

-- Conflicting versions are removed before LIMIT is applied. This guarantees
-- that no memory selection can treat two versions of one norm as valid for
-- the same cutoff, even if one row would otherwise fall outside the window.
create view public.research_memory_candidates
with (security_invoker = true)
as
select evidence.*
from public.research_evidence as evidence
where evidence.card_summary is not null
  and (
    evidence.evidence_kind <> 'norm'
    or evidence.requery_required
    or not exists (
      select 1
      from public.research_evidence as conflict
      where conflict.conversation_id = evidence.conversation_id
        and conflict.client_id = evidence.client_id
        and conflict.retrieval_stichtag = evidence.retrieval_stichtag
        and conflict.evidence_kind = 'norm'
        and not conflict.requery_required
        and conflict.card_summary is not null
        and conflict.canonical_id = evidence.canonical_id
        and conflict.version_id is distinct from evidence.version_id
    )
  );

alter table public.research_evidence enable row level security;

revoke all on table public.research_evidence from public, anon, authenticated;
grant select, insert on table public.research_evidence to service_role;

revoke all on table public.research_memory_candidates from public, anon, authenticated;
grant select on table public.research_memory_candidates to service_role;

revoke all on function public.validate_research_evidence_scope()
  from public, anon, authenticated;
grant execute on function public.validate_research_evidence_scope()
  to service_role;

-- Persist one complete assistant turn in a single PostgREST RPC transaction.
-- The caller generates agent_run.id once and reuses the exact payload when a
-- transport outcome is unclear. PostgreSQL serializes retries for the same
-- conversation/run, compares a database-computed payload hash, and either
-- returns the committed result or rejects key reuse with different content.
create function public.persist_conversation_turn(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  conversation_id_value uuid;
  client_id_value uuid;
  agent_run_id_value uuid;
  assistant_message_id_value bigint;
  existing_run record;
  payload_sha256_value char(64);
  conversation_owner uuid;
  conversation_title text;
  completed_at_value timestamptz;
  pdf_artifacts_value jsonb;
  expected_step_count integer;
  expected_evidence_count integer;
  expected_artifact_count integer;
  persisted_step_count integer;
  persisted_evidence_count integer;
  persisted_artifact_count integer;
begin
  if payload is null or jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'conversation turn payload must be an object'
      using errcode = '22023';
  end if;

  if jsonb_typeof(payload -> 'assistant_message') is distinct from 'object'
    or jsonb_typeof(payload -> 'agent_run') is distinct from 'object'
    or jsonb_typeof(payload -> 'agent_steps') is distinct from 'array'
    or jsonb_typeof(payload -> 'research_evidence') is distinct from 'array'
    or jsonb_typeof(payload -> 'document_artifacts') is distinct from 'array'
  then
    raise exception 'conversation turn payload shape is invalid'
      using errcode = '22023';
  end if;

  conversation_id_value := (payload ->> 'conversation_id')::uuid;
  client_id_value := (payload ->> 'client_id')::uuid;
  agent_run_id_value := (payload #>> '{agent_run,id}')::uuid;
  completed_at_value := (payload #>> '{agent_run,completed_at}')::timestamptz;
  conversation_title := btrim(payload ->> 'title');
  payload_sha256_value := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(payload::text, 'UTF8')),
    'hex'
  );
  expected_step_count := jsonb_array_length(payload -> 'agent_steps');
  expected_evidence_count := jsonb_array_length(payload -> 'research_evidence');
  expected_artifact_count := jsonb_array_length(payload -> 'document_artifacts');

  if conversation_title is null or char_length(conversation_title) not between 1 and 120
    or payload ->> 'user_message' is null
    or payload #>> '{assistant_message,content}' is null
    or completed_at_value is null
  then
    raise exception 'conversation turn payload fields are invalid'
      using errcode = '22023';
  end if;

  -- Every writer takes locks in the same order. Hash collisions only serialize
  -- unrelated writes; ownership checks and primary keys still determine scope.
  perform pg_advisory_xact_lock(
    hashtextextended('conversation:' || conversation_id_value::text, 0)
  );
  perform pg_advisory_xact_lock(
    hashtextextended('agent-run:' || agent_run_id_value::text, 0)
  );

  select
    run.id,
    run.conversation_id,
    run.client_id,
    run.assistant_message_id,
    run.persistence_payload_sha256
  into existing_run
  from public.agent_runs as run
  where run.id = agent_run_id_value;

  if found then
    if existing_run.conversation_id is distinct from conversation_id_value
      or existing_run.client_id is distinct from client_id_value
      or existing_run.persistence_payload_sha256 is null
      or existing_run.persistence_payload_sha256 is distinct from payload_sha256_value
      or existing_run.assistant_message_id is null
    then
      raise exception 'agent run idempotency key reuse mismatch'
        using errcode = '23505';
    end if;

    select conversation.client_id
    into conversation_owner
    from public.conversations as conversation
    where conversation.id = conversation_id_value;

    if not found or conversation_owner is distinct from client_id_value then
      raise exception 'conversation ownership mismatch'
        using errcode = '42501';
    end if;

    perform 1
    from public.messages as assistant_message
    where assistant_message.id = existing_run.assistant_message_id
      and assistant_message.role = 'assistant'
      and assistant_message.conversation_id = conversation_id_value
      and assistant_message.client_id = client_id_value;

    if not found then
      raise exception 'persisted assistant message scope mismatch'
        using errcode = '23514';
    end if;

    select count(*)::integer
    into persisted_step_count
    from public.agent_steps as step
    where step.agent_run_id = agent_run_id_value;

    select count(*)::integer
    into persisted_evidence_count
    from public.research_evidence as evidence
    where evidence.agent_run_id = agent_run_id_value;

    select
      count(*)::integer,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', artifact.id,
            'title', artifact.title,
            'filename', artifact.filename
          ) order by artifact.created_at, artifact.id
        ),
        '[]'::jsonb
      )
    into persisted_artifact_count, pdf_artifacts_value
    from public.document_artifacts as artifact
    where artifact.agent_run_id = agent_run_id_value;

    if persisted_step_count is distinct from expected_step_count
      or persisted_evidence_count is distinct from expected_evidence_count
      or persisted_artifact_count is distinct from expected_artifact_count
    then
      raise exception 'persisted conversation turn is incomplete'
        using errcode = '23514';
    end if;

    return jsonb_build_object(
      'assistantMessageId', existing_run.assistant_message_id,
      'agentRunId', existing_run.id,
      'pdfArtifacts', pdf_artifacts_value,
      'artifactsPersisted', true
    );
  end if;

  insert into public.conversations (
    id,
    client_id,
    title,
    updated_at
  ) values (
    conversation_id_value,
    client_id_value,
    conversation_title,
    completed_at_value
  )
  on conflict (id) do update
  set updated_at = excluded.updated_at
  where public.conversations.client_id = excluded.client_id
  returning public.conversations.client_id into conversation_owner;

  if not found or conversation_owner is distinct from client_id_value then
    raise exception 'conversation ownership mismatch'
      using errcode = '42501';
  end if;

  insert into public.messages (
    conversation_id,
    client_id,
    role,
    content
  ) values (
    conversation_id_value,
    client_id_value,
    'user',
    payload ->> 'user_message'
  );

  insert into public.messages (
    conversation_id,
    client_id,
    role,
    content,
    model,
    model_provider,
    upstream_model,
    reasoning_setting,
    model_settings_revision,
    model_settings_source
  ) values (
    conversation_id_value,
    client_id_value,
    'assistant',
    payload #>> '{assistant_message,content}',
    payload #>> '{assistant_message,model}',
    payload #>> '{assistant_message,model_provider}',
    payload #>> '{assistant_message,upstream_model}',
    payload #>> '{assistant_message,reasoning_setting}',
    (payload #>> '{assistant_message,model_settings_revision}')::bigint,
    payload #>> '{assistant_message,model_settings_source}'
  )
  returning id into assistant_message_id_value;

  insert into public.agent_runs (
    id,
    conversation_id,
    client_id,
    assistant_message_id,
    status,
    started_at,
    completed_at,
    persistence_payload_sha256,
    research_result_limit,
    research_result_limit_source,
    research_stichtag,
    research_stichtag_kind,
    research_stichtag_reason,
    research_stichtag_matched_text,
    research_reference_year
  ) values (
    agent_run_id_value,
    conversation_id_value,
    client_id_value,
    assistant_message_id_value,
    'completed',
    (payload #>> '{agent_run,started_at}')::timestamptz,
    completed_at_value,
    payload_sha256_value,
    (payload #>> '{agent_run,research_result_limit}')::integer,
    payload #>> '{agent_run,research_result_limit_source}',
    (payload #>> '{agent_run,research_stichtag}')::date,
    payload #>> '{agent_run,research_stichtag_kind}',
    payload #>> '{agent_run,research_stichtag_reason}',
    payload #>> '{agent_run,research_stichtag_matched_text}',
    (payload #>> '{agent_run,research_reference_year}')::integer
  );

  insert into public.agent_steps (
    agent_run_id,
    step_order,
    step_type,
    title,
    content,
    tool_name,
    success,
    arguments,
    tools
  )
  select
    agent_run_id_value,
    step.step_order,
    step.step_type,
    step.title,
    step.content,
    step.tool_name,
    step.success,
    step.arguments,
    step.tools
  from jsonb_populate_recordset(
    null::public.agent_steps,
    payload -> 'agent_steps'
  ) as step;

  insert into public.research_evidence (
    id,
    agent_run_id,
    conversation_id,
    client_id,
    result_step_order,
    evidence_order,
    semantic_tool_name,
    raw_tool_name,
    source_key,
    source_name,
    source_kb_id,
    source_system,
    evidence_kind,
    requery_required,
    semantic_arguments,
    effective_arguments,
    result_limit_applied,
    effective_result_limit,
    query_text,
    retrieval_stichtag,
    retrieval_stichtag_kind,
    retrieval_stichtag_reason,
    retrieval_stichtag_matched_text,
    reference_year,
    structured_content,
    classification_metadata,
    canonical_id,
    version_id,
    official_uri,
    valid_from,
    valid_to,
    rechtssatz_id,
    decision_id,
    chunk_id,
    decision_date,
    content,
    content_sha256,
    original_content_sha256,
    original_content_chars,
    content_truncated,
    card_summary,
    card_topics,
    card_generation,
    card_model,
    card_model_provider,
    card_upstream_model,
    card_reasoning,
    card_prompt_version,
    retrieved_at,
    card_generated_at
  )
  select
    evidence.id,
    agent_run_id_value,
    conversation_id_value,
    client_id_value,
    evidence.result_step_order,
    evidence.evidence_order,
    evidence.semantic_tool_name,
    evidence.raw_tool_name,
    evidence.source_key,
    evidence.source_name,
    evidence.source_kb_id,
    evidence.source_system,
    evidence.evidence_kind,
    evidence.requery_required,
    evidence.semantic_arguments,
    evidence.effective_arguments,
    evidence.result_limit_applied,
    evidence.effective_result_limit,
    evidence.query_text,
    evidence.retrieval_stichtag,
    evidence.retrieval_stichtag_kind,
    evidence.retrieval_stichtag_reason,
    evidence.retrieval_stichtag_matched_text,
    evidence.reference_year,
    evidence.structured_content,
    evidence.classification_metadata,
    evidence.canonical_id,
    evidence.version_id,
    evidence.official_uri,
    evidence.valid_from,
    evidence.valid_to,
    evidence.rechtssatz_id,
    evidence.decision_id,
    evidence.chunk_id,
    evidence.decision_date,
    evidence.content,
    evidence.content_sha256,
    evidence.original_content_sha256,
    evidence.original_content_chars,
    evidence.content_truncated,
    evidence.card_summary,
    evidence.card_topics,
    evidence.card_generation,
    evidence.card_model,
    evidence.card_model_provider,
    evidence.card_upstream_model,
    evidence.card_reasoning,
    evidence.card_prompt_version,
    evidence.retrieved_at,
    evidence.card_generated_at
  from jsonb_populate_recordset(
    null::public.research_evidence,
    payload -> 'research_evidence'
  ) as evidence;

  insert into public.document_artifacts (
    id,
    conversation_id,
    client_id,
    assistant_message_id,
    agent_run_id,
    kind,
    title,
    filename,
    content_markdown,
    content_sha256,
    stichtag,
    provenance
  )
  select
    artifact.id,
    conversation_id_value,
    client_id_value,
    assistant_message_id_value,
    agent_run_id_value,
    'pdf',
    artifact.title,
    artifact.filename,
    artifact.content_markdown,
    artifact.content_sha256,
    artifact.stichtag,
    artifact.provenance
  from jsonb_populate_recordset(
    null::public.document_artifacts,
    payload -> 'document_artifacts'
  ) as artifact;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', artifact.id,
        'title', artifact.title,
        'filename', artifact.filename
      ) order by artifact.created_at, artifact.id
    ),
    '[]'::jsonb
  )
  into pdf_artifacts_value
  from public.document_artifacts as artifact
  where artifact.agent_run_id = agent_run_id_value;

  return jsonb_build_object(
    'assistantMessageId', assistant_message_id_value,
    'agentRunId', agent_run_id_value,
    'pdfArtifacts', pdf_artifacts_value,
    'artifactsPersisted', true
  );
end;
$$;

revoke all on function public.persist_conversation_turn(jsonb)
  from public, anon, authenticated;
grant execute on function public.persist_conversation_turn(jsonb)
  to service_role;
