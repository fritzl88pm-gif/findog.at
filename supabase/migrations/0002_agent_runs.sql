create extension if not exists pgcrypto;

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  client_id uuid not null,
  assistant_message_id bigint references public.messages(id) on delete set null,
  model text not null,
  status text not null check (status in ('completed', 'failed')),
  started_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.agent_steps (
  id bigserial primary key,
  agent_run_id uuid not null references public.agent_runs(id) on delete cascade,
  step_order integer not null check (step_order >= 0),
  step_type text not null,
  title varchar(200) not null,
  content text not null,
  tool_name varchar(120),
  success boolean,
  arguments jsonb,
  tools text[],
  created_at timestamptz not null default now(),
  unique (agent_run_id, step_order)
);

create index if not exists messages_conversation_id_created_at_id_idx
  on public.messages (conversation_id, created_at asc, id asc);

create index if not exists agent_runs_conversation_created_at_idx
  on public.agent_runs (conversation_id, created_at asc);

create index if not exists agent_runs_client_id_created_at_idx
  on public.agent_runs (client_id, created_at desc);

create unique index if not exists agent_runs_assistant_message_id_idx
  on public.agent_runs (assistant_message_id)
  where assistant_message_id is not null;

grant usage on schema public to service_role;
grant select, insert on public.agent_runs to service_role;
grant select, insert on public.agent_steps to service_role;
grant usage, select on sequence public.agent_steps_id_seq to service_role;
