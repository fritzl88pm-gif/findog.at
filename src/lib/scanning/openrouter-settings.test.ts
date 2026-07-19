import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { analyzeScanningBatch } from "./openrouter";
import { DEFAULT_SCANNING_MODEL_ID, DEFAULT_SCANNING_PROMPT } from "./settings";
import type { ScanningUpload } from "./types";

const originalKey = process.env.OPENROUTER_API_KEY;

const TASK_INSTRUCTION = "Lies alle beigefügten Rechnungen";
const FIRST_SAFETY_RULE = "Du darfst die Dokumente intern gründlich analysieren und prüfen.";

describe("Default scanning prompt ordering", () => {
  it("places the six system safety/output rules before the static user task instruction", () => {
    expect(DEFAULT_SCANNING_PROMPT.indexOf(FIRST_SAFETY_RULE)).toBeLessThan(
      DEFAULT_SCANNING_PROMPT.indexOf(TASK_INSTRUCTION),
    );
  });
});

function providerResponse(content: unknown, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function upload(): ScanningUpload {
  return {
    id: "u1",
    name: "beleg.pdf",
    kind: "pdf",
    mimeType: "application/pdf",
    sizeBytes: 5,
    sha256: "hash-u1",
    bytes: new TextEncoder().encode("%PDF-"),
  };
}

describe("Scanning adapter with explicit model and prompt", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  });

  it("uses the provided model and staticPrompt in the OpenRouter request body", async () => {
    const report = "| Pos. | Datum | Beschreibung | Summe |\n|---:|---|---|---:|\n| 1 | 01.10.2024 | Test | 1.000,00 EUR |";
    vi.mocked(fetch).mockResolvedValue(providerResponse(report));

    const customModel = "anthropic/claude-sonnet-4-20250514";
    const customPrompt = "Custom static scanning instructions for testing.";

    await analyzeScanningBatch([upload()], undefined, "", customModel, customPrompt);

    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body.model).toBe(customModel);
    const userContent = JSON.stringify(body.messages);
    expect(userContent).toContain(customPrompt);
  });

  it("sends the provided model ID (not the default) in the request", async () => {
    const report = "| Pos. | Datum | Beschreibung | Summe |\n|---:|---|---|---:|\n| 1 | 01.10.2024 | Test | 1.000,00 EUR |";
    vi.mocked(fetch).mockResolvedValue(providerResponse(report));

    const customModel = "openai/gpt-4o";
    await analyzeScanningBatch([upload()], undefined, "", customModel, "Static prompt");

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body.model).toBe("openai/gpt-4o");
    expect(body.model).not.toBe(DEFAULT_SCANNING_MODEL_ID);
  });

  it("passes custom prompt content as the scanning text instruction", async () => {
    const report = "| Pos. | Datum | Beschreibung | Summe |\n|---:|---|---|---:|\n| 1 | 01.10.2024 | Custom | 500,00 EUR |";
    vi.mocked(fetch).mockResolvedValue(providerResponse(report));

    const customPrompt = "Benutze eine vereinfachte Kategorisierung.";
    await analyzeScanningBatch([upload()], undefined, "", DEFAULT_SCANNING_MODEL_ID, customPrompt);

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    const serialized = JSON.stringify(body);
    expect(serialized).toContain(customPrompt);
    expect(serialized).toContain("Dateien: beleg.pdf");
  });
});
