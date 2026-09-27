-- Merge assistant answers that were stored twice before the answer was
-- persisted trimmed. The bridge row kept a leading or trailing newline
-- (btrim() strips only spaces) while the signed webhook echo of the same
-- answer is JS-trimmed, so record_fred_webhook_event and
-- record_fred_bridge_event found no row with equal content and inserted a
-- second, webhook-only assistant row. Pairing only looks 300 s around the
-- answer, so these rows can never pair on their own.
--
-- A pair uses the pairing rules of those functions (same conversation and
-- owner, same role, provider times at most 300 s apart, one bridge-only and
-- one webhook-only row) with whitespace-trimmed content equality, and must be
-- one-to-one: a bridge row with several candidates, or a webhook row with
-- several, is left alone. The webhook event moves onto the bridge row exactly
-- as a normal pairing would have, and the webhook-only row is deleted. The
-- bridge row keeps its content, display content and metadata, so a retried
-- bridge event with the same id still passes its reuse check. A webhook-only
-- row that carries metadata or is referenced by the request ledger, a public
-- share or a native image artifact is kept rather than deleted.
--
-- User questions are not affected: every entry point trims the question
-- before it is stored and relayed, so both copies were always equal and paired.
do $$
begin
  -- Hold off concurrent event writes so the candidates cannot change while
  -- they are merged; reads stay possible.
  lock table public.fred_messages in share row exclusive mode;

  create temporary table fred_unpaired_answer_merge as
  with candidate as (
    select
      bridge_message.id as bridge_message_id,
      webhook_message.id as webhook_message_id,
      webhook.id as webhook_event_id,
      webhook.provider_created_at as webhook_created_at
    from public.fred_messages as bridge_message
    join public.fred_messages as webhook_message
      on webhook_message.conversation_id = bridge_message.conversation_id
      and webhook_message.client_id = bridge_message.client_id
      and webhook_message.role = bridge_message.role
    join public.fred_webhook_events as webhook
      on webhook.id = webhook_message.webhook_event_id
    where bridge_message.role = 'assistant'
      and bridge_message.bridge_event_id is not null
      and bridge_message.webhook_event_id is null
      and webhook_message.bridge_event_id is null
      and webhook_message.webhook_event_id is not null
      and webhook.event_type = 'message_received'
      and btrim(bridge_message.content, E' \t\r\n\f\v')
        = btrim(webhook_message.content, E' \t\r\n\f\v')
      and abs(extract(epoch from (
        coalesce(bridge_message.provider_created_at, bridge_message.created_at)
        - webhook.provider_created_at
      ))) <= 300
  ),
  counted as (
    select
      candidate.*,
      count(*) over (partition by candidate.bridge_message_id) as bridge_candidates,
      count(*) over (partition by candidate.webhook_message_id) as webhook_candidates
    from candidate
  )
  select
    counted.bridge_message_id,
    counted.webhook_message_id,
    counted.webhook_event_id,
    counted.webhook_created_at
  from counted
  join public.fred_messages as webhook_message
    on webhook_message.id = counted.webhook_message_id
  where counted.bridge_candidates = 1
    and counted.webhook_candidates = 1
    and webhook_message.display_content is null
    and webhook_message.content_transformation is null
    and webhook_message.research_trace = '[]'::jsonb
    and webhook_message.source_references = '[]'::jsonb
    and webhook_message.execution_trace = '[]'::jsonb
    and webhook_message.artifacts = '[]'::jsonb
    and webhook_message.attachments = '[]'::jsonb
    and not webhook_message.native_metadata_recorded;

  -- A new reference takes a key-share lock on the row it points to. Locking
  -- the rows first means the reference check below sees every committed one
  -- and none can be added before the delete, which would cascade a share.
  perform 1
  from public.fred_messages as message
  join pg_temp.fred_unpaired_answer_merge as merge
    on merge.webhook_message_id = message.id
  for update of message;

  delete from pg_temp.fred_unpaired_answer_merge as merge
  where exists (
      select 1
      from public.fred_request_ledger as receipt
      where receipt.user_message_id = merge.webhook_message_id
        or receipt.assistant_message_id = merge.webhook_message_id
    )
    or exists (
      select 1
      from public.fred_public_answer_shares as share
      where share.question_message_id = merge.webhook_message_id
        or share.assistant_message_id = merge.webhook_message_id
    )
    or exists (
      select 1
      from public.fred_native_image_artifacts as artifact
      where artifact.user_message_id = merge.webhook_message_id
    );

  -- Delete first: webhook_event_id is unique.
  delete from public.fred_messages as message
  using pg_temp.fred_unpaired_answer_merge as merge
  where message.id = merge.webhook_message_id;

  update public.fred_messages as message
  set webhook_event_id = merge.webhook_event_id,
      provider_created_at = least(
        coalesce(message.provider_created_at, merge.webhook_created_at),
        merge.webhook_created_at
      )
  from pg_temp.fred_unpaired_answer_merge as merge
  where message.id = merge.bridge_message_id;

  drop table pg_temp.fred_unpaired_answer_merge;
end;
$$;
