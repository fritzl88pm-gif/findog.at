import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

const page = source("../app/page.tsx");
const publicView = source("../components/downloads-view.tsx");
const adminView = source("../components/admin-downloads.tsx");
const publicRoute = source("../app/api/downloads/route.ts");
const downloadRoute = source("../app/api/downloads/[documentId]/route.ts");
const categoryRoute = source("../app/api/admin/downloads/categories/route.ts");
const documentRoute = source("../app/api/admin/downloads/documents/route.ts");

describe("download library surface", () => {
  it("adds Downloads to both navigation modes and renders the public view", () => {
    expect(page).toContain('"downloads"');
    expect(page).toContain("openDownloadsView");
    expect(page).toContain('<DownloadsView accessToken={session?.access_token ?? ""} />');
    expect(page.match(/aria-label="Downloads"/gu)).toHaveLength(1);
    expect(page.match(/>\s*Downloads\s*<\/button>/gu)?.length).toBeGreaterThanOrEqual(2);
  });

  it("implements the screenshot-inspired category, file, size and pagination UI", () => {
    expect(publicView).toContain("Downloadkategorien");
    expect(publicView).toContain("downloads-file-icon");
    expect(publicView).toContain("downloads-file-size");
    expect(publicView).toContain("Weitere laden");
    expect(publicView).toContain("DOWNLOAD_PAGE_SIZE");
  });

  it("exposes administration only through an admin tab and admin-authenticated routes", () => {
    expect(page).toContain('id="admin-tab-downloads"');
    expect(page).toContain('<AdminDownloads accessToken={session?.access_token ?? ""} />');
    expect(adminView).toContain("Neue Kategorie");
    expect(adminView).toContain("Dokument hochladen");
    expect(adminView).toContain("Dokument bearbeiten");
    expect(categoryRoute).toContain("authenticateAdminRequest");
    expect(documentRoute).toContain("authenticateAdminRequest");
  });

  it("requires authentication for listing and downloading and keeps Storage server-side", () => {
    expect(publicRoute).toContain("authenticateSupabaseRequest");
    expect(downloadRoute).toContain("authenticateSupabaseRequest");
    expect(downloadRoute).toContain("DOWNLOAD_BUCKET");
    expect(publicView).toContain("Authorization: `Bearer ${accessToken}`");
    expect(publicView).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("validates upload bytes and cleans up storage when metadata creation fails", () => {
    expect(documentRoute).toContain("validateAttachmentBytes");
    expect(documentRoute).toContain("content_sha256: validated.sha256");
    expect(documentRoute).toMatch(/if \(error \|\| !data\)[\s\S]*?\.remove\(\[uploadedPath\]\)/u);
    expect(documentRoute).toContain("backupBytes");
  });
});
