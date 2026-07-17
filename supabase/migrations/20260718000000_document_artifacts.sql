create table public.document_artifacts (
  id uuid primary key,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  client_id uuid not null,
  assistant_message_id bigint not null references public.messages(id) on delete cascade,
  agent_run_id uuid not null references public.agent_runs(id) on delete cascade,
  kind text not null default 'pdf' check (kind = 'pdf'),
  title varchar(160) not null check (char_length(btrim(title)) > 0),
  filename varchar(100) not null check (filename ~ '^[A-Za-z0-9_]+\.pdf$'),
  content_markdown text not null check (
    char_length(btrim(content_markdown)) > 0
    and char_length(content_markdown) <= 60000
  ),
  content_sha256 char(64) not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  stichtag date,
  provenance jsonb not null check (jsonb_typeof(provenance) = 'object'),
  created_at timestamptz not null default now()
);

create index document_artifacts_conversation_message_idx
  on public.document_artifacts (conversation_id, assistant_message_id, created_at);

create index document_artifacts_client_created_at_idx
  on public.document_artifacts (client_id, created_at desc);

create function public.validate_document_artifact_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  message_scope record;
  run_scope record;
begin
  select conversation_id, client_id, role
  into message_scope
  from public.messages
  where id = new.assistant_message_id;

  select conversation_id, client_id, assistant_message_id
  into run_scope
  from public.agent_runs
  where id = new.agent_run_id;

  if message_scope.role is distinct from 'assistant'
    or message_scope.conversation_id is distinct from new.conversation_id
    or message_scope.client_id is distinct from new.client_id
    or run_scope.conversation_id is distinct from new.conversation_id
    or run_scope.client_id is distinct from new.client_id
    or run_scope.assistant_message_id is distinct from new.assistant_message_id
  then
    raise exception 'document artifact scope mismatch';
  end if;
  return new;
end;
$$;

create trigger validate_document_artifact_scope_before_write
before insert or update on public.document_artifacts
for each row execute function public.validate_document_artifact_scope();

alter table public.document_artifacts enable row level security;

revoke all on table public.document_artifacts from public, anon, authenticated;
grant select, insert, delete on table public.document_artifacts to service_role;

revoke all on function public.validate_document_artifact_scope() from public, anon, authenticated;
grant execute on function public.validate_document_artifact_scope() to service_role;
