import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const page = readFileSync(fileURLToPath(new URL("../app/page.tsx", import.meta.url)), "utf8");
const css = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");

describe("OpenAI-compatible administration UI", () => {
  it("renders create fields and CRUD actions without provider-specific labels", () => {
    expect(page).toContain("OpenAI-kompatible Modelle verwalten");
    expect(page).toContain("Upstream-Modell-ID");
    expect(page).toContain("Anzeigename (optional)");
    expect(page).toContain("Basis-URL");
    expect(page).toContain("Nur Administratoren");
    expect(page).toContain("Bearbeiten");
    expect(page).toContain("Speichern");
    expect(page).toContain("Abbrechen");
    expect(page).toContain("Löschen");
    expect(css).toContain("admin-openai-compatible");
  });

  it("keeps create and edit password inputs controlled only by blank local state", () => {
    expect(page).toContain('apiKey: ""');
    expect(page).toContain('Neuer API-Key (optional)');
    expect(page).toContain('type="password"');
    expect(page).not.toContain("apiKeyCiphertext");
  });

  it("locks and validates the edit form while a model save is running", () => {
    expect(page).toContain('id={`openai-compatible-edit-upstream-${model.id}`}');
    expect(page).toContain('disabled={isAdminModelsSaving || !adminEditModel.upstreamModel.trim() || !adminEditModel.baseUrl.trim()}');
    expect(page).toContain('disabled={isAdminModelsSaving}');
  });
});
