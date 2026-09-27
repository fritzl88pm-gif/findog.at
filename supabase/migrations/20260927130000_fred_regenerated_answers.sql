-- "Antwort erneut erzeugen" keeps the audited history. The replaced question
-- and answer stay stored with unchanged content; once the regenerated answer
-- has been completed and persisted they are only marked as superseded by it.
-- Transcript readers hide superseded rows, the admin audit views keep them.
-- A failed, cancelled or timed-out regeneration never reaches the marking RPC,
-- so the replaced question and answer stay visible and unmarked. Its already
-- stored question is superseded with them once a later attempt completes.
--
-- superseded_by_message_id uses ON DELETE SET NULL: deleting the regenerated
-- answer (e.g. with its conversation) must never delete audited rows, and
-- superseded_at alone keeps a replaced row out of the visible transcript.
-- The only trigger on fred_messages (fred_messages_guard_terminal_bridge_event)
-- fires for INSERT and UPDATE OF bridge_event_id, so marking is unaffected.

alter table public.fred_messages
  add column superseded_at timestamptz,
  add column superseded_by_message_id bigint
    references public.fred_messages(id) on delete set null;

alter table public.fred_messages
  add constraint fred_messages_superseded_consistency
    check (superseded_by_message_id is null or superseded_at is not null),
  add constraint fred_messages_superseded_by_other_message
    check (superseded_by_message_id is null or superseded_by_message_id <> id);

create index fred_messages_superseded_by_message_idx
  on public.fred_messages (superseded_by_message_id);

create function public.supersede_regenerated_fred_answer(
  p_client_id uuid,
  p_conversation_id uuid,
  p_replaced_assistant_message_id bigint,
  p_user_message_id bigint,
  p_assistant_message_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  message record;
  question_content text;
  step text := 'new_answer';
  superseded_ids bigint[] := '{}'::bigint[];
  marked_count integer;
begin
  if p_client_id is null
    or p_conversation_id is null
    or p_replaced_assistant_message_id is null
    or p_user_message_id is null
    or p_assistant_message_id is null
    or p_replaced_assistant_message_id <= 0
    or p_user_message_id <= 0
    or p_assistant_message_id <= 0
    or p_replaced_assistant_message_id in (p_user_message_id, p_assistant_message_id)
    or p_user_message_id = p_assistant_message_id
  then
    raise exception 'fred regeneration parameters are invalid' using errcode = '22023';
  end if;

  -- Serializes with message persistence and deletion of this conversation.
  perform 1
  from public.fred_conversations as conversation
  where conversation.id = p_conversation_id
    and conversation.client_id = p_client_id
  for update;

  if not found then
    raise exception 'fred regeneration conversation not found' using errcode = 'P0002';
  end if;

  -- Walk the visible transcript backwards, in the history route's order. It
  -- must end with: replaced question, replaced answer, [questions of earlier
  -- failed regeneration attempts,] regenerated question, regenerated answer.
  for message in
    select candidate.id, candidate.role, candidate.content
    from public.fred_messages as candidate
    where candidate.conversation_id = p_conversation_id
      and candidate.client_id = p_client_id
      and candidate.superseded_at is null
    order by candidate.provider_created_at desc nulls first, candidate.id desc
    limit 50
  loop
    if step = 'new_answer' then
      exit when message.id <> p_assistant_message_id or message.role <> 'assistant';
      step := 'new_question';
    elsif step = 'new_question' then
      exit when message.id <> p_user_message_id or message.role <> 'user';
      question_content := message.content;
      step := 'replaced_answer';
    elsif step = 'replaced_answer' then
      if message.role = 'user' and message.content = question_content then
        superseded_ids := superseded_ids || message.id;
        continue;
      end if;
      exit when message.id <> p_replaced_assistant_message_id or message.role <> 'assistant';
      superseded_ids := superseded_ids || message.id;
      step := 'replaced_question';
    else
      exit when message.role <> 'user' or message.content <> question_content;
      superseded_ids := superseded_ids || message.id;
      step := 'complete';
      exit;
    end if;
  end loop;

  if step <> 'complete' then
    raise exception 'fred regeneration target is not the latest answer' using errcode = '55000';
  end if;

  update public.fred_messages as target
  set superseded_at = now(),
      superseded_by_message_id = p_assistant_message_id
  where target.id = any(superseded_ids)
    and target.conversation_id = p_conversation_id
    and target.client_id = p_client_id
    and target.superseded_at is null;
  get diagnostics marked_count = row_count;

  if marked_count <> cardinality(superseded_ids) then
    raise exception 'fred regeneration target is not the latest answer' using errcode = '55000';
  end if;

  return jsonb_build_object('superseded_message_ids', to_jsonb(superseded_ids));
end;
$$;

revoke all on function public.supersede_regenerated_fred_answer(uuid, uuid, bigint, bigint, bigint)
from public, anon, authenticated;
grant execute on function public.supersede_regenerated_fred_answer(uuid, uuid, bigint, bigint, bigint)
to service_role;
