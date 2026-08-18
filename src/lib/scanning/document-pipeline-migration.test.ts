import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL(
    "../../../supabase/migrations/20260818100000_scanning_document_pipeline.sql",
    import.meta.url,
  )),
  "utf8",
);

describe("scanning document pipeline migration", () => {
  it("adds the document pipeline as an additive column with the existing default", () => {
    expect(migration).toMatch(
      /alter table public\.scanning_settings\s+add column document_pipeline text not null default 'mineru_with_openrouter_fallback'/i,
    );
  });

  it("allows exactly the two supported pipelines", () => {
    expect(migration).toMatch(
      /document_pipeline in \('mineru_with_openrouter_fallback', 'openrouter_only'\)/i,
    );
  });

  it("preserves existing rows without rewriting them", () => {
    expect(migration).not.toMatch(/update public\.scanning_settings/i);
    expect(migration).not.toMatch(/delete from public\.scanning_settings/i);
    expect(migration).not.toMatch(/truncate( table)? public\.scanning_settings/i);
    expect(migration).not.toMatch(/drop column/i);
    expect(migration).not.toMatch(/rename column/i);
  });
});
