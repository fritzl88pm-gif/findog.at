import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { analyzeScanningBatch, ScanningProviderError } from "@/lib/scanning/openrouter";
import { parseScanningStreamLine } from "@/lib/scanning/stream";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { POST } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/scanning/openrouter", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/scanning/openrouter")>();
  return { ...original, analyzeScanningBatch: vi.fn() };
});

function pngBytes(marker = 0): Uint8Array<ArrayBuffer> {
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, marker]);
}

function pdfBytes(marker = 0): Uint8Array<ArrayBuffer> {
  return Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, marker]);
}

function multipart(
  files: Array<{ field: string; file: File }>,
  userToken = "token",
  instructions?: string,
): Request {
  const body = new FormData();
  for (const item of files) body.append(item.field, item.file, item.file.name);
  if (instructions !== undefined) body.append("instructions", instructions);
  return new Request("https://findog.at/api/scanning", {
    method: "POST",
    headers: { Authorization: `Bearer ${userToken}`, "Sec-Fetch-Site": "same-origin" },
    body,
  });
}

function image(name: string, marker = 0): File {
  return new File([pngBytes(marker)], name, { type: "image/png" });
}

function pdf(name: string, marker = 0): File {
  return new File([pdfBytes(marker)], name, { type: "application/pdf" });
}

async function events(response: Response) {
  return (await response.text()).split("\n").map(parseScanningStreamLine).filter(Boolean);
}

