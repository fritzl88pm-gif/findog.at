import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL("../../supabase/migrations/20260808094800_download_library.sql", import.meta.url)),
  "utf8",
);
const auditHardeningMigration = readFileSync(
  fileURLToPath(
    new URL("../../supabase/migrations/20260808121758_harden_download_audit.sql", import.meta.url),
  ),
  "utf8",
);

describe("download library migration", () => {
  it("creates private, server-only metadata tables with RLS", () => {
    expect(migration).toContain("create table public.download_categories");
    expect(migration).toContain("create table public.download_documents");
    expect(migration).toContain("create table public.download_admin_audit");
    expect(migration).toMatch(/alter table public\.download_categories enable row level security/iu);
    expect(migration).toMatch(/alter table public\.download_documents enable row level security/iu);
    expect(migration).toMatch(/revoke all on public\.download_documents from public, anon, authenticated/iu);
    expect(migration).toMatch(/grant select, insert, update, delete on public\.download_documents to service_role/iu);
  });

  it("creates a private size- and MIME-restricted Storage bucket without client policies", () => {
    expect(migration).toMatch(/'downloads',\s*'downloads',\s*false,\s*20971520/isu);
    expect(migration).toContain("allowed_mime_types");
    expect(migration).not.toMatch(/create policy[\s\S]*storage\.objects/iu);
  });

  it("preserves provenance, integrity hashes and mutation history", () => {
    expect(migration).toContain("content_sha256 char(64)");
    expect(migration).toContain("created_by uuid not null");
    expect(migration).toContain("updated_by uuid not null");
    expect(migration).toContain("download_categories_audit");
    expect(migration).toContain("download_documents_audit");
    expect(migration).toContain("before_state jsonb");
    expect(migration).toContain("after_state jsonb");
    expect(auditHardeningMigration).toMatch(
      /revoke all on table public\.download_admin_audit from service_role/iu,
    );
    expect(auditHardeningMigration).toMatch(
      /grant select, insert on table public\.download_admin_audit to service_role/iu,
    );
    expect(auditHardeningMigration).toMatch(
      /revoke all on sequence public\.download_admin_audit_id_seq from service_role/iu,
    );
  });

  it("uses soft deletion and prevents deleting non-empty categories", () => {
    expect(migration).toContain("deleted_at timestamptz");
    expect(migration).toContain("prevent_nonempty_download_category_deletion");
    expect(migration).toContain("require_active_download_document_category");
    expect(migration).toMatch(/from public\.download_categories[\s\S]*?deleted_at is null[\s\S]*?for update/iu);
    expect(migration).toMatch(/where category_id = old\.id\s+and deleted_at is null/iu);
  });
});
