import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildFredLiveSessionConfig,
  createFredLiveSession,
  FRED_LIVE_DEFAULT_VOICE,
  FRED_LIVE_INSTRUCTIONS,
  FRED_LIVE_MODEL,
  FRED_LIVE_VOICES,
  resolveFredLiveApiKey,
  resolveFredLiveVoice,
} from "./fred-live";

describe("Fred Live session", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds the client-delegated session config with the configured voice", () => {
    expect(buildFredLiveSessionConfig("vesper")).toEqual({
      model: FRED_LIVE_MODEL,
      instructions: FRED_LIVE_INSTRUCTIONS,
      audio: { output: { voice: "vesper" } },
      delegation: { type: "client" },
    });
    expect(buildFredLiveSessionConfig().audio.output.voice).toBe(FRED_LIVE_DEFAULT_VOICE);
    expect(FRED_LIVE_INSTRUCTIONS.trim()).not.toBe("");
  });

  it("accepts only voices GPT-Live knows and falls back to the male default", () => {
    expect(FRED_LIVE_VOICES).toContain(FRED_LIVE_DEFAULT_VOICE);
    expect(resolveFredLiveVoice({ OPENAI_LIVE_VOICE: " Vesper " })).toBe("vesper");
    expect(resolveFredLiveVoice({ OPENAI_LIVE_VOICE: "darth-vader" })).toBe(FRED_LIVE_DEFAULT_VOICE);
    expect(resolveFredLiveVoice({})).toBe(FRED_LIVE_DEFAULT_VOICE);
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
