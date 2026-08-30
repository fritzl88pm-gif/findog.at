-- Remove Fred personality profiles and preferred names while preserving the
-- independent research display preference and all user preference rows.

set lock_timeout = '5s';

alter table if exists public.fred_user_preferences
  drop constraint if exists fup_personality_fk;

alter table if exists public.fred_user_preferences
  drop column if exists preferred_name,
  drop column if exists personality;

drop table if exists public.fred_personality_profiles;

reset lock_timeout;
