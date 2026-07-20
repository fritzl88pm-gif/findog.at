import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const pageSource = readFileSync(fileURLToPath(new URL("../app/page.tsx", import.meta.url)), "utf8");
const viewSource = readFileSync(
  fileURLToPath(new URL("../components/knowledge-landscape-view.tsx", import.meta.url)),
  "utf8",
);
const cssSource = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");
const routeSource = readFileSync(
  fileURLToPath(new URL("../app/api/weknora-data/route.ts", import.meta.url)),
  "utf8",
);

describe("knowledge landscape UI integration", () => {
  it("adds Daten to expanded and collapsed navigation outside the admin gates", () => {
    expect(pageSource).toMatch(/type AppView = [^;]*\| "data";/u);
    expect(pageSource.match(/onClick=\{openDataView\}/gu)).toHaveLength(2);
    expect(pageSource).toMatch(/<nav className="forms-navigation"[\s\S]*?onClick=\{openDataView\}[\s\S]*?\{isAdmin \? \(/u);
    expect(pageSource).toMatch(/<div className="rail-content">[\s\S]*?onClick=\{openDataView\}[\s\S]*?title="Daten"[\s\S]*?aria-label="Daten"[\s\S]*?\{isAdmin \? \(/u);
    expect(pageSource).toContain('appView === "data"');
    expect(pageSource).toContain('<KnowledgeLandscapeView accessToken={session?.access_token ?? ""} />');
  });

  it("fetches once per mount and exposes the requested German dashboard structure", () => {
    expect(viewSource).toContain('fetch("/api/weknora-data"');
    expect(viewSource).toContain('Authorization: `Bearer ${accessToken}`');
    expect(viewSource).not.toContain("setInterval");
    expect(viewSource).not.toContain("force-refresh");
    for (const copy of [
      "Transparenz",
      "Wissenslandschaft",
      "Datenstand",
      "Wissensbasen",
      "Inhalte",
      "Dokumente",
      "FAQ-Einträge",
      "Wissensmix",
      "Dokumentwissen",
      "Strukturiertes Wissen",
    ]) {
      expect(viewSource).toContain(copy);
    }
    expect(viewSource).toContain('role="img"');
    expect(viewSource).toContain('aria-label={`Dokumente:');
    expect(viewSource).toContain("knowledge-landscape-skeleton");
    expect(viewSource).toContain("knowledge-landscape-error");
    expect(viewSource).toContain("knowledge-landscape-stale");
    expect(viewSource).toContain("Keine Wissensquellen verfügbar");
  });

  it("keeps the route read-only and defines responsive cards and stacked knowledge groups", () => {
    expect(routeSource).toContain("export async function GET");
    expect(routeSource).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/u);
    expect(cssSource).toMatch(/\.knowledge-landscape-stats\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4/u);
    expect(cssSource).toMatch(/@media \(max-width: 900px\)[\s\S]*?\.knowledge-landscape-stats[\s\S]*?repeat\(2/u);
    expect(cssSource).toMatch(/@media \(max-width: 560px\)[\s\S]*?\.knowledge-landscape-stats[\s\S]*?1fr/u);
    expect(cssSource).toMatch(/\.knowledge-landscape-groups\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2/u);
    expect(cssSource).toMatch(/@media \(max-width: 900px\)[\s\S]*?\.knowledge-landscape-groups[\s\S]*?1fr/u);
    expect(cssSource).not.toMatch(/\.knowledge-landscape[^{}]*\{[^}]*overflow-x:\s*auto/gu);
  });
});
