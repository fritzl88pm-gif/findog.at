import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("approved release surface", () => {
  const pagePath = fileURLToPath(new URL("../app/page.tsx", import.meta.url));
  const pageSource = readFileSync(pagePath, "utf8");

  it("exposes the standalone BFG decisions view in expanded and collapsed navigation", () => {
    expect(pageSource.match(/BFG-Entscheidungen/g)?.length).toBeGreaterThanOrEqual(3);
    expect(pageSource).toContain('appView === "bfg-decisions"');
    expect(pageSource).toContain('/api/findok/bfg');
  });

  it("renders the expanded findog.at brand as a home link with a Beta tag", () => {
    expect(pageSource).toMatch(
      /<Link className="sidebar-brand" href="\/">[\s\S]*className="austria-flag"[\s\S]*findog\.at[\s\S]*Beta[\s\S]*<\/Link>/,
    );
  });

  it("keeps the client PDF fallback filename neutral", () => {
    expect(pageSource).toContain('?? "Antwort.pdf"');
    expect(pageSource).not.toContain("Findog_Antwort.pdf");
  });
});
