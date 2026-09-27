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
