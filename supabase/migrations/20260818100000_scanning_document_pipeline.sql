alter table public.scanning_settings
  add column document_pipeline text not null default 'mineru_with_openrouter_fallback'
  check (document_pipeline in ('mineru_with_openrouter_fallback', 'openrouter_only'));
