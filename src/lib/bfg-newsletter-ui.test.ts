import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const page = readFileSync(fileURLToPath(new URL("../app/page.tsx", import.meta.url)), "utf8");
const dashboard = readFileSync(fileURLToPath(new URL("../components/dashboard-view.tsx", import.meta.url)), "utf8");
const view = readFileSync(fileURLToPath(new URL("../components/bfg-newsletter-view.tsx", import.meta.url)), "utf8");
const admin = readFileSync(fileURLToPath(new URL("../components/admin-bfg-newsletters.tsx", import.meta.url)), "utf8");
const css = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");

describe("BFG newsletter UI", () => {
  it("adds the named section to expanded, collapsed and dashboard navigation", () => {
    expect(page).toContain('appView === "bfg-newsletters"');
    expect(page).toContain("openBfgNewslettersView");
    expect(page).toMatch(/className=\{`sidebar-view-button[\s\S]*?BFG Newsletter\s*<\/button>/u);
    expect(page).toContain('title="BFG Newsletter"');
    expect(page).toContain('aria-label="BFG Newsletter"');
    expect(dashboard).toContain('{ label: "BFG Newsletter"');
    expect(dashboard).toContain('target: "bfg-newsletters"');
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
    expect(page).toContain('id="admin-tab-bfg-newsletters"');
    expect(page).toContain("<AdminBfgNewsletters");
    expect(admin).toContain('fetch("/api/admin/bfg-newsletters"');
    expect(admin).toContain('type="date"');
    expect(admin).toContain('placeholder="Text oder Markdown eingeben …"');
    expect(admin).toContain("keine Datei- oder Bildanhänge");
    expect(admin).toContain("Soft-löschen");
  });
});
