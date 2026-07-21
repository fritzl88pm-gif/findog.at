import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { renderChatPdf } from "@/lib/documents/pdf";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { POST } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/documents/pdf", () => ({ renderChatPdf: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

function pdfRequest(body: unknown): Request {
  return new Request("http://localhost/api/tools/pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer access-token" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/tools/pdf", () => {
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

    const response = await POST(pdfRequest({ title: "Berechnung", content: "Inhalt" }));

    expect(response.status).toBe(401);
    expect(renderChatPdf).not.toHaveBeenCalled();
  });

  it("rejects invalid and oversized payloads", async () => {
    const invalid = await POST(pdfRequest({ title: "Berechnung" }));
    const oversized = await POST(pdfRequest({ title: "Berechnung", content: "x".repeat(500_001) }));

    expect(invalid.status).toBe(400);
    expect(oversized.status).toBe(413);
    expect(renderChatPdf).not.toHaveBeenCalled();
  });

  it("renders an authenticated tool PDF without caching", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T23:30:00.000Z"));

    const response = await POST(pdfRequest({ title: "  SV-Berechnung  ", content: "  Ergebnis  " }));

    expect(response.status).toBe(200);
    expect(renderChatPdf).toHaveBeenCalledWith({
      title: "SV-Berechnung",
      content: "Ergebnis",
      date: "02.01.2026",
    });
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
