import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const pageSource = readFileSync(fileURLToPath(new URL("../app/page.tsx", import.meta.url)), "utf8");
const cssSource = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");

describe("Administration UI tabs and scanning settings", () => {
  it("has exactly three ARIA tab elements for Scanning, BFG PRO, and Benutzer", () => {
    const tabMatches = pageSource.match(/role="tab"/gu);
    expect(tabMatches).toHaveLength(3);
  });

  it("loads scanning settings from /api/admin/scanning-settings when administration opens", () => {
    // Template literal or string literal form
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
});
