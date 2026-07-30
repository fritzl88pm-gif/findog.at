-- Add one-level subcategories to user_reasoning_categories.

-- 1. Add parent_id column
alter table public.user_reasoning_categories
  add column parent_id uuid;

-- 2. Self-referencing FK with same-owner enforcement
--    (parent_id, client_id) must reference a real (id, client_id) row.
--    ON DELETE RESTRICT prevents deleting a parent that has children.
alter table public.user_reasoning_categories
  add constraint user_reasoning_categories_parent_owner_fk
    foreign key (parent_id, client_id)
    references public.user_reasoning_categories (id, client_id)
    on delete restrict;

-- 3. Prevent a category from parenting itself
alter table public.user_reasoning_categories
  add constraint user_reasoning_categories_no_self_parent
    check (parent_id is null or parent_id <> id);

-- 4. Index for parent lookups
create index user_reasoning_categories_parent_idx
  on public.user_reasoning_categories (parent_id);

-- 5. Depth enforcement: maximum one level of nesting.
--    A row whose parent_id is set cannot itself be a parent (its children trigger would fail).
create or replace function public.enforce_reasoning_category_one_level_depth()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_is_child boolean;
  new_parent_has_children integer;
begin
  -- Serialize hierarchy mutations per owner so concurrent inserts/reparents cannot
  -- both observe a top-level parent and commit an accidental second level.
  perform pg_advisory_xact_lock(hashtextextended(new.client_id::text, 0));

  -- If setting a parent_id, the parent must be top-level (NULL parent_id).
  if new.parent_id is not null then
    select parent_id is not null
    into parent_is_child
    from public.user_reasoning_categories
    where id = new.parent_id and client_id = new.client_id;

    if parent_is_child then
      raise exception 'Kategorien unterstützen nur eine Hierarchieebene.'
        using errcode = '23514';
    end if;
  end if;

  -- If setting parent_id on an existing top-level category that already has
  -- children, block it -- that would create a second level.
  if tg_op = 'UPDATE' and new.parent_id is not null then
    select count(*)
    into new_parent_has_children
    from public.user_reasoning_categories
    where parent_id = new.id and client_id = new.client_id;

    if new_parent_has_children > 0 then
      raise exception 'Eine Kategorie mit Unterkategorien kann nicht unter eine andere Kategorie verschoben werden.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger enforce_reasoning_category_one_level_depth_trigger
  before insert or update on public.user_reasoning_categories
  for each row
  execute function public.enforce_reasoning_category_one_level_depth();

-- 6. Drop the old global case-insensitive uniqueness index and replace with
--    sibling-aware uniqueness. All NULL parent_ids belong to one sibling set.
drop index if exists user_reasoning_categories_client_name_unique;

create unique index user_reasoning_categories_client_name_parent_unique
  on public.user_reasoning_categories (
    client_id,
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'),
    lower(name)
  );
