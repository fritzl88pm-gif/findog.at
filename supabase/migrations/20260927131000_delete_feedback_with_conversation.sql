-- Negative feedback copies the reported question and answer. It belongs to its
-- conversation: deleting the conversation must also remove that copy from the
-- admin feedback tab, like the other admin-visible copies purged on deletion.
-- conversation_id has no FK because feedback predates the Fred history and may
-- still point at the retired agent chat (public.conversations), so both
-- conversation tables delete their feedback in an AFTER DELETE trigger. Account
-- deletion keeps removing all feedback through the user_id cascade.
create index if not exists agent_feedback_conversation_id_idx
  on public.agent_feedback (conversation_id);

create or replace function public.delete_conversation_agent_feedback()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.agent_feedback as feedback
  where feedback.conversation_id = old.id
    and feedback.user_id = old.client_id;

  return old;
end;
$$;

revoke all on function public.delete_conversation_agent_feedback()
  from public, anon, authenticated;

create trigger fred_conversations_delete_agent_feedback
after delete on public.fred_conversations
for each row
execute function public.delete_conversation_agent_feedback();

create trigger conversations_delete_agent_feedback
after delete on public.conversations
for each row
execute function public.delete_conversation_agent_feedback();

-- The route checks the conversation before inserting, but without a lock a
-- concurrent deletion can commit between that check and the insert, and the
-- AFTER DELETE trigger cannot see an uncommitted insert. FOR KEY SHARE makes the
-- deletion wait for the inserting transaction, whose feedback the trigger's
-- delete then sees; an insert after the deletion finds no conversation and
-- fails. Feedback is only accepted for Fred conversations.
create or replace function public.lock_agent_feedback_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
  from public.fred_conversations as conversation
  where conversation.id = new.conversation_id
    and conversation.client_id = new.user_id
  for key share;

  if not found then
    raise exception 'Fred conversation not found'
      using errcode = 'P0002';
  end if;

  return new;
end;
$$;

revoke all on function public.lock_agent_feedback_conversation()
  from public, anon, authenticated;

create trigger agent_feedback_lock_conversation
before insert on public.agent_feedback
for each row
execute function public.lock_agent_feedback_conversation();

-- One-time cleanup: feedback whose conversation was already deleted, i.e. no
-- conversation of the same owner exists in either table.
delete from public.agent_feedback as feedback
where not exists (
    select 1
    from public.fred_conversations as conversation
    where conversation.id = feedback.conversation_id
      and conversation.client_id = feedback.user_id
  )
  and not exists (
    select 1
    from public.conversations as conversation
    where conversation.id = feedback.conversation_id
      and conversation.client_id = feedback.user_id
  );
