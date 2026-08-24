import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const componentSource = readFileSync(
  fileURLToPath(new URL("./fred-personalization-settings.tsx", import.meta.url)),
  "utf8",
);

describe("FredPersonalizationSettings component", () => {
  it("renders a dedicated accessible section with the heading Fred personalisieren", () => {
    expect(componentSource).toContain('aria-labelledby="fred-personalization-settings-title"');
    expect(componentSource).toContain('id="fred-personalization-settings-title"');
    expect(componentSource).toContain("Fred personalisieren");
  });

  it("renders as a client component", () => {
    expect(componentSource).toContain('"use client"');
  });

  it("exports a default function accepting accessToken prop", () => {
    expect(componentSource).toContain("export default function FredPersonalizationSettings");
    expect(componentSource).toContain("accessToken");
  });

  it("shows a name text input with maxLength 80 and autoComplete name", () => {
    expect(componentSource).toContain('id="fred-personalization-name"');
    expect(componentSource).toContain('type="text"');
    expect(componentSource).toContain("maxLength={80}");
    expect(componentSource).toContain('autoComplete="name"');
  });

  // ── Dynamic personalities ─────────────────────────────────────────────

  it("parses personalities array from GET/PUT response and renders radio options dynamically", () => {
    // Should parse {id,title} from payload.personalities
    expect(componentSource).toContain("payload.personalities");
    // Should map over personalities to render radio options
    expect(componentSource).toMatch(/personalities\s*\.\s*map/);
    // Radio options use id as value and title as label
    expect(componentSource).toMatch(/value\s*=\s*\{[^}]*\.id\s*\}/);
    expect(componentSource).toMatch(/\{[^}]*\.title\s*\}/);
  });

  it("stores selected personality as a string ID, not a union type", () => {
    // personality state should be string, not a hardcoded union
    expect(componentSource).not.toContain('"standard" | "friendly" | "efficient" | "cynical"');
    expect(componentSource).toMatch(/useState\s*<\s*string\s*>\s*\(/);
  });

  it("does not hardcode personality titles or descriptions", () => {
    // No hardcoded German labels as string literals used for display
    expect(componentSource).not.toContain('"Standard"');
    expect(componentSource).not.toContain('"Freundlich"');
    expect(componentSource).not.toContain('"Effizient"');
    expect(componentSource).not.toContain('"Zynisch"');
    // No hardcoded descriptions
    expect(componentSource).not.toContain("Keine Stilvorgabe");
    expect(componentSource).not.toContain("Herzlich und gesprächig");
    expect(componentSource).not.toContain("Prägnant und klar");
    expect(componentSource).not.toContain("Kritisch und sarkastisch");
    // No VALID_PERSONALITIES constant
    expect(componentSource).not.toContain("VALID_PERSONALITIES");
    // No hardcoded union type called Personality (allow helper types)
    expect(componentSource).not.toMatch(/\btype Personality\b/);
  });

  it("never displays promptText in the user settings UI", () => {
    expect(componentSource).not.toContain("promptText");
    expect(componentSource).not.toContain("prompt_text");
  });

  it("falls back to 'standard' if selected ID is absent from options, otherwise first option", () => {
    // Fallback logic must be present
    expect(componentSource).toContain('"standard"');
  });

  // ── PUT contract ──────────────────────────────────────────────────────

  // ── Research display mode ───────────────────────────────────────────────

  it("renders an accessible fieldset for Rechercheanzeige with Einfach and Erweitert options", () => {
    expect(componentSource).toContain("Rechercheanzeige");
    expect(componentSource).toContain("Einfach");
    expect(componentSource).toContain("Erweitert");
    expect(componentSource).toContain('name="fred-research-display-mode"');
    expect(componentSource).toContain('value="simple"');
    expect(componentSource).toContain('value="advanced"');
  });

  it("has concise explanations for simple and advanced modes", () => {
    expect(componentSource).toMatch(/Kompakter Rechercheverlauf/i);
    expect(componentSource).toMatch(/Ausführungsverlauf|Planung/i);
  });

  it("manages researchDisplayMode state with fallback to simple", () => {
    expect(componentSource).toContain("researchDisplayMode");
    expect(componentSource).toContain('"simple"');
    expect(componentSource).toContain('"advanced"');
    expect((componentSource.match(/onResearchDisplayModeChange\?\.\(/gu) ?? []).length).toBe(2);
  });

  // ── PUT contract ──────────────────────────────────────────────────────

  it("has an explicit submit button labeled Personalisierung speichern", () => {
    expect(componentSource).toContain("Personalisierung speichern");
  });

  it("disables the submit button while loading, saving, without accessToken, or without valid selection", () => {
    expect(componentSource).toContain("canSave");
    expect(componentSource).toMatch(/disabled\s*=\s*\{[^}]*isSaving[^}]*\}/);
    expect(componentSource).toMatch(/disabled\s*=\s*\{[^}]*isLoading[^}]*\}/);
    expect(componentSource).toMatch(/disabled\s*=\s*\{[^}]*!accessToken[^}]*\}/);
  });

  it("PUT saves preferredName, personality, and researchDisplayMode", () => {
    expect(componentSource).toContain('method: "PUT"');
    expect(componentSource).toContain("preferredName");
    expect(componentSource).toContain("personality");
    expect(componentSource).toContain("researchDisplayMode");
    expect(componentSource).not.toContain('"prompt"');
  });

  it("fetches saved settings on mount with Authorization Bearer", () => {
    expect(componentSource).toContain("/api/account/settings/fred-personalization");
    expect(componentSource).toContain("Authorization: `Bearer ${accessToken}`");
    expect(componentSource).toContain('cache: "no-store"');
  });

  it("shows loading state text", () => {
    expect(componentSource).toContain("Einstellungen werden geladen…");
  });

  it("shows a success notice after save", () => {
    expect(componentSource).toContain("Personalisierung gespeichert.");
    expect(componentSource).toContain('className="notice-box"');
  });

  it("shows bounded error via error-box without exposing internals", () => {
    expect(componentSource).toContain('className="error-box"');
    expect(componentSource).toContain('role="alert"');
    expect(componentSource).toContain("Fred-Personalisierung konnte nicht geladen werden.");
    expect(componentSource).toContain("Personalisierung konnte nicht gespeichert werden.");
    expect(componentSource).not.toContain("response.status");
    expect(componentSource).not.toContain(".stack");
  });

  it("replaces local values with normalized response after save", () => {
    expect(componentSource).toContain("setPreferredName(name)");
    expect(componentSource).toContain("setPersonality(pers)");
    expect(componentSource).toContain("payload.preferredName");
    expect(componentSource).toContain("payload.personality");
    expect(componentSource).toContain("payload.researchDisplayMode");
  });

  it("aborts in-flight requests on unmount and prevents stale state updates", () => {
    expect(componentSource).toContain("AbortController");
    expect(componentSource).toContain("mountedRef.current");
    expect(componentSource).toContain("requestSequenceRef.current");
    expect(componentSource).toContain("controller.signal.aborted");
  });

  it("does not render preview, counters, badges, autosave, or reset buttons", () => {
    expect(componentSource).toMatch(/maxLength=\{80\}/);
    expect(componentSource).not.toContain("Zeichen");
    expect(componentSource).not.toContain("counter");
    expect(componentSource).not.toContain("badge");
    expect(componentSource).not.toContain("preview");
    expect(componentSource).not.toContain("autosave");
    expect(componentSource).not.toContain("reset");
    expect(componentSource).not.toContain("icon");
  });
});
