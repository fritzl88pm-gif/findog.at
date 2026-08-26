alter table public.scanning_settings
  drop constraint if exists scanning_settings_document_pipeline_check;

alter table public.scanning_settings
  alter column document_pipeline set default 'mineru_with_omniroute_luna_fallback';

update public.scanning_settings
set document_pipeline = case document_pipeline
  when 'mineru_with_openrouter_fallback' then 'mineru_with_omniroute_luna_fallback'
  when 'openrouter_only' then 'omniroute_luna_only'
  else document_pipeline
end;

alter table public.scanning_settings
  add constraint scanning_settings_document_pipeline_check
  check (document_pipeline in ('mineru_with_omniroute_luna_fallback', 'omniroute_luna_only'));

alter table public.scanning_settings
  add column scanning_provider text not null default 'omniroute_luna';

alter table public.scanning_settings
  add constraint scanning_settings_scanning_provider_check
  check (scanning_provider in ('omniroute_luna', 'openrouter'));
