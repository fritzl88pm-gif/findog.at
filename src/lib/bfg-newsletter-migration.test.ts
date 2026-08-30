import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL("../../supabase/migrations/20260830142801_bfg_newsletters.sql", import.meta.url)),
  "utf8",
).toLowerCase();

describe("BFG newsletter migration", () => {
  it("stores only newsletter date, Markdown content and audit metadata", () => {
    expect(migration).toContain("create table if not exists public.bfg_newsletters");
    expect(migration).toContain("publication_date date not null");
    expect(migration).toContain("content_markdown text not null");
    expect(migration).toContain("content_markdown ~ '[^[:space:]]'");
    expect(migration).not.toMatch(/create table if not exists public\.bfg_newsletters[\s\S]*?\btitle\b[\s\S]*?\);/u);
    expect(migration).toContain("created_by uuid not null");
    expect(migration).toContain("updated_by uuid not null");
    expect(migration).toContain("deleted_by uuid");
    expect(migration).toContain("deleted_at timestamptz");
  });

  it("indexes the required newest-first read order", () => {
    expect(migration).toMatch(/create index[^;]+\(publication_date desc, created_at desc, id desc\)[^;]+where deleted_at is null/su);
  });

  it("keeps an append-only before/after audit trail for create, update and soft delete", () => {
    expect(migration).toContain("create table if not exists public.bfg_newsletter_audit");
    expect(migration).toContain("before_state jsonb");
    expect(migration).toContain("after_state jsonb");
    expect(migration).toContain("'soft_deleted'");
    expect(migration).toContain("to_jsonb(old)");
    expect(migration).toContain("to_jsonb(new)");
    expect(migration).toContain("after insert or update on public.bfg_newsletters");
    expect(migration).not.toMatch(/grant\s+update[^;]+bfg_newsletter_audit/su);
    expect(migration).not.toMatch(/grant\s+delete[^;]+bfg_newsletter_audit/su);
  });

  it("enables RLS and exposes neither table to browser roles", () => {
    expect(migration).toContain("alter table public.bfg_newsletters enable row level security");
    expect(migration).toContain("alter table public.bfg_newsletter_audit enable row level security");
    expect(migration).toContain("revoke all on table public.bfg_newsletters from public, anon, authenticated, service_role");
    expect(migration).toContain("grant select, insert, update on table public.bfg_newsletters to service_role");
    expect(migration).toContain("grant select, insert on table public.bfg_newsletter_audit to service_role");
    expect(migration).not.toMatch(/grant\s+[^;]+\s+to\s+(anon|authenticated)/su);
  });
});
