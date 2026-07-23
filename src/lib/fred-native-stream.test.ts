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
  agentKey: "fred" as const,
};

describe("Fred native stream", () => {
  it("round-trips conversation, status, delta, replace, research and final events", () => {
    expect(parseFredNativeStreamLine(encodeFredNativeStreamEvent({
      type: "conversation",
      conversation,
    }))).toEqual({ type: "conversation", conversation });
    expect(parseFredNativeStreamLine(encodeFredNativeStreamEvent({
      type: "status",
      label: "Anhänge werden analysiert …",
    }))).toEqual({ type: "status", label: "Anhänge werden analysiert …" });
    expect(parseFredNativeStreamLine(encodeFredNativeStreamEvent({
      type: "delta",
      content: "Hallo",
    }))).toEqual({ type: "delta", content: "Hallo" });
    expect(parseFredNativeStreamLine(encodeFredNativeStreamEvent({
      type: "replace",
      answer: "[RV/1100290/2023](https://findok.bmf.gv.at/findok/volltext?gz=RV%2F1100290%2F2023)",
    }))).toEqual({
      type: "replace",
      answer: "[RV/1100290/2023](https://findok.bmf.gv.at/findok/volltext?gz=RV%2F1100290%2F2023)",
    });
    expect(parseFredNativeStreamLine(encodeFredNativeStreamEvent({
      type: "research",
      step: {
        id: "tool-1",
        kind: "knowledge",
        status: "running",
        label: "Wissensbasis wird durchsucht",
      },
    }))).toEqual({
      type: "research",
      step: {
        id: "tool-1",
        kind: "knowledge",
        status: "running",
        label: "Wissensbasis wird durchsucht",
      },
    });
    expect(parseFredNativeStreamLine(encodeFredNativeStreamEvent({
      type: "final",
      answer: "Hallo!",
      conversation,
    }))).toEqual({
      type: "final",
      answer: "Hallo!",
      conversation,
      researchTrace: [],
      sourceReferences: [],
    });
  });

  it("rejects malformed events", () => {
    expect(() => parseFredNativeStreamLine('{"type":"delta"}')).toThrow(
      "Ungültiges Fred-Streaming-Ereignis.",
    );
    expect(() => parseFredNativeStreamLine('{"type":"status"}')).toThrow(
      "Ungültiges Fred-Streaming-Ereignis.",
    );
    expect(() => parseFredNativeStreamLine('{"type":"other"}')).toThrow(
      "Unbekanntes Fred-Streaming-Ereignis.",
    );
  });
});
