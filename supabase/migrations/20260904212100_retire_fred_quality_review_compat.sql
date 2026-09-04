-- Stage 1: compatible with both application revisions. No user history is removed.
begin;
select pg_advisory_xact_lock(hashtextextended('fred:quality-review-batch', 0));

alter table public.fred_request_ledger
  drop constraint fred_request_ledger_content_lifecycle,
  add constraint fred_request_ledger_content_lifecycle check (
    (content_deleted_at is null and content_deletion_reason is null
      and (request_content is null or char_length(request_content) between 1 and 500000)
      and request_content_sha256 is not null
      and request_content_sha256 ~ '^[0-9a-f]{64}$')
    or (content_deleted_at is not null and content_deletion_reason is not null
      and request_content is null
      and (request_content_sha256 is null or request_content_sha256 ~ '^[0-9a-f]{64}$'))
  ),
  drop constraint fred_request_ledger_deletion_reason_values,
  add constraint fred_request_ledger_deletion_reason_values
    check (content_deletion_reason in ('quality_batch', 'quality_retired', 'user_conversation_delete'));

alter table public.admin_request_history alter column content drop not null;

CREATE OR REPLACE FUNCTION public.guard_terminal_fred_request_bridge_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  receipt public.fred_request_ledger%rowtype;
begin
  if new.bridge_event_id is null
    or (tg_op = 'UPDATE' and new.bridge_event_id is not distinct from old.bridge_event_id)
  then
    return new;
  end if;

  select * into receipt
  from public.fred_request_ledger
  where user_event_id = new.bridge_event_id
    or assistant_event_id = new.bridge_event_id
  for update;

  if not found then
    return new;
  end if;

  if receipt.content_deletion_reason = 'user_conversation_delete'
    or receipt.status in ('completed', 'failed', 'cancelled')
  then
    raise exception 'fred bridge event belongs to a terminal request'
      using errcode = '55000';
  end if;

  return new;
end;
$function$;


