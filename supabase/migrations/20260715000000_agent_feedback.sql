create table if not exists public.agent_feedback (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null,
  user_request text not null,
  assistant_response text not null,
  user_feedback text not null,
  created_at timestamptz not null default now()
);

alter table public.agent_feedback enable row level security;

revoke all on public.agent_feedback from anon, authenticated;

revoke all on sequence public.agent_feedback_id_seq from anon, authenticated;

grant select, insert on public.agent_feedback to service_role;

grant usage, select on sequence public.agent_feedback_id_seq to service_role;

create index if not exists agent_feedback_user_id_created_at_idx
  on public.agent_feedback (user_id, created_at desc);
