alter table public.scanning_settings
  add column fred_attachment_mode text not null default 'findog_preprocess'
  check (fred_attachment_mode in ('findog_preprocess', 'weknora_native'));
