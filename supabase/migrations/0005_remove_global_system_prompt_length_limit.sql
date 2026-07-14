-- Remove the 40 000 character limit from global_settings.system_prompt
-- while preserving the non-blank requirement.

-- PostgreSQL auto-names column-level check constraints as
-- tablename_columnname_check.  Drop the old constraint (which
-- contained the <= 40000 bound) and re-add one that only
-- enforces non-blank.
alter table public.global_settings
  drop constraint if exists global_settings_system_prompt_check;

alter table public.global_settings add constraint global_settings_system_prompt_check
  check (char_length(btrim(system_prompt)) > 0);
