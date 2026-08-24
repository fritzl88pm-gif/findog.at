import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL(
    "../../supabase/migrations/20260824120000_fred_research_display_mode.sql",
    import.meta.url,
  )),
  "utf8",
);

describe("fred_research_display_mode migration", () => {
  it("adds research_display_mode column to fred_user_preferences with default 'simple'", () => {
    expect(migration).toMatch(/alter table public\.fred_user_preferences/i);
    expect(migration).toMatch(/add column (?:if not exists )?research_display_mode\s+text\s+not null\s+default\s+'simple'/i);
  });

  it("adds a check constraint for simple|advanced on fred_user_preferences", () => {
    expect(migration).toMatch(/check\s*\(\s*research_display_mode\s+in\s*\(\s*'simple'\s*,\s*'advanced'\s*\)\s*\)/i);
  });

  it("adds execution_trace jsonb column to fred_messages with default '[]'::jsonb", () => {
    expect(migration).toMatch(/alter table public\.fred_messages/i);
    expect(migration).toMatch(/add column (?:if not exists )?execution_trace\s+jsonb\s+not null\s+default\s+'\[\]'::jsonb/i);
  });

  it("updates record_fred_native_event RPC to validate and persist execution_trace", () => {
    expect(migration).toMatch(/create or replace function public\.record_fred_native_event/i);
    expect(migration).toMatch(/execution_trace_value/i);
    expect(migration).toMatch(/execution_trace\s*=\s*execution_trace_value/i);
    expect(migration).toMatch(/jsonb_array_length\(execution_trace_value\)\s*>\s*200/i);
  });

  it("preserves server-only security and grants on updated objects", () => {
    expect(migration).toMatch(/revoke all on function public\.record_fred_native_event/i);
    expect(migration).toMatch(/grant execute on function public\.record_fred_native_event\(jsonb\)\s+to service_role/i);
  });
});
