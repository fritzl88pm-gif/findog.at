import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("approved release surface", () => {
  const pagePath = fileURLToPath(new URL("../app/page.tsx", import.meta.url));
  const globalsPath = fileURLToPath(new URL("../app/globals.css", import.meta.url));
  const layoutPath = fileURLToPath(new URL("../app/layout.tsx", import.meta.url));
  const faviconPath = fileURLToPath(new URL("../../public/favicon.png", import.meta.url));
  const bfgIllustrationPath = fileURLToPath(new URL("../../public/fred-bfg-search.png", import.meta.url));
  const pageSource = readFileSync(pagePath, "utf8");
  const globalsSource = readFileSync(globalsPath, "utf8");
  const layoutSource = readFileSync(layoutPath, "utf8");

  it("labels the standalone BFG view as BFG Suche in expanded and collapsed navigation", () => {
    expect(pageSource).toMatch(/className={`sidebar-view-button[\s\S]*?<\/svg>\s*BFG Suche\s*<\/button>/);
    expect(pageSource).toContain('title="BFG Suche"');
    expect(pageSource).toContain('aria-label="BFG Suche"');
    expect(pageSource).toContain('<h1 id="bfg-decisions-view-title">BFG-Entscheidungen</h1>');
    expect(pageSource).toContain('appView === "bfg-decisions"');
    expect(pageSource).toContain('/api/findok/bfg');
  });

  it("registers the supplied favicon and preserves the approved metadata copy", () => {
    expect(layoutSource).toContain('title: "Findog/Fred"');
    expect(layoutSource).toContain(
      'description: "KI-Assistent fuer oesterreichisches Steuerrecht mit Fachdatenbank-Recherche."',
    );
    expect(layoutSource).toMatch(/icons:\s*\{\s*icon:\s*"\/favicon\.png",?\s*\}/);
    expect(createHash("sha256").update(readFileSync(faviconPath)).digest("hex")).toBe(
      "44239860c1028844639dff3d1cbf02f42c5b26e8f285e6e1572d002f40105395",
    );
  });

  it("shows the supplied decorative illustration beside the exact BFG introduction", () => {
    expect(pageSource).toContain(
      "Durchsuche veröffentlichte Entscheidungen des Bundesfinanzgerichts in der Findok-Suche über das Suchfeld.",
    );
    expect(pageSource).toMatch(
      /<header className="forms-view-header bfg-view-header">[\s\S]*?<Image[\s\S]*?src="\/fred-bfg-search\.png"[\s\S]*?alt=""[\s\S]*?<\/header>/,
    );
    expect(pageSource).toMatch(/src="\/fred-bfg-search\.png"[\s\S]*?unoptimized/);
    expect(createHash("sha256").update(readFileSync(bfgIllustrationPath)).digest("hex")).toBe(
      "923769557c8c9e90c9f49055c1dc070886e4cf177778e940ca8cab6f04d6adae",
    );
  });

  it("keeps the BFG header illustration responsive without horizontal overflow", () => {
    expect(globalsSource).toMatch(
      /\.bfg-view-header \{[\s\S]*?display: grid;[\s\S]*?grid-template-columns: minmax\(0, 1fr\) minmax\(160px, 240px\);[\s\S]*?\}/,
    );
    expect(globalsSource).toMatch(
      /\.bfg-view-header-illustration \{[\s\S]*?width: 100%;[\s\S]*?max-width: 240px;[\s\S]*?height: auto;[\s\S]*?\}/,
    );
    expect(globalsSource).toMatch(
      /@media \(max-width: 640px\) \{[\s\S]*?\.bfg-view-header \{[\s\S]*?grid-template-columns: 1fr;[\s\S]*?\}/,
    );
  });

  it("offers the approved compact BFG sort and collapsible facet controls", () => {
    expect(pageSource).toContain('aria-label="Sortierung"');
    expect(pageSource).toContain("Genehmigungsdatum absteigend");
    expect(pageSource).toContain("Genehmigungsdatum aufsteigend");
    expect(pageSource).toContain("In Findok seit absteigend");
    expect(pageSource).toContain("In Findok seit aufsteigend");
    expect(pageSource).toContain("Geschäftszahl");
    expect(pageSource).toContain('aria-expanded={isBfgFilterPanelOpen}');
    expect(pageSource).toContain("Materie");
    expect(pageSource).toContain("Dokumenttyp");
    expect(pageSource).toContain("Norm");
    expect(pageSource).toContain("Zeitraum");
    expect(pageSource).toContain("Mit Rechtssatz");
    expect(pageSource).toContain("Anwenden");
    expect(pageSource).toContain("Zurücksetzen");
    expect(pageSource).toContain('parameters.set("sort", controls.sort)');
    expect(pageSource).toContain("bfgAppliedFilters");
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

  it("shows decorative link and red PDF icons in the BFG result actions", () => {
    expect(pageSource).toMatch(
      /<svg className="bfg-result-link-icon" aria-hidden="true"[\s\S]*?<\/svg>\s*Entscheidung öffnen/,
    );
    expect(pageSource).toMatch(
      /<svg className="bfg-result-link-icon bfg-result-pdf-icon" aria-hidden="true"[\s\S]*?<\/svg>\s*PDF öffnen/,
    );
    expect(globalsSource).toMatch(
      /\.bfg-result-links a \{[\s\S]*?display: inline-flex;[\s\S]*?align-items: center;[\s\S]*?gap:/,
    );
    expect(globalsSource).toMatch(/\.bfg-result-pdf-icon \{[\s\S]*?color: var\(--danger\);/);
  });
});
