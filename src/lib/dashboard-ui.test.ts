import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const page = readFileSync(fileURLToPath(new URL("../app/page.tsx", import.meta.url)), "utf8");
const view = readFileSync(fileURLToPath(new URL("../components/dashboard-view.tsx", import.meta.url)), "utf8");
const admin = readFileSync(fileURLToPath(new URL("../components/admin-dashboard-news.tsx", import.meta.url)), "utf8");
const css = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");

describe("logged-in dashboard UI", () => {
  it("lands on home after initialization and every fresh authenticated landing", () => {
    expect(page).toContain('type AppView = "home" | "chat"');
    expect(page).toContain('useState<AppView>("home")');
    expect(page).toMatch(/if \(isFreshAuthenticatedLanding\) \{[\s\S]*?setAppView\("home"\)[\s\S]*?setFredConversationId\(""\)/u);
    expect(page).toContain('appView === "home" ? (');
    expect(page).toContain("<DashboardView");
  });

  it("keeps brand, sidebar and rail navigation client-side while new chat opens Fred", () => {
    expect(page).toContain('aria-label="findog.at Startseite"');
    expect(page).toContain("event.preventDefault()");
    expect(page).toContain("openHomeView();");
    expect(page.match(/aria-label="Startseite"/gu)).toHaveLength(1);
    expect(page).toMatch(/onClick=\{openHomeView\}[\s\S]*?>[\s\S]*?Startseite\s*<\/button>/u);
    expect(page).toContain("function startNewManagedConversation()");
    expect(page).toMatch(/function startNewManagedConversation\(\) \{\s*openFredView\(\);/u);
  });

  it("renders all planned quicklinks and keeps Quiz and Administration permission-filtered", () => {
    for (const label of [
      "Fred", "BFG Suche", "BFG Suche PRO", "Daten", "Scanning", "Textbausteine",
      "Formulare", "Downloads", "Deutsche SV Rente", "L17b Währungsrechner", "Quiz", "Fredrun",
      "Administration",
    ]) expect(view).toContain(`label: "${label}"`);
    expect(view.match(/adminOnly: true/gu)).toHaveLength(2);
    expect(view).toContain("!link.adminOnly || isAdmin");
  });

  it("shows three recent conversations, per-section states, source metadata and explicit Stichtag", () => {
    expect(view).toContain("conversations.slice(0, 3)");
    expect(view).toContain('conversation.origin === "telegram" ? "Telegram" : "Web"');
    expect(view).toContain('title="Neu bei findog.at"');
    expect(view).toContain('title="Recht aktuell"');
    expect(view).toContain("Vorübergehend nicht verfügbar");
    expect(view).toContain("Derzeit keine Meldungen");
    expect(view).toContain("<dt>Stichtag</dt>");
    expect(view).toContain("Amtliche Quelle");
  });

  it("provides single-column mobile layouts, focus states and reduced motion", () => {
    expect(css).toContain("width: min(100%, 1280px)");
    expect(css).toMatch(/@media \(max-width: 560px\)[\s\S]*?\.dashboard-stat-grid \{\s*grid-template-columns: 1fr;/u);
    expect(css).toMatch(/@media \(max-width: 960px\)[\s\S]*?\.dashboard-main-grid,[\s\S]*?\.dashboard-news-grid \{\s*grid-template-columns: 1fr;/u);
    expect(css).toContain(".dashboard-stat-card:focus-visible");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.dashboard-skeleton-card/u);
  });

  it("adds the protected news editor with all legal provenance fields and lifecycle actions", () => {
    expect(page).toContain('id="admin-tab-dashboard-news"');
    expect(page).toContain("<AdminDashboardNews");
    expect(admin).toContain('fetch("/api/admin/dashboard-news"');
    expect(admin).toContain("Amtliche Kennung");
    expect(admin).toContain("HTTPS-Quellenlink");
    expect(admin).toContain("Rechtlicher Stichtag");
    expect(admin).toContain("Veröffentlichen");
    expect(admin).toContain("Archivieren");
    expect(admin).toContain("Soft-löschen");
  });
});
