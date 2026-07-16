import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { createFredSessionToken } from "@/lib/fred/token";
import { POST } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WEKNORA_SESSION_ID = "wkn-session-123";
const WEKNORA_API_KEY = "test-weknora-key";
const MESSAGE_ID = "msg-456";

function makeValidToken(): string {
  return createFredSessionToken({
    apiKey: WEKNORA_API_KEY,
    userId: USER_ID,
    weknoraSessionId: WEKNORA_SESSION_ID,
  });
}

function stopRequest(body: Record<string, unknown>): Request {
  const token = makeValidToken();
  return new Request("http://localhost/api/fred/stop", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-supabase-token",
      "Content-Type": "application/json",
      "X-Fred-Session-Token": token,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/fred/stop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSupabaseServerClient).mockReturnValue({} as never);
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: USER_ID });
    process.env.WEKNORA_BASE_URL = "https://weknora.example.com/api/v1";
    process.env.WEKNORA_API_KEY = WEKNORA_API_KEY;
  });

  it("rejects requests without a session token", async () => {
    const request = new Request("http://localhost/api/fred/stop", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-supabase-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messageId: MESSAGE_ID }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("rejects requests without a messageId", async () => {
    const request = stopRequest({});

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("returns 502 when upstream stop fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, { status: 404 }),
    );

    const request = stopRequest({ messageId: MESSAGE_ID });
    const response = await POST(request);

    expect(response.status).toBe(502);
  });

  it("succeeds when upstream stop responds ok", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, { status: 200 }),
    );

    const request = stopRequest({ messageId: MESSAGE_ID });
    const response = await POST(request);

    expect(response.status).toBe(200);
  });
});
