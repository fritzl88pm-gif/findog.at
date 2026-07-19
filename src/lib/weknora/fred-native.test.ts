import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  createFredUpstreamSession,
  deriveFredSessionSignature,
  fetchFredUpstreamConfig,
  fredVisitorId,
  openFredUpstreamStream,
} from "./fred-native";

const config = {
  channelId: "fred-channel",
  publishToken: "em_publish_token_fixture_123456",
  exchangeOrigin: "https://findog.at",
};
const session = {
  token: "ems_session_token_fixture_123456",
  expiresIn: 1800,
  channelId: "fred-channel",
  embedOrigin: "https://taxdog.cloud" as const,
};

describe("Fred native WeKnora client", () => {
  it("derives the signed session handle exactly like WeKnora", () => {
    const expected = createHmac("sha256", config.publishToken)
      .update("fred-channel|session-123")
      .digest("base64url");
    expect(deriveFredSessionSignature(config, "session-123")).toBe(expected);
    expect(fredVisitorId(config.publishToken, "user-123")).not.toContain("user-123");
  });

  it("accepts only a newly created session with the expected signature", async () => {
    const id = "session-123";
    const signature = deriveFredSessionSignature(config, id);
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      success: true,
      data: { id, sig: signature },
    }), { status: 200 }));

    await expect(createFredUpstreamSession({
      session,
      config,
      signal: new AbortController().signal,
      fetchImpl,
    })).resolves.toEqual({ id, signature });
  });

  it("loads the public agent binding and opens the correct embed agent stream", async () => {
    const configFetch = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      success: true,
      data: {
        agent_id: "agent-123",
        knowledge_base_ids: ["kb-1"],
        allow_web_search: true,
        agent_web_search_enabled: true,
        allow_file_upload: true,
        agent_image_upload_enabled: true,
      },
    }), { status: 200 }));
    const upstreamConfig = await fetchFredUpstreamConfig({
      session,
      config,
      signal: new AbortController().signal,
      fetchImpl: configFetch,
    });
    const streamFetch = vi.fn<typeof fetch>(async () => new Response("data: {}\n\n", { status: 200 }));
    const signature = deriveFredSessionSignature(config, "session-123");

    await openFredUpstreamStream({
      session,
      config,
      upstreamConfig,
      upstreamSession: { id: "session-123", signature },
      visitorId: "visitor-hash",
      query: "Meine Frage",
      webSearchEnabled: true,
      attachments: [{
        kind: "file",
        name: "beleg.pdf",
        mimeType: "application/pdf",
        sizeBytes: 3,
        sha256: "a".repeat(64),
        dataUri: "data:application/pdf;base64,cGRm",
      }],
      signal: new AbortController().signal,
      fetchImpl: streamFetch,
    });

    const [url, init] = streamFetch.mock.calls[0]!;
    expect(url).toBe("https://taxdog.cloud/api/v1/embed/fred-channel/agent-chat/session-123");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`Embed ${session.token}`);
    expect(headers.get("x-embed-session")).toBe(signature);
    expect(headers.get("x-embed-visitor")).toBe("visitor-hash");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      query: "Meine Frage",
      agent_enabled: true,
      agent_id: "agent-123",
      knowledge_base_ids: ["kb-1"],
      web_search_enabled: true,
      attachment_uploads: [{
        data: "data:application/pdf;base64,cGRm",
        file_name: "beleg.pdf",
        file_size: 3,
      }],
      channel: "embed",
    });
  });
});
