import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { mintFredEmbedSession, readFredEmbedServerConfig } from "@/lib/weknora/fred-embed";
import { fetchFredUpstreamConfig } from "@/lib/weknora/fred-native";
import { GET } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/weknora/fred-embed", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/weknora/fred-embed")>();
  return { ...original, mintFredEmbedSession: vi.fn(), readFredEmbedServerConfig: vi.fn() };
});
vi.mock("@/lib/weknora/fred-native", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/weknora/fred-native")>();
  return { ...original, fetchFredUpstreamConfig: vi.fn() };
});

describe("GET /api/fred/capabilities", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ auth: {} } as never);
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "user-1" });
    vi.mocked(readFredEmbedServerConfig).mockReturnValue({
      channelId: "fred-channel",
      publishToken: "em_publish_token_fixture_123456",
      exchangeOrigin: "https://findog.at",
    });
    vi.mocked(mintFredEmbedSession).mockResolvedValue({
      token: "ems_session_token_fixture_123456",
      expiresIn: 1800,
      channelId: "fred-channel",
      embedOrigin: "https://taxdog.cloud",
    });
    vi.mocked(fetchFredUpstreamConfig).mockResolvedValue({
      agentId: "agent-1",
      knowledgeBaseIds: [],
      allowWebSearch: true,
      allowFileUpload: true,
    });
  });

  it("returns only authenticated channel capabilities", async () => {
    const request = new Request("https://findog.at/api/fred/capabilities", {
      headers: { Authorization: "Bearer token", "Sec-Fetch-Site": "same-origin" },
    });
    const response = await GET(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ webSearch: true, fileUpload: true });
    expect(authenticateSupabaseRequest).toHaveBeenCalledWith(request, expect.anything());
  });

  it("rejects cross-site capability requests before contacting WeKnora", async () => {
    const response = await GET(new Request("https://findog.at/api/fred/capabilities", {
      headers: { "Sec-Fetch-Site": "cross-site" },
    }));
    expect(response.status).toBe(403);
    expect(mintFredEmbedSession).not.toHaveBeenCalled();
  });
});
