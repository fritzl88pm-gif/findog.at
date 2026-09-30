-- Fredrun 2.0: globale Bestenlisten (jeder gegen jeden). Additiv: die Original-Fredrun-Tabellen bleiben unverändert,
-- der Spielername (fredrun_player_profiles) wird gemeinsam genutzt. Die neue Tabelle startet leer = Highscores zurückgesetzt.
create table public.fredrun2_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.fredrun_player_profiles(user_id) on delete cascade,
  run_id uuid not null,
  board text not null,
  score integer not null,
  meters integer not null default 0,
  hero text not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint fredrun2_scores_user_run_unique unique (user_id, run_id),
  constraint fredrun2_scores_board_check
    check (board ~ '^(world:[a-z][a-z0-9-]{1,23}|tour|daily:[0-9]{4}-[0-9]{2}-[0-9]{2})$'),
  constraint fredrun2_scores_score_range check (score between 0 and 100000000),
  constraint fredrun2_scores_meters_range check (meters between 0 and 10000000),
  constraint fredrun2_scores_hero_check check (hero ~ '^[a-z][a-z0-9-]{1,23}$')
);

comment on table public.fredrun2_scores is
  'Fredrun 2.0 Läufe je Board (world:<id> | tour | daily:<Datum>); die Bestenliste zählt je Spieler den besten Lauf.';

create index fredrun2_scores_board_user_idx
  on public.fredrun2_scores (board, user_id, score desc, created_at asc, id asc);

create index fredrun2_scores_user_created_idx
  on public.fredrun2_scores (user_id, created_at desc);

alter table public.fredrun2_scores enable row level security;

revoke all on table public.fredrun2_scores from public, anon, authenticated;
grant select, insert on table public.fredrun2_scores to service_role;

create function public.submit_fredrun2_score(
  player_id uuid,
  submitted_run_id uuid,
  submitted_name text,
  submitted_board text,
  submitted_score integer,
  submitted_meters integer,
  submitted_hero text
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
    or submitted_board is null
    or submitted_board !~ '^(world:[a-z][a-z0-9-]{1,23}|tour|daily:[0-9]{4}-[0-9]{2}-[0-9]{2})$'
    or submitted_score is null
    or submitted_score not between 0 and 100000000
    or submitted_meters is null
    or submitted_meters not between 0 and 10000000
    or submitted_hero is null
    or submitted_hero !~ '^[a-z][a-z0-9-]{1,23}$'
  then
    raise exception 'fredrun2 submission fields are invalid' using errcode = '22023';
  end if;

  insert into public.fredrun_player_profiles (user_id, player_name, updated_at)
  values (player_id, normalized_name, statement_timestamp())
  on conflict (user_id) do update
  set player_name = excluded.player_name,
      updated_at = excluded.updated_at;

  if exists (
    select 1 from public.fredrun2_scores
    where user_id = player_id and run_id = submitted_run_id
  ) then
    return false;
  end if;

  select count(*)::integer
  into recent_submission_count
  from public.fredrun2_scores
  where user_id = player_id
    and created_at >= statement_timestamp() - interval '5 minutes';

  if recent_submission_count >= 30 then
    raise exception 'fredrun submission rate limit exceeded' using errcode = 'P0001';
  end if;

  insert into public.fredrun2_scores (user_id, run_id, board, score, meters, hero)
  values (player_id, submitted_run_id, submitted_board, submitted_score, submitted_meters, submitted_hero)
  on conflict (user_id, run_id) do nothing
  returning id into inserted_score_id;

  return inserted_score_id is not null;
end;
$$;

-- Bestenliste eines Boards: je Spieler der beste Lauf, Rang nach Score (Gleichstand: früher erreicht gewinnt).
-- Liefert die Top `max_rows` und – falls außerhalb – zusätzlich die Zeile der anfragenden Person.
-- Gesperrte Spieler (fredrun_user_blocks) erscheinen nicht.
create function public.get_fredrun2_leaderboard(
  requested_board text,
  viewer_id uuid,
  max_rows integer default 25
)
returns table (
  rank integer,
  player_name text,
  score integer,
  meters integer,
  hero text,
  is_me boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with best as (
    select distinct on (s.user_id)
      s.user_id, s.score, s.meters, s.hero, s.created_at, s.id
    from public.fredrun2_scores as s
    where s.board = requested_board
      and not exists (select 1 from public.fredrun_user_blocks as b where b.user_id = s.user_id)
    order by s.user_id, s.score desc, s.created_at asc, s.id asc
  ),
  ranked as (
    select
      row_number() over (order by b.score desc, b.created_at asc, b.id asc)::integer as rank,
      p.player_name::text as player_name,
      b.score, b.meters, b.hero,
      (b.user_id = viewer_id) as is_me
    from best as b
    join public.fredrun_player_profiles as p on p.user_id = b.user_id
  )
  select r.rank, r.player_name, r.score, r.meters, r.hero, r.is_me
  from ranked as r
  where r.rank <= greatest(1, least(coalesce(max_rows, 25), 100)) or r.is_me
  order by r.rank;
$$;

revoke all on function public.submit_fredrun2_score(uuid, uuid, text, text, integer, integer, text)
from public, anon, authenticated;
grant execute on function public.submit_fredrun2_score(uuid, uuid, text, text, integer, integer, text)
to service_role;

revoke all on function public.get_fredrun2_leaderboard(text, uuid, integer)
from public, anon, authenticated;
grant execute on function public.get_fredrun2_leaderboard(text, uuid, integer)
to service_role;
