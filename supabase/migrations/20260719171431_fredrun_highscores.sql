create table public.fredrun_player_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  player_name varchar(20) not null,
  updated_at timestamptz not null default statement_timestamp(),
  constraint fredrun_player_profiles_name_length
    check (char_length(player_name) between 1 and 20),
  constraint fredrun_player_profiles_name_normalized
    check (player_name = btrim(regexp_replace(player_name, '[[:space:]]+', ' ', 'g'))),
  constraint fredrun_player_profiles_name_printable
    check (player_name !~ '[[:cntrl:]]')
);

create table public.fredrun_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.fredrun_player_profiles(user_id) on delete cascade,
  run_id uuid not null,
  score integer not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint fredrun_scores_user_run_unique unique (user_id, run_id),
  constraint fredrun_scores_value_range check (score between 0 and 1000000)
);

create index fredrun_scores_leaderboard_idx
  on public.fredrun_scores (score desc, created_at asc, id asc);

create index fredrun_scores_user_created_idx
  on public.fredrun_scores (user_id, created_at desc, id desc);

alter table public.fredrun_player_profiles enable row level security;
alter table public.fredrun_scores enable row level security;

revoke all on table
  public.fredrun_player_profiles,
  public.fredrun_scores
from public, anon, authenticated;

grant usage on schema public to service_role;
grant select, insert, update on table public.fredrun_player_profiles to service_role;
grant select, insert on table public.fredrun_scores to service_role;

create function public.submit_fredrun_score(
  player_id uuid,
  submitted_run_id uuid,
  submitted_name text,
  submitted_score integer
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
    or submitted_score is null
    or submitted_score not between 0 and 1000000
  then
    raise exception 'fredrun submission fields are invalid' using errcode = '22023';
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

  insert into public.fredrun_scores (user_id, run_id, score)
  values (player_id, submitted_run_id, submitted_score)
  on conflict (user_id, run_id) do nothing
  returning id into inserted_score_id;

  return inserted_score_id is not null;
end;
$$;

revoke all on function public.submit_fredrun_score(uuid, uuid, text, integer)
from public, anon, authenticated;
grant execute on function public.submit_fredrun_score(uuid, uuid, text, integer)
to service_role;
