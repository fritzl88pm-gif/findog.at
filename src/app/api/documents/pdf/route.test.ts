import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { renderChatPdf } from "@/lib/documents/pdf";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { POST } from "./route";

const MAX_PDF_CONTENT_CHARS = 60_000;

vi.mock("@/lib/auth/server", () => ({
  authenticateSupabaseRequest: vi.fn(),
}));

vi.mock("@/lib/documents/pdf", () => ({
  renderChatPdf: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: vi.fn(),
}));

function pdfRequest(body: unknown, authorization = true): Request {
  return new Request("http://localhost/api/documents/pdf", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authorization ? { Authorization: "Bearer access-token" } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/documents/pdf", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ auth: {} } as never);
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "user-1" });
    vi.mocked(renderChatPdf).mockResolvedValue(new Uint8Array([37, 80, 68, 70, 45]));
  });

  it("rejects unauthenticated requests", async () => {
    vi.mocked(authenticateSupabaseRequest).mockRejectedValueOnce(
      new UserVisibleError("Bitte zuerst anmelden.", 401),
    );
    const request = pdfRequest({ title: "Antwort", content: "Inhalt" }, false);

    const response = await POST(request);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Bitte zuerst anmelden." });
    expect(renderChatPdf).not.toHaveBeenCalled();
  });

  it.each([
    { label: "missing content", body: { title: "Antwort" }, status: 400 },
    { label: "extra field", body: { title: "Antwort", content: "Inhalt", save: true }, status: 400 },
    { label: "empty title", body: { title: " ", content: "Inhalt" }, status: 400 },
    {
      label: "oversized content",
      body: { title: "Antwort", content: "x".repeat(MAX_PDF_CONTENT_CHARS + 1) },
      status: 400,
    },
    {
      label: "body over transport limit",
      body: { title: "Antwort", content: "x".repeat(100_001) },
      status: 413,
    },
  ])("rejects an invalid body: $label", async ({ body, status }) => {
    const response = await POST(pdfRequest(body));

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: "Die PDF-Anfrage ist ungültig." });
    expect(renderChatPdf).not.toHaveBeenCalled();
  });

  it("renders and returns an authenticated PDF without caching", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T23:30:00.000Z"));
    const request = pdfRequest({ title: "  Säumnisbeschwerde  ", content: "  ## Antrag\n\nText  " });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(authenticateSupabaseRequest).toHaveBeenCalledWith(request, expect.anything());
    expect(renderChatPdf).toHaveBeenCalledWith({
      title: "Säumnisbeschwerde",
      content: "## Antrag\n\nText",
      date: "02.01.2026",
    });
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="Saumnisbeschwerde_02.01.2026.pdf"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([37, 80, 68, 70, 45]),
    );
  });

  it("uses a neutral fallback filename when the title has no filename-safe characters", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T12:00:00.000Z"));

    const response = await POST(pdfRequest({ title: "•••", content: "Inhalt" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="Antwort_11.07.2026.pdf"',
    );
  });
});
