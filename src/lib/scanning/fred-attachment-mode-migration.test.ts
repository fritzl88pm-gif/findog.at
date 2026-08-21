import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL(
    "../../../supabase/migrations/20260821100000_fred_attachment_mode.sql",
    import.meta.url,
  )),
  "utf8",
);

describe("Fred attachment mode migration", () => {
  it("adds the mode as an additive non-null column with the existing default", () => {
    expect(migration).toMatch(
      /alter table public\.scanning_settings\s+add column fred_attachment_mode text not null default 'findog_preprocess'/iu,
    );
  });

  it("allows exactly the two supported Fred attachment modes", () => {
    expect(migration).toMatch(
      /fred_attachment_mode in \('findog_preprocess', 'weknora_native'\)/iu,
    );
  });

  it("preserves existing rows without unrelated schema changes", () => {
    expect(migration).not.toMatch(/update public\.scanning_settings/iu);
    expect(migration).not.toMatch(/delete from public\.scanning_settings/iu);
    expect(migration).not.toMatch(/drop column/iu);
    expect(migration).not.toMatch(/rename column/iu);
  });
});
