import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL(
    "../../../supabase/migrations/20260826100000_ocr_provider_selection.sql",
    import.meta.url,
  )),
  "utf8",
);

describe("OCR provider selection migration", () => {
  it("migrates existing document pipeline values to the Luna-only contract", () => {
    expect(migration).toMatch(/update public\.scanning_settings[\s\S]*mineru_with_openrouter_fallback[\s\S]*mineru_with_omniroute_luna_fallback/i);
    expect(migration).toMatch(/update public\.scanning_settings[\s\S]*openrouter_only[\s\S]*omniroute_luna_only/i);
  });

  it("allows exactly the two new document OCR pipeline values", () => {
    expect(migration).toMatch(/document_pipeline in \('mineru_with_omniroute_luna_fallback', 'omniroute_luna_only'\)/i);
    expect(migration).toMatch(/alter table public\.scanning_settings[\s\S]*alter column document_pipeline set default 'mineru_with_omniroute_luna_fallback'/i);
  });

  it("adds a non-null scanning_provider with default OmniRoute Luna and exact check", () => {
    expect(migration).toMatch(/add column scanning_provider text not null default 'omniroute_luna'/i);
    expect(migration).toMatch(/scanning_provider in \('omniroute_luna', 'openrouter'\)/i);
  });

  it("does not touch prompts, model IDs, Fred attachment mode or secrets", () => {
    expect(migration).not.toMatch(/prompt\s*=/i);
    expect(migration).not.toMatch(/model_id\s*=/i);
    expect(migration).not.toMatch(/fred_attachment_mode\s*=/i);
    expect(migration).not.toMatch(/api[_-]?key|omniroute_api_key|openrouter_api_key/i);
  });
});
