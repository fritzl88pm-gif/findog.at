alter table public.fred_messages
  add column attachments jsonb not null default '[]'::jsonb,
  add column web_search_enabled boolean not null default false,
  add column native_metadata_recorded boolean not null default false;

alter table public.fred_messages
  add constraint fred_messages_attachments_shape
    check (
      jsonb_typeof(attachments) = 'array'
      and jsonb_array_length(attachments) <= 10
    ),
  add constraint fred_messages_request_metadata_role
    check (
      role = 'user'
      or (
        attachments = '[]'::jsonb
        and web_search_enabled = false
      )
    );

create function public.record_fred_native_event(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  event_id_value uuid;
  event_type_value text;
  attachments_value jsonb;
  web_search_enabled_value boolean;
  attachment_value jsonb;
  attachment_kind text;
  attachment_name text;
  attachment_mime_type text;
  attachment_size_bytes bigint;
  attachment_sha256 text;
  image_count integer := 0;
  file_count integer := 0;
  existing_attachments jsonb;
  existing_web_search_enabled boolean;
  metadata_already_recorded boolean;
  result_value jsonb;
begin
  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'fred native payload must be an object' using errcode = '22023';
  end if;

  event_id_value := (payload ->> 'event_id')::uuid;
  event_type_value := btrim(payload ->> 'event_type');
  attachments_value := coalesce(payload -> 'attachments', '[]'::jsonb);

  if payload ? 'web_search_enabled'
    and jsonb_typeof(payload -> 'web_search_enabled') is distinct from 'boolean'
  then
    raise exception 'fred native web search flag must be boolean' using errcode = '22023';
  end if;
  web_search_enabled_value := coalesce((payload ->> 'web_search_enabled')::boolean, false);

  if jsonb_typeof(attachments_value) is distinct from 'array'
    or jsonb_array_length(attachments_value) > 10
  then
    raise exception 'fred native attachments must be an array of at most ten items'
      using errcode = '22023';
  end if;

  for attachment_value in
    select value from jsonb_array_elements(attachments_value)
  loop
    if jsonb_typeof(attachment_value) is distinct from 'object'
      or jsonb_typeof(attachment_value -> 'kind') is distinct from 'string'
      or jsonb_typeof(attachment_value -> 'name') is distinct from 'string'
      or jsonb_typeof(attachment_value -> 'mime_type') is distinct from 'string'
      or jsonb_typeof(attachment_value -> 'size_bytes') is distinct from 'number'
      or jsonb_typeof(attachment_value -> 'sha256') is distinct from 'string'
    then
      raise exception 'fred native attachment metadata is invalid' using errcode = '22023';
    end if;

    attachment_kind := attachment_value ->> 'kind';
    attachment_name := btrim(attachment_value ->> 'name');
    attachment_mime_type := lower(btrim(attachment_value ->> 'mime_type'));
    attachment_size_bytes := (attachment_value ->> 'size_bytes')::bigint;
    attachment_sha256 := lower(attachment_value ->> 'sha256');

    if attachment_kind not in ('image', 'file')
      or char_length(attachment_name) not between 1 and 255
      or char_length(attachment_mime_type) not between 1 and 127
      or attachment_mime_type !~ '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$'
      or attachment_size_bytes < 1
      or attachment_sha256 !~ '^[0-9a-f]{64}$'
      or exists (
        select 1
        from jsonb_object_keys(attachment_value) as object_key(key_name)
        where key_name not in ('kind', 'name', 'mime_type', 'size_bytes', 'sha256')
      )
    then
      raise exception 'fred native attachment metadata fields are invalid' using errcode = '22023';
    end if;

    if attachment_kind = 'image' then
      image_count := image_count + 1;
      if image_count > 5 or attachment_size_bytes > 10485760 then
        raise exception 'fred native image limits exceeded' using errcode = '22023';
      end if;
    else
      file_count := file_count + 1;
      if file_count > 5 or attachment_size_bytes > 20971520 then
        raise exception 'fred native file limits exceeded' using errcode = '22023';
      end if;
    end if;
  end loop;

  if event_type_value = 'message_received'
    and (attachments_value <> '[]'::jsonb or web_search_enabled_value)
  then
    raise exception 'fred assistant events cannot contain request metadata' using errcode = '22023';
  end if;

  result_value := public.record_fred_bridge_event(payload);

  select
    message.attachments,
    message.web_search_enabled,
    message.native_metadata_recorded
  into
    existing_attachments,
    existing_web_search_enabled,
    metadata_already_recorded
  from public.fred_messages as message
  where message.bridge_event_id = event_id_value
  for update;

  if not found then
    raise exception 'fred native message was not persisted' using errcode = 'P0001';
  end if;

  if metadata_already_recorded
    and (
      existing_attachments is distinct from attachments_value
      or existing_web_search_enabled is distinct from web_search_enabled_value
    )
  then
    raise exception 'fred native event id metadata reuse mismatch' using errcode = '23505';
  end if;

  update public.fred_messages
  set attachments = attachments_value,
      web_search_enabled = web_search_enabled_value,
      native_metadata_recorded = true
  where bridge_event_id = event_id_value;

  return result_value;
end;
$$;

revoke all on function public.record_fred_native_event(jsonb)
from public, anon, authenticated;
grant execute on function public.record_fred_native_event(jsonb)
to service_role;
