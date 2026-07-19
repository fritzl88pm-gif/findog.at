import { describe, expect, it } from "vitest";

import {
  encodeFredNativeStreamEvent,
  parseFredNativeStreamLine,
} from "./fred-native-stream";

const conversation = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Testfrage",
  createdAt: "2026-07-19T10:00:00.000Z",
  updatedAt: "2026-07-19T10:00:01.000Z",
};

describe("Fred native stream", () => {
  it("round-trips conversation, delta and final events", () => {
    expect(parseFredNativeStreamLine(encodeFredNativeStreamEvent({
      type: "conversation",
      conversation,
    }))).toEqual({ type: "conversation", conversation });
    expect(parseFredNativeStreamLine(encodeFredNativeStreamEvent({
      type: "delta",
      content: "Hallo",
    }))).toEqual({ type: "delta", content: "Hallo" });
    expect(parseFredNativeStreamLine(encodeFredNativeStreamEvent({
      type: "final",
      answer: "Hallo!",
      conversation,
    }))).toEqual({ type: "final", answer: "Hallo!", conversation });
  });

  it("rejects malformed events", () => {
    expect(() => parseFredNativeStreamLine('{"type":"delta"}')).toThrow(
      "Ungültiges Fred-Streaming-Ereignis.",
    );
    expect(() => parseFredNativeStreamLine('{"type":"other"}')).toThrow(
      "Unbekanntes Fred-Streaming-Ereignis.",
    );
  });
});
