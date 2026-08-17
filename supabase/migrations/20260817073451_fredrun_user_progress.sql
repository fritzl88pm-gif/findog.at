create table public.fredrun_catalog_items (
  item_type text not null,
  item_id text not null,
  display_order smallint not null,
  price integer not null,
  default_unlocked boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  primary key (item_type, item_id),
  constraint fredrun_catalog_items_type_check
    check (item_type in ('character', 'world')),
  constraint fredrun_catalog_items_id_check
    check (item_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint fredrun_catalog_items_display_order_check
    check (display_order >= 0),
  constraint fredrun_catalog_items_price_check
    check (price between 0 and 1000000)
);

insert into public.fredrun_catalog_items (
  item_type,
  item_id,
  display_order,
  price,
  default_unlocked
)
values
  ('character', 'fred', 0, 0, true),
  ('character', 'frida', 1, 0, true),
  ('character', 'superfred', 2, 1000, false),
  ('world', 'vienna', 0, 0, true),
  ('world', 'finanzamt-night', 1, 500, false);

create table public.fredrun_user_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  coin_balance integer not null default 0,
  best_score integer not null default 0,
  selected_character text not null default 'fred',
  selected_world text not null default 'vienna',
  last_settled_run_id uuid,
  version bigint not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint fredrun_user_progress_coin_balance_check
    check (coin_balance between 0 and 1000000000),
  constraint fredrun_user_progress_best_score_check
    check (best_score between 0 and 1000000),
  constraint fredrun_user_progress_selected_character_check
    check (selected_character in ('fred', 'frida', 'superfred')),
  constraint fredrun_user_progress_selected_world_check
    check (selected_world in ('vienna', 'finanzamt-night')),
  constraint fredrun_user_progress_version_check
    check (version > 0),
  constraint fredrun_user_progress_timestamp_order_check
    check (updated_at >= created_at)
);

create table public.fredrun_user_unlocks (
  user_id uuid not null references public.fredrun_user_progress(user_id) on delete cascade,
  item_type text not null,
  item_id text not null,
  price_paid integer not null,
  provenance text not null,
  acquired_at timestamptz not null default statement_timestamp(),
  primary key (user_id, item_type, item_id),
  foreign key (item_type, item_id)
    references public.fredrun_catalog_items(item_type, item_id),
  constraint fredrun_user_unlocks_price_paid_check
    check (price_paid between 0 and 1000000),
  constraint fredrun_user_unlocks_provenance_check
    check (provenance in ('system_default', 'server_purchase'))
);

create table public.fredrun_progress_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.fredrun_user_progress(user_id) on delete cascade,
  event_type text not null,
  run_id uuid,
  item_type text,
  item_id text,
  coins_delta integer not null default 0,
  balance_after integer not null,
  reported_score integer,
  best_score_after integer not null,
  provenance text not null,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (item_type, item_id)
    references public.fredrun_catalog_items(item_type, item_id),
  constraint fredrun_progress_events_type_check
    check (event_type in ('profile_created', 'run_settled', 'item_purchased', 'item_selected')),
  constraint fredrun_progress_events_item_pair_check
    check ((item_type is null) = (item_id is null)),
  constraint fredrun_progress_events_balance_check
    check (balance_after between 0 and 1000000000),
  constraint fredrun_progress_events_reported_score_check
    check (reported_score is null or reported_score between 0 and 1000000),
  constraint fredrun_progress_events_best_score_check
    check (best_score_after between 0 and 1000000),
  constraint fredrun_progress_events_provenance_check
    check (provenance in ('server_default', 'client_reported_run', 'server_catalog', 'authenticated_selection'))
);

create unique index fredrun_progress_events_settled_run_idx
  on public.fredrun_progress_events (user_id, run_id)
  where event_type = 'run_settled';

create index fredrun_progress_events_user_created_idx
  on public.fredrun_progress_events (user_id, created_at desc, id desc);

create index fredrun_user_unlocks_catalog_idx
  on public.fredrun_user_unlocks (item_type, item_id);

create index fredrun_progress_events_catalog_idx
  on public.fredrun_progress_events (item_type, item_id);

alter table public.fredrun_catalog_items enable row level security;
alter table public.fredrun_user_progress enable row level security;
alter table public.fredrun_user_unlocks enable row level security;
alter table public.fredrun_progress_events enable row level security;

revoke all on table
  public.fredrun_catalog_items,
  public.fredrun_user_progress,
  public.fredrun_user_unlocks,
  public.fredrun_progress_events
from public, anon, authenticated;

revoke all on table
  public.fredrun_catalog_items,
  public.fredrun_user_progress,
  public.fredrun_user_unlocks,
  public.fredrun_progress_events
from service_role;

