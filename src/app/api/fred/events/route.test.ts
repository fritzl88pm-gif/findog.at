import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { readFredEmbedServerConfig } from "@/lib/weknora/fred-embed";
import { POST } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/weknora/fred-embed", () => ({
  FredEmbedConfigurationError: class FredEmbedConfigurationError extends Error {},
  readFredEmbedServerConfig: vi.fn(),
}));

describe("POST /api/fred/events", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
    });
    vi.mocked(readFredEmbedServerConfig).mockReturnValue({
      channelId: "fred-channel",
      publishToken: "em_1234567890123456",
      exchangeOrigin: "https://findog.at",
    });
  });

  it("binds a trusted iframe event to the authenticated user through the RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        conversation_id: "22222222-2222-4222-8222-222222222222",
        title: "Wie ist die Rechtslage?",
        created_at: "2026-07-19T10:00:00.000Z",
        updated_at: "2026-07-19T10:00:00.000Z",
      },
      error: null,
    });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);
    const request = new Request("http://localhost/api/fred/events", {
      method: "POST",
      headers: {
        Authorization: "Bearer access-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        eventId: "33333333-3333-4333-8333-333333333333",
        type: "message_sent",
        channelId: "fred-channel",
        sessionId: "session-1",
        content: "Wie ist die Rechtslage?",
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      conversation: {
        id: "22222222-2222-4222-8222-222222222222",
        title: "Wie ist die Rechtslage?",
        createdAt: "2026-07-19T10:00:00.000Z",
        updatedAt: "2026-07-19T10:00:00.000Z",
      },
    });
    expect(authenticateSupabaseRequest).toHaveBeenCalledWith(request, expect.objectContaining({ rpc }));
    expect(rpc).toHaveBeenCalledWith("record_fred_bridge_event", {
      payload: expect.objectContaining({
        client_id: "11111111-1111-4111-8111-111111111111",
        channel_id: "fred-channel",
        session_id: "session-1",
        event_id: "33333333-3333-4333-8333-333333333333",
        event_type: "message_sent",
        content: "Wie ist die Rechtslage?",
        occurred_at: expect.any(String),
      }),
    });
  });

  it("rejects a forged channel before persistence", async () => {
    const rpc = vi.fn();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);
    const response = await POST(new Request("http://localhost/api/fred/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventId: "33333333-3333-4333-8333-333333333333",
        type: "message_sent",
        channelId: "other-channel",
        sessionId: "session-1",
        content: "Frage",
      }),
    }));

    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});
