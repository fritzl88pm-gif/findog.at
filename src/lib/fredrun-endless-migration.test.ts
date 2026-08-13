import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL(
    "../../supabase/migrations/20260813133900_reset_fredrun_leaderboard_for_endless_mode.sql",
    import.meta.url,
  )),
  "utf8",
);

describe("Fredrun endless-mode leaderboard reset", () => {
  it("deletes only score rows and leaves profiles, RPC, RLS, and schema untouched", () => {
    const statements = migration
      .replace(/--.*$/gmu, "")
      .split(";")
      .map((statement) => statement.trim().replace(/\s+/gu, " "))
      .filter(Boolean);

    expect(statements).toEqual(["delete from public.fredrun_scores"]);
    expect(migration).not.toMatch(/\b(?:alter|create|drop|grant|revoke|truncate|update|insert)\b/iu);
  });
});
