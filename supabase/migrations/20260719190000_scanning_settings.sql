create table if not exists public.scanning_settings (
  id boolean primary key default true check (id),
  model_id text not null check (
    char_length(btrim(model_id)) > 0
    and char_length(model_id) <= 160
    and model_id ~ '^[^\s/[:cntrl:]]+/[^\s/[:cntrl:]]+(:[^\s/[:cntrl:]]+)?$'
  ),
  prompt text not null check (
    char_length(btrim(prompt)) > 0
    and char_length(prompt) <= 40000
  ),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.scanning_settings enable row level security;

revoke all on public.scanning_settings from anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on public.scanning_settings to service_role;
