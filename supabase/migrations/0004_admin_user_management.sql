create table if not exists public.admin_request_history (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists admin_request_history_user_created_id_idx
  on public.admin_request_history (user_id, created_at desc, id desc);

alter table public.admin_request_history enable row level security;

revoke all on public.admin_request_history from anon, authenticated;
revoke all on sequence public.admin_request_history_id_seq from anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, delete on public.admin_request_history to service_role;
grant usage, select on sequence public.admin_request_history_id_seq to service_role;

create or replace function public.admin_delete_managed_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.conversations
  where client_id = target_user_id;

  delete from auth.users
  where id = target_user_id;

  if not found then
    raise exception 'managed user not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.admin_delete_managed_user(uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_managed_user(uuid) to service_role;
