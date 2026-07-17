import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { renderChatPdf } from "@/lib/documents/pdf";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GET } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/documents/pdf", () => ({ renderChatPdf: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

const artifactId = "55555555-5555-4555-8555-555555555555";

function request(): Request {
  return new Request(`http://localhost/api/documents/pdf/${artifactId}`, {
    headers: { Authorization: "Bearer access-token" },
  });
}

function artifactClient(data: Record<string, unknown> | null) {
  const query = {
    eq: vi.fn(() => query),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
  return {
    from: vi.fn(() => ({ select: vi.fn(() => query) })),
    query,
  };
}

describe("GET /api/documents/pdf/:artifactId", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "user-1" });
    vi.mocked(renderChatPdf).mockResolvedValue(new Uint8Array([37, 80, 68, 70, 45]));
  });

  it("renders only the authenticated owner's stored and integrity-checked content", async () => {
    const content = "# Eigenständiges Dokument\n\nGespeicherter Inhalt.";
    const client = artifactClient({
      title: "Eigenständiges Dokument",
      filename: "Eigenstaendiges_Dokument.pdf",
      content_markdown: content,
      content_sha256: createHash("sha256").update(content, "utf8").digest("hex"),
    });
    vi.mocked(getSupabaseServerClient).mockReturnValue(client as never);

    const response = await GET(request(), { params: Promise.resolve({ artifactId }) });

    expect(response.status).toBe(200);
    expect(client.query.eq).toHaveBeenCalledWith("id", artifactId);
    expect(client.query.eq).toHaveBeenCalledWith("client_id", "user-1");
    expect(renderChatPdf).toHaveBeenCalledWith(expect.objectContaining({
      title: "Eigenständiges Dokument",
      content,
    }));
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="Eigenstaendiges_Dokument.pdf"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 404 without revealing an unknown or foreign artifact", async () => {
    const client = artifactClient(null);
    vi.mocked(getSupabaseServerClient).mockReturnValue(client as never);

    const response = await GET(request(), { params: Promise.resolve({ artifactId }) });

    expect(response.status).toBe(404);
    expect(renderChatPdf).not.toHaveBeenCalled();
  });

  it("refuses to render modified stored content", async () => {
    const client = artifactClient({
      title: "Dokument",
      filename: "Dokument.pdf",
      content_markdown: "Veränderter Inhalt",
      content_sha256: "0".repeat(64),
    });
    vi.mocked(getSupabaseServerClient).mockReturnValue(client as never);

    const response = await GET(request(), { params: Promise.resolve({ artifactId }) });

    expect(response.status).toBe(409);
    expect(renderChatPdf).not.toHaveBeenCalled();
  });
});
