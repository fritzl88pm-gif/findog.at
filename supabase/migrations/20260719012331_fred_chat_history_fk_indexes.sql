-- Covers ownership foreign keys used during cascading deletes.
create index fred_messages_client_idx
  on public.fred_messages (client_id);

create index fred_messages_conversation_owner_idx
  on public.fred_messages (conversation_id, client_id);

create index fred_webhook_events_conversation_owner_idx
  on public.fred_webhook_events (conversation_id, client_id);
