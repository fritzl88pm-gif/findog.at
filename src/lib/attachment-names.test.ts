import { describe, expect, it } from "vitest";

import { ellipsizeFilename } from "./attachment-names";

describe("ellipsizeFilename", () => {
  it("keeps short filenames unchanged", () => {
    expect(ellipsizeFilename("Bescheid.pdf")).toBe("Bescheid.pdf");
  });

  it("shortens long filenames in the middle while keeping the extension visible", () => {
    const name = "Einkommensteuerbescheid_mit_extrem_langem_Dateinamen_und_Aktenzeichen_2024.pdf";

    const displayName = ellipsizeFilename(name, 42);

    expect(displayName).toContain("...");
    expect(displayName).toMatch(/^Einkommensteuer/);
    expect(displayName).toMatch(/2024\.pdf$/);
    expect(displayName.length).toBeLessThan(name.length);
  });
});
