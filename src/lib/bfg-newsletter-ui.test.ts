import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { LAUNCHER_GROUPS } from "@/lib/tools-launcher";

const page = readFileSync(fileURLToPath(new URL("../app/page.tsx", import.meta.url)), "utf8");
const view = readFileSync(fileURLToPath(new URL("../components/bfg-newsletter-view.tsx", import.meta.url)), "utf8");
const admin = readFileSync(fileURLToPath(new URL("../components/admin-bfg-newsletters.tsx", import.meta.url)), "utf8");
const css = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");

const launcherTools = LAUNCHER_GROUPS.flatMap((group) => group.tools);

describe("BFG newsletter UI", () => {
  it("adds the named section to the Werkzeuge launcher", () => {
    expect(page).toContain('appView === "bfg-newsletters"');
    expect(page).toContain("openBfgNewslettersView");
    expect(page).toContain('case "bfg-newsletters": openBfgNewslettersView(); break;');
    expect(launcherTools).toContainEqual(expect.objectContaining({ id: "bfg-newsletters", label: "BFG Newsletter" }));
  });

  it("loads newsletters, renders their date and safe Markdown, and handles all states", () => {
    expect(view).toContain('fetch("/api/bfg-newsletters"');
    expect(view).toContain('<h1 id="bfg-newsletter-view-title">BFG Newsletter</h1>');
    expect(view).toContain('<time dateTime={item.publicationDate}>');
    expect(view).toContain('<RichAnswer content={item.contentMarkdown} showTableCopyActions={false} />');
    expect(view).toContain("Newsletter werden geladen");
    expect(view).toContain("Vorübergehend nicht verfügbar");
    expect(view).toContain("Noch keine Newsletter verfügbar");
    expect(css).toContain(".bfg-newsletter-entry");
  });

  it("adds an admin editor limited to date and text or Markdown", () => {
    expect(page).toContain('adminTab === "bfg-newsletters" ? (');
    expect(page).toContain("<AdminBfgNewsletters");
    expect(admin).toContain('fetch("/api/admin/bfg-newsletters"');
    expect(admin).toContain('type="date"');
    expect(admin).toContain('placeholder="Text oder Markdown eingeben …"');
    expect(admin).toContain("keine Datei- oder Bildanhänge");
    expect(admin).toContain("Soft-löschen");
  });
});
