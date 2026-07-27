-- User-owned reusable reasoning texts and their many-to-many categories.
-- These records are private workspace content, not RIS/EVI legal source material.
create table public.user_reasoning_categories (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references auth.users(id) on delete cascade,
  name varchar(80) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_reasoning_categories_id_client_unique unique (id, client_id),
  constraint user_reasoning_categories_name_trimmed
    check (name = btrim(name) and char_length(name) between 1 and 80)
);

create unique index user_reasoning_categories_client_name_unique
  on public.user_reasoning_categories (client_id, lower(name));

create index user_reasoning_categories_client_name_idx
  on public.user_reasoning_categories (client_id, name, id);

create table public.user_reasonings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references auth.users(id) on delete cascade,
  title varchar(160) not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_reasonings_id_client_unique unique (id, client_id),
  constraint user_reasonings_title_trimmed
    check (title = btrim(title) and char_length(title) between 1 and 160),
  constraint user_reasonings_content_trimmed
    check (content = btrim(content) and char_length(content) between 1 and 100000)
);

create index user_reasonings_client_updated_idx
  on public.user_reasonings (client_id, updated_at desc, id desc);

create table public.user_reasoning_category_links (
  reasoning_id uuid not null,
  category_id uuid not null,
  client_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (reasoning_id, category_id),
  constraint user_reasoning_category_links_reasoning_owner_fk
    foreign key (reasoning_id, client_id)
    references public.user_reasonings(id, client_id)
    on delete cascade,
  constraint user_reasoning_category_links_category_owner_fk
    foreign key (category_id, client_id)
    references public.user_reasoning_categories(id, client_id)
    on delete cascade
);

create index user_reasoning_category_links_client_category_idx
  on public.user_reasoning_category_links (client_id, category_id, reasoning_id);

alter table public.user_reasoning_categories enable row level security;
alter table public.user_reasonings enable row level security;
alter table public.user_reasoning_category_links enable row level security;

revoke all on table
  public.user_reasoning_categories,
  public.user_reasonings,
  public.user_reasoning_category_links
from anon, authenticated;

grant usage on schema public to service_role;
grant select, insert, update, delete on table
  public.user_reasoning_categories,
  public.user_reasonings,
  public.user_reasoning_category_links
to service_role;

-- Replacing category assignments must be atomic with saving the card.
create function public.save_user_reasoning(
  p_client_id uuid,
  p_reasoning_id uuid,
  p_title text,
  p_content text,
  p_category_ids uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_id uuid;
  requested_category_count integer;
  owned_category_count integer;
begin
  if p_client_id is null
    or p_title is null
    or p_title <> btrim(p_title)
    or char_length(p_title) not between 1 and 160
    or p_content is null
    or p_content <> btrim(p_content)
    or char_length(p_content) not between 1 and 100000
    or p_category_ids is null
    or cardinality(p_category_ids) > 50
    or array_position(p_category_ids, null) is not null
  then
    raise exception 'reasoning payload is invalid' using errcode = '22023';
  end if;

  requested_category_count := cardinality(p_category_ids);

  select count(distinct category.id)
  into owned_category_count
  from public.user_reasoning_categories as category
  where category.client_id = p_client_id
    and category.id = any(p_category_ids);

  if owned_category_count <> requested_category_count then
    raise exception 'reasoning category ownership mismatch' using errcode = '42501';
  end if;

  if p_reasoning_id is null then
    insert into public.user_reasonings (client_id, title, content)
    values (p_client_id, p_title, p_content)
    returning id into saved_id;
  else
    update public.user_reasonings
    set title = p_title,
        content = p_content,
        updated_at = now()
    where id = p_reasoning_id
      and client_id = p_client_id
    returning id into saved_id;

    if not found then
      raise exception 'reasoning not found' using errcode = 'P0002';
    end if;
  end if;

  delete from public.user_reasoning_category_links
  where reasoning_id = saved_id
    and client_id = p_client_id;

  insert into public.user_reasoning_category_links (
    reasoning_id,
    category_id,
    client_id
  )
  select saved_id, category_id, p_client_id
  from unnest(p_category_ids) as requested(category_id);

  return saved_id;
end;
$$;

revoke all on function public.save_user_reasoning(uuid, uuid, text, text, uuid[])
from public, anon, authenticated;
grant execute on function public.save_user_reasoning(uuid, uuid, text, text, uuid[])
to service_role;
