import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(new URL(
  "../../supabase/migrations/20260714195644_central_model_settings.sql",
  import.meta.url,
));
const migration = readFileSync(migrationPath, "utf8");

describe("central model settings migration", () => {
  it("seeds exactly the fixed catalog with reviewed defaults", () => {
    expect(migration).toContain("('deepseek-v4-flash', true, 'disabled'");
    expect(migration).toContain("('deepseek-v4-pro', true, 'high'");
    expect(migration).toContain("('glm-5.2', false, 'max'");
    expect(migration).toContain("('glm-5-turbo', false, 'enabled'");
    expect(migration).toMatch(/model_settings_flash_enabled_check[\s\S]*model_id <> 'deepseek-v4-flash' or enabled/i);
  });

  it("keeps current settings and append-only history private to service_role", () => {
    expect(migration).toMatch(/alter table public\.model_settings enable row level security/i);
    expect(migration).toMatch(/alter table public\.model_settings_history enable row level security/i);
    expect(migration).toMatch(/revoke all on public\.model_settings from anon, authenticated/i);
    expect(migration).toMatch(/revoke all on public\.model_settings_history from anon, authenticated/i);
    expect(migration).toMatch(/grant select, insert, update on public\.model_settings to service_role/i);
    expect(migration).toMatch(/grant select on public\.model_settings_history to service_role/i);
    expect(migration).not.toMatch(/grant[^;]*(?:insert|update|delete)[^;]*model_settings_history/i);
  });

  it("records every seed and update through restricted audit triggers", () => {
    expect(migration).toMatch(/before insert or update on public\.model_settings/i);
    expect(migration).toMatch(/after insert or update on public\.model_settings/i);
    expect(migration).toMatch(/insert into public\.model_settings_history/i);
    expect(migration).toMatch(/security definer[\s\S]*set search_path = ''/i);
    expect(migration).toMatch(/revoke all on function public\.append_model_settings_history\(\)[\s\S]*from public, anon, authenticated/i);
  });

  it("updates settings atomically with optimistic revisions", () => {
    expect(migration).toMatch(/create function public\.update_model_settings\([\s\S]*expected_revision bigint/i);
    expect(migration).toMatch(/where model_id = setting\.model_id[\s\S]*and revision = setting\.expected_revision/i);
    expect(migration).toMatch(/model settings changed concurrently'[\s\S]*errcode = '40001'/i);
    expect(migration).toMatch(/grant execute on function public\.update_model_settings\(uuid, jsonb\)[\s\S]*to service_role/i);
  });

  it("stores canonical runtime provenance on assistant messages", () => {
    expect(migration).toMatch(/alter table public\.messages[\s\S]*add column model text/i);
    expect(migration).toMatch(/messages_model_provenance_completeness_check/i);
    expect(migration).toMatch(/messages_fallback_model_check[\s\S]*model = 'deepseek-v4-flash'[\s\S]*reasoning_setting = 'disabled'/i);
    expect(migration).toMatch(/messages_model_provider_upstream_check[\s\S]*model_provider = 'zai'[\s\S]*upstream_model = 'glm-5-turbo'/i);
    expect(migration).toMatch(/messages_model_settings_revision_model_reasoning_fkey[\s\S]*foreign key \(model_settings_revision, model, reasoning_setting\)[\s\S]*references public\.model_settings_history \(revision, model_id, reasoning_setting\)/i);
    expect(migration).toMatch(/model_settings_history_revision_model_reasoning_key[\s\S]*unique \(revision, model_id, reasoning_setting\)/i);
    expect(migration).not.toContain("persist_conversation_turn");
  });

  it("derives agent-run provenance from the matching assistant message", () => {
    expect(migration).toMatch(/add column model_provider text/i);
    expect(migration).toMatch(/add column upstream_model text/i);
    expect(migration).toMatch(/add column reasoning_setting text/i);
    expect(migration).toMatch(/add column model_settings_revision bigint/i);
    expect(migration).toMatch(/add column model_settings_source text/i);
    expect(migration).toMatch(/model_settings_source = 'database' and model_settings_revision is not null/i);
    expect(migration).toMatch(/model_settings_source in \('fallback', 'legacy'\) and model_settings_revision is null/i);
    expect(migration).toMatch(/agent_runs_model_settings_revision_model_reasoning_fkey[\s\S]*foreign key \(model_settings_revision, model, reasoning_setting\)/i);
    expect(migration).toMatch(/where message\.id = new\.assistant_message_id[\s\S]*message\.conversation_id = new\.conversation_id[\s\S]*message\.client_id = new\.client_id/i);
    expect(migration).toMatch(/assistant_provenance\.model_settings_source is null[\s\S]*or assistant_provenance\.model_settings_source not in \('database', 'fallback'\)/i);
    expect(migration).toMatch(/before insert on public\.agent_runs/i);
  });
});
