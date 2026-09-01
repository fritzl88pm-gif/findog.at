import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import AdminOmniRouteUsage from "./admin-omniroute-usage";

const pageSource = readFileSync(fileURLToPath(new URL("../app/page.tsx", import.meta.url)), "utf8");
const componentSource = readFileSync(
  fileURLToPath(new URL("./admin-omniroute-usage.tsx", import.meta.url)),
  "utf8",
);
const cssSource = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");

describe("Admin OmniRoute Stats UI", () => {
  it("renders a dedicated keyboard-navigable top-level admin tab", () => {
    expect(pageSource).toContain('id="admin-tab-omniroute"');
    expect(pageSource).toContain('aria-controls="admin-panel-omniroute"');
    expect(pageSource).toContain('onClick={() => setAdminTab("omniroute")}');
    expect(pageSource).toContain('onKeyDown={(e) => handleAdminTabKeyDown(e, "omniroute")}');
    expect(pageSource).toContain("OmniRoute Stats");
    expect(pageSource).toMatch(/ADMIN_TAB_IDS\s*=\s*\[[^\]]*"omniroute"[^\]]*\]/u);
  });

  it("mounts the standalone component only inside its selected tabpanel", () => {
    expect(pageSource).toContain('adminTab === "omniroute" ? (');
    expect(pageSource).toContain("<AdminOmniRouteUsage accessToken={session?.access_token ?? \"\"} />");
    expect(componentSource).toContain('id="admin-panel-omniroute"');
    expect(componentSource).toContain('aria-labelledby="admin-tab-omniroute"');
    expect(componentSource).not.toContain("AdminScanning");
  });

  it("renders an accessible initial loading console with range and refresh controls", () => {
    const markup = renderToStaticMarkup(createElement(AdminOmniRouteUsage, { accessToken: "admin-token" }));

    expect(markup).toContain('id="admin-panel-omniroute"');
    expect(markup).toContain('id="admin-omniroute-range"');
    expect(markup).toContain("Letzte 24 Stunden");
    expect(markup).toContain("Letzte 7 Tage");
    expect(markup).toContain("Letzte 30 Tage");
    expect(markup).toContain("OmniRoute-Daten werden geladen …");
    expect(markup).toContain('role="status"');
    expect(markup).toContain("Aktualisieren");
    expect(markup).toContain("Operations Console");
  });

  it("authorizes only with the Supabase access token and validates the full browser DTO shape", () => {
    expect(componentSource).toContain('Authorization: `Bearer ${accessToken}`');
    expect(componentSource).toMatch(/refresh\s*\?\s*"&refresh=1"\s*:\s*""/u);
    expect(componentSource).toContain("new AbortController()");
    for (const field of [
      "payload.userQuestions",
      "payload.exchangeRate",
      "payload.costConversionWarning",
      "codexQuota",
      "providerHealth",
      "routes",
      "userUsage",
    ]) {
      expect(componentSource).toContain(field);
    }
  });

  it("renders exact per-user Fred questions in a responsive card grid", () => {
    expect(componentSource).toContain('id="admin-omniroute-users-title"');
    expect(componentSource).toContain("Useranfragen");
    expect(componentSource).toContain("Fred-Fragen (exakt)");
    expect(componentSource).toContain("Kostenanteil (Schätzung)");
    expect(componentSource).toContain("Anteil an Fred-Fragen");
    expect(componentSource).toContain("Letzte Frage");
    expect(componentSource).toContain("userUsage.map((user)");
    expect(componentSource).toContain("admin-omniroute-user-grid");
    expect(componentSource).toContain("admin-omniroute-user-card");
    expect(componentSource).toContain("System / nicht zugeordnet");
    expect(componentSource).toContain("Fred-Fragen sind exakt gezählt");
    expect(componentSource).toContain("proportional zu allen OmniRoute-Anfragen");
    expect(componentSource).not.toContain("<table>");
    expect(cssSource).toContain(".admin-omniroute-user-grid");
    expect(cssSource).toContain(".admin-omniroute-user-card");
    expect(cssSource).toContain(
      "  .admin-omniroute-user-grid,\n  .admin-omniroute-routes-list {\n    grid-template-columns: 1fr;",
    );
  });

  it("keeps model and provider surfaces dynamic and free of a fixed Gemini panel", () => {
    expect(componentSource).toContain("providers.map((health)");
    expect(componentSource).toContain('health.provider === "codex" ? snapshot.codexQuota : snapshot.quota');
    expect(componentSource).toContain("Keine unterstützten Provider-Health-Daten für konfigurierte Ziele.");
    expect(componentSource).toContain("Nur Zielmodelle aus der aktuellen Route-Konfiguration.");
    expect(componentSource).not.toContain("Gemini Flash Pool");
    expect(componentSource).not.toContain("codexHealth, geminiHealth");
    expect(componentSource).not.toContain('label: "Gemini / Antigravity"');
    expect(componentSource).not.toContain("<table>");
    expect(componentSource).not.toContain("overflow-x: auto");
  });

  it("preserves loading, error, stale, empty, EUR, and restricted-detail states", () => {
    for (const label of [
      "Veraltete Daten:",
      "costConversionWarning",
      "Keine OmniRoute-Daten verfügbar.",
      "Keine konfigurierten Routen gefunden.",
      "Keine Nutzung für aktuell konfigurierte Zielmodelle.",
      "Gesamtüberblick",
      "Konfigurierte Modell-Performance",
      "Aktivität",
      "Health &amp; Quoten",
      "Findog-Fragen",
      "Kosten (EUR)",
      "Alle OmniRoute-Anfragen im Zeitraum",
      "Modell- und Provider-Details sind auf aktuell konfigurierte Ziele beschränkt",
      "EUR-Referenzkurs",
      "Kursdatum",
    ]) {
      expect(componentSource).toContain(label);
    }
    expect(componentSource).toContain('className="error-box" role="alert"');
    expect(componentSource).toContain('role="progressbar"');
    expect(componentSource).toContain("aria-valuemin={0}");
    expect(componentSource).toContain("aria-valuemax={100}");
    expect(componentSource).toContain("aria-valuenow={progressValue");
  });

  it("uses the existing light system with responsive cards, focus states, and 44px controls", () => {
    expect(cssSource).toContain(".admin-omniroute-panel");
    expect(cssSource).toContain(".admin-omniroute-controls select,\n.admin-omniroute-controls .compact-button");
    expect(cssSource).toMatch(/\.admin-omniroute-model-grid,\n\.admin-omniroute-provider-grid,\n\.admin-omniroute-user-grid/u);
    expect(cssSource).toContain("min-height: 44px");
    expect(cssSource).toContain(".admin-omniroute-controls select:focus");
    expect(cssSource).toContain("min-width: 0");
    expect(cssSource).not.toContain(".admin-omniroute-table-wrap");
    for (const width of ["1000px", "780px", "560px", "350px"]) {
      expect(cssSource).toContain(`@media (max-width: ${width})`);
    }
    expect(cssSource).toContain("var(--bmf-blue)");
    expect(cssSource).toContain("var(--accent-yellow)");
  });

  it("does not expose OmniRoute management secrets or server environment names", () => {
    const clientSurface = `${pageSource}\n${componentSource}`;
    expect(clientSurface).not.toContain("OMNIROUTE_ADMIN_BASE_URL");
    expect(clientSurface).not.toContain("OMNIROUTE_ADMIN_API_KEY");
    expect(clientSurface).not.toContain("connectionId");
    expect(clientSurface).not.toContain("byApiKey");
    expect(clientSurface).not.toContain("byAccount");
    expect(clientSurface).not.toContain("Luna Pro");
  });
});
