import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { POST } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

function request(body: Record<string, unknown> = {}, headers: Record<string, string> = {}): Request {
  return new Request("https://findog.at/api/fred/public-shares", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer token",
      "Sec-Fetch-Site": "same-origin",
      ...headers,
    },
    body: body && Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
  });
}

function mockRpc(shareId = "11111111-1111-4111-8111-111111111111") {
  vi.mocked(getSupabaseServerClient).mockReturnValue({
    rpc: vi.fn().mockResolvedValue({
      data: { share_id: shareId },
      error: null,
    }),
  } as never);
}

function mockSupabaseMissing() {
  vi.mocked(getSupabaseServerClient).mockReturnValue(null);
}

describe("POST /api/fred/public-shares", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "user-1" });
    mockRpc(); // Default mock for most tests
  });

  it("returns 401 without authentication", async () => {
    vi.mocked(authenticateSupabaseRequest).mockRejectedValueOnce(
      new (await import("@/lib/errors")).UserVisibleError("Nicht authentifiziert.", 401),
    );

    const response = await POST(request({ conversationId: "33333333-3333-4333-8333-333333333333", assistantMessageId: 42 }));
    expect(response.status).toBe(401);
  });

  it("returns 403 for cross-site requests", async () => {
    const response = await POST(
      request(
        { conversationId: "33333333-3333-4333-8333-333333333333", assistantMessageId: 42 },
        { "Sec-Fetch-Site": "cross-site" },
      ),
    );
    expect(response.status).toBe(403);
  });

  it("returns 400 for missing body", async () => {
    const response = await POST(
      new Request("https://findog.at/api/fred/public-shares", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer token",
          "Sec-Fetch-Site": "same-origin",
        },
      }),
    );
    expect(response.status).toBe(400);
  });

  it("returns 415 for non-JSON content type", async () => {
    const response = await POST(
      new Request("https://findog.at/api/fred/public-shares", {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          Authorization: "Bearer token",
          "Sec-Fetch-Site": "same-origin",
        },
        body: "not-json",
      }),
    );
    expect(response.status).toBe(415);
  });

  it("returns 400 for invalid conversationId", async () => {
    const response = await POST(request({ conversationId: "not-a-uuid", assistantMessageId: 42 }));
    expect(response.status).toBe(400);
  });

  it("returns 400 for missing assistantMessageId", async () => {
    const response = await POST(request({ conversationId: "33333333-3333-4333-8333-333333333333" }));
    expect(response.status).toBe(400);
  });

  it("returns 400 for numeric-string assistantMessageId", async () => {
    const response = await POST(request({ conversationId: "33333333-3333-4333-8333-333333333333", assistantMessageId: "42" }));
    expect(response.status).toBe(400);
  });

  it("returns 400 for zero assistantMessageId", async () => {
    const response = await POST(request({ conversationId: "33333333-3333-4333-8333-333333333333", assistantMessageId: 0 }));
    expect(response.status).toBe(400);
  });

  it("returns 400 for negative assistantMessageId", async () => {
    const response = await POST(request({ conversationId: "33333333-3333-4333-8333-333333333333", assistantMessageId: -1 }));
    expect(response.status).toBe(400);
  });

  it("returns 400 for non-integer assistantMessageId", async () => {
    const response = await POST(request({ conversationId: "33333333-3333-4333-8333-333333333333", assistantMessageId: 3.14 }));
    expect(response.status).toBe(400);
  });

  it("returns 503 when supabase client is unavailable", async () => {
    mockSupabaseMissing();

    const response = await POST(request({ conversationId: "33333333-3333-4333-8333-333333333333", assistantMessageId: 42 }));
    expect(response.status).toBe(503);
  });

  it("returns 404 when RPC rejects with not-found error", async () => {
    vi.mocked(getSupabaseServerClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "fred public share conversation not found" },
      }),
    } as never);

    const response = await POST(request({ conversationId: "33333333-3333-4333-8333-333333333333", assistantMessageId: 42 }));
    expect(response.status).toBe(404);
  });

  it("returns success with shareId and sharePath on valid request", async () => {
    const response = await POST(request({ conversationId: "33333333-3333-4333-8333-333333333333", assistantMessageId: 42 }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({
      shareId: "11111111-1111-4111-8111-111111111111",
      sharePath: "/fred/share/11111111-1111-4111-8111-111111111111",
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("returns same shareId on repeat calls (idempotent)", async () => {
    const response1 = await POST(request({ conversationId: "33333333-3333-4333-8333-333333333333", assistantMessageId: 42 }));
    const payload1 = await response1.json();
    const response2 = await POST(request({ conversationId: "33333333-3333-4333-8333-333333333333", assistantMessageId: 42 }));
    const payload2 = await response2.json();
    expect(payload1).toEqual(payload2);
  });

  it("returns no-store Cache-Control", async () => {
    const response = await POST(request({ conversationId: "33333333-3333-4333-8333-333333333333", assistantMessageId: 42 }));
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("returns only shareId and sharePath in response body", async () => {
    const response = await POST(request({ conversationId: "33333333-3333-4333-8333-333333333333", assistantMessageId: 42 }));
    const payload = await response.json();
    expect(Object.keys(payload).sort()).toEqual(["shareId", "sharePath"].sort());
  });

  it("requires assistantMessageId to be typeof number, rejecting numeric strings", () => {
    // Source-level check: validatePayload must use typeof === "number" not Number()
    const routeSource = readFileSync(
      fileURLToPath(new URL("./route.ts", import.meta.url)),
      "utf8",
    );
    expect(routeSource).toContain('typeof body.assistantMessageId !== "number"');
    expect(routeSource).not.toMatch(/Number\(body\.assistantMessageId\)/);
  });
});

// Need fileURLToPath for source check
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
