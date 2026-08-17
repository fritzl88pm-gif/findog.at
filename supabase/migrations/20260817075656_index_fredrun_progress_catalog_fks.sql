create index if not exists fredrun_user_unlocks_catalog_idx
  on public.fredrun_user_unlocks (item_type, item_id);

create index if not exists fredrun_progress_events_catalog_idx
  on public.fredrun_progress_events (item_type, item_id);
