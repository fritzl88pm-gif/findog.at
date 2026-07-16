import { describe, expect, it } from "vitest";

import {
  createLlmProgressStepTitle,
  readLlmProgressStepTitle,
  sanitizeLlmProgressStatus,
} from "./agent-progress-status";

describe("LLM progress status", () => {
  it("accepts a short action line and stores it in a private step title", () => {
    expect(sanitizeLlmProgressStatus("Werte BFG-Urteile aus"))
      .toBe("Werte BFG-Urteile aus.");

    const title = createLlmProgressStepTitle("STATUS: Werte BFG-Urteile aus.");

    expect(title).toBe("LLM-Arbeitsstatus: Werte BFG-Urteile aus.");
    expect(readLlmProgressStepTitle(title)).toBe("Werte BFG-Urteile aus.");
  });

  it.each([
    null,
    "",
    "Werte BFG-Urteile aus.",
    "STATUS: Der Unterhaltsabsetzbetrag beträgt 2024 EUR 35.",
    "STATUS: Werte BFG-Urteile aus. Ergebnis bestätigt.",
    "STATUS: Werte\nBFG-Urteile aus.",
    "STATUS: Prüfe § 34 EStG.",
    "STATUS: Öffne https://example.test.",
    "STATUS: **Werte BFG-Urteile aus.**",
    "STATUS: Prüfe e0282ab8-b94f-4553-962e-68705201cf9a.",
    "STATUS: Werte search_bfg aus.",
    "STATUS: Werte Tool-Ergebnisse aus.",
    "STATUS: Werte die gefundenen Treffer aus.",
    `STATUS: Prüfe ${"A".repeat(100)}.`,
  ])("rejects unsafe or unstructured model content: %s", (value) => {
    expect(createLlmProgressStepTitle(value)).toBeUndefined();
  });

  it("does not trust arbitrary persisted progress titles", () => {
    expect(readLlmProgressStepTitle("Werte BFG-Urteile aus."))
      .toBeUndefined();
    expect(readLlmProgressStepTitle("LLM-Arbeitsstatus: Der Betrag ist belegt."))
      .toBeUndefined();
  });
});
