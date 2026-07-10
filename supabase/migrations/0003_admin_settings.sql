create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

create table if not exists public.global_settings (
  id boolean primary key default true check (id),
  system_prompt text not null check (
    char_length(btrim(system_prompt)) > 0
    and char_length(system_prompt) <= 40000
  ),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.global_settings enable row level security;

revoke all on public.admin_users from anon, authenticated;
revoke all on public.global_settings from anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on public.admin_users to service_role;
grant select, insert, update, delete on public.global_settings to service_role;
