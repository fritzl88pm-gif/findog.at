import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const pageSource = readFileSync(fileURLToPath(new URL("../app/page.tsx", import.meta.url)), "utf8");
const cssSource = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");

describe("Administration UI tabs and scanning settings", () => {
  it("has exactly two ARIA tab elements for Scanning and Benutzer (no BFG PRO tab)", () => {
    const tabMatches = pageSource.match(/role="tab"/gu);
    expect(tabMatches).toHaveLength(2);
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
