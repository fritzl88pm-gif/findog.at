-- Raise the editorial summary cap for dashboard news (platform updates) from 600 to 2000 characters.
alter table public.dashboard_news_items
  alter column summary type varchar(2000);

alter table public.dashboard_news_items
  drop constraint if exists dashboard_news_items_summary_check;

alter table public.dashboard_news_items
  add constraint dashboard_news_items_summary_check
  check (length(btrim(summary)) between 1 and 2000);

comment on column public.dashboard_news_items.summary is
  'Administrativ gepflegter Klartext der Meldung, maximal 2000 Zeichen.';
