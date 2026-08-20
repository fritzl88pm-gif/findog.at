import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const pageSource = readFileSync(fileURLToPath(new URL("../app/page.tsx", import.meta.url)), "utf8");
const componentSource = readFileSync(
  fileURLToPath(new URL("./admin-omniroute-usage.tsx", import.meta.url)),
  "utf8",
);
const cssSource = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");

describe("Admin Gemini & OmniRoute UI", () => {
  it("renders a dedicated keyboard-navigable top-level admin tab", () => {
    expect(pageSource).toContain('id="admin-tab-omniroute"');
    expect(pageSource).toContain('aria-controls="admin-panel-omniroute"');
    expect(pageSource).toContain('onClick={() => setAdminTab("omniroute")}');
    expect(pageSource).toContain('onKeyDown={(e) => handleAdminTabKeyDown(e, "omniroute")}');
    expect(pageSource).toContain("Gemini &amp; OmniRoute");
    expect(pageSource).toMatch(/ADMIN_TAB_IDS\s*=\s*\[[^\]]*"omniroute"[^\]]*\]/u);
  });

  it("mounts the standalone component only inside its selected tabpanel", () => {
    expect(pageSource).toContain('adminTab === "omniroute" ? (');
    expect(pageSource).toContain("<AdminOmniRouteUsage accessToken={session?.access_token ?? \"\"} />");
    expect(componentSource).toContain('id="admin-panel-omniroute"');
    expect(componentSource).toContain('aria-labelledby="admin-tab-omniroute"');
    expect(componentSource).not.toContain("AdminScanning");
  });

  it("authorizes only with the Supabase access token and supports range and refresh controls", () => {
    expect(componentSource).toContain('Authorization: `Bearer ${accessToken}`');
    expect(componentSource).toContain('id="admin-omniroute-range"');
    expect(componentSource).toContain('<label htmlFor="admin-omniroute-range">Zeitraum</label>');
    for (const label of ["Heute (24 Stunden)", "7 Tage", "30 Tage"]) {
      expect(componentSource).toContain(label);
    }
    expect(componentSource).toMatch(/refresh\s*\?\s*"&refresh=1"\s*:\s*""/u);
    expect(componentSource).toContain('"Aktualisieren"');
    expect(componentSource).toContain("new AbortController()");
  });

  it("renders loading, error, stale and empty states with required German labels", () => {
    for (const label of [
      "Gemini Flash Pool",
      "Verbleibend",
      "Normalisierte Nutzung",
      "Nächster Reset",
      "Quota-Quelle",
      "Letzte Quota-Synchronisation",
      "Aktiver Cooldown / Rate-Limit",
      "OmniRoute-Daten werden geladen …",
      "OmniRoute-Nutzung",
      "Eingabe-Tokens",
      "Ausgabe-Tokens",
      "Tokens insgesamt",
      "Durchschnittliche Latenz",
      "Letzte Anfrage",
      "Aktive Route",
      "Primäres Gemini 3.7-Ziel",
      "Fallback-Ziel (Luna Pro)",
      "Produktionsstatus",
      "Provider und Modell",
      "Tagesverlauf",
      "Provider-Health",
      "Zuletzt aktualisiert",
      "Veraltete Daten:",
    ]) {
      expect(componentSource).toContain(label);
    }
    expect(componentSource).toContain('className="error-box" role="alert"');
    expect(componentSource).toContain('role="status"');
    expect(componentSource).toContain("Keine OmniRoute-Daten verfügbar.");
  });

  it("uses accessible progress semantics, semantic tables and responsive dark styling", () => {
    expect(componentSource).toContain('role="progressbar"');
    expect(componentSource).toContain("aria-valuemin={0}");
    expect(componentSource).toContain("aria-valuemax={100}");
    expect(componentSource).toContain("aria-valuenow={progressValue");
    expect(componentSource).toMatch(/<table>/u);
    expect(componentSource).toContain("<caption>Nutzung nach Provider und Modell</caption>");
    expect(componentSource).toContain("<caption>Tagesverlauf im ausgewählten Zeitraum</caption>");
    expect(cssSource).toContain(".admin-omniroute-panel");
    expect(cssSource).toContain(".admin-omniroute-card");
    expect(cssSource).toContain("@media (max-width: 700px)");
  });

  it("does not expose OmniRoute management secrets or server environment names", () => {
    const clientSurface = `${pageSource}\n${componentSource}`;
    expect(clientSurface).not.toContain("OMNIROUTE_ADMIN_BASE_URL");
    expect(clientSurface).not.toContain("OMNIROUTE_ADMIN_API_KEY");
    expect(clientSurface).not.toContain("connectionId");
    expect(clientSurface).not.toContain("byApiKey");
    expect(clientSurface).not.toContain("byAccount");
  });
});
