import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  fredWebhookDeliverySha256,
  parseFredBridgeEvent,
  parseFredWebhookEvent,
  readFredWebhookSecret,
  verifyFredWebhookSignature,
} from "./fred-history";

const CHANNEL_ID = "fred-channel-2026";

describe("Fred history event validation", () => {
  it("accepts a scoped authenticated bridge event", () => {
    expect(parseFredBridgeEvent({
      eventId: "11111111-1111-4111-8111-111111111111",
      type: "message_sent",
      channelId: CHANNEL_ID,
      sessionId: "22222222-2222-4222-8222-222222222222",
      content: "  Wie ist die Rechtslage?  ",
    }, CHANNEL_ID)).toEqual({
      eventId: "11111111-1111-4111-8111-111111111111",
      type: "message_sent",
      channelId: CHANNEL_ID,
      sessionId: "22222222-2222-4222-8222-222222222222",
      content: "Wie ist die Rechtslage?",
    });
  });

  it("rejects a bridge event for another channel", () => {
    expect(() => parseFredBridgeEvent({
      eventId: "11111111-1111-4111-8111-111111111111",
      type: "message_sent",
      channelId: "foreign-channel",
      sessionId: "session-1",
      content: "Frage",
    }, CHANNEL_ID)).toThrow("stimmt nicht überein");
  });

  it("maps signed webhook payload fields by event type and enforces freshness", () => {
    const now = new Date("2026-07-19T10:00:00.000Z");
    expect(parseFredWebhookEvent({
      type: "message_sent",
      channel_id: CHANNEL_ID,
      session_id: "session-1",
      timestamp: "2026-07-19T09:59:30.000Z",
      query: "Meine Frage",
    }, CHANNEL_ID, now).content).toBe("Meine Frage");
    expect(parseFredWebhookEvent({
      type: "message_received",
      channel_id: CHANNEL_ID,
      session_id: "session-1",
      timestamp: "2026-07-19T09:59:30.000Z",
      content: "Die Antwort",
    }, CHANNEL_ID, now).content).toBe("Die Antwort");
    expect(() => parseFredWebhookEvent({
      type: "message_received",
      channel_id: CHANNEL_ID,
      session_id: "session-1",
      timestamp: "2026-07-19T09:00:00.000Z",
      content: "Zu alt",
    }, CHANNEL_ID, now)).toThrow("abgelaufen");
  });
});

describe("Fred webhook authentication", () => {
  const secret = "fred-webhook-secret-that-is-long-enough";
  const rawBody = '{"type":"message_sent","query":"hi"}';

  it("verifies the exact raw body with constant-shape HMAC input", () => {
    const signature = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
    expect(verifyFredWebhookSignature(rawBody, signature, secret)).toBe(true);
    expect(verifyFredWebhookSignature(`${rawBody} `, signature, secret)).toBe(false);
    expect(verifyFredWebhookSignature(rawBody, "sha256=bad", secret)).toBe(false);
  });

  it("creates a stable delivery fingerprint and rejects weak configuration", () => {
    expect(fredWebhookDeliverySha256(rawBody)).toMatch(/^[0-9a-f]{64}$/u);
    expect(readFredWebhookSecret({ WEKNORA_FRED_WEBHOOK_SECRET: secret })).toBe(secret);
    expect(() => readFredWebhookSecret({ WEKNORA_FRED_WEBHOOK_SECRET: "short" })).toThrow(
      "nicht vollständig konfiguriert",
    );
  });
});
