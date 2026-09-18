import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateAdminRequest } from "@/lib/admin-users";
import { UserVisibleError } from "@/lib/errors";
import { createFredLiveSession, resolveFredLiveApiKey } from "@/lib/fred-live";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { POST } from "./route";

vi.mock("@/lib/admin-users", () => ({ authenticateAdminRequest: vi.fn() }));
vi.mock("@/lib/fred-live", () => ({
  createFredLiveSession: vi.fn(),
  resolveFredLiveApiKey: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

function request(body: unknown) {
  return new Request("http://localhost/api/fred-live/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/fred-live/session", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSupabaseServerClient).mockReturnValue({} as never);
    vi.mocked(authenticateAdminRequest).mockResolvedValue({ id: "admin-1" } as never);
    vi.mocked(resolveFredLiveApiKey).mockReturnValue("secret");
    vi.mocked(createFredLiveSession).mockResolvedValue({ sessionId: "session-1", sdp: "answer" });
  });

  it("returns 403 for a non-admin", async () => {
    vi.mocked(authenticateAdminRequest).mockRejectedValue(
      new UserVisibleError("Du hast keine Administrationsberechtigung.", 403),
    );
    expect((await POST(request({ sdp: "offer" }))).status).toBe(403);
  });

  it("returns 400 for missing SDP", async () => {
    expect((await POST(request({}))).status).toBe(400);
  });

  it("returns 503 without a key", async () => {
    vi.mocked(resolveFredLiveApiKey).mockReturnValue(null);
    expect((await POST(request({ sdp: "offer" }))).status).toBe(503);
  });

  it("returns the provider answer", async () => {
    const response = await POST(request({ sdp: "offer" }));
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ sessionId: "session-1", sdp: "answer" });
    expect(createFredLiveSession).toHaveBeenCalledWith({ sdp: "offer", apiKey: "secret" });
  });
});
