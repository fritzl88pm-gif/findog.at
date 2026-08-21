import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { UserVisibleError } from "../errors";

import {
  assertFredNativeAttachmentTotalSize,
  createFredUpstreamSession,
  deriveFredSessionSignature,
  fetchFredUpstreamConfig,
  fetchFredRecentEmbedImages,
  fredVisitorId,
  MAX_NATIVE_ATTACHMENT_TOTAL_BYTES,
  openFredUpstreamStream,
  type FredNativeAttachmentUpload,
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
  it("accepts the native attachment total boundary and rejects one additional raw byte", () => {
    expect(() => assertFredNativeAttachmentTotalSize([
      { byteLength: MAX_NATIVE_ATTACHMENT_TOTAL_BYTES },
      { byteLength: 0 },
    ])).not.toThrow();

    expect(() => assertFredNativeAttachmentTotalSize([
      { byteLength: MAX_NATIVE_ATTACHMENT_TOTAL_BYTES + 1 },
    ])).toThrowError(UserVisibleError);

    try {
      assertFredNativeAttachmentTotalSize([
        { byteLength: MAX_NATIVE_ATTACHMENT_TOTAL_BYTES + 1 },
      ]);
    } catch (error) {
      expect(error).toBeInstanceOf(UserVisibleError);
      expect((error as UserVisibleError).status).toBe(413);
      expect((error as UserVisibleError).message).toBe(
        "Die Fred-Anhänge sind zusammen zu groß. Bitte reduziere die Gesamtgröße.",
      );
    }
  });

  it("uses validated buffer byte lengths rather than attachment size metadata", () => {
    const attachment = {
      kind: "file",
      name: "Beleg.pdf",
      sizeBytes: -1,
      bytes: new Uint8Array(3),
    } satisfies FredNativeAttachmentUpload;
    expect(() => assertFredNativeAttachmentTotalSize([attachment])).not.toThrow();
  });
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

  it("loads the public agent binding and opens the correct embed agent stream without attachment fields", async () => {
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
      query: "Meine Frage\n\n--- BEGINN DER ANHÄNGE ---\nExtracted content\n--- ENDE DER ANHÄNGE ---",
      webSearchEnabled: true,
      summaryModelId: "",
      signal: new AbortController().signal,
      fetchImpl: streamFetch,
    });

    const [url, init] = streamFetch.mock.calls[0]!;
    expect(url).toBe("https://taxdog.cloud/api/v1/embed/fred-channel/agent-chat/session-123");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`Embed ${session.token}`);
    expect(headers.get("x-embed-session")).toBe(signature);
    expect(headers.get("x-embed-visitor")).toBe("visitor-hash");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      query: "Meine Frage\n\n--- BEGINN DER ANHÄNGE ---\nExtracted content\n--- ENDE DER ANHÄNGE ---",
      agent_enabled: true,
      agent_id: "agent-123",
      knowledge_base_ids: ["kb-1"],
      web_search_enabled: true,
      summary_model_id: "",
      channel: "embed",
    });
    expect(body).not.toHaveProperty("images");
    expect(body).not.toHaveProperty("attachment_uploads");
  });

  it("serializes native image and file attachments exactly as WeKnora expects", async () => {
    const streamFetch = vi.fn<typeof fetch>(async () => new Response("data: {}\n\n", { status: 200 }));
    const signature = deriveFredSessionSignature(config, "session-123");
    const imageBytes = new Uint8Array([1, 2, 3, 4]);
    const fileBytes = new Uint8Array([5, 6, 7]);

    await openFredUpstreamStream({
      session,
      config,
      upstreamConfig: {
        agentId: "agent-123",
        knowledgeBaseIds: [],
        allowWebSearch: false,
        allowFileUpload: true,
        allowImageUpload: true,
      },
      upstreamSession: { id: "session-123", signature },
      visitorId: "visitor-hash",
      query: "Bitte prüfe die Anhänge",
      webSearchEnabled: false,
      summaryModelId: "",
      signal: new AbortController().signal,
      fetchImpl: streamFetch,
      nativeAttachments: [
        { kind: "image", mimeType: "image/png", bytes: imageBytes },
        { kind: "file", name: "Beleg.pdf", sizeBytes: fileBytes.byteLength, bytes: fileBytes },
      ],
    });

    const body = JSON.parse(String(streamFetch.mock.calls[0][1]?.body));
    expect(body.images).toEqual([
      { data: `data:image/png;base64,${Buffer.from(imageBytes).toString("base64")}` },
    ]);
    expect(body.attachment_uploads).toEqual([{
      data: Buffer.from(fileBytes).toString("base64"),
      file_name: "Beleg.pdf",
      file_size: fileBytes.byteLength,
    }]);
  });

  it("sends the resolved Pro model ID as summary_model_id when provided", async () => {
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
      query: "Pro question",
      webSearchEnabled: true,
      summaryModelId: "a1b2c3d4-e5f6-4789-abcd-ef0123456789",
      signal: new AbortController().signal,
      fetchImpl: streamFetch,
    });

    const body = JSON.parse(String(streamFetch.mock.calls[0][1]?.body));
    expect(body.summary_model_id).toBe("a1b2c3d4-e5f6-4789-abcd-ef0123456789");
  });

  it("derives channel file upload and agent image upload flags separately", async () => {
    const configFetch = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      success: true,
      data: {
        agent_id: "agent-123",
        knowledge_base_ids: [],
        allow_web_search: false,
        agent_web_search_enabled: false,
        allow_file_upload: true,
        agent_image_upload_enabled: false,
      },
    }), { status: 200 }));
    const upstreamConfig = await fetchFredUpstreamConfig({
      session,
      config,
      signal: new AbortController().signal,
      fetchImpl: configFetch,
    });
    expect(upstreamConfig).toEqual({
      agentId: "agent-123",
      knowledgeBaseIds: [],
      allowWebSearch: false,
      allowFileUpload: true,
      allowImageUpload: false,
    });
  });

  describe("fetchFredRecentEmbedImages", () => {
    it("loads recent embed messages with exact endpoint, headers, and query limit", async () => {
      const signature = deriveFredSessionSignature(config, "session-456");
      const visitorId = "visitor-456";
      const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
        expect(url).toBe("https://taxdog.cloud/api/v1/embed/fred-channel/messages/session-456/load?limit=2");
        expect(init?.headers).toEqual({
          Accept: "application/json",
          Authorization: `Embed ${session.token}`,
          Origin: config.exchangeOrigin,
          "X-Embed-Session": signature,
          "X-Embed-Visitor": visitorId,
        });
        expect(init?.cache).toBe("no-store");
        return new Response(JSON.stringify({
          success: true,
          data: {
            messages: [
              {
                role: "user",
                images: [
                  { url: "minio://attachments/img1.jpg", caption: "Photo 1" },
                ],
              },
            ],
          },
        }), { status: 200 });
      });

      const images = await fetchFredRecentEmbedImages({
        session,
        config,
        upstreamSession: { id: "session-456", signature },
        visitorId,
        signal: new AbortController().signal,
        fetchImpl,
      });

      expect(images).toEqual([
        { url: "minio://attachments/img1.jpg", caption: "Photo 1" },
      ]);
    });

    it("selects the newest user message deterministically when multiple messages are returned", async () => {
      const signature = deriveFredSessionSignature(config, "session-456");
      const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
        success: true,
        data: {
          messages: [
            {
              role: "user",
              images: [{ url: "minio://old/img.png", caption: "Old" }],
            },
            {
              role: "assistant",
              images: [{ url: "minio://assistant/img.png" }],
            },
            {
              role: "user",
              images: [{ url: "s3://newest/img.png", caption: "Newest" }],
            },
          ],
        },
      }), { status: 200 }));

      const images = await fetchFredRecentEmbedImages({
        session,
        config,
        upstreamSession: { id: "session-456", signature },
        visitorId: "visitor-123",
        signal: new AbortController().signal,
        fetchImpl,
      });

      expect(images).toEqual([
        { url: "s3://newest/img.png", caption: "Newest" },
      ]);
    });

    it("filters out invalid provider schemes, control characters, traversal paths, and public http urls", async () => {
      const signature = deriveFredSessionSignature(config, "session-456");
      const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
        success: true,
        data: {
          messages: [
            {
              role: "user",
              images: [
                { url: "https://evil.com/fake.jpg" },
                { url: "http://localhost/fake.jpg" },
                { url: "minio://valid/bucket/pic.jpg" },
                { url: "local://valid/path/file.png" },
                { url: "cos://valid/pic.webp" },
                { url: "tos://valid/pic.gif" },
                { url: "s3://valid/pic.jpeg" },
                { url: "oss://valid/pic.jpg" },
                { url: "ks3://valid/pic.jpg" },
                { url: "obs://valid/pic.jpg" },
                { url: "ftp://fake/pic.jpg" },
                { url: "minio://invalid/../traversal.png" },
                { url: "minio://invalid/\x00null.png" },
              ],
            },
          ],
        },
      }), { status: 200 }));

      const images = await fetchFredRecentEmbedImages({
        session,
        config,
        upstreamSession: { id: "session-456", signature },
        visitorId: "visitor-123",
        signal: new AbortController().signal,
        fetchImpl,
      });

      // Max 5 allowed trusted images
      expect(images).toHaveLength(5);
      expect(images.map((i) => i.url)).toEqual([
        "minio://valid/bucket/pic.jpg",
        "local://valid/path/file.png",
        "cos://valid/pic.webp",
        "tos://valid/pic.gif",
        "s3://valid/pic.jpeg",
      ]);
    });

    it("rejects malformed envelopes and oversized payloads (> 2 MiB) with controlled 502", async () => {
      const signature = deriveFredSessionSignature(config, "session-456");

      // Non-JSON response
      const nonJsonFetch = vi.fn<typeof fetch>(async () => new Response("not json", { status: 200 }));
      await expect(fetchFredRecentEmbedImages({
        session,
        config,
        upstreamSession: { id: "session-456", signature },
        visitorId: "visitor-123",
        signal: new AbortController().signal,
        fetchImpl: nonJsonFetch,
      })).rejects.toThrowError(UserVisibleError);

      // Malformed data shape
      const badDataFetch = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
        success: true,
        data: "not an object or array",
      }), { status: 200 }));
      await expect(fetchFredRecentEmbedImages({
        session,
        config,
        upstreamSession: { id: "session-456", signature },
        visitorId: "visitor-123",
        signal: new AbortController().signal,
        fetchImpl: badDataFetch,
      })).rejects.toThrowError(UserVisibleError);

      // Oversized (> 2 MiB)
      const hugeData = "x".repeat(2 * 1024 * 1024 + 100);
      const hugeFetch = vi.fn<typeof fetch>(async () => new Response(hugeData, {
        status: 200,
        headers: { "content-length": String(hugeData.length) },
      }));
      await expect(fetchFredRecentEmbedImages({
        session,
        config,
        upstreamSession: { id: "session-456", signature },
        visitorId: "visitor-123",
        signal: new AbortController().signal,
        fetchImpl: hugeFetch,
      })).rejects.toThrowError(UserVisibleError);
    });

    it("handles upstream error status codes appropriately", async () => {
      const signature = deriveFredSessionSignature(config, "session-456");

      const rateLimitFetch = vi.fn<typeof fetch>(async () => new Response("Rate limited", { status: 429 }));
      await expect(fetchFredRecentEmbedImages({
        session,
        config,
        upstreamSession: { id: "session-456", signature },
        visitorId: "visitor-123",
        signal: new AbortController().signal,
        fetchImpl: rateLimitFetch,
      })).rejects.toThrowError(/ausgelastet/);

      const authErrorFetch = vi.fn<typeof fetch>(async () => new Response("Unauthorized", { status: 401 }));
      await expect(fetchFredRecentEmbedImages({
        session,
        config,
        upstreamSession: { id: "session-456", signature },
        visitorId: "visitor-123",
        signal: new AbortController().signal,
        fetchImpl: authErrorFetch,
      })).rejects.toThrowError(/abgelaufen/);
    });
  });
});
