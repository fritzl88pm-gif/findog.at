-- fred_personality_profiles: admin-managed personality catalog.
-- This table is server-only: only the service_role can access it.

create table public.fred_personality_profiles (
  id text primary key
    constraint fpp_id_max_length check (char_length(id) <= 64)
    constraint fpp_id_format check (id ~ '^[a-z0-9][a-z0-9-]*$'),
  title text not null
    constraint fpp_title_max_length check (char_length(title) <= 80),
  prompt_text text not null default ''
    constraint fpp_prompt_text_max_length check (char_length(prompt_text) <= 4000),
  is_builtin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fred_personality_profiles enable row level security;

-- Revoke all from client-side roles; only service_role can read/write.
revoke all on public.fred_personality_profiles from public, anon, authenticated;

-- Grant full CRUD to service_role.
grant select, insert, update, delete on public.fred_personality_profiles to service_role;

-- ── Seed four builtin definitions ──────────────────────────────────────────
-- Idempotent INSERT: skip rows whose id already exists.
insert into public.fred_personality_profiles (id, title, prompt_text, is_builtin)
values
  ('standard',  'Standard',  '',                                                                                                                              true),
  ('friendly',  'Freundlich','Antworte herzlich, zugewandt und gesprächig. Verwende häufiger passende Emojis, ohne fachliche Präzision, Professionalität oder Verständlichkeit zu beeinträchtigen.', true),
  ('efficient', 'Effizient', 'Antworte prägnant, direkt und klar. Konzentriere dich auf die wesentlichen Informationen und vermeide unnötige Einleitungen, Wiederholungen und Ausschmückungen.',        true),
  ('cynical',   'Zynisch',   'Antworte kritisch, trocken und sarkastisch. Der Sarkasmus darf pointiert sein, aber nicht beleidigend, abwertend oder respektlos gegenüber dem Benutzer oder Dritten. Fachliche Präzision und Verlässlichkeit bleiben vollständig erhalten.', true)
on conflict (id) do nothing;

-- ── Drop old CHECK constraint and add FK from fred_user_preferences ────────
do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'fred_user_preferences_personality_check'
      and table_schema = 'public'
      and table_name = 'fred_user_preferences'
  ) then
    alter table public.fred_user_preferences
      drop constraint fred_user_preferences_personality_check;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'fup_personality_fk'
      and table_schema = 'public'
      and table_name = 'fred_user_preferences'
  ) then
    alter table public.fred_user_preferences
      add constraint fup_personality_fk
      foreign key (personality) references public.fred_personality_profiles(id)
      on update cascade
      on delete restrict;
  end if;
end $$;

-- Ensure role grants on fred_user_preferences are current.
revoke all on public.fred_user_preferences from public, anon, authenticated;
grant select, insert, update, delete on public.fred_user_preferences to service_role;
