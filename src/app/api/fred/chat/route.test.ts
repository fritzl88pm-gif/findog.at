import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import {
  mintFredEmbedSession,
  readFredEmbedServerConfig,
} from "@/lib/weknora/fred-embed";
import {
  createFredUpstreamSession,
  deriveFredSessionSignature,
  fetchFredUpstreamConfig,
  openFredUpstreamStream,
  relayFredWebhookEvent,
  stopFredUpstreamSession,
} from "@/lib/weknora/fred-native";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { parseFredNativeStreamLine } from "@/lib/fred-native-stream";
import { POST } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/weknora/fred-embed", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/weknora/fred-embed")>();
  return {
    ...original,
    mintFredEmbedSession: vi.fn(),
    readFredEmbedServerConfig: vi.fn(),
  };
});
vi.mock("@/lib/weknora/fred-native", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/weknora/fred-native")>();
  return {
    ...original,
    createFredUpstreamSession: vi.fn(),
    deriveFredSessionSignature: vi.fn(),
    fetchFredUpstreamConfig: vi.fn(),
    fredVisitorId: vi.fn(() => "visitor-hash"),
    openFredUpstreamStream: vi.fn(),
    relayFredWebhookEvent: vi.fn(() => Promise.resolve()),
    stopFredUpstreamSession: vi.fn(() => Promise.resolve()),
  };
});

const userId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const summaryRow = {
  conversation_id: conversationId,
  title: "Wie ist die Rechtslage?",
  created_at: "2026-07-19T10:00:00.000Z",
  updated_at: "2026-07-19T10:00:01.000Z",
};

function request(body: Record<string, unknown>): Request {
  return new Request("https://findog.at/api/fred/chat", {
    method: "POST",
    headers: {
      Authorization: "Bearer access-token",
      "Content-Type": "application/json",
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

function upstreamStream(): Response {
  return new Response([
    'data: {"response_type":"agent_query","assistant_message_id":"answer-1"}\n\n',
    'data: {"response_type":"answer","content":"Hallo ","done":false}\n\n',
    'data: {"response_type":"answer","content":"Welt","done":true}\n\n',
    'data: {"response_type":"complete","data":{}}\n\n',
  ].join(""), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function rpcForTurn() {
  return vi.fn()
    .mockResolvedValueOnce({ data: summaryRow, error: null })
    .mockResolvedValueOnce({
      data: { ...summaryRow, updated_at: "2026-07-19T10:00:02.000Z" },
      error: null,
    });
}

describe("POST /api/fred/chat", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: userId });
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
      knowledgeBaseIds: ["kb-1"],
      allowWebSearch: false,
    });
    vi.mocked(createFredUpstreamSession).mockResolvedValue({
      id: "session-1",
      signature: "session-signature",
    });
    vi.mocked(openFredUpstreamStream).mockImplementation(async () => upstreamStream());
  });

  it("streams a native answer and persists both sides under the authenticated user", async () => {
    const rpc = rpcForTurn();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);

    const response = await POST(request({ query: "Wie ist die Rechtslage?" }));
    const events = (await response.text())
      .split("\n")
      .map(parseFredNativeStreamLine)
      .filter(Boolean);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect(events).toEqual([
      {
        type: "conversation",
        conversation: {
          id: conversationId,
          title: "Wie ist die Rechtslage?",
          createdAt: "2026-07-19T10:00:00.000Z",
          updatedAt: "2026-07-19T10:00:01.000Z",
        },
      },
      { type: "delta", content: "Hallo " },
      { type: "delta", content: "Welt" },
      {
        type: "final",
        answer: "Hallo Welt",
        conversation: expect.objectContaining({ id: conversationId }),
      },
    ]);
    expect(rpc).toHaveBeenNthCalledWith(1, "record_fred_bridge_event", {
      payload: expect.objectContaining({
        client_id: userId,
        event_type: "message_sent",
        content: "Wie ist die Rechtslage?",
        session_id: "session-1",
      }),
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "record_fred_bridge_event", {
      payload: expect.objectContaining({
        client_id: userId,
        event_type: "message_received",
        content: "Hallo Welt",
        session_id: "session-1",
      }),
    });
    expect(relayFredWebhookEvent).toHaveBeenCalledTimes(2);
    expect(stopFredUpstreamSession).not.toHaveBeenCalled();
  });

  it("continues only an owned stored WeKnora session", async () => {
    const rpc = rpcForTurn();
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: conversationId,
        title: "Alt",
        created_at: "2026-07-19T09:00:00.000Z",
        updated_at: "2026-07-19T09:00:00.000Z",
        weknora_channel_id: "fred-channel",
        weknora_session_id: "session-existing",
      },
      error: null,
    });
    const chain = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle,
    };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    const from = vi.fn(() => chain);
    vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc, from } as never);
    vi.mocked(deriveFredSessionSignature).mockReturnValue("derived-signature");

    const response = await POST(request({
      query: "Anschlussfrage",
      conversationId,
    }));
    await response.text();

    expect(response.status).toBe(200);
    expect(from).toHaveBeenCalledWith("fred_conversations");
    expect(chain.eq).toHaveBeenCalledWith("id", conversationId);
    expect(chain.eq).toHaveBeenCalledWith("client_id", userId);
    expect(deriveFredSessionSignature).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: "fred-channel" }),
      "session-existing",
    );
    expect(createFredUpstreamSession).not.toHaveBeenCalled();
    expect(openFredUpstreamStream).toHaveBeenCalledWith(expect.objectContaining({
      upstreamSession: { id: "session-existing", signature: "derived-signature" },
    }));
  });
});
