-- Administrative balance corrections must remain distinguishable from gameplay
-- settlements and retain both ledger and operator-request provenance.
alter table public.fredrun_progress_events
  drop constraint fredrun_progress_events_type_check,
  drop constraint fredrun_progress_events_provenance_check;

alter table public.fredrun_progress_events
  add constraint fredrun_progress_events_type_check
    check (event_type in (
      'profile_created',
      'run_settled',
      'item_purchased',
      'item_selected',
      'admin_coin_grant'
    )),
  add constraint fredrun_progress_events_provenance_check
    check (provenance in (
      'server_default',
      'client_reported_run',
      'server_catalog',
      'authenticated_selection',
      'administrator_grant'
    ));

alter table public.fredrun_moderation_events
  drop constraint fredrun_moderation_events_type_check;

alter table public.fredrun_moderation_events
  add constraint fredrun_moderation_events_type_check
    check (event_type in ('blocked', 'unblocked', 'scores_deleted', 'coins_granted'));
