import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL("../../supabase/migrations/20260829225606_dashboard_news.sql", import.meta.url)),
  "utf8",
).toLowerCase();

describe("dashboard news migration", () => {
  it("creates curated news with legal provenance, explicit as-of date and soft deletion", () => {
    expect(migration).toContain("create table if not exists public.dashboard_news_items");
    expect(migration).toContain("source_system text");
    expect(migration).toContain("document_kind text");
    expect(migration).toContain("source_identifier varchar(200)");
    expect(migration).toContain("document_date date");
    expect(migration).toContain("as_of_date date");
    expect(migration).toContain("deleted_at timestamptz");
    expect(migration).toContain("deleted_by uuid");
    expect(migration).toContain("dashboard_news_items_legal_fields_check");
    expect(migration).toContain("dashboard_news_items_source_url_check");
  });

  it("prevents duplicate active legal sources", () => {
    expect(migration).toMatch(/create unique index[^;]+\(source_system, lower\(source_identifier\)\)[^;]+where kind = 'legal' and deleted_at is null/su);
  });

  it("writes immutable before/after audit entries for create, update and soft delete", () => {
    expect(migration).toContain("create table if not exists public.dashboard_news_audit");
    expect(migration).toContain("before_state jsonb");
    expect(migration).toContain("after_state jsonb");
    expect(migration).toContain("'soft_deleted'");
    expect(migration).toContain("to_jsonb(old)");
    expect(migration).toContain("to_jsonb(new)");
    expect(migration).toContain("after insert or update on public.dashboard_news_items");
    expect(migration).not.toMatch(/grant\s+update[^;]+dashboard_news_audit/su);
    expect(migration).not.toMatch(/grant\s+delete[^;]+dashboard_news_audit/su);
  });

  it("enables RLS, removes browser grants and grants only explicit service-role access", () => {
    expect(migration).toContain("alter table public.dashboard_news_items enable row level security");
    expect(migration).toContain("alter table public.dashboard_news_audit enable row level security");
    expect(migration).toContain("revoke all on table public.dashboard_news_items from public, anon, authenticated, service_role");
    expect(migration).toContain("revoke all on table public.dashboard_news_audit from public, anon, authenticated, service_role");
    expect(migration).toContain("grant select, insert, update on table public.dashboard_news_items to service_role");
    expect(migration).toContain("grant select, insert on table public.dashboard_news_audit to service_role");
    expect(migration).not.toMatch(/grant\s+[^;]+\s+to\s+(anon|authenticated)/su);
  });
});
