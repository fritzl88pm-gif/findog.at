import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const page = read("../app/page.tsx");
const header = read("../components/app-header-bar.tsx");
const launcher = read("../components/tools-launcher.tsx");
const chatView = read("../components/fred-native-chat-view.tsx");
const newsSection = read("../components/news-section.tsx");
const newsView = read("../components/news-view.tsx");
const newsHook = read("./use-platform-news.ts");
const admin = read("../components/admin-dashboard-news.tsx");
const css = read("../app/globals.css");

describe("chat-first home", () => {
  it("lands in the Fred chat after initialization and every fresh authenticated landing", () => {
    expect(page).toContain('type AppView = "chat" | "news"');
    expect(page).toContain('useState<AppView>("chat")');
    expect(page).not.toContain('"home"');
    expect(page).toMatch(/if \(isFreshAuthenticatedLanding\) \{[\s\S]*?setAppView\("chat"\)[\s\S]*?setFredConversationId\(""\)/u);
  });

  it("no longer ships the dashboard start page", () => {
    expect(page).not.toContain("DashboardView");
    expect(page).not.toContain("openDashboardApp");
    expect(page).not.toContain("openHomeView");
    expect(css).not.toContain(".dashboard-hero");
    expect(css).not.toContain(".dashboard-quicklink");
  });

  it("starts a new Fred conversation from the logo without a full page navigation", () => {
    expect(page).toContain('aria-label="findog.at Startseite"');
    expect(page).toMatch(
      /className="sidebar-brand"[\s\S]*?onClick=\{\(event\) => \{\s*event\.preventDefault\(\);\s*startNewManagedConversation\(\);/u,
    );
    expect(page).toMatch(/function startNewManagedConversation\(\) \{\s*openFredView\(\);/u);
  });
});

describe("header bar", () => {
  it("renders Neuigkeiten, Werkzeuge and Konto in this order on every view", () => {
    expect(header.indexOf('aria-label="Neuigkeiten"')).toBeGreaterThan(-1);
    expect(header.indexOf("<ToolsLauncher")).toBeGreaterThan(header.indexOf('aria-label="Neuigkeiten"'));
    expect(header.indexOf("<AccountMenu")).toBeGreaterThan(header.indexOf("<ToolsLauncher"));
    expect(launcher).toContain('aria-label="Werkzeuge"');
    expect(launcher).toContain("aria-expanded={isOpen}");
    expect(header).toContain('aria-label="Konto"');
    // Rendered once, outside the per-view conditional, so it shows on every view.
    expect(page.match(/<AppHeaderBar/gu)).toHaveLength(1);
    expect(page.indexOf("<AppHeaderBar")).toBeLessThan(page.indexOf('appView === "news" ? ('));
  });

  it("keeps the sidebar toggle on the left on mobile and hides sidebar-only chrome", () => {
    expect(page).toContain('className="mobile-menu-toggle"');
    for (const removed of ["Anwendungsbereiche", "sidebar-footer", "Angemeldet als", "sidebar-signout-btn"]) {
      expect(page).not.toContain(removed);
    }
  });

  it("offers Einstellungen, Administration (admin only) and Abmelden in the account menu", () => {
    expect(header).toContain("Angemeldet als");
    expect(header).toContain("Einstellungen");
    expect(header).toMatch(/\{isAdmin \? \(\s*<button[\s\S]*?Administration/u);
    expect(header).toContain("disabled={isSigningOut}");
    expect(page).toContain("accountTriggerRef={settingsTriggerRef}");
    expect(page).toContain("isSigningOut={isAuthSubmitting}");
    expect(page).toContain("onOpenSettings={openSettingsDialog}");
  });

  it("closes both popovers on outside click and Escape", () => {
    for (const source of [header, launcher]) {
      expect(source).toContain('addEventListener("pointerdown"');
      expect(source).toContain('event.key !== "Escape"');
    }
  });

  it("aligns launcher columns and lets the panel span the viewport on mobile", () => {
    expect(css).toMatch(/\.tools-launcher-grid \{[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/u);
    expect(css).toMatch(/@media \(max-width: 700px\)[\s\S]*?\.tools-launcher-panel \{[\s\S]*?left: 10px;[\s\S]*?right: 10px;/u);
    expect(css).toMatch(/\.tools-launcher-admin-badge \{[\s\S]*?position: absolute;/u);
    expect(css).toMatch(/\.app-header-news-dot \{[\s\S]*?var\(--accent-yellow\)/u);
  });
});

describe("tools discoverability", () => {
  it("shows the visible label \"Werkzeuge\" next to the 9-dot icon and keeps the popover semantics", () => {
    expect(launcher).toContain('<span className="app-header-button-label">Werkzeuge</span>');
    expect(launcher).toContain('aria-label="Werkzeuge"');
    expect(launcher).toContain("aria-expanded={isOpen}");
    expect(launcher).toContain('aria-haspopup="dialog"');
    // The label is not hidden on mobile.
    expect(css).toMatch(/\.app-header-labeled-button \{[\s\S]*?white-space: nowrap;/u);
    expect(css).not.toMatch(/\.app-header-button-label \{[^}]*display: none/u);
  });




  it("does not bring back the sidebar Anwendungsbereiche", () => {
    expect(page).not.toContain("Anwendungsbereiche");
  });
});

describe("Neuigkeiten view", () => {
  it("shows the platform updates with the heading and subtitle from the old dashboard", () => {
    expect(newsView).toContain('title="Neuigkeiten"');
    expect(newsView).toContain('subtitle="Neuigkeiten und Hinweise zur Plattform"');
    expect(newsHook).toContain('fetch("/api/dashboard"');
    expect(newsHook).toContain("payload?.news.product");
    expect(page).toContain('appView === "news" ? (');
    expect(page).toContain("<NewsView");
  });

  it("renders every news state through the shared NewsSection", () => {
    expect(newsView).toContain("<NewsSection");
    expect(newsSection).toContain("Vorübergehend nicht verfügbar");
    expect(newsSection).toContain("Derzeit keine Meldungen");
    expect(newsSection).toContain("Plattformupdate");
    expect(newsSection.match(/formatTimestamp\(item\.publishedAt\)/gu)).toHaveLength(1);
    expect(newsSection).not.toContain("<dt>Stichtag</dt>");
    expect(css).toContain(".dashboard-news-card.is-featured");
    expect(css).toContain(".dashboard-news-card.is-secondary");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.dashboard-skeleton-card/u);
  });

  it("lights the unread dot from the persisted last-seen time and clears it when the view opens", () => {
    expect(page).toContain("NEWS_LAST_SEEN_STORAGE_KEY");
    expect(page).toContain("hasUnreadNews(newsItems, newsLastSeenAt)");
    expect(page).toContain("nextNewsLastSeen(newsItems, Date.now())");
    expect(page).toContain("hasUnreadNews={hasUnseenNews}");
  });

  it("keeps the protected platform update editor and lifecycle actions", () => {
    expect(page).toContain('adminTab === "dashboard-news" ? (');
    expect(page).toContain("<AdminDashboardNews");
    expect(admin).toContain('fetch("/api/admin/dashboard-news"');
    expect(admin).not.toContain("Amtliche Kennung");
    expect(admin).not.toContain("HTTPS-Quellenlink");
    expect(admin).not.toContain("Rechtlicher Stichtag");
    expect(admin).toContain("Veröffentlichen");
    expect(admin).toContain("Archivieren");
    expect(admin).toContain("Soft-löschen");
  });
});
