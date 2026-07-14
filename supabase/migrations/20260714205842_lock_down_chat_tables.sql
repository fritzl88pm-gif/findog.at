alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_steps enable row level security;

revoke all privileges on table
  public.conversations,
  public.messages,
  public.agent_runs,
  public.agent_steps
from anon, authenticated;

revoke all privileges on sequence
  public.messages_id_seq,
  public.agent_steps_id_seq
from anon, authenticated;
