import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { POST } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function authenticatedRequest(method = "POST"): Request {
  return new Request("http://localhost/api/fred/sessions", {
    method,
    headers: { Authorization: "Bearer test-token" },
  });
}

describe("POST /api/fred/sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSupabaseServerClient).mockReturnValue({} as never);
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: USER_ID });
    process.env.WEKNORA_BASE_URL = "https://weknora.example.com/api/v1";
    process.env.WEKNORA_API_KEY = "test-weknora-key";
  });

  it("rejects unauthenticated requests", async () => {
    vi.mocked(authenticateSupabaseRequest).mockRejectedValueOnce(
      new UserVisibleError("Bitte zuerst anmelden.", 401),
    );

    const response = await POST(authenticatedRequest());

    expect(response.status).toBe(401);
  });

  it("returns 503 when WEKNORA_BASE_URL is missing", async () => {
    delete (process.env as Record<string, string>).WEKNORA_BASE_URL;

    const response = await POST(authenticatedRequest());

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBeTruthy();
  });

  it("returns 503 when WEKNORA_API_KEY is missing", async () => {
    delete (process.env as Record<string, string>).WEKNORA_API_KEY;

    const response = await POST(authenticatedRequest());

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBeTruthy();
  });
});
