-- Keep the administrative download audit log append-only for the server role.
-- Supabase's table-creation hooks can grant broad service_role privileges before
-- the explicit grants in the preceding migration are evaluated.

revoke all on table public.download_admin_audit from service_role;
grant select, insert on table public.download_admin_audit to service_role;

revoke all on sequence public.download_admin_audit_id_seq from service_role;
grant usage, select on sequence public.download_admin_audit_id_seq to service_role;
