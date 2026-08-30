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

  it("keeps the latest conversation in the hero and renders news states with explicit Stichtag", () => {
    expect(view).toContain("const latestConversation = conversations[0]");
    expect(view).toContain("onOpenConversation(latestConversation.id)");
    expect(view).toContain('title="Neu bei findog.at"');
    expect(view).toContain('title="Recht aktuell"');
    expect(view).toContain("Vorübergehend nicht verfügbar");
    expect(view).toContain("Derzeit keine Meldungen");
    expect(view).toContain("<dt>Stichtag</dt>");
    expect(view).toContain("Amtliche Quelle");
    expect(view.match(/formatTimestamp\(item\.publishedAt\)/gu)).toHaveLength(1);
  });

  it("uses the dedicated casual Fred artwork in the dashboard hero", () => {
    const heroStart = view.indexOf('<header className="dashboard-hero">');
    const heroEnd = view.indexOf("</header>", heroStart);
    const hero = view.slice(heroStart, heroEnd);

    expect(hero).toContain('src="/fred_casual.png"');
    expect(hero).toContain("width={409}");
    expect(hero).toContain("height={614}");
    expect(hero).not.toContain('src="/fred.png"');
  });

  it("puts platform updates left of legal news and only applications below the news grid", () => {
    const heroIndex = view.indexOf('className="dashboard-hero"');
    const newsIndex = view.indexOf('className="dashboard-news-grid"');
    const productNewsIndex = view.indexOf('id="dashboard-product-news-title"', newsIndex);
    const legalNewsIndex = view.indexOf('id="dashboard-legal-news-title"', newsIndex);
    const applicationsIndex = view.indexOf('className="dashboard-section dashboard-quicklinks-section"');

    expect(heroIndex).toBeGreaterThan(-1);
    expect(newsIndex).toBeGreaterThan(heroIndex);
    expect(productNewsIndex).toBeGreaterThan(newsIndex);
    expect(legalNewsIndex).toBeGreaterThan(productNewsIndex);
    expect(applicationsIndex).toBeGreaterThan(legalNewsIndex);
    expect(view).not.toContain('className="dashboard-overview"');
    expect(view).not.toContain('className="dashboard-main-grid"');
    expect(view).not.toContain("Zuletzt verwendet");
    expect(view).not.toContain("Ihre Übersicht");

    expect(view).toContain("is-featured");
    expect(view).toContain("is-secondary");
    expect(css).toContain(".dashboard-news-card.is-featured");
    expect(css).toContain(".dashboard-news-card.is-secondary");
  });

  it("keeps news and enlarged application icons responsive with focus and reduced motion", () => {
    expect(css).toContain("width: min(100%, 1280px)");
    expect(css).toMatch(/\.dashboard-quicklink-groups \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/u);
    expect(css).toMatch(/\.dashboard-quicklink-icon \{[\s\S]*?width: 46px;[\s\S]*?height: 46px;/u);
    expect(css).toMatch(/\.dashboard-quicklink-icon \.dashboard-icon \{\s*width: 24px;\s*height: 24px;/u);
    expect(css).toMatch(/@media \(max-width: 960px\)[\s\S]*?\.dashboard-news-grid \{\s*grid-template-columns: 1fr;/u);
    expect(css).toMatch(/@media \(max-width: 700px\)[\s\S]*?\.dashboard-quicklink-groups \{\s*grid-template-columns: 1fr;/u);
    expect(css).toMatch(/@media \(max-width: 560px\)[\s\S]*?\.dashboard-quicklink-icon \.dashboard-icon \{\s*width: 22px;\s*height: 22px;/u);
    expect(css).toContain(".dashboard-quicklink-grid button:focus-visible");
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
