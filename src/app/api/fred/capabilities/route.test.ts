import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getScanningSettings } from "@/lib/scanning/settings";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  FredEmbedUpstreamError,
  mintFredEmbedSession,
  readFredEmbedServerConfig,
  readFredProModelId,
  readQuickFredEmbedServerConfig,
} from "@/lib/weknora/fred-embed";
import { fetchFredUpstreamConfig } from "@/lib/weknora/fred-native";
import { resetFredCapabilitiesCacheForTests } from "./cache";
import { GET } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/scanning/settings", () => ({ getScanningSettings: vi.fn() }));
vi.mock("@/lib/weknora/fred-embed", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/weknora/fred-embed")>();
  return { ...original, mintFredEmbedSession: vi.fn(), readFredEmbedServerConfig: vi.fn(),
    readFredProModelId: vi.fn(), readQuickFredEmbedServerConfig: vi.fn() };
});
vi.mock("@/lib/weknora/fred-native", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/weknora/fred-native")>();
  return { ...original, fetchFredUpstreamConfig: vi.fn() };
});

const fredConfig = {
  agentKey: "fred" as const,
  channelId: "fred-channel",
  publishToken: "em_publish_token_fixture_123456",
  exchangeOrigin: "https://findog.at",
};
const quickFredConfig = {
  agentKey: "quickfred" as const,
  channelId: "quickfred-channel",
  publishToken: "em_quickfred_publish_fixture_123456",
  exchangeOrigin: "https://findog.at",
  expectedAgentId: "a1b2c3d4-e5f6-4789-abcd-ef0123456789",
};

function capabilityRequest(signal?: AbortSignal): Request {
  return new Request("https://findog.at/api/fred/capabilities", {
    headers: { Authorization: "Bearer token", "Sec-Fetch-Site": "same-origin" },
    signal,
  });
}

