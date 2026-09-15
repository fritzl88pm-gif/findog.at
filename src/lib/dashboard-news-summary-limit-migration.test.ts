import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL("../../supabase/migrations/20260915180000_expand_dashboard_news_summary_limit.sql", import.meta.url)),
  "utf8",
).toLowerCase();

describe("dashboard news summary limit migration", () => {
  it("widens the stored summary and keeps the length check in sync", () => {
    expect(migration).toContain("alter column summary type varchar(2000)");
    expect(migration).toContain("drop constraint if exists dashboard_news_items_summary_check");
    expect(migration).toMatch(
      /add constraint dashboard_news_items_summary_check\s+check \(length\(btrim\(summary\)\) between 1 and 2000\)/s,
    );
  });

  it("does not touch the title, the legal provenance fields or the audit contract", () => {
    expect(migration).not.toContain("title");
    expect(migration).not.toContain("source_url");
    expect(migration).not.toContain("dashboard_news_audit");
  });
});
