drop index public.agent_runs_model_settings_revision_idx;
drop index public.messages_model_settings_revision_idx;

create index agent_runs_model_settings_provenance_idx
  on public.agent_runs (model_settings_revision, model, reasoning_setting);

create index messages_model_settings_provenance_idx
  on public.messages (model_settings_revision, model, reasoning_setting);
