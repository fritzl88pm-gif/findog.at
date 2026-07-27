-- Cover the composite owner foreign keys used during cascaded deletes.
create index user_reasoning_category_links_reasoning_owner_idx
  on public.user_reasoning_category_links (reasoning_id, client_id);

create index user_reasoning_category_links_category_owner_idx
  on public.user_reasoning_category_links (category_id, client_id);