revoke all on sequence public.fredrun_progress_events_id_seq
from public, anon, authenticated;

revoke all on sequence public.fredrun_progress_events_id_seq
from service_role;

grant usage on schema public to service_role;
grant select on table public.fredrun_catalog_items to service_role;
grant select, insert, update on table public.fredrun_user_progress to service_role;
grant select, insert on table public.fredrun_user_unlocks to service_role;
grant select, insert on table public.fredrun_progress_events to service_role;
grant usage, select on sequence public.fredrun_progress_events_id_seq to service_role;

create function public.fredrun_progress_payload(player_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'coinBalance', progress.coin_balance,
    'bestScore', progress.best_score,
    'unlockedCharacters', coalesce((
      select jsonb_agg(unlocks.item_id order by catalog.display_order)
      from public.fredrun_user_unlocks as unlocks
      join public.fredrun_catalog_items as catalog
        on catalog.item_type = unlocks.item_type
       and catalog.item_id = unlocks.item_id
      where unlocks.user_id = progress.user_id
        and unlocks.item_type = 'character'
    ), '[]'::jsonb),
    'selectedCharacter', progress.selected_character,
    'unlockedWorlds', coalesce((
      select jsonb_agg(unlocks.item_id order by catalog.display_order)
      from public.fredrun_user_unlocks as unlocks
      join public.fredrun_catalog_items as catalog
        on catalog.item_type = unlocks.item_type
       and catalog.item_id = unlocks.item_id
      where unlocks.user_id = progress.user_id
        and unlocks.item_type = 'world'
    ), '[]'::jsonb),
    'selectedWorld', progress.selected_world,
    'lastSettledRunId', progress.last_settled_run_id,
    'version', progress.version,
    'updatedAt', progress.updated_at
  )
  from public.fredrun_user_progress as progress
  where progress.user_id = player_id;
$$;

