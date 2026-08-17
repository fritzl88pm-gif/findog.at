alter table public.fredrun_user_progress
  drop constraint fredrun_user_progress_selected_character_check;

alter table public.fredrun_user_progress
  add constraint fredrun_user_progress_selected_character_check
  check (selected_character in ('fred', 'frida', 'superfred', 'cyberfred'));

insert into public.fredrun_catalog_items (
  item_type,
  item_id,
  display_order,
  price,
  default_unlocked,
  active
)
values ('character', 'cyberfred', 3, 2000, false, true);
