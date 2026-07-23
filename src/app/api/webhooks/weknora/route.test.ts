import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  readFredEmbedServerConfig,
  readQuickFredEmbedServerConfig,
} from "@/lib/weknora/fred-embed";
import { POST } from "./route";

vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/weknora/fred-embed", () => ({
  readFredEmbedServerConfig: vi.fn(),
  readQuickFredEmbedServerConfig: vi.fn(),
}));

const SECRET = "fred-webhook-secret-that-is-long-enough";

function signedRequest(rawBody: string, signatureBody = rawBody): Request {
  const signature = createHmac("sha256", SECRET).update(signatureBody).digest("hex");
  return new Request("http://localhost/api/webhooks/weknora", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-WeKnora-Signature": `sha256=${signature}`,
    },
    body: rawBody,
  });
}

describe("POST /api/webhooks/weknora", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.WEKNORA_FRED_WEBHOOK_SECRET = SECRET;
    vi.mocked(readFredEmbedServerConfig).mockReturnValue({
      channelId: "fred-channel",
      publishToken: "em_1234567890123456",
      exchangeOrigin: "https://findog.at",
    });
  });

  afterEach(() => {
    delete process.env.WEKNORA_FRED_WEBHOOK_SECRET;
  });

  it("persists a fresh, correctly signed event with its raw provenance", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { pending: false }, error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);
    const event = {
      type: "message_received",
      channel_id: "fred-channel",
      session_id: "session-1",
      timestamp: new Date().toISOString(),
      content: "Fred antwortet.",
    };
    const rawBody = JSON.stringify(event);

    const response = await POST(signedRequest(rawBody));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true, pending: false });
    expect(rpc).toHaveBeenCalledWith("record_fred_webhook_event", {
      payload: expect.objectContaining({
        delivery_sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
        channel_id: "fred-channel",
        session_id: "session-1",
        event_type: "message_received",
        content: "Fred antwortet.",
        provider_created_at: event.timestamp,
        raw_event: event,
      }),
    });
  });

  it("rejects a signature computed over different bytes before touching storage", async () => {
    const rpc = vi.fn();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);
    const rawBody = JSON.stringify({
      type: "message_sent",
      channel_id: "fred-channel",
      session_id: "session-1",
      timestamp: new Date().toISOString(),
      query: "Frage",
    });

    const response = await POST(signedRequest(rawBody, `${rawBody} `));

    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("accepts a signed event from the optional QuickFred channel", async () => {
    vi.mocked(readQuickFredEmbedServerConfig).mockReturnValue({
      agentKey: "quickfred",
      channelId: "quickfred-channel",
      publishToken: "em_quickfred_publish_123456",
      exchangeOrigin: "https://findog.at",
      expectedAgentId: "a1b2c3d4-e5f6-4789-abcd-ef0123456789",
    });
    const rpc = vi.fn().mockResolvedValue({ data: { pending: false }, error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);
    const event = {
      type: "message_received",
      channel_id: "quickfred-channel",
      session_id: "quick-session-1",
      timestamp: new Date().toISOString(),
      content: "QuickFred antwortet.",
    };

    const response = await POST(signedRequest(JSON.stringify(event)));

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("record_fred_webhook_event", {
      payload: expect.objectContaining({
        channel_id: "quickfred-channel",
        session_id: "quick-session-1",
      }),
    });
  });
});
