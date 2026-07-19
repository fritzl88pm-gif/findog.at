import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { analyzeScanningBatch, ScanningProviderError } from "./openrouter";
import type { ScanningUpload } from "./types";

const originalKey = process.env.OPENROUTER_API_KEY;

function providerResponse(content: unknown, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function upload(kind: "image" | "pdf", id: string): ScanningUpload {
  const pdf = kind === "pdf";
  const bytes = pdf
    ? new TextEncoder().encode("%PDF-")
    : new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return {
    id,
    name: pdf ? `${id}.pdf` : `${id}.png`,
    kind,
    mimeType: pdf ? "application/pdf" : "image/png",
    sizeBytes: bytes.byteLength,
    sha256: `hash-${id}`,
    bytes,
  };
}

describe("OpenRouter scanning adapter", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  });

  it("sends the complete mixed batch in one direct Gemini request and returns its Markdown", async () => {
    const report = "| Pos. | Datum | Beschreibung | Summe |\n|---:|---|---|---:|\n| 1 | 01.10.2024 | Betreuung Oktober | 2.680,00 EUR |\n| 2 | 01.11.2024 | Betreuung November | 2.060,00 EUR |\n| | | Gesamtsumme | 4.740,00 EUR |";
    vi.mocked(fetch).mockResolvedValue(providerResponse(report));

    await expect(analyzeScanningBatch([upload("pdf", "sammel"), upload("image", "foto")]))
      .resolves.toBe(report);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    const serialized = JSON.stringify(body);
    expect(body.model).toBe("google/gemini-3.5-flash");
    expect(serialized).toContain("data:application/pdf;base64,");
    expect(serialized).toContain("data:image/png;base64,");
    expect(body.response_format).toBeUndefined();
    expect(body.plugins).toBeUndefined();
    expect(body.reasoning).toEqual({ effort: "minimal", exclude: true });
    expect(serialized).toContain("Gib niemals Arbeitsnotizen, Gedankengänge, Selbstgespräche");
    expect(serialized).toContain("Jede Ergebnistabelle muss exakt mit der Kopfzeile");
    expect(serialized).toContain("bei PDFs jede Seite, Anfang bis Ende");
    expect(serialized).toContain("Gedrehte oder auf dem Kopf stehende Seiten automatisch korrigieren");
    expect(serialized).toContain("Bilde selbst sinnvolle inhaltliche Kategorien");
    expect(serialized).toContain("Amazon-Bestellungen, Reisekosten, Bürobedarf");
    expect(serialized).toContain("Tabelle „Sonstiges");
    expect(serialized).toContain("Spalten: Pos., Datum, Beschreibung, Summe");
    expect(serialized).toContain("Bei wiederkehrenden Dienstleistungsrechnungen");
    expect(serialized).toContain("Jede Zeile = ein vollständiger Beleg, nicht seine Einzelpositionen");
    expect(serialized).toContain("Bei Waren-, Kassen-, Apotheken- und Einkaufsbelegen");
    expect(serialized).toContain("enthält ein Beleg 20 Positionen, muss die Tabelle 20 Positionszeilen enthalten");
    expect(serialized).toContain("den ausgewiesenen Gesamtpreis der Position als Summe");
    expect(serialized).toContain("nicht zusätzlich als eigene Zeile");
    expect(serialized).toContain("Rabatte, Versandkosten, Pfand, Zuschläge oder Rundungsdifferenzen");
    expect(serialized).toContain("zusätzlich alle Einzelpositionen");
    expect(serialized).toContain("Am Ende jeder Tabelle eine Zeile „Gesamtsumme");
    expect(serialized).toContain("Keine separaten Rechnungsüberschriften");
    expect(serialized).toContain("Antworte direkt in gut lesbarem deutschem Markdown, kein JSON");
    expect(serialized).toContain("Dateien: sammel.pdf, foto.png");
    expect(serialized).toContain("Ist kein Datum erkennbar oder ausgewiesen");
    expect(serialized).toContain("Der Beleg bleibt trotzdem in der Tabelle");
  });

  it("adds optional user instructions to the prompt without weakening output rules", async () => {
    vi.mocked(fetch).mockResolvedValue(providerResponse(
      "## Apotheke\n\n| Pos. | Datum | Beschreibung | Summe |\n|---:|---|---|---:|\n| 1 | 15.05.2024 | Medikament | 6,35 EUR |",
    ));

    await analyzeScanningBatch([upload("pdf", "belege")], undefined, "nur Apothekenrechnungen");
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    const serialized = JSON.stringify(body);
    expect(serialized).toContain("**Zusätzliche Anweisung des Nutzers**");
    expect(serialized).toContain("nur Apothekenrechnungen");
    expect(serialized).toContain("gib ausschließlich passende Belege aus");
    expect(serialized).toContain("darf das Tabellenformat");
  });

  it("keeps undated documents and fills only their date cell with a dash", async () => {
    vi.mocked(fetch).mockResolvedValue(providerResponse(
      "## Bürobedarf\n\n| Pos. | Datum | Beschreibung | Summe |\n|---:|---|---|---:|\n| 1 | | Büromaterial | 12,00 EUR |\n| | | Gesamtsumme | 12,00 EUR |",
    ));

    const result = await analyzeScanningBatch([upload("pdf", "ohne-datum")]);
    expect(result).toContain("| 1 | – | Büromaterial | 12,00 EUR |");
    expect(result).toContain("| | | Gesamtsumme | 12,00 EUR |");
  });

  it("removes HTML line-break fragments from Gemini table cells", async () => {
    vi.mocked(fetch).mockResolvedValue(providerResponse(
      "| Pos. | Datum | Beschreibung | Summe |\n|---:|---|---|---:|\n| 1 | 01.11.2024 | Betreuung<br>November<br />Wien | 2.060,00 EUR |",
    ));
    await expect(analyzeScanningBatch([upload("pdf", "belege")]))
      .resolves.toContain("| 1 | 01.11.2024 | Betreuung November Wien | 2.060,00 EUR |");
  });

  it("keeps reasoning enabled but removes leaked thinking blocks before display", async () => {
    vi.mocked(fetch).mockResolvedValue(providerResponse(
      "<thinking>Ich ordne die Belege zunächst intern.</thinking>\n\n| Pos. | Datum | Beschreibung | Summe |\n|---:|---|---|---:|\n| 1 | 01.11.2024 | Betreuung | 2.060,00 EUR |",
    ));

    const result = await analyzeScanningBatch([upload("pdf", "belege")]);
    expect(result).toContain("| Pos. | Datum | Beschreibung | Summe |");
    expect(result).not.toContain("thinking");
    expect(result).not.toContain("Ich ordne die Belege zunächst intern.");
  });

  it("removes stray thinking tags without deleting the report", async () => {
    vi.mocked(fetch).mockResolvedValue(providerResponse(
      "<think>\n| Pos. | Datum | Beschreibung | Summe |\n|---:|---|---|---:|\n| 1 | 01.11.2024 | Betreuung | 2.060,00 EUR |\n</think-invalid>",
    ));

    const result = await analyzeScanningBatch([upload("pdf", "belege")]);
    expect(result).toContain("| Pos. | Datum | Beschreibung | Summe |");
    expect(result).not.toContain("<think>");
  });

  it("accepts assistant text returned in content parts", async () => {
    vi.mocked(fetch).mockResolvedValue(providerResponse([
      { type: "text", text: "## Sonstiges\n\n| Pos. | Datum | Beschreibung | Summe |\n|---:|---|---|---:|" },
      { type: "text", text: { value: "| 1 | 01.11.2024 | Beleg | 42,00 EUR |" } },
    ]));

    await expect(analyzeScanningBatch([upload("pdf", "beleg")]))
      .resolves.toContain("| 1 | 01.11.2024 | Beleg | 42,00 EUR |");
  });

  it("caps oversized reports for the existing PDF export", async () => {
    vi.mocked(fetch).mockResolvedValue(providerResponse(
      `| Pos. | Datum | Beschreibung | Summe |\n|---:|---|---|---:|\n| 1 | 01.11.2024 | ${"x".repeat(70_000)} | 1,00 EUR |`,
    ));
    const result = await analyzeScanningBatch([upload("pdf", "lang")]);
    expect(result.length).toBeLessThanOrEqual(58_000);
    expect(result).toContain("gekürzt");
  });

  it("rejects empty batches", async () => {
    await expect(analyzeScanningBatch([])).rejects.toMatchObject({ status: 400 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("treats missing configuration and provider authentication as fatal", async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(analyzeScanningBatch([upload("image", "bild")]))
      .rejects.toMatchObject({ fatal: true, status: 503 });

    process.env.OPENROUTER_API_KEY = "test-key";
    vi.mocked(fetch).mockResolvedValue(new Response("unauthorized", { status: 401 }));
    const failure = analyzeScanningBatch([upload("image", "bild")]);
    await expect(failure).rejects.toBeInstanceOf(ScanningProviderError);
    await expect(failure).rejects.toMatchObject({ fatal: true, status: 503 });
  });

  it("maps rate limits and invalid or empty provider responses to safe errors", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("busy", { status: 429 }));
    await expect(analyzeScanningBatch([upload("pdf", "rate")]))
      .rejects.toMatchObject({ status: 429, message: "Die Dokumentauswertung ist derzeit ausgelastet." });

    vi.mocked(fetch).mockResolvedValueOnce(new Response("not-json", { status: 200 }));
    await expect(analyzeScanningBatch([upload("pdf", "json")]))
      .rejects.toThrow("Die Dokumentauswertung lieferte keine gültige Antwort.");

    vi.mocked(fetch).mockImplementation(async () => providerResponse("   "));
    await expect(analyzeScanningBatch([upload("pdf", "leer")]))
      .rejects.toThrow("Die Dokumentauswertung lieferte keine gültige Ergebnistabelle. Bitte erneut versuchen.");
  });

  it("drops plain-text work notes before a valid result table", async () => {
    vi.mocked(fetch).mockResolvedValue(providerResponse(
      "Wait, let's inspect the upside-down page first.\n- I need to read every product.\n\n## Apotheke & Gesundheit\n\n| Pos. | Datum | Beschreibung | Summe |\n|---:|---|---|---:|\n| 1 | 15.05.2024 | Amoxicillin 500 mg | 6,35 EUR |",
    ));

    const result = await analyzeScanningBatch([upload("pdf", "apotheke")]);
    expect(result).toContain("## Apotheke & Gesundheit");
    expect(result).toContain("Amoxicillin 500 mg");
    expect(result).not.toContain("Wait");
    expect(result).not.toContain("I need");
  });

  it("retries once when Gemini returns only work notes", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(providerResponse("Wait, let's look at the image directly. I need to inspect every line."))
      .mockResolvedValueOnce(providerResponse(
        "## Apotheke & Gesundheit\n\n| Pos. | Datum | Beschreibung | Summe |\n|---:|---|---|---:|\n| 1 | 15.05.2024 | Amoxicillin 500 mg | 6,35 EUR |",
      ));

    await expect(analyzeScanningBatch([upload("pdf", "apotheke")]))
      .resolves.toContain("Amoxicillin 500 mg");
    expect(fetch).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(String(vi.mocked(fetch).mock.calls[1]?.[1]?.body)) as Record<string, unknown>;
    expect(JSON.stringify(retryBody)).toContain("WICHTIGER NEUVERSUCH");
  });

  it("never exposes work notes when both attempts lack a result table", async () => {
    vi.mocked(fetch).mockImplementation(async () => providerResponse(
      "Let's read the upside-down page. Wait, I need to inspect the letters.",
    ));

    await expect(analyzeScanningBatch([upload("pdf", "apotheke")]))
      .rejects.toThrow("Die Dokumentauswertung lieferte keine gültige Ergebnistabelle. Bitte erneut versuchen.");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
