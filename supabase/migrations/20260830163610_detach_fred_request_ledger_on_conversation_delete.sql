-- Repair user-owned Fred conversation deletion after request-ledger FKs.
-- Detach all ledger links in one UPDATE before fred_conversations deletion so
-- ON DELETE SET NULL cannot violate fred_request_ledger_message_roles.
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
  set conversation_id = null,
      user_message_id = null,
      assistant_message_id = null,
      request_content = null,
      request_content_sha256 = null,
      content_deleted_at = now(),
      content_deletion_reason = 'user_conversation_delete'
  where receipt.client_id = p_client_id
    and receipt.conversation_id = any(owned_conversation_ids);

  return query
  delete from public.fred_conversations as conversation
  where conversation.client_id = p_client_id
    and conversation.id = any(owned_conversation_ids)
  returning conversation.id;
end;
$$;

revoke all on function public.delete_owned_fred_conversations(uuid, uuid[])
from public, anon, authenticated;
grant execute on function public.delete_owned_fred_conversations(uuid, uuid[])
to service_role;