CREATE OR REPLACE FUNCTION public.create_fred_request_receipt(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  request_id_value uuid;
  client_id_value uuid;
  origin_value text;
  telegram_update_id_value bigint;
  update_row_id_value bigint;
  lease_id_value uuid;
  agent_key_value text;
  user_event_id_value uuid;
  assistant_event_id_value uuid;
  conversation_id_value uuid;
  web_search_enabled_value boolean;
  pro_mode_enabled_value boolean;
  content_value text;
  content_sha256_value text;
  locked_conversation_id uuid;
  channel_id_value text;
  session_id_value text;
  telegram_update public.telegram_updates%rowtype;
  receipt public.fred_request_ledger%rowtype;
begin
  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'fred request receipt payload must be an object' using errcode = '22023';
  end if;

  if (payload ? 'web_search_enabled'
      and jsonb_typeof(payload -> 'web_search_enabled') is distinct from 'boolean')
    or (payload ? 'pro_mode_enabled'
      and jsonb_typeof(payload -> 'pro_mode_enabled') is distinct from 'boolean')
  then
    raise exception 'fred request receipt mode fields are invalid' using errcode = '22023';
  end if;

  request_id_value := (payload ->> 'request_id')::uuid;
  client_id_value := (payload ->> 'client_id')::uuid;
  origin_value := btrim(payload ->> 'origin');
  telegram_update_id_value := nullif(payload ->> 'telegram_update_id', '')::bigint;
  update_row_id_value := nullif(payload ->> 'telegram_update_row_id', '')::bigint;
  lease_id_value := nullif(payload ->> 'telegram_lease_id', '')::uuid;
  agent_key_value := btrim(payload ->> 'agent_key');
  user_event_id_value := (payload ->> 'user_event_id')::uuid;
  assistant_event_id_value := (payload ->> 'assistant_event_id')::uuid;
  conversation_id_value := nullif(payload ->> 'conversation_id', '')::uuid;
  web_search_enabled_value := coalesce((payload ->> 'web_search_enabled')::boolean, false);
  pro_mode_enabled_value := coalesce((payload ->> 'pro_mode_enabled')::boolean, false);
  content_value := btrim(payload ->> 'content');
  content_sha256_value := encode(
    extensions.digest(convert_to(content_value, 'UTF8'), 'sha256'),
    'hex'
  );

  if origin_value not in ('web', 'telegram')
    or agent_key_value not in ('fred', 'quickfred')
    or user_event_id_value = assistant_event_id_value
    or char_length(content_value) not between 1 and 500000
    or (
      origin_value = 'web'
      and (
        telegram_update_id_value is not null
        or update_row_id_value is not null
        or lease_id_value is not null
      )
    )
    or (
      origin_value = 'telegram'
      and (
        telegram_update_id_value is null
        or update_row_id_value is null
        or lease_id_value is null
        or telegram_update_id_value <> update_row_id_value
      )
    )
  then
    raise exception 'fred request receipt fields are invalid' using errcode = '22023';
  end if;

  -- The account row is first in every create/delete lock hierarchy. Besides
  -- preventing an FK race, this keeps account deletion from owning the account
  -- while waiting on a provider session or queue row held below.
  if not public.lock_existing_findog_account(client_id_value) then
    raise exception 'fred request client does not exist' using errcode = '23503';
  end if;

  if conversation_id_value is not null then
    select
      conversation.weknora_channel_id,
      conversation.weknora_session_id
    into channel_id_value, session_id_value
    from public.fred_conversations as conversation
    where conversation.id = conversation_id_value
      and conversation.client_id = client_id_value
      and conversation.agent_key = agent_key_value;

    if not found then
      raise exception 'fred request conversation ownership mismatch' using errcode = '42501';
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended('fred:' || channel_id_value || ':' || session_id_value, 0)
    );

    -- Revalidate after taking the provider-session lock, then retain a weak row
    -- lock until every receipt FK write has completed.
    select conversation.id into locked_conversation_id
    from public.fred_conversations as conversation
    where conversation.id = conversation_id_value
      and conversation.client_id = client_id_value
      and conversation.agent_key = agent_key_value
      and conversation.weknora_channel_id = channel_id_value
      and conversation.weknora_session_id = session_id_value
    for key share;

    if not found then
      raise exception 'fred request conversation changed during lock acquisition'
        using errcode = '40001';
    end if;
  end if;

  if origin_value = 'telegram' then
    select queued_update.* into telegram_update
    from public.telegram_updates as queued_update
    join public.telegram_integrations as integration
      on integration.id = queued_update.integration_id
    where queued_update.id = update_row_id_value
      and integration.client_id = client_id_value
    for update of queued_update;

    if not found
      or telegram_update.status is distinct from 'processing'
      or telegram_update.lease_id is distinct from lease_id_value
      or telegram_update.lease_expires_at is null
      or telegram_update.lease_expires_at <= now()
    then
      return 'false'::jsonb;
    end if;
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
    request_content_sha256,
    conversation_id,
    web_search_enabled,
    pro_mode_enabled,
    ingress_context_recorded
  ) values (
    request_id_value,
    client_id_value,
    origin_value,
    telegram_update_id_value,
    agent_key_value,
    user_event_id_value,
    assistant_event_id_value,
    null,
    content_sha256_value,
    conversation_id_value,
    web_search_enabled_value,
    pro_mode_enabled_value,
    true
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
    or (
      receipt.request_content_sha256 is not null
      and receipt.request_content_sha256 is distinct from content_sha256_value
    )
  then
    raise exception 'fred request receipt id reuse mismatch' using errcode = '23505';
  end if;

  -- Receipts that predate this migration did not freeze modes or a possible
  -- existing conversation at ingress. Fill that context once, then preserve it.
  if not receipt.ingress_context_recorded then
    update public.fred_request_ledger
    set conversation_id = coalesce(receipt.conversation_id, conversation_id_value),
        web_search_enabled = web_search_enabled_value,
        pro_mode_enabled = pro_mode_enabled_value,
        ingress_context_recorded = true
    where id = receipt.id
    returning * into receipt;
  end if;

  return jsonb_build_object(
    'request_id', receipt.id,
    'user_event_id', receipt.user_event_id,
    'assistant_event_id', receipt.assistant_event_id,
    'status', receipt.status,
    'received_at', receipt.received_at
  );
end;
$function$;


CREATE OR REPLACE FUNCTION public.transition_fred_request_receipt(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  request_id_value uuid;
  target_status_value text;
  conversation_id_value uuid;
  user_message_id_value bigint;
  assistant_message_id_value bigint;
  failure_phase_value text;
  error_code_value text;
  receipt public.fred_request_ledger%rowtype;
  unlocked_client_id uuid;
  session_conversation_id uuid;
  locked_conversation_id uuid;
  channel_id_value text;
  session_id_value text;
  session_lock_acquired boolean := false;
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

  -- Discover provenance without row locks, then enter the global hierarchy at
  -- auth.users before taking a provider-session or receipt lock.
  select * into receipt
  from public.fred_request_ledger
  where id = request_id_value;

  if not found then
    raise exception 'fred request receipt not found' using errcode = 'P0002';
  end if;

  unlocked_client_id := receipt.client_id;
  if not public.lock_existing_findog_account(unlocked_client_id) then
    raise exception 'fred request client does not exist' using errcode = '23503';
  end if;

  if target_status_value = 'user_persisted' and conversation_id_value is not null then
    select
      conversation.id,
      conversation.weknora_channel_id,
      conversation.weknora_session_id
    into session_conversation_id, channel_id_value, session_id_value
    from public.fred_conversations as conversation
    where conversation.id = conversation_id_value
      and conversation.client_id = unlocked_client_id;
  elsif receipt.conversation_id is not null then
    select
      conversation.id,
      conversation.weknora_channel_id,
      conversation.weknora_session_id
    into session_conversation_id, channel_id_value, session_id_value
    from public.fred_conversations as conversation
    where conversation.id = receipt.conversation_id
      and conversation.client_id = unlocked_client_id;
  else
    select
      conversation.id,
      conversation.weknora_channel_id,
      conversation.weknora_session_id
    into session_conversation_id, channel_id_value, session_id_value
    from public.fred_messages as message
    join public.fred_conversations as conversation
      on conversation.id = message.conversation_id
    where message.bridge_event_id in (receipt.user_event_id, receipt.assistant_event_id)
      and message.client_id = unlocked_client_id
    order by message.id
    limit 1;
  end if;

  if session_conversation_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('fred:' || channel_id_value || ':' || session_id_value, 0)
    );
    session_lock_acquired := true;

    select conversation.id into locked_conversation_id
    from public.fred_conversations as conversation
    where conversation.id = session_conversation_id
      and conversation.client_id = unlocked_client_id
      and conversation.weknora_channel_id = channel_id_value
      and conversation.weknora_session_id = session_id_value
    for key share;

    if not found then
      raise exception 'fred transition conversation changed during lock acquisition'
        using errcode = '40001';
    end if;
  end if;

  select * into receipt
  from public.fred_request_ledger
  where id = request_id_value
  for update;

  if not found then
    raise exception 'fred request receipt not found' using errcode = 'P0002';
  end if;

  if receipt.client_id is distinct from unlocked_client_id then
    raise exception 'fred request receipt owner changed' using errcode = '23514';
  end if;

  if receipt.content_deletion_reason = 'user_conversation_delete' then
    raise exception 'fred request receipt content already deleted' using errcode = '55000';
  end if;

  if receipt.status in ('completed', 'failed', 'cancelled') then
    if receipt.status <> target_status_value then
      raise exception 'fred request terminal state is immutable' using errcode = '55000';
    end if;
    return jsonb_build_object('request_id', receipt.id, 'status', receipt.status);
  end if;

  if not session_lock_acquired and (
    (
      target_status_value = 'user_persisted'
      and conversation_id_value is not null
      and exists (
        select 1 from public.fred_conversations as conversation
        where conversation.id = conversation_id_value
          and conversation.client_id = receipt.client_id
      )
    )
    or (
      receipt.conversation_id is not null
      and exists (
        select 1 from public.fred_conversations as conversation
        where conversation.id = receipt.conversation_id
          and conversation.client_id = receipt.client_id
      )
    )
    or exists (
      select 1
      from public.fred_messages as message
      join public.fred_conversations as conversation
        on conversation.id = message.conversation_id
      where message.bridge_event_id in (receipt.user_event_id, receipt.assistant_event_id)
        and message.client_id = receipt.client_id
    )
  ) then
    raise exception 'fred transition provider session discovered after receipt lock'
      using errcode = '40001';
  end if;

  if target_status_value = 'user_persisted' then
    if receipt.status not in ('received', 'user_persisted', 'generating')
      or conversation_id_value is null
      or user_message_id_value is null
      or (receipt.conversation_id is not null and receipt.conversation_id <> conversation_id_value)
      or (receipt.user_message_id is not null and receipt.user_message_id <> user_message_id_value)
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
    set status = case when receipt.status = 'received' then 'user_persisted' else receipt.status end,
        conversation_id = conversation_id_value,
        user_message_id = user_message_id_value,
        user_persisted_at = coalesce(user_persisted_at, now())
    where id = receipt.id
    returning * into receipt;

  elsif target_status_value = 'generating' then
    if receipt.status not in ('user_persisted', 'generating') then
      raise exception 'fred generating transition mismatch' using errcode = '23514';
    end if;

    update public.fred_request_ledger
    set status = 'generating',
        generation_started_at = coalesce(generation_started_at, now())
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
$function$;


CREATE OR REPLACE FUNCTION public.resume_fred_request_receipt(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  request_id_value uuid;
  client_id_value uuid;
  telegram_update_id_value bigint;
  receipt public.fred_request_ledger%rowtype;
  user_message public.fred_messages%rowtype;
  assistant_message public.fred_messages%rowtype;
  session_conversation_id uuid;
  locked_conversation_id uuid;
  channel_id_value text;
  session_id_value text;
  session_lock_acquired boolean := false;
  user_found boolean := false;
  assistant_found boolean := false;
begin
  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'fred request resume payload must be an object' using errcode = '22023';
  end if;

  request_id_value := (payload ->> 'request_id')::uuid;
  client_id_value := (payload ->> 'client_id')::uuid;
  telegram_update_id_value := (payload ->> 'telegram_update_id')::bigint;

  if request_id_value is null
    or client_id_value is null
    or telegram_update_id_value is null
  then
    raise exception 'fred request resume fields are invalid' using errcode = '22023';
  end if;

  if not public.lock_existing_findog_account(client_id_value) then
    raise exception 'fred request client does not exist' using errcode = '23503';
  end if;

  select * into receipt
  from public.fred_request_ledger
  where id = request_id_value;

  if not found then
    raise exception 'fred request receipt not found' using errcode = 'P0002';
  end if;
  if receipt.client_id is distinct from client_id_value
    or receipt.origin is distinct from 'telegram'
    or receipt.telegram_update_id is distinct from telegram_update_id_value
  then
    raise exception 'fred request resume ownership mismatch' using errcode = '42501';
  end if;

  if receipt.conversation_id is not null then
    select
      conversation.id,
      conversation.weknora_channel_id,
      conversation.weknora_session_id
    into session_conversation_id, channel_id_value, session_id_value
    from public.fred_conversations as conversation
    where conversation.id = receipt.conversation_id
      and conversation.client_id = client_id_value;
  else
    select
      conversation.id,
      conversation.weknora_channel_id,
      conversation.weknora_session_id
    into session_conversation_id, channel_id_value, session_id_value
    from public.fred_messages as message
    join public.fred_conversations as conversation
      on conversation.id = message.conversation_id
    where message.bridge_event_id in (receipt.user_event_id, receipt.assistant_event_id)
      and message.client_id = client_id_value
    order by message.id
    limit 1;
  end if;

  if session_conversation_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('fred:' || channel_id_value || ':' || session_id_value, 0)
    );
    session_lock_acquired := true;

    select conversation.id into locked_conversation_id
    from public.fred_conversations as conversation
    where conversation.id = session_conversation_id
      and conversation.client_id = client_id_value
      and conversation.weknora_channel_id = channel_id_value
      and conversation.weknora_session_id = session_id_value
    for key share;

    if not found then
      raise exception 'fred resume conversation changed during lock acquisition'
        using errcode = '40001';
    end if;
  end if;

  select * into receipt
  from public.fred_request_ledger
  where id = request_id_value
  for update;

  if not found then
    raise exception 'fred request receipt not found' using errcode = 'P0002';
  end if;
  if receipt.client_id is distinct from client_id_value
    or receipt.origin is distinct from 'telegram'
    or receipt.telegram_update_id is distinct from telegram_update_id_value
  then
    raise exception 'fred request resume ownership mismatch' using errcode = '42501';
  end if;

  if receipt.content_deletion_reason = 'user_conversation_delete' then
    return jsonb_build_object(
      'status', receipt.status,
      'content_deleted', true,
      'web_search_enabled', receipt.web_search_enabled,
      'pro_mode_enabled', receipt.pro_mode_enabled
    );
  end if;

  select * into user_message
  from public.fred_messages as message
  where message.bridge_event_id = receipt.user_event_id
    and message.client_id = receipt.client_id;
  user_found := found;

  select * into assistant_message
  from public.fred_messages as message
  where message.bridge_event_id = receipt.assistant_event_id
    and message.client_id = receipt.client_id;
  assistant_found := found;

  if not session_lock_acquired and (
    (
      receipt.conversation_id is not null
      and exists (
        select 1 from public.fred_conversations as conversation
        where conversation.id = receipt.conversation_id
          and conversation.client_id = receipt.client_id
      )
    )
    or user_found
    or assistant_found
  ) then
    raise exception 'fred resume provider session discovered after receipt lock'
      using errcode = '40001';
  end if;

  if user_found and (
    user_message.role <> 'user'
    or (receipt.conversation_id is not null and receipt.conversation_id <> user_message.conversation_id)
    or (receipt.user_message_id is not null and receipt.user_message_id <> user_message.id)
  ) then
    raise exception 'fred request resume user provenance mismatch' using errcode = '23514';
  end if;

  if assistant_found and (
    not user_found
    or assistant_message.role <> 'assistant'
    or assistant_message.conversation_id <> user_message.conversation_id
    or (receipt.assistant_message_id is not null and receipt.assistant_message_id <> assistant_message.id)
  ) then
    raise exception 'fred request resume assistant provenance mismatch' using errcode = '23514';
  end if;

  if receipt.status in ('received', 'user_persisted', 'generating') and assistant_found then
    update public.fred_request_ledger
    set status = 'completed',
        conversation_id = user_message.conversation_id,
        user_message_id = user_message.id,
        assistant_message_id = assistant_message.id,
        user_persisted_at = coalesce(user_persisted_at, user_message.created_at),
        generation_started_at = coalesce(generation_started_at, user_message.created_at),
        terminal_at = coalesce(terminal_at, assistant_message.created_at, now()),
        failure_phase = null,
        error_code = null
    where id = receipt.id
    returning * into receipt;
  elsif receipt.status = 'received' and user_found then
    update public.fred_request_ledger
    set status = 'user_persisted',
        conversation_id = user_message.conversation_id,
        user_message_id = user_message.id,
        user_persisted_at = coalesce(user_persisted_at, user_message.created_at)
    where id = receipt.id
    returning * into receipt;
  end if;

  if receipt.status in ('user_persisted', 'generating', 'completed') and not user_found then
    raise exception 'fred request resume user message missing' using errcode = '23514';
  end if;
  if receipt.status = 'completed' and not assistant_found then
    raise exception 'fred request resume assistant message missing' using errcode = '23514';
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'status', receipt.status,
    'content_deleted', false,
    'conversation_id', coalesce(receipt.conversation_id, user_message.conversation_id),
    'user_message_id', coalesce(receipt.user_message_id, user_message.id),
    'assistant_message_id', coalesce(receipt.assistant_message_id, assistant_message.id),
    'answer', case when receipt.status = 'completed'
      then coalesce(assistant_message.display_content, assistant_message.content)
      else null
    end,
    -- The receipt is the ingress snapshot. Message metadata is checked above
    -- for provenance, but must not become a mutable source of retry settings.
    'web_search_enabled', receipt.web_search_enabled,
    'pro_mode_enabled', receipt.pro_mode_enabled
  ));
