import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL(
    "../../../supabase/migrations/20260801051911_telegram_pro_web_modes.sql",
    import.meta.url,
  )),
  "utf8",
);

describe("telegram_pro_web_modes migration", () => {
  it("adds pro_mode_enabled column with boolean not null default false", () => {
    expect(migration).toMatch(
      /alter table public\.telegram_integrations/i,
    );
    expect(migration).toMatch(
      /add column pro_mode_enabled boolean not null default false/i,
    );
  });

  it("adds web_search_enabled column with boolean not null default false", () => {
    expect(migration).toMatch(
      /add column web_search_enabled boolean not null default false/i,
    );
  });

  it("does NOT drop, rename, or alter any existing column", () => {
    expect(migration).not.toMatch(/drop column/i);
    expect(migration).not.toMatch(/rename column/i);
    expect(migration).not.toMatch(/alter column/i);
  });

  it("does NOT backfill data, delete rows, or rewrite any existing rows", () => {
    expect(migration).not.toMatch(
      /update public\.telegram_integrations/i,
    );
    expect(migration).not.toMatch(
      /delete from public\.telegram_integrations/i,
    );
    expect(migration).not.toMatch(
      /truncate( table)? public\.telegram_integrations/i,
    );
  });

  it("does NOT create any table, index, trigger, RPC function, or sequence", () => {
    expect(migration).not.toMatch(/create table/i);
    expect(migration).not.toMatch(/create index/i);
    expect(migration).not.toMatch(/create (or replace )?function/i);
    expect(migration).not.toMatch(/create trigger/i);
    expect(migration).not.toMatch(/create sequence/i);
  });

  it("does NOT touch RLS or grants (no revoke, grant, or enable row level security)", () => {
    expect(migration).not.toMatch(/enable row level security/i);
    expect(migration).not.toMatch(/revoke/i);
    expect(migration).not.toMatch(/grant/i);
  });

  it("contains only the additive ALTER TABLE statement(s) and nothing extraneous", () => {
    const withoutComments = migration
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim();

    expect(withoutComments.length).toBeGreaterThan(0);

    const statements = withoutComments
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    expect(statements.length).toBeGreaterThanOrEqual(1);
    for (const stmt of statements) {
      expect(stmt).toMatch(/^alter table public\.telegram_integrations\b/i);
    }
  });
});
