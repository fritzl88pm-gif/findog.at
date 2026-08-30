import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL(
  "./fred-research-display-settings.tsx",
  import.meta.url,
)), "utf8");

describe("FredResearchDisplaySettings", () => {
  it("renders only the accessible research display setting", () => {
    expect(source).toContain("FredResearchDisplaySettings");
    expect(source).toContain('id="fred-research-display-settings-title"');
    expect(source).toContain("Rechercheanzeige");
    expect(source).toContain("Einfach");
    expect(source).toContain("Erweitert");
    expect(source).not.toMatch(/preferredName|personality|Persönlichkeit|Fred personalisieren/u);
  });

  it("uses the new API and sends exactly researchDisplayMode", () => {
    expect(source).toContain('/api/account/settings/fred-research-display');
    expect(source).toContain("body: JSON.stringify({ researchDisplayMode })");
    expect(source).not.toContain("fred-personalization");
  });

  it("keeps loading, save, notice and abort handling", () => {
    expect(source).toContain('cache: "no-store"');
    expect(source).toContain("Authorization: `Bearer ${accessToken}`");
    expect(source).toContain("Rechercheanzeige gespeichert.");
    expect(source).toContain("controller.abort()");
    expect(source).toContain('role="alert"');
    expect(source).toContain('role="status"');
  });
});
