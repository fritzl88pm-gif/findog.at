-- Add a centrally managed research result limit to the single-row
-- global_settings table.  This lets an administrator adjust how many
-- results per non-law research source the agent requests, without a
-- redeploy.  The value is clamped to a sane range; laws stay uncapped
-- in application code and are unaffected by this column.

alter table public.global_settings
  add column if not exists research_result_limit integer not null default 8
    check (research_result_limit between 1 and 50);
