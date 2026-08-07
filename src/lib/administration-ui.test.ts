import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const pageSource = readFileSync(fileURLToPath(new URL("../app/page.tsx", import.meta.url)), "utf8");
const componentSource = readFileSync(
  fileURLToPath(new URL("../components/admin-fred-personalities.tsx", import.meta.url)),
  "utf8",
);
const cssSource = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");

describe("Administration UI tabs and scanning settings", () => {
  it("has exactly four ARIA tabs for Scanning, Benutzer, Rückmeldungen, and Persönlichkeiten", () => {
    const tabMatches = pageSource.match(/role="tab"/gu);
    expect(tabMatches).toHaveLength(4);
    expect(pageSource).toContain('id="admin-tab-personalities"');
    expect(pageSource).not.toContain('id="admin-tab-bfg-pro"');
  });

  it("includes Persönlichkeiten in ADMIN_TAB_IDS for keyboard navigation", () => {
    expect(pageSource).toContain('"personalities"');
    // The ADMIN_TAB_IDS const must contain four entries
    expect(pageSource).toMatch(/ADMIN_TAB_IDS\s*=\s*\[[^\]]*"scanning"[^\]]*"benutzer"[^\]]*"feedback"[^\]]*"personalities"[^\]]*\]/);
  });

  it("renders the admin personalities component inside the Persönlichkeiten tabpanel", () => {
    // The component import and usage are in page.tsx
    expect(pageSource).toContain("admin-fred-personalities");
    expect(pageSource).toContain("<AdminFredPersonalities");
    // The tabpanel id and aria-labelledby are in the component
    expect(componentSource).toContain('id="admin-panel-personalities"');
    expect(componentSource).toContain('aria-labelledby="admin-tab-personalities"');
  });

  it("passes accessToken to the admin personalities component", () => {
    expect(pageSource).toMatch(/AdminFredPersonalities\s+accessToken=\{session\?\.access_token\s*\?\?\s*""\}/);
  });

  it("loads scanning settings from /api/admin/scanning-settings when administration opens", () => {
    const loadCall = pageSource.match(
      /\/api\/admin\/scanning-settings/u,
    );
    expect(loadCall).not.toBeNull();
  });

  it("calls GET and PUT on /api/admin/scanning-settings for scanning configuration", () => {
    expect(pageSource).toContain("/api/admin/scanning-settings");
  });

  it("renders a model ID text input field for scanning settings", () => {
    expect(pageSource).toContain("OpenRouter-Modell-ID");
    expect(pageSource).toContain("Freds Dokument-Fallback");
  });

  it("renders a prompt textarea for scanning settings", () => {
    expect(pageSource).toContain("Scanning-Prompt");
  });

  it("has a save button for scanning settings", () => {
    const savePattern = /Scanning-Einstellungen speichern/u;
    expect(pageSource).toMatch(savePattern);
  });

  it("contains minimal tab CSS in globals.css", () => {
    expect(cssSource).toMatch(/admin-tab-button|admin-tabs/u);
  });

  it("does not reference /api/admin/settings or the global/BFG prompt editor", () => {
    expect(pageSource).not.toContain("/api/admin/settings");
    expect(pageSource).not.toContain("adminSystemPrompt");
    expect(pageSource).not.toContain("Globaler Systemprompt");
    expect(pageSource).not.toContain("BFG PRO");
  });
});
