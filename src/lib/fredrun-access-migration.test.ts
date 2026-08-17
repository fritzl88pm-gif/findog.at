import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(new URL(
  "../../supabase/migrations/20260817130855_block_fredrun_user_access.sql",
  import.meta.url,
));
const migration = readFileSync(migrationPath, "utf8");

describe("FredRun user access block migration", () => {
  it("stores current blocks and append-only moderation provenance without an email allowlist", () => {
    expect(migration).toMatch(/create table public\.fredrun_user_blocks/i);
    expect(migration).toMatch(/user_id uuid primary key references auth\.users\(id\) on delete cascade/i);
    expect(migration).toMatch(/create table public\.fredrun_moderation_events/i);
    expect(migration).toMatch(/event_type in \('blocked', 'unblocked', 'scores_deleted'\)/i);
    expect(migration).toMatch(/actor text not null/i);
    expect(migration).toMatch(/provenance text not null/i);
    expect(migration).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/iu);
  });

  it("keeps both tables private and grants runtime code read-only block lookup", () => {
    expect(migration).toMatch(/alter table public\.fredrun_user_blocks enable row level security/i);
    expect(migration).toMatch(/alter table public\.fredrun_moderation_events enable row level security/i);
    expect(migration).toMatch(/revoke all on table[\s\S]*from public, anon, authenticated, service_role/i);
    expect(migration).toMatch(/grant select on table public\.fredrun_user_blocks to service_role/i);
    expect(migration).not.toMatch(/grant[^;]*fredrun_moderation_events/i);
  });

  it("blocks writes at the database boundary and indexes moderation history by user", () => {
    expect(migration).toMatch(/create function public\.enforce_fredrun_user_not_blocked\(\)/i);
    expect(migration).toMatch(/security invoker/i);
    expect(migration).not.toMatch(/security definer/i);
    for (const table of [
      "fredrun_player_profiles",
      "fredrun_scores",
      "fredrun_user_progress",
      "fredrun_user_unlocks",
      "fredrun_progress_events",
    ]) {
      expect(migration).toMatch(new RegExp(`before insert or update on public\\.${table}`, "i"));
    }
    expect(migration).toMatch(/on public\.fredrun_moderation_events \(user_id, created_at desc, id desc\)/i);
  });
});
