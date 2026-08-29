import { describe, expect, it, vi } from "vitest";

import {
  createFredRequestReceipt,
  transitionFredRequestReceipt,
} from "./request-ledger";

const receipt = {
  request_id: "11111111-1111-4111-8111-111111111111",
  user_event_id: "22222222-2222-4222-8222-222222222222",
  assistant_event_id: "33333333-3333-4333-8333-333333333333",
  received_at: "2026-08-29T10:00:00.000Z",
};

describe("Fred request ledger client", () => {
  it("creates the content-bearing ingress receipt with stable provenance IDs", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: receipt, error: null });

    await expect(createFredRequestReceipt({
      supabase: { rpc } as never,
      clientId: "44444444-4444-4444-8444-444444444444",
      origin: "telegram",
      agentKey: "fred",
      content: "  Meine Steuerfrage  ",
      requestId: receipt.request_id,
      userEventId: receipt.user_event_id,
      assistantEventId: receipt.assistant_event_id,
      telegramUpdateId: 91,
    })).resolves.toEqual({
      requestId: receipt.request_id,
      userEventId: receipt.user_event_id,
      assistantEventId: receipt.assistant_event_id,
      receivedAt: receipt.received_at,
    });

    expect(rpc).toHaveBeenCalledWith("create_fred_request_receipt", {
      payload: {
        request_id: receipt.request_id,
        client_id: "44444444-4444-4444-8444-444444444444",
        origin: "telegram",
        agent_key: "fred",
        content: "  Meine Steuerfrage  ",
        user_event_id: receipt.user_event_id,
        assistant_event_id: receipt.assistant_event_id,
        telegram_update_id: 91,
      },
    });
  });

  it("retries once and then fails closed when the ingress receipt cannot be stored", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: new Error("down") });

    await expect(createFredRequestReceipt({
      supabase: { rpc } as never,
      clientId: "44444444-4444-4444-8444-444444444444",
      origin: "web",
      agentKey: "fred",
      content: "Frage",
    })).rejects.toMatchObject({ status: 503 });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("persists exact user-message linkage through the transition RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: "user_persisted" }, error: null });

    await transitionFredRequestReceipt({
      supabase: { rpc } as never,
      requestId: receipt.request_id,
      status: "user_persisted",
      conversationId: "55555555-5555-4555-8555-555555555555",
      userMessageId: 42,
    });

    expect(rpc).toHaveBeenCalledWith("transition_fred_request_receipt", {
      payload: {
        request_id: receipt.request_id,
        status: "user_persisted",
        conversation_id: "55555555-5555-4555-8555-555555555555",
        user_message_id: 42,
      },
    });
  });
});
