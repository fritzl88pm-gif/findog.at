import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(new URL(
  "../../supabase/migrations/20260715093000_openai_compatible_providers.sql",
  import.meta.url,
));
const migration = readFileSync(migrationPath, "utf8");

describe("OpenAI-compatible providers migration", () => {
  it("adds current-only credential storage and non-secret history metadata", () => {
    expect(migration).toMatch(/alter table public\.model_settings[\s\S]*add column base_url text/i);
    expect(migration).toMatch(/alter table public\.model_settings[\s\S]*add column access_scope text/i);
    expect(migration).toMatch(/alter table public\.model_settings[\s\S]*add column api_key_ciphertext text/i);
    expect(migration).toMatch(/alter table public\.model_settings_history[\s\S]*add column base_url text/i);
    expect(migration).toMatch(/alter table public\.model_settings_history[\s\S]*add column access_scope text/i);
    expect(migration).not.toMatch(/alter table public\.model_settings_history[\s\S]*add column api_key_ciphertext/i);
    expect(migration).toMatch(/alter table public\.model_settings_history[\s\S]*alter column display_name drop not null/i);
  });

  it("removes only current LaoZhang settings", () => {
    expect(migration).toMatch(/delete from public\.model_settings[\s\S]*provider = 'laozhang'/i);
    expect(migration).not.toMatch(/delete from public\.model_settings_history/i);
    expect(migration).not.toMatch(/delete from public\.agent_runs/i);
    expect(migration).not.toMatch(/delete from public\.messages/i);
  });

  it("requires openai UUID IDs and openai_compatible current providers", () => {
    expect(migration).toMatch(/model_id ~ '\^openai:/i);
    expect(migration).toMatch(/provider = 'openai_compatible'/i);
    expect(migration).toMatch(/access_scope in \('disabled', 'admins', 'all'\)/i);
    expect(migration).toMatch(/enabled = \(access_scope <> 'disabled'\)/i);
    expect(migration).toMatch(/create unique index model_settings_dynamic_provider_url_upstream_unique[\s\S]*\(provider, base_url, upstream_model\)[\s\S]*where is_dynamic/i);
  });

  it("validates model metadata and base URLs strictly", () => {
    expect(migration).toMatch(/length\(upstream_model\) between 1 and 120/i);
    expect(migration).toMatch(/length\(display_name\) between 1 and 120/i);
    expect(migration).toMatch(/length\(base_url\) between 1 and 2048/i);
    expect(migration).toMatch(/https\?:\/\//i);
    expect(migration).toMatch(/position\('\?' in base_url\) = 0/i);
    expect(migration).toMatch(/position\('#' in base_url\) = 0/i);
    expect(migration).toMatch(/position\('@' in/i);
  });

  it("drops the active legacy create RPC", () => {
    expect(migration).toMatch(/drop function if exists public\.create_dynamic_model/i);
  });

  it("creates service-role-only CRUD RPCs with empty search paths", () => {
    for (const name of [
      "create_openai_compatible_model",
      "update_openai_compatible_model",
      "delete_openai_compatible_model",
    ]) {
      expect(migration).toMatch(new RegExp(`create function public\\.${name}`, "i"));
      expect(migration).toMatch(new RegExp(`${name}[\\s\\S]*set search_path = ''`, "i"));
      expect(migration).toMatch(new RegExp(`revoke all on function public\\.${name}[\\s\\S]*from public, anon, authenticated`, "i"));
      expect(migration).toMatch(new RegExp(`grant execute on function public\\.${name}[\\s\\S]*to service_role`, "i"));
    }
  });

  it("uses optimistic revisions for update and delete conflicts", () => {
    expect(migration).toMatch(/p_expected_revision bigint/i);
    expect(migration).toMatch(/revision = p_expected_revision/i);
    expect(migration).toMatch(/errcode = '40001'/i);
  });

  it("keeps ciphertext out of history triggers", () => {
    const historyFunction = migration.match(/create or replace function public\.append_model_settings_history[\s\S]*?\$\$;/i)?.[0] ?? "";
    expect(historyFunction).toContain("new.base_url");
    expect(historyFunction).toContain("new.access_scope");
    expect(historyFunction).not.toContain("api_key_ciphertext");
  });

  it("preserves explicit legacy LaoZhang provenance clauses", () => {
    expect(migration).toMatch(/model_provider in \('deepseek', 'zai', 'openai_compatible', 'laozhang'\)/i);
    expect(migration).toMatch(/model ~ '\^laozhang:[\s\S]*model_provider = 'laozhang'/i);
    expect(migration).toMatch(/model_id ~ '\^laozhang:[\s\S]*provider = 'laozhang'/i);
  });
});