function embedSession(channelId: string) {
  return {
    token: `ems_session_token_${channelId}_123456`,
    expiresIn: 1800,
    channelId,
    embedOrigin: "https://taxdog.cloud" as const,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("GET /api/fred/capabilities", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetFredCapabilitiesCacheForTests();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ auth: {} } as never);
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "user-1" });
    vi.mocked(readFredEmbedServerConfig).mockReturnValue(fredConfig);
    vi.mocked(getScanningSettings).mockResolvedValue({
      documentPipeline: "mineru_with_omniroute_luna_fallback",
      fredAttachmentMode: "findog_preprocess",
      scanningProvider: "omniroute_luna",
      modelId: "google/gemini-3.5-flash",
      prompt: "prompt",
      updatedAt: "2026-07-19T10:00:00.000Z",
      updatedBy: null,
    });
    vi.mocked(mintFredEmbedSession).mockImplementation(async (options = {}) => {
      return embedSession(options.config?.channelId ?? fredConfig.channelId);
    });
    vi.mocked(fetchFredUpstreamConfig).mockResolvedValue({
      agentId: "agent-1",
      knowledgeBaseIds: [],
      allowWebSearch: true,
      allowFileUpload: true,
      allowImageUpload: true,
    });
    vi.stubEnv("MINERU_API_TOKEN", "test-mineru-token");
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("returns webSearch from WeKnora and custom-mode fileUpload from the OpenRouter prerequisite", async () => {
    const request = new Request("https://findog.at/api/fred/capabilities", {
      headers: { Authorization: "Bearer token", "Sec-Fetch-Site": "same-origin" },
    });
    const response = await GET(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      webSearch: true,
      fileUpload: true,
      imageUpload: true,
      proMode: true,
      quickFred: false,
    });
    expect(authenticateSupabaseRequest).toHaveBeenCalledWith(request, expect.anything());
  });

  it("keeps file upload enabled when only MINERU_API_TOKEN is missing", async () => {
    vi.stubEnv("MINERU_API_TOKEN", "");
    const request = new Request("https://findog.at/api/fred/capabilities", {
      headers: { Authorization: "Bearer token", "Sec-Fetch-Site": "same-origin" },
    });
    const response = await GET(request);
    const data = await response.json() as Record<string, unknown>;
    expect(data.fileUpload).toBe(true);
    expect(data.webSearch).toBe(true);
  });

  it("returns custom-mode fileUpload false when OPENROUTER_API_KEY is missing", async () => {
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

  it("returns native-mode fileUpload true from the live Fred channel upload flag", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.mocked(getScanningSettings).mockResolvedValue({
      documentPipeline: "omniroute_luna_only",
      fredAttachmentMode: "weknora_native",
      scanningProvider: "omniroute_luna",
      modelId: "model/x",
      prompt: "prompt",
      updatedAt: "2026-07-19T10:00:00.000Z",
      updatedBy: null,
    });
    vi.mocked(fetchFredUpstreamConfig).mockResolvedValue({
      agentId: "agent-1",
      knowledgeBaseIds: [],
      allowWebSearch: true,
      allowFileUpload: true,
      allowImageUpload: false,
    });

    const response = await GET(capabilityRequest());

    await expect(response.json()).resolves.toEqual({
      webSearch: true,
      fileUpload: true,
      imageUpload: false,
      proMode: true,
      quickFred: false,
    });
  });

  it("returns native-mode fileUpload false when the live Fred channel disallows upload", async () => {
    vi.mocked(getScanningSettings).mockResolvedValue({
      documentPipeline: "omniroute_luna_only",
      fredAttachmentMode: "weknora_native",
      scanningProvider: "omniroute_luna",
      modelId: "model/x",
      prompt: "prompt",
      updatedAt: "2026-07-19T10:00:00.000Z",
      updatedBy: null,
    });
    vi.mocked(fetchFredUpstreamConfig).mockResolvedValue({
      agentId: "agent-1",
      knowledgeBaseIds: [],
      allowWebSearch: true,
      allowFileUpload: false,
      allowImageUpload: false,
    });

    const response = await GET(capabilityRequest());

    await expect(response.json()).resolves.toEqual({
      webSearch: true,
      fileUpload: false,
      imageUpload: false,
      proMode: true,
      quickFred: false,
    });
  });

  it("returns webSearch false from WeKnora config without breaking fileUpload", async () => {
    vi.mocked(fetchFredUpstreamConfig).mockResolvedValue({
      agentId: "agent-1",
      knowledgeBaseIds: [],
      allowWebSearch: false,
      allowFileUpload: false,
      allowImageUpload: false,
    });
    const request = new Request("https://findog.at/api/fred/capabilities", {
      headers: { Authorization: "Bearer token", "Sec-Fetch-Site": "same-origin" },
    });
    const response = await GET(request);
    await expect(response.json()).resolves.toEqual({
      webSearch: false,
      fileUpload: true,
      imageUpload: true,
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
        allowImageUpload: true,
      })
      .mockResolvedValueOnce({
        agentId: "a1b2c3d4-e5f6-4789-abcd-ef0123456789",
        knowledgeBaseIds: [],
        allowWebSearch: true,
        allowFileUpload: true,
        allowImageUpload: true,
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
        allowImageUpload: true,
      })
      .mockResolvedValueOnce({
        agentId: "wrong-agent",
        knowledgeBaseIds: [],
        allowWebSearch: true,
        allowFileUpload: true,
        allowImageUpload: true,
      });

    const response = await GET(new Request("https://findog.at/api/fred/capabilities", {
      headers: { Authorization: "Bearer token", "Sec-Fetch-Site": "same-origin" },
    }));
    const data = await response.json() as Record<string, unknown>;
    expect(data).toMatchObject({ webSearch: true, quickFred: false });
  });

  it("starts cold Fred and QuickFred probe paths concurrently with independent sequential config fetches", async () => {
    vi.mocked(readQuickFredEmbedServerConfig).mockReturnValue(quickFredConfig);
    const fredSession = deferred<ReturnType<typeof embedSession>>();
    const quickSession = deferred<ReturnType<typeof embedSession>>();
    vi.mocked(mintFredEmbedSession).mockImplementation((options = {}) => (
      options.config?.channelId === quickFredConfig.channelId
        ? quickSession.promise
        : fredSession.promise
    ));
    vi.mocked(fetchFredUpstreamConfig).mockImplementation(async ({ session }) => ({
      agentId: session.channelId === quickFredConfig.channelId
        ? quickFredConfig.expectedAgentId
        : "fred-agent",
      knowledgeBaseIds: [],
      allowWebSearch: true,
      allowFileUpload: true,
      allowImageUpload: true,
    }));
    const browserController = new AbortController();
    const request = capabilityRequest(browserController.signal);
    const responsePromise = GET(request);

    await vi.waitFor(() => expect(mintFredEmbedSession).toHaveBeenCalledTimes(2));
    expect(fetchFredUpstreamConfig).not.toHaveBeenCalled();
    expect(vi.mocked(mintFredEmbedSession).mock.calls.map(([options]) => (
      options?.config?.channelId
    ))).toEqual(expect.arrayContaining([
      fredConfig.channelId,
      quickFredConfig.channelId,
    ]));
    expect(vi.mocked(mintFredEmbedSession).mock.calls[0][0]?.signal).not.toBe(request.signal);

    fredSession.resolve(embedSession(fredConfig.channelId));
    quickSession.resolve(embedSession(quickFredConfig.channelId));
    const response = await responsePromise;
    await expect(response.json()).resolves.toMatchObject({
      webSearch: true,
      quickFred: true,
    });
    expect(fetchFredUpstreamConfig).toHaveBeenCalledTimes(2);
  });

  it("serves a fresh derived hit without upstream calls and recomputes local flags", async () => {
    await GET(capabilityRequest());
    vi.mocked(mintFredEmbedSession).mockClear();
    vi.mocked(fetchFredUpstreamConfig).mockClear();
    vi.stubEnv("MINERU_API_TOKEN", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.mocked(getScanningSettings).mockResolvedValue({
      documentPipeline: "omniroute_luna_only",
      fredAttachmentMode: "weknora_native",
      scanningProvider: "omniroute_luna",
      modelId: "model/x",
      prompt: "prompt",
      updatedAt: "2026-07-19T10:00:00.000Z",
      updatedBy: null,
    });
    vi.mocked(readFredProModelId).mockImplementation(() => {
      throw new Error("disabled");
    });

    const response = await GET(capabilityRequest());

    await expect(response.json()).resolves.toEqual({
      webSearch: true,
      fileUpload: true,
      imageUpload: true,
      proMode: false,
      quickFred: false,
    });
    expect(mintFredEmbedSession).not.toHaveBeenCalled();
    expect(fetchFredUpstreamConfig).not.toHaveBeenCalled();
    expect(authenticateSupabaseRequest).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight refresh across concurrent cache misses", async () => {
    const session = deferred<ReturnType<typeof embedSession>>();
    vi.mocked(mintFredEmbedSession).mockReturnValue(session.promise);

    const firstResponse = GET(capabilityRequest());
    const secondResponse = GET(capabilityRequest());
    await vi.waitFor(() => expect(mintFredEmbedSession).toHaveBeenCalledTimes(1));
    session.resolve(embedSession(fredConfig.channelId));

    const responses = await Promise.all([firstResponse, secondResponse]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(fetchFredUpstreamConfig).toHaveBeenCalledTimes(1);
    expect(authenticateSupabaseRequest).toHaveBeenCalledTimes(2);
  });

  it("serves stale derived capabilities when a refresh fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-25T00:00:00.000Z"));
    await GET(capabilityRequest());
    vi.setSystemTime(new Date("2026-07-25T00:01:00.001Z"));
    vi.mocked(mintFredEmbedSession).mockRejectedValue(
      new FredEmbedUpstreamError("unavailable"),
    );

    const response = await GET(capabilityRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      webSearch: true,
      quickFred: false,
    });
  });

  it("does not hide a Fred failure after the stale window expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-25T00:00:00.000Z"));
    await GET(capabilityRequest());
    vi.setSystemTime(new Date("2026-07-25T00:10:00.001Z"));
    vi.mocked(mintFredEmbedSession).mockRejectedValue(
      new FredEmbedUpstreamError("unavailable"),
    );

    const response = await GET(capabilityRequest());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Fred ist derzeit nicht erreichbar.",
    });
  });

  it("authenticates every fresh-cache request before returning derived capabilities", async () => {
    await GET(capabilityRequest());
    vi.mocked(mintFredEmbedSession).mockClear();
    vi.mocked(authenticateSupabaseRequest).mockRejectedValue(
      new UserVisibleError("Nicht angemeldet.", 401),
    );

    const response = await GET(capabilityRequest());

    expect(response.status).toBe(401);
    expect(mintFredEmbedSession).not.toHaveBeenCalled();
  });
});
