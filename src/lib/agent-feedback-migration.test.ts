import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL("../../supabase/migrations/20260715000000_agent_feedback.sql", import.meta.url)),
  "utf8",
);

describe("agent feedback migration", () => {
  it("creates agent_feedback table with required columns", () => {
    expect(migration).toMatch(/create table if not exists public\.agent_feedback/i);
    expect(migration).toMatch(/id\s+bigserial\s+primary\s+key/i);
    expect(migration).toMatch(/user_id\s+uuid\s+not\s+null/i);
    expect(migration).toMatch(/conversation_id\s+uuid\s+not\s+null/i);
    expect(migration).toMatch(/user_request\s+text\s+not\s+null/i);
    expect(migration).toMatch(/assistant_response\s+text\s+not\s+null/i);
    expect(migration).toMatch(/user_feedback\s+text\s+not\s+null/i);
    expect(migration).toMatch(/created_at\s+timestamptz\s+not\s+null\s+default\s+now\(\)/i);
  });

  it("keeps feedback independent from conversation deletion (no FK to conversations)", () => {
    expect(migration).not.toMatch(/conversation_id[^,]*references\s+public\.conversations/i);
  });

  it("links user_id to auth.users with ON DELETE CASCADE", () => {
    expect(migration).toMatch(/user_id[^,]*references\s+auth\.users\s*\(\s*id\s*\)\s+on\s+delete\s+cascade/i);
  });

  it("enables RLS and revokes access from anon and authenticated", () => {
    expect(migration).toMatch(/alter table public\.agent_feedback enable row level security/i);
    expect(migration).toMatch(/revoke all on public\.agent_feedback from anon, authenticated/i);
  });

  it("grants service_role the required privileges", () => {
    expect(migration).toMatch(/grant select, insert on public\.agent_feedback to service_role/i);
  });

  it("revokes agent_feedback_id_seq sequence from anon and authenticated", () => {
    expect(migration).toMatch(
      /revoke all on sequence public\.agent_feedback_id_seq from anon, authenticated/i,
    );
  });

  it("grants usage, select on agent_feedback_id_seq sequence to service_role", () => {
    expect(migration).toMatch(
      /grant usage, select on sequence public\.agent_feedback_id_seq to service_role/i,
    );
  });

  it("adds an index on user_id and created_at", () => {
    expect(migration).toMatch(/create index\s+(if not exists\s+)?agent_feedback_user_id_created_at_idx\s+on\s+public\.agent_feedback\s*\(\s*user_id\s*,\s*created_at\s+(desc|asc)\s*\)/i);
  });
});