end;
$function$;


CREATE OR REPLACE FUNCTION public.delete_owned_fred_conversations(p_client_id uuid, p_conversation_ids uuid[])
 RETURNS TABLE(id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  owned_conversation_ids uuid[];
  request_ids uuid[];
  telegram_update_ids bigint[];
  session_row record;
  deletion_time timestamptz := now();
begin
  if p_client_id is null
    or p_conversation_ids is null
    or cardinality(p_conversation_ids) < 1
  then
    raise exception 'fred conversation deletion parameters are invalid'
      using errcode = '22023';
  end if;

  -- Use one global lock order for normal conversation deletion and the
  -- auth.users BEFORE DELETE trigger: account row, provider session, rows.
  if not public.lock_existing_findog_account(p_client_id) then
    raise exception 'fred conversation owner does not exist'
      using errcode = '23503';
  end if;

  for session_row in
    select
      conversation.id,
      hashtextextended(
        'fred:' || conversation.weknora_channel_id || ':' || conversation.weknora_session_id,
        0
      ) as lock_key
    from public.fred_conversations as conversation
    where conversation.client_id = p_client_id
      and conversation.id = any(p_conversation_ids)
    order by lock_key, conversation.id
  loop
    perform pg_advisory_xact_lock(session_row.lock_key);
  end loop;

  perform conversation.id
  from public.fred_conversations as conversation
  where conversation.client_id = p_client_id
    and conversation.id = any(p_conversation_ids)
  order by conversation.id
  for update;

  select coalesce(array_agg(conversation.id order by conversation.id), '{}'::uuid[])
  into owned_conversation_ids
  from public.fred_conversations as conversation
  where conversation.client_id = p_client_id
    and conversation.id = any(p_conversation_ids);

  insert into public.fred_conversation_tombstones (
    conversation_id,
    client_id,
    session_key_sha256,
    deleted_at,
    deletion_reason
  )
  select
    conversation.id,
    conversation.client_id,
    public.fred_conversation_session_sha256(
      conversation.weknora_channel_id,
      conversation.weknora_session_id
    ),
    deletion_time,
    'user_conversation_delete'
  from public.fred_conversations as conversation
  where conversation.id = any(owned_conversation_ids)
  order by conversation.id;

  select
    coalesce(array_agg(receipt.id order by receipt.id), '{}'::uuid[]),
    coalesce(
      array_agg(distinct receipt.telegram_update_id order by receipt.telegram_update_id)
        filter (where receipt.telegram_update_id is not null),
      '{}'::bigint[]
    )
  into request_ids, telegram_update_ids
  from public.fred_request_ledger as receipt
  where receipt.client_id = p_client_id
    and (
      receipt.conversation_id = any(owned_conversation_ids)
      or exists (
        select 1
        from public.fred_messages as message
        where message.conversation_id = any(owned_conversation_ids)
          and message.bridge_event_id in (
            receipt.user_event_id,
            receipt.assistant_event_id
          )
      )
    );

  update public.telegram_chat_bindings as binding
  set active_conversation_id = null
  where binding.active_conversation_id = any(owned_conversation_ids);

  -- Clear queued and leased raw input in the deletion transaction. A late
  -- worker transition fails closed because the row is terminal and lease-less.
  update public.telegram_updates as telegram_update
  set status = 'cancelled',
      cancel_requested = true,
      lease_id = null,
      lease_expires_at = null,
      raw_update = '{}'::jsonb,
      last_error_code = 'CONVERSATION_DELETED',
      cancelled_at = deletion_time,
      updated_at = deletion_time
  where telegram_update.id = any(telegram_update_ids)
    and telegram_update.status in ('pending', 'retry', 'processing');

  update public.fred_generation_runs as generation_run
  set status = 'cancelled',
      conversation_id = null,
      completed_at = coalesce(generation_run.completed_at, deletion_time)
  where generation_run.client_id = p_client_id
    and generation_run.status in ('preprocessing', 'connecting', 'streaming')
    and (
      generation_run.conversation_id = any(owned_conversation_ids)
      or generation_run.request_id = any(request_ids)
    );

  delete from public.admin_request_history as audit
  where audit.user_id = p_client_id
    and audit.conversation_id = any(owned_conversation_ids);

  update public.telegram_deliveries
  set message_content = '',
      updated_at = deletion_time
  where update_id = any(telegram_update_ids)
    and message_content <> '';

  -- Cancel every active receipt, preserve already terminal outcomes, redact its
  -- content, and detach all message/conversation FKs before cascade deletion.
  -- A prior quality-batch reason remains the original content-deletion reason.
  update public.fred_request_ledger as receipt
  set status = case
        when receipt.status in ('received', 'user_persisted', 'generating') then 'cancelled'
        else receipt.status
      end,
      failure_phase = case receipt.status
        when 'received' then 'ingress'
        when 'user_persisted' then 'connecting'
        when 'generating' then 'streaming'
        else receipt.failure_phase
      end,
      error_code = case
        when receipt.status in ('received', 'user_persisted', 'generating')
          then 'conversation_deleted'
        else receipt.error_code
      end,
      terminal_at = case
        when receipt.status in ('received', 'user_persisted', 'generating')
          then deletion_time
        else receipt.terminal_at
      end,
      request_content = null,
      request_content_sha256 = null,
      content_deleted_at = coalesce(receipt.content_deleted_at, deletion_time),
      content_deletion_reason = 'user_conversation_delete',
      conversation_id = null,
      user_message_id = null,
      assistant_message_id = null
  where receipt.client_id = p_client_id
    and receipt.id = any(request_ids);

  -- Pending rows are not attached to the conversation and therefore would not
  -- be removed by its FK cascade. Delete them while the session lock is held.
  delete from public.fred_webhook_events as webhook
  using public.fred_conversations as conversation
  where conversation.id = any(owned_conversation_ids)
    and webhook.weknora_channel_id = conversation.weknora_channel_id
    and webhook.weknora_session_id = conversation.weknora_session_id
    and webhook.processed_at is null;

  return query
  delete from public.fred_conversations as conversation
  where conversation.client_id = p_client_id
    and conversation.id = any(owned_conversation_ids)
  returning conversation.id;
end;
$function$;


CREATE OR REPLACE FUNCTION public.prepare_fred_quality_review_batch(p_cutoff_at timestamp with time zone DEFAULT now(), p_time_zone text DEFAULT 'Europe/Vienna'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  raise exception 'Fred quality review has been retired' using errcode = '55000';
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_fred_quality_review_batch(p_batch_id uuid)
 RETURNS TABLE(batch_id uuid, candidate_set_sha256 character, request_id uuid, origin text, agent_key text, request_status text, failure_phase text, error_code character varying, received_at timestamp with time zone, terminal_at timestamp with time zone, content_deleted_at timestamp with time zone, content_deletion_reason text, request_content text, question_message_present boolean, answer_message_present boolean, admin_audit_present boolean, answer_content text, research_trace jsonb, execution_trace jsonb, source_references jsonb, web_search_enabled boolean, pro_mode_enabled boolean, telegram_update_status text, telegram_deliveries jsonb)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  raise exception 'Fred quality review has been retired' using errcode = '55000';
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_fred_quality_review_batch_reviewed(p_batch_id uuid, p_expected_set_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  raise exception 'Fred quality review has been retired' using errcode = '55000';
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_confirmed_fred_quality_batch(p_batch_id uuid, p_expected_set_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  raise exception 'Fred quality review has been retired' using errcode = '55000';
end;
$function$;

-- Retain the candidate hashes and actual review timestamps as historical metadata.
update public.fred_quality_review_batches
set status = 'cancelled'
where status in ('awaiting_review', 'pending_confirmation');

commit;
