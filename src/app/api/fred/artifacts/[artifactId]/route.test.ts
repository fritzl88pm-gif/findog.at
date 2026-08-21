import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { UserVisibleError } from "@/lib/errors";

import { GET } from "./route";

vi.mock("@/lib/auth/server", () => ({
  authenticateSupabaseRequest: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: vi.fn(),
}));

const userId = "11111111-1111-4111-8111-111111111111";
const validArtifactId = "22222222-2222-4222-8222-222222222222";
const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
]);

function createRequest(options: {
  url?: string;
  secFetchSite?: string;
  authHeader?: string;
} = {}): Request {
  const headers: Record<string, string> = {
    Authorization: options.authHeader ?? "Bearer test-jwt-token",
    "Sec-Fetch-Site": options.secFetchSite ?? "same-origin",
  };
  return new Request(options.url ?? `https://findog.at/api/fred/artifacts/${validArtifactId}`, {
    method: "GET",
    headers,
  });
}

function mockSupabase(artifactData: unknown = null, error: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: artifactData, error });
  const eq2 = vi.fn().mockReturnValue({ maybeSingle });
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
  const select = vi.fn().mockReturnValue({ eq: eq1 });
  const from = vi.fn().mockReturnValue({ select });
  return { from };
}

describe("GET /api/fred/artifacts/[artifactId]", () => {
  const originalApiKey = process.env.WEKNORA_API_KEY;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.WEKNORA_API_KEY = "test-weknora-api-key";
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: userId });
  });

  afterEach(() => {
    process.env.WEKNORA_API_KEY = originalApiKey;
    vi.restoreAllMocks();
  });

  it("rejects non-UUID artifact ID with 400", async () => {
    const request = createRequest({ url: "https://findog.at/api/fred/artifacts/not-a-uuid" });
    const response = await GET(request, { params: Promise.resolve({ artifactId: "not-a-uuid" }) });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("ungültig");
  });

  it("rejects cross-site requests with 403", async () => {
    const request = createRequest({ secFetchSite: "cross-site" });
    const response = await GET(request, { params: Promise.resolve({ artifactId: validArtifactId }) });
    expect(response.status).toBe(403);
  });

  it("requires bearer authentication before querying DB or upstream", async () => {
    vi.mocked(getSupabaseServerClient).mockReturnValue(mockSupabase() as never);
    vi.mocked(authenticateSupabaseRequest).mockRejectedValue(
      new UserVisibleError("Bitte zuerst anmelden.", 401),
    );

    const request = createRequest();
    const response = await GET(request, { params: Promise.resolve({ artifactId: validArtifactId }) });
    expect(response.status).toBe(401);
  });

  it("returns 404 when artifact is not found or client_id does not match", async () => {
    const supabase = mockSupabase(null);
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase as never);

    const request = createRequest();
    const response = await GET(request, { params: Promise.resolve({ artifactId: validArtifactId }) });
    expect(response.status).toBe(404);
    expect(supabase.from).toHaveBeenCalledWith("fred_native_image_artifacts");
  });

  it("returns 503 if WEKNORA_API_KEY is not configured", async () => {
    delete process.env.WEKNORA_API_KEY;
    const supabase = mockSupabase({
      id: validArtifactId,
      client_id: userId,
      source_uri: "minio://bucket/image.png",
      mime_type: "image/png",
      original_name: "image.png",
    });
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase as never);

    const request = createRequest();
    const response = await GET(request, { params: Promise.resolve({ artifactId: validArtifactId }) });
    expect(response.status).toBe(503);
  });

  it("fetches upstream with exact URL, X-API-Key, Accept, cache:no-store, and redirect:error", async () => {
    const supabase = mockSupabase({
      id: validArtifactId,
      client_id: userId,
      source_uri: "minio://bucket/image.png",
      mime_type: "image/png",
      original_name: "test.png",
    });
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase as never);

    const fetchMock = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://taxdog.cloud/api/v1/files?file_path=minio%3A%2F%2Fbucket%2Fimage.png");
      const headers = init.headers as Record<string, string>;
      expect(headers["X-API-Key"]).toBe("test-weknora-api-key");
      expect(headers["Accept"]).toBe("image/*");
      expect(init.cache).toBe("no-store");
      expect(init.redirect).toBe("error");
      return new Response(pngBytes, {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const request = createRequest();
    const response = await GET(request, { params: Promise.resolve({ artifactId: validArtifactId }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Content-Length")).toBe(String(pngBytes.byteLength));
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Disposition")).toBe(
      "inline; filename=\"image.png\"; filename*=UTF-8''test.png",
    );

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes).toEqual(pngBytes);
  });

  it("rejects responses exceeding 10 MiB with 413", async () => {
    const supabase = mockSupabase({
      id: validArtifactId,
      client_id: userId,
      source_uri: "minio://bucket/huge.png",
      mime_type: "image/png",
      original_name: "huge.png",
    });
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase as never);

    // Stream that sends > 10 MiB
    const largeChunk = new Uint8Array(1024 * 1024); // 1 MiB
    let chunksSent = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (chunksSent < 11) {
          controller.enqueue(largeChunk);
          chunksSent += 1;
        } else {
          controller.close();
        }
      },
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { "Content-Type": "image/png" },
    })));

    const request = createRequest();
    const response = await GET(request, { params: Promise.resolve({ artifactId: validArtifactId }) });
    expect(response.status).toBe(413);
  });

  it("rejects magic signature mismatch with controlled 502", async () => {
    const supabase = mockSupabase({
      id: validArtifactId,
      client_id: userId,
      source_uri: "minio://bucket/fake.png",
      mime_type: "image/png",
      original_name: "fake.png",
    });
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase as never);

    const fakeBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]); // Not valid PNG magic
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(fakeBytes, {
      status: 200,
      headers: { "Content-Type": "image/png" },
    })));

    const request = createRequest();
    const response = await GET(request, { params: Promise.resolve({ artifactId: validArtifactId }) });
    expect(response.status).toBe(502);
  });

  it("rejects missing or unsupported upstream content types instead of trusting stored metadata", async () => {
    const supabase = mockSupabase({
      id: validArtifactId,
      client_id: userId,
      source_uri: "minio://bucket/image.png",
      mime_type: "image/png",
      original_name: "image.png",
    });
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase as never);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(pngBytes, { status: 200 })));
    const missingType = await GET(createRequest(), {
      params: Promise.resolve({ artifactId: validArtifactId }),
    });
    expect(missingType.status).toBe(502);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(pngBytes, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    })));
    const unsupportedType = await GET(createRequest(), {
      params: Promise.resolve({ artifactId: validArtifactId }),
    });
    expect(unsupportedType.status).toBe(502);
  });

  it("encodes the original filename without placing model-controlled quotes in the header", async () => {
    const supabase = mockSupabase({
      id: validArtifactId,
      client_id: userId,
      source_uri: "minio://bucket/image.png",
      mime_type: "image/png",
      original_name: "Beleg \"final\".png",
    });
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase as never);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(pngBytes, {
      status: 200,
      headers: { "Content-Type": "image/png" },
    })));

    const response = await GET(createRequest(), {
      params: Promise.resolve({ artifactId: validArtifactId }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(
      "inline; filename=\"image.png\"; filename*=UTF-8''Beleg%20%22final%22.png",
    );
  });

  it("handles upstream error status codes appropriately", async () => {
    const supabase = mockSupabase({
      id: validArtifactId,
      client_id: userId,
      source_uri: "minio://bucket/image.png",
      mime_type: "image/png",
      original_name: "image.png",
    });
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase as never);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Not found", { status: 404 })));
    const response404 = await GET(createRequest(), { params: Promise.resolve({ artifactId: validArtifactId }) });
    expect(response404.status).toBe(404);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Server error", { status: 500 })));
    const response500 = await GET(createRequest(), { params: Promise.resolve({ artifactId: validArtifactId }) });
    expect(response500.status).toBe(502);
  });
});
