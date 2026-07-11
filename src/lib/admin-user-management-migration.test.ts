import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL("../../supabase/migrations/0004_admin_user_management.sql", import.meta.url)),
  "utf8",
);

describe("admin user management migration", () => {
  it("keeps request history independent from conversation deletion and private to service_role", () => {
    expect(migration).toMatch(/conversation_id uuid not null\s*,/i);
    expect(migration).not.toMatch(/conversation_id[^\n]+references public\.conversations/i);
    expect(migration).toMatch(/alter table public\.admin_request_history enable row level security/i);
    expect(migration).toMatch(/revoke all on public\.admin_request_history from anon, authenticated/i);
    expect(migration).toMatch(
      /grant select, insert, delete on public\.admin_request_history to service_role/i,
    );
  });

  it("atomically removes public conversations before the auth account", () => {
    const conversationDelete = migration.indexOf("delete from public.conversations");
    const authDelete = migration.indexOf("delete from auth.users");
    expect(conversationDelete).toBeGreaterThan(-1);
    expect(authDelete).toBeGreaterThan(conversationDelete);
    expect(migration).toMatch(/security definer/i);
    expect(migration).toMatch(
      /revoke all on function public\.admin_delete_managed_user\(uuid\) from public, anon, authenticated/i,
    );
    expect(migration).toMatch(
      /grant execute on function public\.admin_delete_managed_user\(uuid\) to service_role/i,
    );
  });
});
