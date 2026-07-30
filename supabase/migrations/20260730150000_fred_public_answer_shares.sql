-- Fred public answer sharing: one public UUID per shared assistant message.
-- Share row only exists after explicit user click; deletion cascades from conversation.
-- record_fred_native_event also returns the persisted message_id.

-- 1. Table ---------------------------------------------------------------

create table public.fred_public_answer_shares (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  client_id uuid not null references auth.users(id) on delete cascade,
  question_message_id bigint not null references public.fred_messages(id) on delete cascade,
  assistant_message_id bigint not null references public.fred_messages(id) on delete cascade,
  question_content text not null,
  answer_content text not null,
  created_at timestamptz not null default now(),
  constraint fred_public_answer_shares_content_length
    check (
      char_length(question_content) between 1 and 500000
      and char_length(answer_content) between 1 and 500000
    ),
  constraint fred_public_answer_shares_conversation_fk
    foreign key (conversation_id, client_id)
    references public.fred_conversations(id, client_id)
    on delete cascade,
  constraint fred_public_answer_shares_client_message_unique
    unique (client_id, assistant_message_id),
  constraint fred_public_answer_shares_distinct_ids
    check (question_message_id <> assistant_message_id)
);

-- 2. RLS -----------------------------------------------------------------

alter table public.fred_public_answer_shares enable row level security;

revoke all on public.fred_public_answer_shares from public, anon, authenticated;
grant select, insert on public.fred_public_answer_shares to service_role;

-- 3. Updated record_fred_native_event: return message_id ------------------

