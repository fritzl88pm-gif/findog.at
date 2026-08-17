import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(fileURLToPath(new URL(
  "../../supabase/migrations/20260817073451_fredrun_user_progress.sql",
  import.meta.url,
)), "utf8");
const hardeningMigration = readFileSync(fileURLToPath(new URL(
  "../../supabase/migrations/20260817075512_harden_fredrun_progress_audit.sql",
  import.meta.url,
)), "utf8");
const indexMigration = readFileSync(fileURLToPath(new URL(
  "../../supabase/migrations/20260817075656_index_fredrun_progress_catalog_fks.sql",
  import.meta.url,
)), "utf8");

describe("FredRun user progress migration", () => {
  it("owns progress, unlocks, and immutable events by auth user", () => {
    expect(migration).toMatch(/create table public\.fredrun_user_progress[\s\S]*user_id uuid primary key references auth\.users\(id\) on delete cascade/iu);
    expect(migration).toMatch(/create table public\.fredrun_user_unlocks[\s\S]*primary key \(user_id, item_type, item_id\)/iu);
    expect(migration).toMatch(/create table public\.fredrun_progress_events[\s\S]*generated always as identity/iu);
    expect(migration).not.toMatch(/grant\s+(?:update|delete)[^;]*fredrun_progress_events/iu);
  });

  it("keeps every table private behind RLS and service-role functions", () => {
    for (const table of [
      "fredrun_catalog_items",
      "fredrun_user_progress",
      "fredrun_user_unlocks",
      "fredrun_progress_events",
    ]) {
      expect(migration).toMatch(new RegExp(`alter table public\\.${table} enable row level security`, "iu"));
    }
    expect(migration).toMatch(/revoke all on table[\s\S]*from public, anon, authenticated/iu);
    expect(migration).toMatch(/security invoker/iu);
    expect(migration).toMatch(/revoke all on function public\.apply_fredrun_progress_action[\s\S]*from public, anon, authenticated/iu);
    expect(migration).toMatch(/grant execute on function public\.apply_fredrun_progress_action[\s\S]*to service_role/iu);
    expect(hardeningMigration).toMatch(/revoke all on table[\s\S]*from public, anon, authenticated, service_role/iu);
    expect(hardeningMigration).toMatch(/grant select, insert on table public\.fredrun_progress_events to service_role/iu);
    expect(hardeningMigration).not.toMatch(/grant\s+(?:update|delete)[^;]*fredrun_progress_events/iu);
  });

  it("settles each run once and records provenance for every mutation", () => {
    expect(migration).toMatch(/create unique index fredrun_progress_events_settled_run_idx[\s\S]*where event_type = 'run_settled'/iu);
    expect(migration).toContain("'client_reported_run'");
    expect(migration).toContain("'server_catalog'");
    expect(migration).toContain("'authenticated_selection'");
    expect(migration).toMatch(/for update/iu);
  });

  it("covers both catalog foreign keys for audited catalog changes", () => {
    expect(indexMigration).toMatch(/fredrun_user_unlocks\s*\(item_type, item_id\)/iu);
    expect(indexMigration).toMatch(/fredrun_progress_events\s*\(item_type, item_id\)/iu);
  });
});
