import { describe, expect, it } from "vitest";

import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL,
  DEFAULT_SYSTEM_PROMPT,
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_IMAGE_UPLOADS,
  MAX_MULTIPART_REQUEST_BYTES,
  MAX_PDF_UPLOAD_BYTES,
  MAX_PDF_UPLOADS,
  MAX_REQUEST_BYTES,
  isSupportedModel,
} from "./config";

describe("DEFAULT_SYSTEM_PROMPT", () => {
  it("contains the full system prompt and fits within the accepted request bounds", () => {
    expect(DEFAULT_SYSTEM_PROMPT.length).toBeGreaterThan(24_000);
  });

  it("tells the assistant to fulfill explicit PDF document requests through the available download", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("# PDF-DOKUMENTE");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("PDF-Download");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Behaupte einen PDF-Download nur, wenn diese Funktion von der Anwendung tatsächlich bereitgestellt wird");
  });

  it("contains no raw MCP tool names, no KB UUIDs, no empty parentheses, and no broken source table", () => {
    // No raw MCP function names
    expect(DEFAULT_SYSTEM_PROMPT).not.toMatch(/\bhybrid_search\b/);
    expect(DEFAULT_SYSTEM_PROMPT).not.toMatch(/\bfaq_search\b/);
    expect(DEFAULT_SYSTEM_PROMPT).not.toMatch(/\bfaq_entries_search\b/);
    expect(DEFAULT_SYSTEM_PROMPT).not.toMatch(/\bwiki_search\b/);
    expect(DEFAULT_SYSTEM_PROMPT).not.toMatch(/\bwiki_read_page\b/);
    expect(DEFAULT_SYSTEM_PROMPT).not.toMatch(/\bwiki_index_view\b/);
    expect(DEFAULT_SYSTEM_PROMPT).not.toMatch(/\blist_knowledge_bases\b/);
    expect(DEFAULT_SYSTEM_PROMPT).not.toMatch(/\bget_knowledge_base\b/);
    expect(DEFAULT_SYSTEM_PROMPT).not.toMatch(/\blist_knowledge\b/);
    expect(DEFAULT_SYSTEM_PROMPT).not.toMatch(/\blist_chunks\b/);
    expect(DEFAULT_SYSTEM_PROMPT).not.toMatch(/\bget_knowledge\b/);
    expect(DEFAULT_SYSTEM_PROMPT).not.toMatch(/\bonly_recommended\b/);
    expect(DEFAULT_SYSTEM_PROMPT).not.toMatch(/\bfirst_priority_tag_ids\b/);
    expect(DEFAULT_SYSTEM_PROMPT).not.toMatch(/\bsecond_priority_tag_ids\b/);
    // No empty parentheses placeholders
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain("()");
    // No broken "der Dokumentsuche" prefix
    expect(DEFAULT_SYSTEM_PROMPT).not.toMatch(/^der Dokumentsuche/m);
    // No static KB UUIDs
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain("e0282ab8");
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain("7e203a75");
    // No stripped "Hermes Memory" sentence — the Hermes reference must be intact
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Hermes Memory");
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/nichts mit Steuerrecht zu tun/);
  });

  it("contains no references to unavailable web or live research", () => {
    expect(DEFAULT_SYSTEM_PROMPT).not.toMatch(/Websuche/i);
    expect(DEFAULT_SYSTEM_PROMPT).not.toMatch(/Live-Recherche/i);
    expect(DEFAULT_SYSTEM_PROMPT).not.toMatch(/externe Recherche angek(?:ü|\u00fc)ndigt/i);
  });

  it("contains a compact high-level research-sources section without technical tool inventory", () => {
    // Has the research sources overview
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Forschungsquellen in findog.at");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Gesetze und Verordnungen");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("BFG Entscheidungen Findok");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Allgemeine Informationen Wiki");
    // Does NOT contain the old "Werkzeuge im Detail" subsection header
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain("Werkzeuge im Detail");
    // Contains the routing guidance
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Welche KB für welche Frage");
  });

  it("preserves the substantive legal sections: role, source hierarchy, stichtag, output formats, style, PDF policy", () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("# ROLLE");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("# QUELLENHIERARCHIE");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("## STICHTAG");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("# RECHERCHEABLAUF");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("## ROUTING-GATE");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("## KURZSCHLUSS");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("## FOLGEFRAGEN");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("# ARBEITSREGELN");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("# FALLKLASSIFIKATION");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("# AUSGABEFORM");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("# WÜRDIGUNG");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("# BESCHIEDBEGRÜNDUNG");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("# WINANV");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("# FEXKLUSIV");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("# FORMATIERUNG");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("# STIL");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("# SCHLUSSFORMEL");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("# PDF-DOKUMENTE");
  });

  it("keeps JSON requests bounded separately from PDF multipart uploads", () => {
    expect(MAX_REQUEST_BYTES).toBe(400_000);
    expect(MAX_PDF_UPLOAD_BYTES).toBe(50_000_000);
    expect(MAX_IMAGE_UPLOAD_BYTES).toBe(5_000_000);
    expect(MAX_PDF_UPLOADS).toBe(5);
    expect(MAX_IMAGE_UPLOADS).toBe(5);
    expect(MAX_MULTIPART_REQUEST_BYTES).toBeGreaterThanOrEqual(
      MAX_REQUEST_BYTES + MAX_PDF_UPLOAD_BYTES * MAX_PDF_UPLOADS + MAX_IMAGE_UPLOAD_BYTES * MAX_IMAGE_UPLOADS,
    );
  });
});

describe("model policy", () => {
  it("supports exactly DeepSeek v4 Flash and Pro, with Pro as the default", () => {
    expect(DEFAULT_MODEL).toBe("deepseek-v4-pro");
    expect(AVAILABLE_MODELS).toEqual(["deepseek-v4-flash", "deepseek-v4-pro"]);
    expect(isSupportedModel("deepseek-v4-pro")).toBe(true);
    expect(isSupportedModel("deepseek-v4-flash")).toBe(true);
    expect(isSupportedModel("deepseek-chat")).toBe(false);
    expect(isSupportedModel("obsolete-client-model")).toBe(false);
  });
});
