import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const pageSource = readFileSync(fileURLToPath(new URL("../app/page.tsx", import.meta.url)), "utf8");
const cssSource = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");

describe("Administration UI tabs and scanning settings", () => {
  it("has exactly six ARIA tabs including Startseiten-News and OpenRouter administration", () => {
    const tabMatches = pageSource.match(/role="tab"/gu);
    expect(tabMatches).toHaveLength(6);
    expect(pageSource).toContain('id="admin-tab-downloads"');
    expect(pageSource).toContain('id="admin-tab-dashboard-news"');
    expect(pageSource).toContain('id="admin-tab-openrouter"');
    expect(pageSource).not.toContain('id="admin-tab-personalities"');
    expect(pageSource).not.toContain('id="admin-tab-bfg-pro"');
    expect(pageSource).not.toContain('id="admin-tab-omniroute"');
  });

  it("keeps the remaining tabs in keyboard navigation and removes personalities", () => {
    expect(pageSource).toContain('"downloads"');
    expect(pageSource).not.toContain('"personalities"');
    expect(pageSource).toMatch(/ADMIN_TAB_IDS\s*=\s*\[[^\]]*"scanning"[^\]]*"benutzer"[^\]]*"feedback"[^\]]*"downloads"[^\]]*"dashboard-news"[^\]]*"openrouter"[^\]]*\]/);
  });

  it("contains no personality administration surface", () => {
    expect(pageSource).not.toContain("admin-fred-personalities");
    expect(pageSource).not.toContain("AdminFredPersonalities");
    expect(pageSource).not.toContain("/api/admin/fred-personalities");
    expect(cssSource).not.toContain("admin-personality-");
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

  it("renders an accessible OCR pipeline select with German labels and descriptions", () => {
    expect(pageSource).toContain('<label htmlFor="scanning-document-pipeline">OCR-Pipeline</label>');
    expect(pageSource).toContain('id="scanning-document-pipeline"');
    expect(pageSource).toContain('aria-describedby="scanning-document-pipeline-description"');
    expect(pageSource).toContain('value="mineru_with_omniroute_luna_fallback"');
    expect(pageSource).toContain("MinerU mit Luna-Fallback");
    expect(pageSource).toContain("MinerU wird zuerst genutzt; bei Fehler folgt Luna via OmniRoute.");
    expect(pageSource).toContain('value="omniroute_luna_only"');
    expect(pageSource).toContain("Nur Luna via OmniRoute");
    expect(pageSource).toContain("Dokumente werden ausschließlich über Luna via OmniRoute verarbeitet.");
  });

  it("loads, validates and saves the document pipeline with the scanning settings", () => {
    expect(pageSource).toMatch(/payload\.documentPipeline !== "mineru_with_omniroute_luna_fallback"[\s\S]*?payload\.documentPipeline !== "omniroute_luna_only"/u);
    expect(pageSource).toContain("setScanningDocumentPipeline(payload.documentPipeline)");
    expect(pageSource).toContain("documentPipeline: scanningDocumentPipeline");
  });

  it("renders a separate Scanning provider select with German labels", () => {
    expect(pageSource).toContain('<label htmlFor="scanning-provider">Scanning-Provider</label>');
    expect(pageSource).toContain('id="scanning-provider"');
    expect(pageSource).toContain('value="omniroute_luna"');
    expect(pageSource).toContain("Luna via OmniRoute");
    expect(pageSource).toContain('value="openrouter"');
    expect(pageSource).toContain("OpenRouter");
    expect(pageSource).toContain("scanningProvider: scanningProvider");
  });

  it("renders a model ID text input field only active for OpenRouter scanning", () => {
    expect(pageSource).toContain('<label htmlFor="scanning-model-id">OpenRouter-Modell-ID</label>');
    expect(pageSource).toContain('disabled={isScanningSettingsLoading || isScanningSettingsSaving || scanningProvider !== "openrouter"}');
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
    expect(pageSource).not.toMatch(/API[_ -]?Key|Api[_ -]?Key|Secret/i);
  });
});

describe("Administration Fred attachment mode", () => {
  it("loads, validates, saves and renders the native Fred attachment mode selector", () => {
    expect(pageSource).toContain('<label htmlFor="fred-attachment-mode">Fred-Dateiverarbeitung</label>');
    expect(pageSource).toContain('id="fred-attachment-mode"');
    expect(pageSource).toContain('value="findog_preprocess"');
    expect(pageSource).toContain("Findog-Vorverarbeitung");
    expect(pageSource).toContain('value="weknora_native"');
    expect(pageSource).toContain("WeKnora nativ");
    expect(pageSource).toContain("Findog liest Anhänge selbst aus; nativ übergibt sie direkt an WeKnora.");
    expect(pageSource).toMatch(/payload\.fredAttachmentMode !== "findog_preprocess"[\s\S]*?payload\.fredAttachmentMode !== "weknora_native"/u);
    expect(pageSource).toContain("setFredAttachmentMode(payload.fredAttachmentMode)");
    expect(pageSource).toContain("fredAttachmentMode,");
  });
});
