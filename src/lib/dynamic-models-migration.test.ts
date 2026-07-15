import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(new URL(
  "../../supabase/migrations/20260715000001_laozhang_dynamic_models.sql",
  import.meta.url,
));
const migration = readFileSync(migrationPath, "utf8");

describe("LaoZhang dynamic models migration", () => {
  it("adds dynamic model columns to model_settings", () => {
    expect(migration).toMatch(/add column display_name text/i);
    expect(migration).toMatch(/add column upstream_model text/i);
    expect(migration).toMatch(/add column is_dynamic boolean/i);
    expect(migration).toMatch(/add column always_enabled boolean/i);
    expect(migration).toMatch(/add column provider text/i);
  });

  it("updates model_id check to allow laozhang:uuid pattern", () => {
    expect(migration).toMatch(/model_id ~ '\^laozhang:/i);
  });

  it("enforces dynamic model constraints: reasoning=disabled, always_enabled=false", () => {
    expect(migration).toMatch(/constraint model_settings_dynamic_reasoning_check/i);
    expect(migration).toMatch(/constraint model_settings_dynamic_enabled_check/i);
  });

  it("validates provider: built-in deepseek/zai, dynamic laozhang", () => {
    expect(migration).toMatch(/constraint model_settings_provider_check/i);
    expect(migration).toMatch(/is_dynamic and provider = 'laozhang'/i);
    expect(migration).toMatch(/not is_dynamic and provider in \('deepseek', 'zai'\)/i);
  });

  it("enforces uniqueness for dynamic (provider, upstream_model)", () => {
    expect(migration).toMatch(/unique index model_settings_dynamic_provider_upstream_unique/i);
    expect(migration).toMatch(/where is_dynamic/i);
  });

  it("adds matching columns to model_settings_history", () => {
    expect(migration).toMatch(/alter table public\.model_settings_history/i);
    expect(migration).toMatch(/add column display_name text/i);
    expect(migration).toMatch(/add column upstream_model text/i);
    expect(migration).toMatch(/add column is_dynamic boolean/i);
    expect(migration).toMatch(/add column always_enabled boolean/i);
    expect(migration).toMatch(/add column provider text/i);
  });

  it("updates agent_runs and messages provider check to include laozhang", () => {
    expect(migration).toMatch(/model_provider in \('deepseek', 'zai', 'laozhang'\)/);
    expect(migration).toMatch(/model ~ '\^laozhang:[\s\S]*and model_provider = 'laozhang'/i);
  });

  it("creates the create_dynamic_model RPC with validations", () => {
    expect(migration).toMatch(/create function public\.create_dynamic_model/i);
    expect(migration).toMatch(/p_model_id text/i);
    expect(migration).toMatch(/p_display_name text/i);
    expect(migration).toMatch(/p_upstream_model text/i);
    expect(migration).toMatch(/p_created_by uuid/i);
    expect(migration).toMatch(/insert into public\.model_settings/i);
    expect(migration).toMatch(/grant execute on function public\.create_dynamic_model/i);
    expect(migration).toMatch(/to service_role/i);
  });

  it("does not grant create_dynamic_model to anon or authenticated", () => {
    expect(migration).toMatch(/revoke all on function public\.create_dynamic_model/i);
    expect(migration).toMatch(/from public, anon, authenticated/i);
  });

  it("backfills upstream_model and provider for existing rows", () => {
    expect(migration).toMatch(/update public\.model_settings set upstream_model = model_id/i);
    expect(migration).toMatch(/update public\.model_settings set provider = 'deepseek'/i);
    expect(migration).toMatch(/update public\.model_settings set provider = 'zai'/i);
  });

  it("backfills display_name for all built-in models", () => {
    expect(migration).toMatch(/update public\.model_settings set display_name = 'DeepSeek v4 Flash'/i);
    expect(migration).toMatch(/update public\.model_settings set display_name = 'DeepSeek v4 Pro'/i);
    expect(migration).toMatch(/update public\.model_settings set display_name = 'GLM-5\.2'/i);
    expect(migration).toMatch(/update public\.model_settings set display_name = 'GLM-5-Turbo'/i);
  });

  it("makes display_name NOT NULL after backfill", () => {
    expect(migration).toMatch(/alter column display_name set not null/i);
  });

  it("adds length and control-character constraints on display_name and upstream_model", () => {
    expect(migration).toMatch(/constraint model_settings_display_name_check/i);
    expect(migration).toMatch(/length\(display_name\) between 1 and 120/i);
    expect(migration).toMatch(/display_name !~ /);
    expect(migration).toMatch(/constraint model_settings_upstream_model_check/i);
    expect(migration).toMatch(/length\(upstream_model\) between 1 and 120/i);
  });

  it("replaces append_model_settings_history to include all new columns", () => {
    expect(migration).toMatch(/create or replace function public\.append_model_settings_history/i);
    expect(migration).toMatch(/new\.display_name/i);
    expect(migration).toMatch(/new\.provider/i);
    expect(migration).toMatch(/new\.upstream_model/i);
    expect(migration).toMatch(/new\.is_dynamic/i);
    expect(migration).toMatch(/new\.always_enabled/i);
    expect(migration).toMatch(/revoke all on function public\.append_model_settings_history/i);
  });

  it("does not call nextval in create_dynamic_model (BEFORE trigger handles it)", () => {
    const createFunc = migration.split("create function public.create_dynamic_model")[1]?.split("$$")[0] ?? "";
    expect(createFunc).not.toContain("nextval");
    expect(createFunc).not.toContain("revision_seq");
  });

  it("uses exact UUID regex for dynamic provenance constraints", () => {
    expect(migration).toMatch(/model ~ '\^laozhang:\[0-9a-f\]\{8\}/);
  });

  it("disables reasoning for dynamic models in create_dynamic_model", () => {
    expect(migration).toMatch(/'disabled'/i);
  });

  it("backfills always-enabled history metadata for the default model", () => {
    expect(migration).toMatch(
      /update public\.model_settings_history set always_enabled = true where model_id = 'deepseek-v4-flash'/i,
    );
  });

  it("enforces exact built-in and dynamic metadata mappings in current and history tables", () => {
    expect(migration).toMatch(
      /constraint model_settings_catalog_metadata_check[\s\S]*model_id = 'deepseek-v4-flash'[\s\S]*provider = 'deepseek'[\s\S]*upstream_model = 'deepseek-v4-flash'/i,
    );
    expect(migration).toMatch(
      /constraint model_settings_history_catalog_metadata_check[\s\S]*model_id = 'glm-5\.2'[\s\S]*provider = 'zai'[\s\S]*upstream_model = 'glm-5\.2'/i,
    );
    expect(migration).toMatch(
      /is_dynamic[\s\S]*provider = 'laozhang'[\s\S]*reasoning_setting = 'disabled'/i,
    );
  });
});