create or replace function public.record_fred_native_event(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  event_id_value uuid;
  event_type_value text;
  attachments_value jsonb;
  web_search_enabled_value boolean;
  pro_mode_enabled_value boolean;
  display_content_value text;
  research_trace_value jsonb;
  source_references_value jsonb;
  content_transformation_value text;
  attachment_value jsonb;
  attachment_kind text;
  attachment_name text;
  attachment_mime_type text;
  attachment_size_bytes bigint;
  attachment_sha256 text;
  image_count integer := 0;
  file_count integer := 0;
  existing_attachments jsonb;
  existing_web_search_enabled boolean;
  existing_pro_mode_enabled boolean;
  existing_display_content text;
  existing_research_trace jsonb;
  existing_source_references jsonb;
  existing_content_transformation text;
  metadata_already_recorded boolean;
  result_value jsonb;
  message_id_value bigint;
begin
  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'fred native payload must be an object' using errcode = '22023';
  end if;

  event_id_value := (payload ->> 'event_id')::uuid;
  event_type_value := btrim(payload ->> 'event_type');
  attachments_value := coalesce(payload -> 'attachments', '[]'::jsonb);
  display_content_value := nullif(btrim(payload ->> 'display_content'), '');
  research_trace_value := coalesce(payload -> 'research_trace', '[]'::jsonb);
  source_references_value := coalesce(payload -> 'source_references', '[]'::jsonb);
  content_transformation_value := nullif(btrim(payload ->> 'content_transformation'), '');

  if payload ? 'web_search_enabled'
    and jsonb_typeof(payload -> 'web_search_enabled') is distinct from 'boolean'
  then
    raise exception 'fred native web search flag must be boolean' using errcode = '22023';
  end if;
  web_search_enabled_value := coalesce((payload ->> 'web_search_enabled')::boolean, false);

  if payload ? 'pro_mode_enabled'
    and jsonb_typeof(payload -> 'pro_mode_enabled') is distinct from 'boolean'
  then
    raise exception 'fred native pro mode flag must be boolean' using errcode = '22023';
  end if;
  pro_mode_enabled_value := coalesce((payload ->> 'pro_mode_enabled')::boolean, false);

  if jsonb_typeof(attachments_value) is distinct from 'array'
    or jsonb_array_length(attachments_value) > 10
  then
    raise exception 'fred native attachments must be an array of at most ten items'
      using errcode = '22023';
  end if;

  for attachment_value in
    select value from jsonb_array_elements(attachments_value)
  loop
    if jsonb_typeof(attachment_value) is distinct from 'object'
      or jsonb_typeof(attachment_value -> 'kind') is distinct from 'string'
      or jsonb_typeof(attachment_value -> 'name') is distinct from 'string'
      or jsonb_typeof(attachment_value -> 'mime_type') is distinct from 'string'
      or jsonb_typeof(attachment_value -> 'size_bytes') is distinct from 'number'
      or jsonb_typeof(attachment_value -> 'sha256') is distinct from 'string'
    then
      raise exception 'fred native attachment metadata is invalid' using errcode = '22023';
    end if;

    attachment_kind := attachment_value ->> 'kind';
    attachment_name := btrim(attachment_value ->> 'name');
    attachment_mime_type := lower(btrim(attachment_value ->> 'mime_type'));
    attachment_size_bytes := (attachment_value ->> 'size_bytes')::bigint;
    attachment_sha256 := lower(attachment_value ->> 'sha256');

    if attachment_kind not in ('image', 'file')
      or char_length(attachment_name) not between 1 and 255
      or char_length(attachment_mime_type) not between 1 and 127
      or attachment_mime_type !~ '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$'
      or attachment_size_bytes < 1
      or attachment_sha256 !~ '^[0-9a-f]{64}$'
      or exists (
        select 1
        from jsonb_object_keys(attachment_value) as object_key(key_name)
        where key_name not in ('kind', 'name', 'mime_type', 'size_bytes', 'sha256')
      )
    then
      raise exception 'fred native attachment metadata fields are invalid' using errcode = '22023';
    end if;

    if attachment_kind = 'image' then
      image_count := image_count + 1;
      if image_count > 5 or attachment_size_bytes > 10485760 then
        raise exception 'fred native image limits exceeded' using errcode = '22023';
      end if;
    else
      file_count := file_count + 1;
      if file_count > 5 or attachment_size_bytes > 20971520 then
        raise exception 'fred native file limits exceeded' using errcode = '22023';
      end if;
    end if;
  end loop;

  if jsonb_typeof(research_trace_value) is distinct from 'array'
    or jsonb_array_length(research_trace_value) > 200
    or jsonb_typeof(source_references_value) is distinct from 'array'
    or jsonb_array_length(source_references_value) > 100
  then
    raise exception 'fred native research metadata is invalid' using errcode = '22023';
  end if;

  if event_type_value = 'message_received' then
    if attachments_value <> '[]'::jsonb
      or web_search_enabled_value
      or pro_mode_enabled_value
      or display_content_value is null
      or char_length(display_content_value) > 500000
      or content_transformation_value is null
      or content_transformation_value !~ '^[a-z0-9][a-z0-9_-]{0,79}$'
    then
      raise exception 'fred assistant presentation metadata is invalid' using errcode = '22023';
    end if;
  elsif event_type_value = 'message_sent' then
    if display_content_value is not null
      or research_trace_value <> '[]'::jsonb
      or source_references_value <> '[]'::jsonb
      or content_transformation_value is not null
    then
      raise exception 'fred user events cannot contain presentation metadata' using errcode = '22023';
    end if;
  end if;

  result_value := public.record_fred_bridge_event(payload);

  select
    message.id,
    message.attachments,
    message.web_search_enabled,
    message.pro_mode_enabled,
    message.display_content,
    message.research_trace,
    message.source_references,
    message.content_transformation,
    message.native_metadata_recorded
  into
    message_id_value,
    existing_attachments,
    existing_web_search_enabled,
    existing_pro_mode_enabled,
    existing_display_content,
    existing_research_trace,
    existing_source_references,
    existing_content_transformation,
    metadata_already_recorded
  from public.fred_messages as message
  where message.bridge_event_id = event_id_value
  for update;

  if not found then
    raise exception 'fred native message was not persisted' using errcode = 'P0001';
  end if;

  if metadata_already_recorded
    and (
      existing_attachments is distinct from attachments_value
      or existing_web_search_enabled is distinct from web_search_enabled_value
      or existing_pro_mode_enabled is distinct from pro_mode_enabled_value
      or existing_display_content is distinct from display_content_value
      or existing_research_trace is distinct from research_trace_value
      or existing_source_references is distinct from source_references_value
      or existing_content_transformation is distinct from content_transformation_value
    )
  then
    raise exception 'fred native event id metadata reuse mismatch' using errcode = '23505';
  end if;

  update public.fred_messages
  set attachments = attachments_value,
      web_search_enabled = web_search_enabled_value,
      pro_mode_enabled = pro_mode_enabled_value,
      display_content = display_content_value,
      research_trace = research_trace_value,
      source_references = source_references_value,
      content_transformation = content_transformation_value,
      native_metadata_recorded = true
  where bridge_event_id = event_id_value;

  return result_value || jsonb_build_object('message_id', message_id_value);
end;
$$;

revoke all on function public.record_fred_native_event(jsonb)
from public, anon, authenticated;
grant execute on function public.record_fred_native_event(jsonb)
to service_role;

-- 4. create_fred_public_answer_share RPC ----------------------------------

create function public.create_fred_public_answer_share(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  client_id_value uuid;
  conversation_id_value uuid;
  assistant_message_id_value bigint;
  existing_share_id uuid;
  assistant_row public.fred_messages%rowtype;
  question_row public.fred_messages%rowtype;
  question_content_value text;
  answer_content_value text;
begin
  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'fred public share payload must be an object' using errcode = '22023';
  end if;

  client_id_value := (payload ->> 'client_id')::uuid;
  conversation_id_value := (payload ->> 'conversation_id')::uuid;
  assistant_message_id_value := (payload ->> 'assistant_message_id')::bigint;

  if client_id_value is null
    or conversation_id_value is null
    or assistant_message_id_value is null
    or assistant_message_id_value <= 0
  then
    raise exception 'fred public share fields are invalid' using errcode = '22023';
  end if;

  -- Lock the conversation row to prevent concurrent delete while resolving/inserting.
  -- The FK constraint remains the final integrity guard.
  perform 1
  from public.fred_conversations
  where id = conversation_id_value
    and client_id = client_id_value
  for key share;

  if not found then
    raise exception 'fred public share conversation not found' using errcode = 'P0002';
  end if;

  -- Load assistant message, verify ownership and role.
  select *
  into assistant_row
  from public.fred_messages
  where id = assistant_message_id_value
    and conversation_id = conversation_id_value
    and client_id = client_id_value
  for share;

  if not found then
    raise exception 'fred public share assistant message not found' using errcode = 'P0002';
  end if;

  if assistant_row.role <> 'assistant' then
    raise exception 'fred public share target message is not an assistant message' using errcode = 'P0002';
  end if;

  -- Resolve nearest preceding user question using exact chronology.
  -- When assistant has a non-NULL provider_created_at: candidate user must have
  -- non-NULL earlier timestamp, or same timestamp and lower ID.
  -- When assistant has NULL provider_created_at: candidate user has any non-NULL
  -- timestamp, or NULL timestamp with lower ID.
  select *
  into question_row
  from public.fred_messages
  where conversation_id = conversation_id_value
    and client_id = client_id_value
    and role = 'user'
    and (
      (assistant_row.provider_created_at is not null and (
        provider_created_at < assistant_row.provider_created_at
        or (
          provider_created_at is not distinct from assistant_row.provider_created_at
          and id < assistant_row.id
        )
      ))
      or
      (assistant_row.provider_created_at is null and (
        provider_created_at is not null
        or (
          provider_created_at is null
          and id < assistant_row.id
        )
      ))
    )
  order by provider_created_at desc nulls first, id desc
  limit 1;

  if not found then
    raise exception 'fred public share missing preceding question' using errcode = 'P0002';
  end if;

  question_content_value := question_row.content;
  answer_content_value := coalesce(nullif(assistant_row.display_content, ''), assistant_row.content);

  if char_length(question_content_value) < 1
    or char_length(answer_content_value) < 1
    or char_length(question_content_value) > 500000
    or char_length(answer_content_value) > 500000
  then
    raise exception 'fred public share content out of bounds' using errcode = '22023';
  end if;

  -- Concurrency-safe idempotent insert: ON CONFLICT DO NOTHING + fallback select.
  insert into public.fred_public_answer_shares (
    conversation_id,
    client_id,
    question_message_id,
    assistant_message_id,
    question_content,
    answer_content
  ) values (
    conversation_id_value,
    client_id_value,
    question_row.id,
    assistant_message_id_value,
    question_content_value,
    answer_content_value
  )
  on conflict (client_id, assistant_message_id) do nothing
  returning id into existing_share_id;

  if not found then
    -- INSERT did nothing because a row already exists; select the existing ID.
    select id
    into existing_share_id
    from public.fred_public_answer_shares
    where client_id = client_id_value
      and assistant_message_id = assistant_message_id_value;
  end if;

  return jsonb_build_object('share_id', existing_share_id);
end;
$$;

revoke all on function public.create_fred_public_answer_share(jsonb)
from public, anon, authenticated;
grant execute on function public.create_fred_public_answer_share(jsonb)
to service_role;
