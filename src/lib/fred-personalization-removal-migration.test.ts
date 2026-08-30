import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(fileURLToPath(new URL(
  "../../supabase/migrations/20260830093213_remove_fred_personalization.sql",
  import.meta.url,
)), "utf8");

describe("Fred personalization removal migration", () => {
  it("uses a bounded lock timeout and drops dependencies in order", () => {
    expect(migration).toMatch(/set lock_timeout = '5s'/i);
    const foreignKey = migration.indexOf("drop constraint if exists fup_personality_fk");
    const preferredName = migration.indexOf("drop column if exists preferred_name");
    const personality = migration.indexOf("drop column if exists personality");
    const profiles = migration.indexOf("drop table if exists public.fred_personality_profiles");
    expect(foreignKey).toBeGreaterThan(-1);
    expect(preferredName).toBeGreaterThan(foreignKey);
    expect(personality).toBeGreaterThan(preferredName);
    expect(profiles).toBeGreaterThan(personality);
  });

  it("preserves the preference table, rows, research mode, RLS and grants", () => {
    expect(migration).not.toMatch(/drop table(?: if exists)? public\.fred_user_preferences/i);
    expect(migration).not.toMatch(/delete from public\.fred_user_preferences/i);
    expect(migration).not.toMatch(/truncate(?: table)? public\.fred_user_preferences/i);
    expect(migration).not.toMatch(/drop column if exists research_display_mode/i);
    expect(migration).not.toMatch(/disable row level security/i);
    expect(migration).not.toMatch(/revoke .*service_role/i);
    expect(migration).not.toMatch(/cascade/i);
  });
});
