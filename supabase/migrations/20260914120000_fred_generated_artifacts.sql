-- Persist trusted WeKnora sandbox artifact metadata on the owning assistant message.
alter table public.fred_messages
  add column if not exists artifacts jsonb not null default '[]'::jsonb;

alter table public.fred_messages
  drop constraint if exists fred_messages_artifacts_shape;

alter table public.fred_messages
  add constraint fred_messages_artifacts_shape check (
    jsonb_typeof(artifacts) = 'array'
    and jsonb_array_length(artifacts) <= 10
  );
