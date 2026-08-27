import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const pageSource = readFileSync(fileURLToPath(new URL("../app/page.tsx", import.meta.url)), "utf8");
const componentSource = readFileSync(
  fileURLToPath(new URL("./admin-openrouter-usage.tsx", import.meta.url)),
  "utf8",
);
const cssSource = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");

describe("Admin OpenRouter-Nutzung UI", () => {
  it("renders a dedicated keyboard-navigable top-level OpenRouter admin tab in page.tsx", () => {
    expect(pageSource).toContain('id="admin-tab-openrouter"');
    expect(pageSource).toContain('aria-controls="admin-panel-openrouter"');
    expect(pageSource).toContain('onClick={() => setAdminTab("openrouter")}');
    expect(pageSource).toContain('onKeyDown={(e) => handleAdminTabKeyDown(e, "openrouter")}');
    expect(pageSource).toContain("OpenRouter-Nutzung");
    expect(pageSource).toMatch(/ADMIN_TAB_IDS\s*=\s*\[[^\]]*"openrouter"[^\]]*\]/u);
    expect(pageSource).not.toContain('id="admin-tab-omniroute"');
  });

  it("mounts the standalone component only inside its selected openrouter tabpanel", () => {
    expect(pageSource).toContain('adminTab === "openrouter" ? (');
    expect(pageSource).toContain('<AdminOpenRouterUsage accessToken={session?.access_token ?? ""');
    expect(componentSource).toContain('id="admin-panel-openrouter"');
    expect(componentSource).toContain('aria-labelledby="admin-tab-openrouter"');
    expect(componentSource).not.toContain("AdminScanning");
    expect(componentSource).not.toContain("AdminOmniRouteUsage");
  });

  it("authorizes only with the Supabase access token and supports range and refresh controls", () => {
    expect(componentSource).toContain('Authorization: `Bearer ${accessToken}`');
    expect(componentSource).toContain("/api/admin/openrouter-usage");
    expect(componentSource).toContain('id="admin-omniroute-range"');
    expect(componentSource).toContain('<label htmlFor="admin-omniroute-range">Zeitraum</label>');
    for (const label of ["Heute (24 Stunden)", "7 Tage", "30 Tage"]) {
      expect(componentSource).toContain(label);
    }
    expect(componentSource).toMatch(/refresh\s*\?\s*"&refresh=1"\s*:\s*""/u);
    expect(componentSource).toContain('"Aktualisieren"');
    expect(componentSource).toContain("new AbortController()");
    expect(componentSource).toContain('|| !("credits" in payload)');
    expect(componentSource).toContain('|| !("fredUsers" in payload)');
  });

  it("renders loading, error, stale, empty states and all required German section headers and metric labels", () => {
    for (const label of [
      "OpenRouter-Nutzung",
      "Kosten, Modelle, API-Keys und Fred-Nutzung",
      "Guthaben",
      "Gekaufte Credits (USD)",
      "Verbrauch gesamt (USD)",
      "Verbleibend (USD)",
      "Verbrauch im gewählten Zeitraum (USD)",
      "Nutzung im Zeitraum",
      "OpenRouter-Aufrufe",
      "Eingabe-Tokens",
      "Ausgabe-Tokens",
      "Reasoning-Tokens",
      "Tokens gesamt",
      "Cache-Tokens",
      "Durchschnittliche Latenz",
      "p90-Latenz",
      "Kosten (USD)",
      "Modelle und Provider",
      "API-Key-Nutzung",
      "Zeitverlauf",
      "Fred-Nutzung nach User",
      "User (E-Mail)",
      "Fred-Fragen (exakt)",
      "Anteil an Fred-Fragen",
      "Kostenanteil (Schätzung)",
      "Letzte Frage",
      "Zuletzt aktualisiert",
      "Veraltete Daten:",
    ]) {
      expect(componentSource).toContain(label);
    }
    expect(componentSource).toContain('className="error-box" role="alert"');
    expect(componentSource).toContain('role="status"');
    expect(componentSource).toContain("Keine OpenRouter-Daten verfügbar.");
    expect(componentSource).toContain("OpenRouter-Daten werden geladen …");
  });

  it("contains the exact required disclaimer explaining user cost estimation formula", () => {
    expect(componentSource).toContain(
      "Anfragen sind exakt. Der Kostenanteil wird proportional aus den Kosten des gemeinsamen OpenRouter-Keys „WeKnora“ geschätzt; OpenRouter erhält derzeit keine Findog-User-ID.",
    );
    expect(componentSource).toContain("System / nicht zugeordnet");
  });

  it("uses accessible progress semantics, semantic tables and responsive dark styling", () => {
    expect(componentSource).toContain('role="progressbar"');
    expect(componentSource).toContain("aria-valuemin={0}");
    expect(componentSource).toContain("aria-valuemax={100}");
    expect(componentSource).toContain("aria-valuenow={progressValue");
    expect(componentSource).toMatch(/<table>/u);
    expect(componentSource).toContain("<caption>Nutzung nach Modell und Provider</caption>");
    expect(componentSource).toContain("<caption>Nutzung nach OpenRouter-API-Key</caption>");
    expect(componentSource).toContain("<caption>Zeitverlauf im ausgewählten Zeitraum</caption>");
    expect(componentSource).toContain("<caption>Fred-Anfragen und geschätzter Kostenanteil pro User</caption>");
    expect(cssSource).toContain(".admin-omniroute-panel");
    expect(cssSource).toContain(".admin-omniroute-card");
    expect(cssSource).toContain("@media (max-width: 700px)");
  });
});
