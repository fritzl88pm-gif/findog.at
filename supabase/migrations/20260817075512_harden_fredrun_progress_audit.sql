-- Supabase projects with legacy default privileges may auto-grant service_role
-- broader table rights at CREATE time. Revoke first, then grant the exact API surface.
revoke all on table
  public.fredrun_catalog_items,
  public.fredrun_user_progress,
  public.fredrun_user_unlocks,
  public.fredrun_progress_events
from public, anon, authenticated, service_role;

revoke all on sequence public.fredrun_progress_events_id_seq
from public, anon, authenticated, service_role;

grant select on table public.fredrun_catalog_items to service_role;
grant select, insert, update on table public.fredrun_user_progress to service_role;
grant select, insert on table public.fredrun_user_unlocks to service_role;
grant select, insert on table public.fredrun_progress_events to service_role;
grant usage, select on sequence public.fredrun_progress_events_id_seq to service_role;

revoke all on function public.fredrun_progress_payload(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.ensure_fredrun_user_progress(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.apply_fredrun_progress_action(uuid, text, uuid, integer, integer, text, text)
from public, anon, authenticated, service_role;

grant execute on function public.fredrun_progress_payload(uuid)
to service_role;
grant execute on function public.ensure_fredrun_user_progress(uuid)
to service_role;
grant execute on function public.apply_fredrun_progress_action(uuid, text, uuid, integer, integer, text, text)
to service_role;