create function public.ensure_fredrun_user_progress(player_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_user_id uuid;
begin
  if player_id is null then
    raise exception 'fredrun player is required' using errcode = '22023';
  end if;

  insert into public.fredrun_user_progress (user_id)
  values (player_id)
  on conflict (user_id) do nothing
  returning user_id into created_user_id;

  insert into public.fredrun_user_unlocks (
    user_id,
    item_type,
    item_id,
    price_paid,
    provenance
  )
  select
    player_id,
    catalog.item_type,
    catalog.item_id,
    0,
    'system_default'
  from public.fredrun_catalog_items as catalog
  where catalog.default_unlocked
    and catalog.active
  on conflict (user_id, item_type, item_id) do nothing;

  if created_user_id is not null then
    insert into public.fredrun_progress_events (
      user_id,
      event_type,
      coins_delta,
      balance_after,
      best_score_after,
      provenance
    )
    values (
      player_id,
      'profile_created',
      0,
      0,
      0,
      'server_default'
    );
  end if;

  return public.fredrun_progress_payload(player_id);
end;
$$;

create function public.apply_fredrun_progress_action(
  player_id uuid,
  requested_action text,
  submitted_run_id uuid default null,
  submitted_coins integer default null,
  submitted_score integer default null,
  target_type text default null,
  target_id text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  progress public.fredrun_user_progress%rowtype;
  catalog_item public.fredrun_catalog_items%rowtype;
  awarded_coins integer := 0;
  result_status text := 'unchanged';
begin
  perform public.ensure_fredrun_user_progress(player_id);

  select *
  into progress
  from public.fredrun_user_progress
  where user_id = player_id
  for update;

  if requested_action = 'settle_run' then
    if submitted_run_id is null
      or submitted_coins is null
      or submitted_coins not between 0 and 1000000
      or submitted_score is null
      or submitted_score not between 0 and 1000000
    then
      raise exception 'fredrun settlement is invalid' using errcode = '22023';
    end if;

    if exists (
      select 1
      from public.fredrun_progress_events
      where user_id = player_id
        and event_type = 'run_settled'
        and run_id = submitted_run_id
    ) then
      return public.fredrun_progress_payload(player_id)
        || jsonb_build_object('status', 'already-settled', 'awardedCoins', 0);
    end if;

    awarded_coins := least(1000000000 - progress.coin_balance, submitted_coins);

    update public.fredrun_user_progress
    set coin_balance = coin_balance + awarded_coins,
        best_score = greatest(best_score, submitted_score),
        last_settled_run_id = submitted_run_id,
        version = version + 1,
        updated_at = statement_timestamp()
    where user_id = player_id
    returning * into progress;

    insert into public.fredrun_progress_events (
      user_id,
      event_type,
      run_id,
      coins_delta,
      balance_after,
      reported_score,
      best_score_after,
      provenance
    )
    values (
      player_id,
      'run_settled',
      submitted_run_id,
      awarded_coins,
      progress.coin_balance,
      submitted_score,
      progress.best_score,
      'client_reported_run'
    );

    result_status := 'settled';
  elsif requested_action = 'purchase' then
    if target_type is null or target_type not in ('character', 'world') or target_id is null then
      raise exception 'fredrun purchase target is invalid' using errcode = '22023';
    end if;

    select *
    into catalog_item
    from public.fredrun_catalog_items
    where item_type = target_type
      and item_id = target_id
      and active;

    if not found then
      raise exception 'fredrun purchase target is unavailable' using errcode = '22023';
    end if;

    if exists (
      select 1
      from public.fredrun_user_unlocks
      where user_id = player_id
        and item_type = target_type
        and item_id = target_id
    ) then
      return public.fredrun_progress_payload(player_id)
        || jsonb_build_object('status', 'already-owned', 'awardedCoins', 0);
    end if;

    if progress.coin_balance < catalog_item.price then
      return public.fredrun_progress_payload(player_id)
        || jsonb_build_object('status', 'insufficient-funds', 'awardedCoins', 0);
    end if;

    update public.fredrun_user_progress
    set coin_balance = coin_balance - catalog_item.price,
        selected_character = case
          when target_type = 'character' then target_id
          else selected_character
        end,
        selected_world = case
          when target_type = 'world' then target_id
          else selected_world
        end,
        version = version + 1,
        updated_at = statement_timestamp()
    where user_id = player_id
    returning * into progress;

    insert into public.fredrun_user_unlocks (
      user_id,
      item_type,
      item_id,
      price_paid,
      provenance
    )
    values (
      player_id,
      target_type,
      target_id,
      catalog_item.price,
      'server_purchase'
    );

    insert into public.fredrun_progress_events (
      user_id,
      event_type,
      item_type,
      item_id,
      coins_delta,
      balance_after,
      best_score_after,
      provenance
    )
    values (
      player_id,
      'item_purchased',
      target_type,
      target_id,
      -catalog_item.price,
      progress.coin_balance,
      progress.best_score,
      'server_catalog'
    );

    result_status := 'purchased';
  elsif requested_action = 'select' then
    if target_type is null or target_type not in ('character', 'world') or target_id is null then
      raise exception 'fredrun selection target is invalid' using errcode = '22023';
    end if;

    if not exists (
      select 1
      from public.fredrun_user_unlocks
      where user_id = player_id
        and item_type = target_type
        and item_id = target_id
    ) then
      return public.fredrun_progress_payload(player_id)
        || jsonb_build_object('status', 'locked', 'awardedCoins', 0);
    end if;

    if (target_type = 'character' and progress.selected_character = target_id)
      or (target_type = 'world' and progress.selected_world = target_id)
    then
      return public.fredrun_progress_payload(player_id)
        || jsonb_build_object('status', 'unchanged', 'awardedCoins', 0);
    end if;

    update public.fredrun_user_progress
    set selected_character = case
          when target_type = 'character' then target_id
          else selected_character
        end,
        selected_world = case
          when target_type = 'world' then target_id
          else selected_world
        end,
        version = version + 1,
        updated_at = statement_timestamp()
    where user_id = player_id
    returning * into progress;

    insert into public.fredrun_progress_events (
      user_id,
      event_type,
      item_type,
      item_id,
      coins_delta,
      balance_after,
      best_score_after,
      provenance
    )
    values (
      player_id,
      'item_selected',
      target_type,
      target_id,
      0,
      progress.coin_balance,
      progress.best_score,
      'authenticated_selection'
    );

    result_status := 'selected';
  else
    raise exception 'fredrun action is invalid' using errcode = '22023';
  end if;

  return public.fredrun_progress_payload(player_id)
    || jsonb_build_object('status', result_status, 'awardedCoins', awarded_coins);
end;
$$;

revoke all on function public.fredrun_progress_payload(uuid)
from public, anon, authenticated;
revoke all on function public.ensure_fredrun_user_progress(uuid)
from public, anon, authenticated;
revoke all on function public.apply_fredrun_progress_action(uuid, text, uuid, integer, integer, text, text)
from public, anon, authenticated;

revoke all on function public.fredrun_progress_payload(uuid)
from service_role;
revoke all on function public.ensure_fredrun_user_progress(uuid)
from service_role;
revoke all on function public.apply_fredrun_progress_action(uuid, text, uuid, integer, integer, text, text)
from service_role;

grant execute on function public.fredrun_progress_payload(uuid)
to service_role;
grant execute on function public.ensure_fredrun_user_progress(uuid)
to service_role;
grant execute on function public.apply_fredrun_progress_action(uuid, text, uuid, integer, integer, text, text)
to service_role;
