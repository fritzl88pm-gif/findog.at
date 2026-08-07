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

  it("renders a fieldset with legend Persönlichkeit and four exact radio options", () => {
    expect(componentSource).toContain("<fieldset");
    expect(componentSource).toContain("fred-personality-fieldset");
    expect(componentSource).toContain("<legend>Persönlichkeit</legend>");

    // The four values are defined in VALID_PERSONALITIES and used via value={value}
    expect(componentSource).toContain('"standard"');
    expect(componentSource).toContain('"friendly"');
    expect(componentSource).toContain('"efficient"');
    expect(componentSource).toContain('"cynical"');

    // Each has a corresponding description
    expect(componentSource).toContain("Keine Stilvorgabe. Nur der Name wird berücksichtigt, wenn du ihn eingetragen hast.");
    expect(componentSource).toContain("Herzlich und gesprächig, mit mehr passenden Emojis.");
    expect(componentSource).toContain("Prägnant und klar.");
    expect(componentSource).toContain("Kritisch und sarkastisch.");
  });

  it("labels radio options as Standard, Freundlich, Effizient, Zynisch", () => {
    // The labels are rendered via ternary with string literal fallbacks
    expect(componentSource).toContain('"Standard"');
    expect(componentSource).toContain('"Freundlich"');
    expect(componentSource).toContain('"Effizient"');
    expect(componentSource).toContain('"Zynisch"');
  });

  it("has an explicit submit button labeled Personalisierung speichern", () => {
    expect(componentSource).toContain("Personalisierung speichern");
    expect(componentSource).toMatch(/type="button"/);
    expect(componentSource).toContain("primary-button");
  });

  it("disables the submit button while loading, saving, or without accessToken", () => {
    expect(componentSource).toContain("disabled={isSaving || isLoading || !accessToken}");
  });

  it("fetches saved settings on mount with Authorization Bearer", () => {
    expect(componentSource).toContain("/api/account/settings/fred-personalization");
    expect(componentSource).toContain("Authorization: `Bearer ${accessToken}`");
    expect(componentSource).toContain('cache: "no-store"');
  });

  it("PUT saves exactly preferredName and personality, nothing else", () => {
    expect(componentSource).toContain('method: "PUT"');
    expect(componentSource).toContain("JSON.stringify({ preferredName, personality })");
    expect(componentSource).not.toContain("userId");
    expect(componentSource).not.toContain("prompt");
    expect(componentSource).not.toContain("free-form");
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
  });

  it("aborts in-flight requests on unmount and prevents stale state updates", () => {
    expect(componentSource).toContain("AbortController");
    expect(componentSource).toContain("mountedRef.current");
    expect(componentSource).toContain("requestSequenceRef.current");
    expect(componentSource).toContain("controller.signal.aborted");
    expect(componentSource).toContain("sequence !== requestSequenceRef.current");
    expect(componentSource).toMatch(/controllers\.clear\(\);[\s\S]*?\}, \[accessToken\]\);/);
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
