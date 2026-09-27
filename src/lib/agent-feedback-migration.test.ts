import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL("../../supabase/migrations/20260715000000_agent_feedback.sql", import.meta.url)),
  "utf8",
);
const deletionMigrationUrl = new URL(
  "../../supabase/migrations/20260927131000_delete_feedback_with_conversation.sql",
  import.meta.url,
);

function readDeletionMigration(): string {
  return readFileSync(fileURLToPath(deletionMigrationUrl), "utf8");
}

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

  it("has no FK to conversations (deletion is handled by a trigger migration)", () => {
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

describe("agent feedback conversation deletion migration", () => {
  it("deletes the owner's feedback in a hardened AFTER DELETE trigger function", () => {
    const sql = readDeletionMigration();
    const fn = sql.match(
      /create or replace function public\.delete_conversation_agent_feedback\(\)([\s\S]*?)\$\$;/i,
    )?.[1] ?? "";
    expect(fn).toMatch(/returns trigger/i);
    expect(fn).toMatch(/security definer\s+set search_path = ''/i);
    expect(fn).toMatch(
      /delete from public\.agent_feedback as feedback\s+where feedback\.conversation_id = old\.id\s+and feedback\.user_id = old\.client_id;/i,
    );
    expect(sql).toMatch(
      /revoke all on function public\.delete_conversation_agent_feedback\(\)\s+from public, anon, authenticated;/i,
    );
  });

  it("fires for Fred and legacy agent conversations", () => {
    const sql = readDeletionMigration();
    for (const table of ["fred_conversations", "conversations"]) {
      expect(sql).toMatch(new RegExp(
        `after delete on public\\.${table}\\s+for each row\\s+execute function public\\.delete_conversation_agent_feedback\\(\\);`,
        "i",
      ));
    }
  });

  it("indexes conversation_id for the trigger lookup", () => {
    expect(readDeletionMigration()).toMatch(
      /create index if not exists agent_feedback_conversation_id_idx\s+on public\.agent_feedback \(conversation_id\);/i,
    );
  });

  it("removes existing feedback whose conversation no longer exists in either table", () => {
    const cleanup = readDeletionMigration().match(/delete from public\.agent_feedback as feedback\s+where not exists[\s\S]*$/i)?.[0] ?? "";
    expect(cleanup).toMatch(
      /not exists \(\s*select 1\s+from public\.fred_conversations as conversation\s+where conversation\.id = feedback\.conversation_id\s+and conversation\.client_id = feedback\.user_id\s*\)/i,
    );
    expect(cleanup).toMatch(
      /and not exists \(\s*select 1\s+from public\.conversations as conversation\s+where conversation\.id = feedback\.conversation_id\s+and conversation\.client_id = feedback\.user_id\s*\)/i,
    );
  });

  it("keeps account deletion on the user_id cascade", () => {
    const sql = readDeletionMigration();
    expect(sql).not.toMatch(/alter table public\.agent_feedback/i);
    expect(sql).not.toMatch(/auth\.users/i);
  });
});
