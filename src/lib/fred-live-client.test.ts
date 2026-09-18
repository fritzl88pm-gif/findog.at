import { describe, expect, it, vi } from "vitest";

import {
  describeFredLiveStartError,
  fredLiveDelegationReply,
  isFredLiveConnectionActive,
  reduceFredLiveEvent,
  type FredLiveTranscriptState,
  waitForIceGathering,
} from "./fred-live-client";

// Fragment sequence captured from a real GPT-Live WebRTC session (18.09.2026), with the exact
// event types, deltas and timeline intervals the API delivered for German speech.
const recordedFragments: [string, string, number, number][] = [
  ["session.input_transcript.delta", " Guten", 2200, 2400],
  ["session.input_transcript.delta", " Tag", 2600, 2800],
  ["session.input_transcript.delta", ". Ich", 3200, 3400],
  ["session.input_transcript.delta", " habe", 3400, 3600],
  ["session.input_transcript.delta", " eine", 3600, 3800],
  ["session.input_transcript.delta", " Frage", 4000, 4200],
  ["session.input_transcript.delta", " zur", 4200, 4400],
  ["session.input_transcript.delta", " Pendler", 4600, 4800],
  ["session.input_transcript.delta", "pa", 5000, 5200],
  ["session.output_transcript.delta", " Ja.", 5200, 5400],
  ["session.input_transcript.delta", "uschale", 5400, 5600],
  ["session.input_transcript.delta", ". Wie", 6400, 6600],
  ["session.input_transcript.delta", " wird", 6600, 6800],
  ["session.input_transcript.delta", " der", 6800, 7000],
];

function reduceAll(events: [string, string, number, number][]): FredLiveTranscriptState {
  return events.reduce<FredLiveTranscriptState>(
    (state, [type, delta, start_ms, end_ms]) => reduceFredLiveEvent(state, { type, delta, start_ms, end_ms }),
    { status: "Bereit", transcript: [] },
  );
}

describe("Fred Live browser helpers", () => {
  it("waits for complete ICE gathering", async () => {
    const connection = {
      iceGatheringState: "gathering",
      addEventListener: vi.fn((_: string, listener: () => void) => {
        (connection as { iceGatheringState: string }).iceGatheringState = "complete";
        listener();
      }),
      removeEventListener: vi.fn(),
    } as unknown as RTCPeerConnection;
    await expect(waitForIceGathering(connection, 100)).resolves.toBeUndefined();
  });

  it("rejects when ICE gathering times out", async () => {
    vi.useFakeTimers();
    const connection = {
      iceGatheringState: "gathering",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as RTCPeerConnection;
    const promise = waitForIceGathering(connection, 100);
    const rejection = expect(promise).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    vi.useRealTimers();
  });

  it("labels and separates the two speakers from recorded GPT-Live events", () => {
    const state = reduceAll(recordedFragments);
    expect(state.transcript).toHaveLength(2);
    expect(state.transcript[0]).toEqual({
      speaker: "Du",
      text: " Guten Tag. Ich habe eine Frage zur Pendlerpauschale. Wie wird der",
      startMs: 2200,
      endMs: 7000,
    });
    expect(state.transcript[1]).toEqual({
      speaker: "Fred",
      text: " Ja.",
      startMs: 5200,
      endMs: 5400,
    });
  });

  it("starts a new row when the same speaker resumes after a longer gap", () => {
    const state = reduceAll([
      ["session.input_transcript.delta", "Erste Frage", 0, 1000],
      ["session.output_transcript.delta", "Antwort", 1200, 2000],
      ["session.input_transcript.delta", "Zweite Frage", 9000, 9500],
    ]);
    expect(state.transcript).toEqual([
      { speaker: "Du", text: "Erste Frage", startMs: 0, endMs: 1000 },
      { speaker: "Fred", text: "Antwort", startMs: 1200, endMs: 2000 },
      { speaker: "Du", text: "Zweite Frage", startMs: 9000, endMs: 9500 },
    ]);
  });

  it("reports lifecycle and cumulative usage without dropping unknown events", () => {
    let state: FredLiveTranscriptState = { status: "Bereit", transcript: [] };
    state = reduceFredLiveEvent(state, { type: "session.started" });
    expect(state.status).toBe("Verbunden");
    state = reduceFredLiveEvent(state, { type: "session.usage.updated", usage: { seconds: 12 } });
    expect(state.usageSeconds).toBe(12);
    expect(reduceFredLiveEvent(state, { type: "session.delegation.created" })).toEqual(state);
    expect(reduceFredLiveEvent(state, { type: "vendor.event", delta: "x" })).toEqual(state);
    expect(reduceFredLiveEvent(state, { type: "session.closed", usage: { seconds: 31 } }))
      .toMatchObject({ status: "Beendet", usageSeconds: 31 });
  });

  it("answers a client delegation instead of leaving the conversation waiting", () => {
    expect(fredLiveDelegationReply({ type: "session.started" })).toBeNull();
    expect(fredLiveDelegationReply({ type: "session.delegation.created", delegation: {} })).toBeNull();
    expect(fredLiveDelegationReply({
      type: "session.delegation.created",
      delegation: { id: "item_9tA2bF3h7K9m2P5q8R1s4", type: "delegation", target: "client" },
    })).toEqual({
      type: "session.commentary.append",
      event_id: "no-backend-item_9tA2bF3h7K9m2P5q8R1s4",
      delegation_id: "item_9tA2bF3h7K9m2P5q8R1s4",
      content: expect.stringContaining("kein Backend-Agent"),
    });
  });

  it("checks whether the captured connection is still active", () => {
    const connection = {} as RTCPeerConnection;
    expect(isFredLiveConnectionActive(connection, connection)).toBe(true);
    expect(isFredLiveConnectionActive(null, connection)).toBe(false);
  });

  it("explains blocked microphone access instead of repeating the browser message", () => {
    expect(describeFredLiveStartError(new DOMException("Permission denied", "NotAllowedError")))
      .toContain("Schloss-Symbol");
    expect(describeFredLiveStartError(new DOMException("no device", "NotFoundError")))
      .toContain("kein Mikrofon");
    expect(describeFredLiveStartError(new DOMException("busy", "NotReadableError")))
      .toContain("anderes Programm");
    expect(describeFredLiveStartError(new Error("Fred Live konnte nicht gestartet werden.")))
      .toBe("Fred Live konnte nicht gestartet werden.");
    expect(describeFredLiveStartError(undefined)).toContain("konnte nicht gestartet werden");
  });
});
