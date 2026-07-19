import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL(
    "../../supabase/migrations/20260719171431_fredrun_highscores.sql",
    import.meta.url,
  )),
  "utf8",
);

describe("Fredrun highscore migration", () => {
  it("stores account profiles and every submitted round separately", () => {
    expect(migration).toMatch(/create table public\.fredrun_player_profiles/i);
    expect(migration).toMatch(/create table public\.fredrun_scores/i);
    expect(migration).toMatch(/references auth\.users\(id\) on delete cascade/i);
    expect(migration).toMatch(/unique \(user_id, run_id\)/i);
    expect(migration).toMatch(/score between 0 and 1000000/i);
  });

  it("supports a deterministic top ten and bounded per-account lookups", () => {
    expect(migration).toMatch(/fredrun_scores_leaderboard_idx[\s\S]*score desc, created_at asc, id asc/i);
    expect(migration).toMatch(/fredrun_scores_user_created_idx[\s\S]*user_id, created_at desc, id desc/i);
  });

  it("keeps both tables and the submission function service-role-only", () => {
    for (const table of ["fredrun_player_profiles", "fredrun_scores"]) {
      expect(migration).toMatch(new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    }
    expect(migration).toMatch(/revoke all on table[\s\S]*fredrun_player_profiles[\s\S]*from public, anon, authenticated/i);
    expect(migration).toMatch(/create function public\.submit_fredrun_score[\s\S]*security invoker[\s\S]*set search_path = ''/i);
    expect(migration).toMatch(/revoke all on function public\.submit_fredrun_score[\s\S]*from public, anon, authenticated/i);
    expect(migration).toMatch(/grant execute on function public\.submit_fredrun_score[\s\S]*to service_role/i);
  });

  it("normalizes names, rate limits writes, and makes retries idempotent", () => {
    expect(migration).toMatch(/char_length\(normalized_name\) not between 1 and 20/i);
    expect(migration).toMatch(/created_at >= statement_timestamp\(\) - interval '5 minutes'/i);
    expect(migration).toMatch(/recent_submission_count >= 30/i);
    expect(migration).toMatch(/on conflict \(user_id, run_id\) do nothing/i);
    expect(migration).toMatch(/return inserted_score_id is not null/i);
  });
});
