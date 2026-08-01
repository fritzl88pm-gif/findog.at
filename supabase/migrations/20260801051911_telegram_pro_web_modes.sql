-- Add per-integration Pro mode and web-search toggles for Telegram.
-- Both default to false: users must opt in explicitly.

alter table public.telegram_integrations
  add column pro_mode_enabled boolean not null default false,
  add column web_search_enabled boolean not null default false;
