-- Per-user Fred personalization preferences.
-- This table is server-only: only the service_role can access it.
-- The browser accesses preferences exclusively through the authenticated
-- API route, which performs all validation.

create table public.fred_user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferred_name text,
    constraint preferred_name_length check (preferred_name is null or char_length(preferred_name) <= 80),
    constraint preferred_name_no_tags check (preferred_name is null or (preferred_name !~ '<' and preferred_name !~ '>')),
    constraint preferred_name_no_newlines check (preferred_name is null or (preferred_name !~ '\r' and preferred_name !~ '\n')),
  personality text not null default 'standard'
    check (personality in ('standard', 'friendly', 'efficient', 'cynical')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fred_user_preferences enable row level security;

-- Server-only: revoke all table privileges from public, anon, authenticated.
revoke all on public.fred_user_preferences from public, anon, authenticated;

-- Only the service_role backend may read and write.
grant select, insert, update, delete on public.fred_user_preferences to service_role;
