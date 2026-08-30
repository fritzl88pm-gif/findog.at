import { describe, expect, it, vi } from "vitest";

import {
  createFredRequestReceipt,
  resumeFredRequestReceipt,
  transitionFredRequestReceipt,
  transitionFredRequestReceiptIfPresent,
} from "./request-ledger";

const receipt = {
  request_id: "11111111-1111-4111-8111-111111111111",
  user_event_id: "22222222-2222-4222-8222-222222222222",
  assistant_event_id: "33333333-3333-4333-8333-333333333333",
  status: "received",
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
      updateRowId: 91,
      leaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      conversationId: "55555555-5555-4555-8555-555555555555",
      webSearchEnabled: true,
      proModeEnabled: true,
    })).resolves.toEqual({
      requestId: receipt.request_id,
      userEventId: receipt.user_event_id,
      assistantEventId: receipt.assistant_event_id,
      status: "received",
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
        web_search_enabled: true,
        pro_mode_enabled: true,
        telegram_update_id: 91,
        telegram_update_row_id: 91,
        telegram_lease_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        conversation_id: "55555555-5555-4555-8555-555555555555",
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

  it("returns a distinct stale-lease result without retrying receipt creation", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });

    await expect(createFredRequestReceipt({
      supabase: { rpc } as never,
      clientId: "44444444-4444-4444-8444-444444444444",
      origin: "telegram",
      agentKey: "fred",
      content: "Frage",
      telegramUpdateId: 91,
      updateRowId: 91,
      leaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    })).resolves.toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("passes the exact queue lease to the optional terminal transition", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { lease_valid: false, receipt_present: false },
      error: null,
    });

    await expect(transitionFredRequestReceiptIfPresent({
      supabase: { rpc } as never,
      requestId: receipt.request_id,
      updateRowId: 7,
      leaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "failed",
      failurePhase: "ingress",
      errorCode: "integration_inactive",
    })).resolves.toEqual({ leaseValid: false, receiptPresent: false });

    expect(rpc).toHaveBeenCalledWith(
      "transition_fred_request_receipt_if_present",
      {
        payload: {
          request_id: receipt.request_id,
          telegram_update_row_id: 7,
          telegram_lease_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          status: "failed",
          failure_phase: "ingress",
          error_code: "integration_inactive",
        },
      },
    );
  });

  it("parses the atomically reconciled completed snapshot from an optional transition", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        lease_valid: true,
        receipt_present: true,
        status: "completed",
        content_deleted: false,
        conversation_id: "55555555-5555-4555-8555-555555555555",
        user_message_id: 41,
        assistant_message_id: 42,
        answer: "Bereits gespeichert",
        web_search_enabled: true,
        pro_mode_enabled: false,
      },
      error: null,
    });

    await expect(transitionFredRequestReceiptIfPresent({
      supabase: { rpc } as never,
      requestId: receipt.request_id,
      updateRowId: 7,
      leaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "failed",
      failurePhase: "streaming",
      errorCode: "turn_failed",
    })).resolves.toEqual({
      leaseValid: true,
      receiptPresent: true,
      status: "completed",
      contentDeleted: false,
      conversationId: "55555555-5555-4555-8555-555555555555",
      userMessageId: 41,
      assistantMessageId: 42,
      answer: "Bereits gespeichert",
      webSearchEnabled: true,
      proModeEnabled: false,
    });
  });

  it("loads a reconciled completed Telegram request for delivery-only retry", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        status: "completed",
        content_deleted: false,
        conversation_id: "55555555-5555-4555-8555-555555555555",
        user_message_id: 41,
        assistant_message_id: 42,
        answer: "Bereits gespeicherte Antwort",
        web_search_enabled: true,
        pro_mode_enabled: false,
      },
      error: null,
    });

    await expect(resumeFredRequestReceipt({
      supabase: { rpc } as never,
      requestId: receipt.request_id,
      clientId: "44444444-4444-4444-8444-444444444444",
      telegramUpdateId: 91,
    })).resolves.toEqual({
      status: "completed",
      contentDeleted: false,
      conversationId: "55555555-5555-4555-8555-555555555555",
      userMessageId: 41,
      assistantMessageId: 42,
      answer: "Bereits gespeicherte Antwort",
      webSearchEnabled: true,
      proModeEnabled: false,
    });
    expect(rpc).toHaveBeenCalledWith("resume_fred_request_receipt", {
      payload: {
        request_id: receipt.request_id,
        client_id: "44444444-4444-4444-8444-444444444444",
        telegram_update_id: 91,
      },
    });
  });

  it("fails closed when a completed resume snapshot lacks its persisted answer", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        status: "completed",
        content_deleted: false,
        conversation_id: "55555555-5555-4555-8555-555555555555",
        user_message_id: 41,
        assistant_message_id: 42,
        web_search_enabled: false,
        pro_mode_enabled: false,
      },
      error: null,
    });

    await expect(resumeFredRequestReceipt({
      supabase: { rpc } as never,
      requestId: receipt.request_id,
      clientId: "44444444-4444-4444-8444-444444444444",
      telegramUpdateId: 91,
    })).rejects.toMatchObject({ status: 503 });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("fails closed when a resume snapshot omits its frozen mode flags", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        status: "received",
        content_deleted: false,
      },
      error: null,
    });

    await expect(resumeFredRequestReceipt({
      supabase: { rpc } as never,
      requestId: receipt.request_id,
      clientId: "44444444-4444-4444-8444-444444444444",
      telegramUpdateId: 91,
    })).rejects.toMatchObject({ status: 503 });
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
