-- fred_generation_runs: durable per-turn generation-run status and sanitized
-- failure diagnostics. service_role access only — no browser policies.

create table public.fred_generation_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid null references public.fred_conversations(id) on delete set null,
  status text not null
    constraint fgr_status_values
      check (status in ('preprocessing', 'connecting', 'streaming', 'completed', 'failed', 'cancelled')),
  failure_phase text null
    constraint fgr_failure_phase_values
      check (failure_phase in ('preprocessing', 'connecting', 'streaming')),
  error_code text null
    constraint fgr_error_code_values
      check (error_code in (
        'preprocessing_failed',
        'upstream_eof_without_final',
        'timeout',
        'unexpected_error'
      )),
  upstream_http_status integer null
    constraint fgr_upstream_http_status_range
      check (upstream_http_status >= 100 and upstream_http_status <= 599),
  upstream_request_id text null
    constraint fgr_upstream_request_id_length check (char_length(upstream_request_id) <= 256),
  model_route text null
    constraint fgr_model_route_length check (char_length(model_route) <= 256),
  attachment_count integer not null default 0
    constraint fgr_attachment_count_nonnegative check (attachment_count >= 0),
  attachment_total_bytes bigint not null default 0
    constraint fgr_attachment_total_bytes_nonnegative check (attachment_total_bytes >= 0),
  started_at timestamptz not null default now(),
  first_delta_at timestamptz null,
  completed_at timestamptz null,
  updated_at timestamptz not null default now()
);

-- Indexes: minimal useful set for operational queries
create index fgr_started_at_idx
  on public.fred_generation_runs (started_at desc);

create index fgr_unfinished_or_failed_partial_idx
  on public.fred_generation_runs (started_at desc)
  where status in ('failed', 'preprocessing', 'connecting', 'streaming');

-- updated_at trigger
create function public.set_fred_generation_run_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger fgr_set_updated_at
  before update on public.fred_generation_runs
  for each row
  execute function public.set_fred_generation_run_updated_at();

-- RLS: enable row-level security, revoke from client roles
alter table public.fred_generation_runs enable row level security;

revoke all on public.fred_generation_runs from public, anon, authenticated;

grant select, insert, update on public.fred_generation_runs to service_role;

revoke all on function public.set_fred_generation_run_updated_at()
from public, anon, authenticated;
