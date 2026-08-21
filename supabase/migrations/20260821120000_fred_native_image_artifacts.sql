-- Stores private metadata for trusted native image artifacts created during WeKnora native upload turns.
create table public.fred_native_image_artifacts (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  client_id uuid not null references auth.users(id) on delete cascade,
  user_message_id bigint not null references public.fred_messages(id) on delete cascade,
  source_uri text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/gif', 'image/webp')),
  original_name text not null check (
    char_length(original_name) between 1 and 255
    and original_name !~ '[\x00-\x1f\x7f]'
  ),
  created_at timestamptz not null default now(),
  constraint fred_native_image_artifacts_conversation_owner_fk
    foreign key (conversation_id, client_id)
    references public.fred_conversations(id, client_id)
    on delete cascade,
  constraint fred_native_image_artifacts_source_uri_format
    check (
      char_length(source_uri) between 1 and 2048
      and source_uri ~ '^(local|minio|cos|tos|s3|oss|ks3|obs)://[^\x00-\x1f\x7f]+$'
      and source_uri !~ '(\.\./|/\.\.)'
    ),
  constraint fred_native_image_artifacts_message_source_unique
    unique (user_message_id, source_uri)
);

create index fred_native_image_artifacts_owner_idx
  on public.fred_native_image_artifacts (client_id, conversation_id, id);

alter table public.fred_native_image_artifacts enable row level security;

revoke all on table public.fred_native_image_artifacts from public, anon, authenticated;

grant select, insert, delete on table public.fred_native_image_artifacts to service_role;
