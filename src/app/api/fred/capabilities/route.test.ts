import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { mintFredEmbedSession, readFredEmbedServerConfig,
  readFredProModelId,
  readQuickFredEmbedServerConfig,
} from "@/lib/weknora/fred-embed";
import { fetchFredUpstreamConfig } from "@/lib/weknora/fred-native";
import { GET } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/weknora/fred-embed", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/weknora/fred-embed")>();
  return { ...original, mintFredEmbedSession: vi.fn(), readFredEmbedServerConfig: vi.fn(),
    readFredProModelId: vi.fn(), readQuickFredEmbedServerConfig: vi.fn() };
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
    vi.stubEnv("MINERU_API_TOKEN", "test-mineru-token");
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns webSearch from WeKnora and fileUpload from env vars", async () => {
    const request = new Request("https://findog.at/api/fred/capabilities", {
      headers: { Authorization: "Bearer token", "Sec-Fetch-Site": "same-origin" },
    });
    const response = await GET(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      webSearch: true,
      fileUpload: true,
      proMode: true,
      quickFred: false,
    });
    expect(authenticateSupabaseRequest).toHaveBeenCalledWith(request, expect.anything());
  });

  it("returns fileUpload false when MINERU_API_TOKEN is missing", async () => {
    vi.stubEnv("MINERU_API_TOKEN", "");
    const request = new Request("https://findog.at/api/fred/capabilities", {
      headers: { Authorization: "Bearer token", "Sec-Fetch-Site": "same-origin" },
    });
    const response = await GET(request);
    const data = await response.json() as Record<string, unknown>;
    expect(data.fileUpload).toBe(false);
    expect(data.webSearch).toBe(true);
  });

  it("returns fileUpload false when OPENROUTER_API_KEY is missing", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const request = new Request("https://findog.at/api/fred/capabilities", {
      headers: { Authorization: "Bearer token", "Sec-Fetch-Site": "same-origin" },
    });
    const response = await GET(request);
    const data = await response.json() as Record<string, unknown>;
    expect(data.fileUpload).toBe(false);
    expect(data.webSearch).toBe(true);
  });

  it("returns fileUpload false when both env vars are missing", async () => {
    vi.stubEnv("MINERU_API_TOKEN", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const request = new Request("https://findog.at/api/fred/capabilities", {
      headers: { Authorization: "Bearer token", "Sec-Fetch-Site": "same-origin" },
    });
    const response = await GET(request);
    const data = await response.json() as Record<string, unknown>;
    expect(data.fileUpload).toBe(false);
    expect(data.webSearch).toBe(true);
  });

  it("returns webSearch false from WeKnora config without breaking fileUpload", async () => {
    vi.mocked(fetchFredUpstreamConfig).mockResolvedValue({
      agentId: "agent-1",
      knowledgeBaseIds: [],
      allowWebSearch: false,
      allowFileUpload: false,
    });
    const request = new Request("https://findog.at/api/fred/capabilities", {
      headers: { Authorization: "Bearer token", "Sec-Fetch-Site": "same-origin" },
    });
    const response = await GET(request);
    await expect(response.json()).resolves.toEqual({
      webSearch: false,
      fileUpload: true,
      proMode: true,
      quickFred: false,
    });
  });

  it("rejects cross-site capability requests before contacting WeKnora", async () => {
    const response = await GET(new Request("https://findog.at/api/fred/capabilities", {
      headers: { "Sec-Fetch-Site": "cross-site" },
    }));
    expect(response.status).toBe(403);
    expect(mintFredEmbedSession).not.toHaveBeenCalled();
  });

  it("returns proMode true when WEKNORA_FRED_PRO_MODEL_ID is set to a valid UUID", async () => {
    vi.mocked(readFredProModelId).mockReturnValue("a1b2c3d4-e5f6-4789-abcd-ef0123456789");
    const request = new Request("https://findog.at/api/fred/capabilities", {
      headers: { Authorization: "Bearer token", "Sec-Fetch-Site": "same-origin" },
    });
    const response = await GET(request);
    const data = await response.json() as Record<string, unknown>;
    expect(data.proMode).toBe(true);
    expect(data.webSearch).toBe(true);
    expect(data.fileUpload).toBe(true);
  });

  it("returns proMode false when readFredProModelId throws (missing/invalid config)", async () => {
    vi.mocked(readFredProModelId).mockImplementation(() => {
      throw new Error("not a FredEmbedConfigurationError but a throw");
    });
    const request = new Request("https://findog.at/api/fred/capabilities", {
      headers: { Authorization: "Bearer token", "Sec-Fetch-Site": "same-origin" },
    });
    const response = await GET(request);
    const data = await response.json() as Record<string, unknown>;
    expect(data.proMode).toBe(false);
    expect(data.webSearch).toBe(true);
    expect(data.fileUpload).toBe(true);
  });

  it("returns quickFred true only for a distinct channel with the expected agent and matching web search", async () => {
    vi.mocked(readQuickFredEmbedServerConfig).mockReturnValue({
      agentKey: "quickfred",
      channelId: "quickfred-channel",
      publishToken: "em_quickfred_publish_fixture_123456",
      exchangeOrigin: "https://findog.at",
      expectedAgentId: "a1b2c3d4-e5f6-4789-abcd-ef0123456789",
    });
    vi.mocked(fetchFredUpstreamConfig)
      .mockResolvedValueOnce({
        agentId: "fred-agent",
        knowledgeBaseIds: [],
        allowWebSearch: true,
        allowFileUpload: true,
      })
      .mockResolvedValueOnce({
        agentId: "a1b2c3d4-e5f6-4789-abcd-ef0123456789",
        knowledgeBaseIds: [],
        allowWebSearch: true,
        allowFileUpload: true,
      });

    const response = await GET(new Request("https://findog.at/api/fred/capabilities", {
      headers: { Authorization: "Bearer token", "Sec-Fetch-Site": "same-origin" },
    }));
    const data = await response.json() as Record<string, unknown>;
    expect(data.quickFred).toBe(true);
  });

  it("fails QuickFred closed without breaking Fred when the channel reports another agent", async () => {
    vi.mocked(readQuickFredEmbedServerConfig).mockReturnValue({
      agentKey: "quickfred",
      channelId: "quickfred-channel",
      publishToken: "em_quickfred_publish_fixture_123456",
      exchangeOrigin: "https://findog.at",
      expectedAgentId: "a1b2c3d4-e5f6-4789-abcd-ef0123456789",
    });
    vi.mocked(fetchFredUpstreamConfig)
      .mockResolvedValueOnce({
        agentId: "fred-agent",
        knowledgeBaseIds: [],
        allowWebSearch: true,
        allowFileUpload: true,
      })
      .mockResolvedValueOnce({
        agentId: "wrong-agent",
        knowledgeBaseIds: [],
        allowWebSearch: true,
        allowFileUpload: true,
      });

    const response = await GET(new Request("https://findog.at/api/fred/capabilities", {
      headers: { Authorization: "Bearer token", "Sec-Fetch-Site": "same-origin" },
    }));
    const data = await response.json() as Record<string, unknown>;
    expect(data).toMatchObject({ webSearch: true, quickFred: false });
  });
});
