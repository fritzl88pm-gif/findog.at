-- Make the already-shipped Alpine world selectable in the audited server catalog.
insert into public.fredrun_catalog_items (
  item_type,
  item_id,
  display_order,
  price,
  default_unlocked,
  active
)
values ('world', 'alps', 2, 0, true, true)
on conflict (item_type, item_id) do update set
  display_order = excluded.display_order,
  price = excluded.price,
  default_unlocked = excluded.default_unlocked,
  active = excluded.active;

alter table public.fredrun_user_progress
  drop constraint if exists fredrun_user_progress_selected_world_check;

alter table public.fredrun_user_progress
  add constraint fredrun_user_progress_selected_world_check
  check (selected_world in ('vienna', 'finanzamt-night', 'alps'));

-- Existing players receive the now-default world without changing progress or events.
-- The moderation trigger normally rejects writes for blocked players; restore it below.
alter table public.fredrun_user_unlocks
  disable trigger fredrun_user_unlocks_blocked_user_guard;

insert into public.fredrun_user_unlocks (
  user_id,
  item_type,
  item_id,
  price_paid,
  provenance
)
select
  progress.user_id,
  'world',
  'alps',
  0,
  'system_default'
from public.fredrun_user_progress as progress
cross join public.fredrun_catalog_items as catalog
where catalog.item_type = 'world'
  and catalog.item_id = 'alps'
on conflict (user_id, item_type, item_id) do nothing;

alter table public.fredrun_user_unlocks
  enable trigger fredrun_user_unlocks_blocked_user_guard;
