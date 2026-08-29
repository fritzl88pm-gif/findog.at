-- Cover the foreign keys introduced by the request-ledger rollout. The first
-- migration also declares these indexes for fresh databases; IF NOT EXISTS
-- keeps this production follow-up safe and idempotent.

create index if not exists fred_request_ledger_client_idx
  on public.fred_request_ledger (client_id);

create index if not exists fred_request_ledger_conversation_idx
  on public.fred_request_ledger (conversation_id)
  where conversation_id is not null;

create index if not exists fred_request_ledger_user_message_idx
  on public.fred_request_ledger (user_message_id)
  where user_message_id is not null;

create index if not exists fred_request_ledger_assistant_message_idx
  on public.fred_request_ledger (assistant_message_id)
  where assistant_message_id is not null;

create index if not exists admin_request_history_conversation_idx
  on public.admin_request_history (conversation_id);
