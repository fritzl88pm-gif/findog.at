import { describe, expect, it, vi } from "vitest";

import {
  isFredLiveConnectionActive,
  reduceFredLiveEvent,
  type FredLiveTranscriptState,
  waitForIceGathering,
} from "./fred-live-client";

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

  it("reduces assistant and user transcript turns", () => {
    let state: FredLiveTranscriptState = { status: "Bereit", transcript: [] };
    state = reduceFredLiveEvent(state, { type: "session.started" });
    expect(state.status).toBe("Verbunden");
    state = reduceFredLiveEvent(state, { type: "response.output_audio_transcript.delta", delta: "Hallo" });
    state = reduceFredLiveEvent(state, { type: "response.output_audio_transcript.delta", text: " Fred" });
    state = reduceFredLiveEvent(state, { type: "conversation.item.input_audio_transcription.delta", delta: "Guten Tag" });
    expect(state.transcript).toEqual([
      { speaker: "Fred", text: "Hallo Fred" },
      { speaker: "Du", text: "Guten Tag" },
    ]);
  });

  it("switches turns and closes a turn on completion", () => {
    let state: FredLiveTranscriptState = { status: "Bereit", transcript: [] };
    state = reduceFredLiveEvent(state, { type: "response.audio_transcript.delta", delta: "Erste" });
    state = reduceFredLiveEvent(state, { type: "conversation.item.input_audio_transcription.delta", delta: "Antwort" });
    state = reduceFredLiveEvent(state, { type: "response.audio_transcript.done" });
    state = reduceFredLiveEvent(state, { type: "response.audio_transcript.delta", delta: "Neue Runde" });
    expect(state.transcript).toEqual([
      { speaker: "Fred", text: "Erste" },
      { speaker: "Du", text: "Antwort" },
      { speaker: "Fred", text: "Neue Runde" },
    ]);
  });

  it("ignores unknown events without losing text", () => {
    let state: FredLiveTranscriptState = { status: "Bereit", transcript: [] };
    state = reduceFredLiveEvent(state, { type: "response.output_audio_transcript.delta", delta: "Hallo" });
    expect(reduceFredLiveEvent(state, { type: "other.event" })).toEqual(state);
    state = reduceFredLiveEvent(state, { type: "vendor.transcript.delta", delta: " Welt" });
    expect(state.transcript).toEqual([{ speaker: "Fred", text: "Hallo Welt" }]);
    expect(reduceFredLiveEvent(state, { type: "session.closed", usage: { seconds: 3 } }))
      .toMatchObject({ status: "Beendet", usage: { seconds: 3 } });
  });

  it("checks whether the captured connection is still active", () => {
    const connection = {} as RTCPeerConnection;
    expect(isFredLiveConnectionActive(connection, connection)).toBe(true);
    expect(isFredLiveConnectionActive(null, connection)).toBe(false);
  });
});
