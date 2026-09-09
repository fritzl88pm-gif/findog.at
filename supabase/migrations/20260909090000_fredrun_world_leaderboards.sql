-- Deploy this additive migration before the world-aware application.
-- Unknown legacy runs remain NULL, including writes through the old RPC.
-- The existing four-argument RPC, grants and block triggers remain in place.
alter table public.fredrun_scores
  add column world_id text
  constraint fredrun_scores_world_check
  check (world_id in ('vienna', 'finanzamt-night', 'alps'));

comment on column public.fredrun_scores.world_id is
  'World reported by the completed run. NULL means unknown legacy origin; excluded from world boards.';

create index fredrun_scores_world_leaderboard_idx
  on public.fredrun_scores (world_id, score desc, created_at asc, id asc)
  where world_id is not null;

create function public.submit_fredrun_world_score(
  player_id uuid,
  submitted_run_id uuid,
  submitted_name text,
  submitted_score integer,
  submitted_world text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_name text;
  inserted_score_id uuid;
  recent_submission_count integer;
begin
  normalized_name := regexp_replace(btrim(coalesce(submitted_name, '')), '[[:space:]]+', ' ', 'g');

  if player_id is null
    or submitted_run_id is null
    or char_length(normalized_name) not between 1 and 20
    or normalized_name ~ '[[:cntrl:]]'
    or submitted_world is null
    or submitted_world not in ('vienna', 'finanzamt-night', 'alps')
    or submitted_score is null
    or submitted_score not between 0 and 1000000
  then
    raise exception 'fredrun submission fields are invalid' using errcode = '22023';
  end if;

  -- Check ownership of this run's world, never the mutable profile selection.
  -- Default worlds can be played before a profile has been initialized.
  if not exists (
    select 1 from public.fredrun_catalog_items as catalog
    where catalog.item_type = 'world'
      and catalog.item_id = submitted_world
      and catalog.active
      and (catalog.default_unlocked or exists (
        select 1 from public.fredrun_user_unlocks as unlocks
        where unlocks.user_id = player_id
          and unlocks.item_type = 'world'
          and unlocks.item_id = submitted_world
      ))
  ) then
    raise exception 'fredrun world is locked' using errcode = '42501';
  end if;

  insert into public.fredrun_player_profiles (user_id, player_name, updated_at)
  values (player_id, normalized_name, statement_timestamp())
  on conflict (user_id) do update
  set player_name = excluded.player_name,
      updated_at = excluded.updated_at;

  if exists (
    select 1
    from public.fredrun_scores
    where user_id = player_id
      and run_id = submitted_run_id
  ) then
    return false;
  end if;

  select count(*)::integer
  into recent_submission_count
  from public.fredrun_scores
  where user_id = player_id
    and created_at >= statement_timestamp() - interval '5 minutes';

  if recent_submission_count >= 30 then
    raise exception 'fredrun submission rate limit exceeded' using errcode = 'P0001';
  end if;

  insert into public.fredrun_scores (user_id, run_id, score, world_id)
  values (player_id, submitted_run_id, submitted_score, submitted_world)
  on conflict (user_id, run_id) do nothing
  returning id into inserted_score_id;

  return inserted_score_id is not null;
end;
$$;

revoke all on function public.submit_fredrun_world_score(uuid, uuid, text, integer, text)
from public, anon, authenticated;
grant execute on function public.submit_fredrun_world_score(uuid, uuid, text, integer, text)
to service_role;
