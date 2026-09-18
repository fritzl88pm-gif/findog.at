import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildFredLiveSessionConfig,
  createFredLiveSession,
  FRED_LIVE_INSTRUCTIONS,
  FRED_LIVE_MODEL,
  resolveFredLiveApiKey,
} from "./fred-live";

describe("Fred Live session", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds the fixed client-delegated session config", () => {
    expect(buildFredLiveSessionConfig()).toEqual({
      model: FRED_LIVE_MODEL,
      instructions: FRED_LIVE_INSTRUCTIONS,
      delegation: { type: "client" },
    });
    expect(FRED_LIVE_INSTRUCTIONS.trim()).not.toBe("");
  });

  it("resolves the dedicated key before the fallback", () => {
    vi.stubEnv("OPENAI_LIVE_API_KEY", " live-key ");
    vi.stubEnv("OPENAI_API_KEY", "fallback-key");
    expect(resolveFredLiveApiKey()).toBe("live-key");
    vi.stubEnv("OPENAI_LIVE_API_KEY", " ");
    expect(resolveFredLiveApiKey()).toBe("fallback-key");
    vi.stubEnv("OPENAI_API_KEY", " ");
    expect(resolveFredLiveApiKey()).toBeNull();
  });

  it("posts the session config and returns the provider values", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      session: { id: "sess-1" },
      transport: { type: "webrtc", sdp: "answer-sdp" },
    }), { status: 201 }));
    await expect(createFredLiveSession({ sdp: "offer-sdp", apiKey: "secret", fetchImpl }))
      .resolves.toEqual({ sessionId: "sess-1", sdp: "answer-sdp" });
    expect(fetchImpl).toHaveBeenCalledWith("https://api.openai.com/v1/live/sessions", expect.objectContaining({
      method: "POST",
      headers: { Authorization: "Bearer secret", "Content-Type": "application/json" },
    }));
    const options = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(options.body))).toEqual({
      session: buildFredLiveSessionConfig(),
      transport: { type: "webrtc", sdp: "offer-sdp" },
    });
  });

  it("maps invalid input, missing keys, and provider failures safely", async () => {
    await expect(createFredLiveSession({ sdp: "", apiKey: "secret" }))
      .rejects.toMatchObject({ status: 400 });
    await expect(createFredLiveSession({ sdp: "offer-sdp", apiKey: null }))
      .rejects.toMatchObject({ status: 503 });
    for (const status of [400, 401, 500]) {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("sensitive", { status }));
      await expect(createFredLiveSession({ sdp: "offer-sdp", apiKey: "secret", fetchImpl }))
        .rejects.toMatchObject({ status: 502 });
    }
  });
});
