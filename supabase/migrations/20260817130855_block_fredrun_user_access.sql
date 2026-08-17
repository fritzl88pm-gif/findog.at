create table public.fredrun_user_blocks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  message text not null,
  reason_code text not null,
  blocked_at timestamptz not null default statement_timestamp(),
  blocked_by text not null,
  provenance text not null,
  constraint fredrun_user_blocks_message_length
    check (char_length(message) between 1 and 240),
  constraint fredrun_user_blocks_message_printable
    check (message !~ '[[:cntrl:]]'),
  constraint fredrun_user_blocks_reason_code_format
    check (reason_code ~ '^[a-z0-9][a-z0-9_.-]{0,63}$'),
  constraint fredrun_user_blocks_blocked_by_length
    check (char_length(blocked_by) between 1 and 120),
  constraint fredrun_user_blocks_provenance_length
    check (char_length(provenance) between 1 and 120)
);

create table public.fredrun_moderation_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  event_type text not null,
  message text,
  reason_code text not null,
  affected_rows integer not null default 0,
  actor text not null,
  provenance text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default statement_timestamp(),
  constraint fredrun_moderation_events_type_check
    check (event_type in ('blocked', 'unblocked', 'scores_deleted')),
  constraint fredrun_moderation_events_message_length
    check (message is null or char_length(message) between 1 and 240),
  constraint fredrun_moderation_events_affected_rows_check
    check (affected_rows >= 0),
  constraint fredrun_moderation_events_reason_code_format
    check (reason_code ~ '^[a-z0-9][a-z0-9_.-]{0,63}$'),
  constraint fredrun_moderation_events_actor_length
    check (char_length(actor) between 1 and 120),
  constraint fredrun_moderation_events_provenance_length
    check (char_length(provenance) between 1 and 120),
  constraint fredrun_moderation_events_details_object
    check (jsonb_typeof(details) = 'object')
);

create index fredrun_moderation_events_user_created_idx
  on public.fredrun_moderation_events (user_id, created_at desc, id desc);

alter table public.fredrun_user_blocks enable row level security;
alter table public.fredrun_moderation_events enable row level security;

revoke all on table
  public.fredrun_user_blocks,
  public.fredrun_moderation_events
from public, anon, authenticated, service_role;

revoke all on sequence public.fredrun_moderation_events_id_seq
from public, anon, authenticated, service_role;

grant select on table public.fredrun_user_blocks to service_role;

create function public.enforce_fredrun_user_not_blocked()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.fredrun_user_blocks
    where user_id = new.user_id
  ) then
    raise exception 'fredrun user access blocked' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger fredrun_player_profiles_blocked_user_guard
before insert or update on public.fredrun_player_profiles
for each row execute function public.enforce_fredrun_user_not_blocked();

create trigger fredrun_scores_blocked_user_guard
before insert or update on public.fredrun_scores
for each row execute function public.enforce_fredrun_user_not_blocked();

create trigger fredrun_user_progress_blocked_user_guard
before insert or update on public.fredrun_user_progress
for each row execute function public.enforce_fredrun_user_not_blocked();

create trigger fredrun_user_unlocks_blocked_user_guard
before insert or update on public.fredrun_user_unlocks
for each row execute function public.enforce_fredrun_user_not_blocked();

create trigger fredrun_progress_events_blocked_user_guard
before insert or update on public.fredrun_progress_events
for each row execute function public.enforce_fredrun_user_not_blocked();

revoke all on function public.enforce_fredrun_user_not_blocked()
from public, anon, authenticated, service_role;