describe("POST /api/scanning", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ auth: {} } as never);
    vi.mocked(authenticateSupabaseRequest).mockImplementation(async (request) => ({
      id: request.headers.get("authorization")?.replace("Bearer ", "") || "user",
    }));
    vi.mocked(analyzeScanningBatch).mockResolvedValue(
      "| Pos. | Datum | Beschreibung | Summe |\n|---:|---|---|---:|\n| 1 | 01.10.2024 | Betreuung Oktober | 2.680,00 EUR |\n| 2 | 01.11.2024 | Betreuung November | 2.060,00 EUR |\n| | | Gesamtsumme | 4.740,00 EUR |",
    );
  });

  it("sends five images and five PDFs together and streams the direct report", async () => {
    const files = [
      ...Array.from({ length: 5 }, (_, index) => ({ field: "image", file: image(`bild-${index}.png`, index) })),
      ...Array.from({ length: 5 }, (_, index) => ({ field: "pdf", file: pdf(`beleg-${index}.pdf`, index) })),
    ];
    const response = await POST(multipart(files, "ten-files-user"));
    const streamed = await events(response);
    const final = streamed.find((event) => event?.type === "final");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(analyzeScanningBatch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(analyzeScanningBatch).mock.calls[0]?.[0]).toHaveLength(10);
    expect(vi.mocked(analyzeScanningBatch).mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
    expect(final).toMatchObject({
      type: "final",
      model: "google/gemini-3.5-flash",
      report: expect.stringContaining("Gesamtsumme"),
    });
    if (final?.type === "final") {
      expect(final.files).toHaveLength(10);
      expect(final.files.every((file) => file.status === "completed")).toBe(true);
    }
    expect(getSupabaseServerClient).toHaveBeenCalledTimes(1);
  });

  it("forwards one grouped row per invoice plus the shared total", async () => {
    vi.mocked(analyzeScanningBatch).mockResolvedValueOnce(
      "| Pos. | Datum | Beschreibung | Summe |\n|---:|---|---|---:|\n| 1 | 01.10.2024 | Betreuung Oktober | 2.680,00 EUR |\n| 2 | 01.11.2024 | Betreuung November | 2.060,00 EUR |\n| | | Gesamtsumme | 4.740,00 EUR |",
    );
    const response = await POST(multipart([{ field: "pdf", file: pdf("gedreht.pdf") }], "rotated-user"));
    const final = (await events(response)).find((event) => event?.type === "final");
    expect(final).toMatchObject({
      type: "final",
      report: expect.stringContaining("| | | Gesamtsumme | 4.740,00 EUR |"),
    });
  });

  it("forwards optional bounded instructions to the Gemini adapter", async () => {
    const response = await POST(multipart(
      [{ field: "pdf", file: pdf("apotheke.pdf") }],
      "instructions-user",
      "  nur Apothekenrechnungen  ",
    ));
    expect(response.status).toBe(200);
    await response.text();
    expect(analyzeScanningBatch).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(AbortSignal),
      "nur Apothekenrechnungen",
    );
  });

  it("rejects oversized optional instructions", async () => {
    const response = await POST(multipart(
      [{ field: "pdf", file: pdf("beleg.pdf") }],
      "long-instructions-user",
      "x".repeat(1_001),
    ));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Zusätzliche Anweisungen dürfen maximal 1.000 Zeichen lang sein.",
    });
    expect(analyzeScanningBatch).not.toHaveBeenCalled();
  });

  it("rejects empty batches, a sixth file and unknown form fields", async () => {
    expect((await POST(multipart([], "empty-user"))).status).toBe(400);
    expect((await POST(multipart(
      Array.from({ length: 6 }, (_, index) => ({ field: "image", file: image(`bild-${index}.png`, index) })),
      "six-user",
    ))).status).toBe(400);
    expect((await POST(multipart([{ field: "attachment", file: pdf("beleg.pdf") }], "unknown-user"))).status).toBe(400);
    expect(analyzeScanningBatch).not.toHaveBeenCalled();
  });

  it("accepts files exactly at 5 and 10 MiB and rejects one byte above", async () => {
    const exactImage = new Uint8Array(5 * 1_024 * 1_024);
    exactImage.set(pngBytes());
    const exactPdf = new Uint8Array(10 * 1_024 * 1_024);
    exactPdf.set(pdfBytes());
    const accepted = await POST(multipart([
      { field: "image", file: new File([exactImage], "max.png", { type: "image/png" }) },
      { field: "pdf", file: new File([exactPdf], "max.pdf", { type: "application/pdf" }) },
    ], "exact-size-user"));
    expect(accepted.status).toBe(200);
    expect((await events(accepted)).some((event) => event?.type === "final")).toBe(true);

    const tooLarge = new Uint8Array(5 * 1_024 * 1_024 + 1);
    tooLarge.set(pngBytes());
    expect((await POST(multipart([
      { field: "image", file: new File([tooLarge], "too-large.png", { type: "image/png" }) },
    ], "large-user"))).status).toBe(413);
  });

  it("rejects MIME/signature mismatches and cross-site submissions", async () => {
    expect((await POST(multipart([
      { field: "pdf", file: new File([pngBytes()], "fake.pdf", { type: "application/pdf" }) },
    ], "mismatch-user"))).status).toBe(400);

    const crossSite = multipart([{ field: "pdf", file: pdf("beleg.pdf") }], "cross-user");
    const headers = new Headers(crossSite.headers);
    headers.set("Sec-Fetch-Site", "cross-site");
    const authCalls = vi.mocked(authenticateSupabaseRequest).mock.calls.length;
    expect((await POST(new Request(crossSite, { headers }))).status).toBe(403);
    expect(authenticateSupabaseRequest).toHaveBeenCalledTimes(authCalls);
  });

  it("sends exact duplicates once and marks the copy", async () => {
    const response = await POST(multipart([
      { field: "image", file: image("Original.png", 4) },
      { field: "image", file: image("Kopie.png", 4) },
    ], "duplicate-user"));
    const final = (await events(response)).find((event) => event?.type === "final");
    expect(vi.mocked(analyzeScanningBatch).mock.calls[0]?.[0]).toHaveLength(1);
    expect(final).toMatchObject({
      type: "final",
      files: expect.arrayContaining([expect.objectContaining({ name: "Kopie.png", status: "duplicate" })]),
    });
  });

  it("emits the safe provider error instead of inventing an extraction failure", async () => {
    vi.mocked(analyzeScanningBatch).mockRejectedValueOnce(new ScanningProviderError("OpenRouter ist ausgelastet.", 429));
    const failure = await POST(multipart([{ field: "pdf", file: pdf("a.pdf") }], "failed-user"));
    expect(await events(failure)).toContainEqual({ type: "error", error: "OpenRouter ist ausgelastet." });

    vi.mocked(analyzeScanningBatch).mockRejectedValueOnce(
      new ScanningProviderError("Scanning ist serverseitig nicht konfiguriert.", 503, true),
    );
    const fatal = await POST(multipart([{ field: "pdf", file: pdf("b.pdf") }], "fatal-user"));
    expect(await events(fatal)).toContainEqual({
      type: "error",
      error: "Scanning ist serverseitig nicht konfiguriert.",
    });
  });

  it("enforces five batches per user in five minutes", async () => {
    for (let index = 0; index < 5; index += 1) {
      const response = await POST(multipart([{ field: "pdf", file: pdf(`beleg-${index}.pdf`, index) }], "rate-user"));
      expect(response.status).toBe(200);
      await response.text();
    }
    expect((await POST(multipart([{ field: "pdf", file: pdf("sechs.pdf", 9) }], "rate-user"))).status).toBe(429);
  });
});
