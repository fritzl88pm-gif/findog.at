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
      label: "Dokumente werden analysiert …",
    }))).toEqual({ type: "status", label: "Dokumente werden analysiert …" });
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
      type: "execution",
      step: {
        id: "exec-1",
        kind: "planning",
        status: "running",
        label: "Rechercheplan wird aktualisiert",
        detail: "3 Aufgaben geplant",
        counts: { total: 3, completed: 0, inProgress: 1, open: 2 },
      },
    }))).toEqual({
      type: "execution",
      step: {
        id: "exec-1",
        kind: "planning",
        status: "running",
        label: "Rechercheplan wird aktualisiert",
        detail: "3 Aufgaben geplant",
        counts: { total: 3, completed: 0, inProgress: 1, open: 2 },
      },
    });
    expect(parseFredNativeStreamLine(encodeFredNativeStreamEvent({
      type: "final",
      answer: "Hallo!",
      assistantMessageId: 42,
      conversation,
      executionTrace: [{
        id: "exec-1",
        kind: "planning",
        status: "completed",
        label: "Rechercheplan aktualisiert",
      }],
    }))).toEqual({
      type: "final",
      answer: "Hallo!",
      assistantMessageId: 42,
      conversation,
      researchTrace: [],
      executionTrace: [{
        id: "exec-1",
        kind: "planning",
        status: "completed",
        label: "Rechercheplan aktualisiert",
      }],
      sourceReferences: [],
    });
  });

  it("parses the explicit status-clear contract without status text", () => {
    expect(parseFredNativeStreamLine(encodeFredNativeStreamEvent({
      type: "status_clear",
    }))).toEqual({ type: "status_clear" });
    expect(parseFredNativeStreamLine('{"type":"status_clear"}'))
      .toEqual({ type: "status_clear" });
  });

  it("accepts final event with missing assistantMessageId", () => {
    const result = parseFredNativeStreamLine(JSON.stringify({
      type: "final",
      answer: "Hallo!",
      conversation,
    }));
    expect(result).toBeTruthy();
    expect(result?.type).toBe("final");
    if (result?.type === "final") {
      expect(result.assistantMessageId).toBeUndefined();
    }
  });

  it("rejects final event with non-positive assistantMessageId", () => {
    expect(() => parseFredNativeStreamLine(JSON.stringify({
      type: "final",
      answer: "Hallo!",
      assistantMessageId: 0,
      conversation,
    }))).toThrow("Ungültiges Fred-Streaming-Ereignis.");
  });

  it("rejects final event with non-integer assistantMessageId", () => {
    expect(() => parseFredNativeStreamLine(JSON.stringify({
      type: "final",
      answer: "Hallo!",
      assistantMessageId: 3.14,
      conversation,
    }))).toThrow("Ungültiges Fred-Streaming-Ereignis.");
  });

  it("rejects final event with non-safe assistantMessageId", () => {
    expect(() => parseFredNativeStreamLine(JSON.stringify({
      type: "final",
      answer: "Hallo!",
      assistantMessageId: Number.MAX_SAFE_INTEGER + 1,
      conversation,
    }))).toThrow("Ungültiges Fred-Streaming-Ereignis.");
  });

  it("rejects malformed events", () => {
    expect(() => parseFredNativeStreamLine('{"type":"delta"}')).toThrow(
      "Ungültiges Fred-Streaming-Ereignis.",
    );
    expect(() => parseFredNativeStreamLine('{"type":"status"}')).toThrow(
      "Ungültiges Fred-Streaming-Ereignis.",
    );
    expect(() => parseFredNativeStreamLine('{"type":"execution"}')).toThrow(
      "Ungültiges Fred-Streaming-Ereignis.",
    );
    expect(() => parseFredNativeStreamLine('{"type":"execution","step":{"id":"1"}}')).toThrow(
      "Ungültiges Fred-Streaming-Ereignis.",
    );
    expect(() => parseFredNativeStreamLine('{"type":"other"}')).toThrow(
      "Unbekanntes Fred-Streaming-Ereignis.",
    );
  });
});
