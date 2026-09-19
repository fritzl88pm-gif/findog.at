import { describe, expect, it, vi } from "vitest";

import {
  collectFredLiveQuestion,
  describeFredLiveStartError,
  estimateFredLiveTokens,
  fredLiveAnswerCommentary,
  fredLiveAskBody,
  fredLiveDelegationId,
  fredLiveDelegationReply,
  fredLiveErrorMessage,
  fredLiveInterimCommentary,
  fredLiveNoticeCommentary,
  fredLiveQuestionFromTranscript,
  fredLiveUserTranscript,
  FRED_LIVE_APPEND_TOKEN_BUDGET,
  FRED_LIVE_QUESTION_GRACE_MS,
  FRED_LIVE_QUESTION_MAX_WAIT_MS,
  isFredLiveConnectionActive,
  reduceFredLiveEvent,
  splitFredLiveAppend,
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
  it("uses the transcript timings required by GPT-Live", () => {
    expect(FRED_LIVE_QUESTION_GRACE_MS).toBe(700);
    expect(FRED_LIVE_QUESTION_MAX_WAIT_MS).toBeGreaterThan(FRED_LIVE_QUESTION_GRACE_MS);
  });

  it("assembles only the unconsumed user speech and caps the question", () => {
    const rows = [
      { speaker: "Du" as const, text: "Alte Frage.", startMs: 0, endMs: 1 },
      { speaker: "Fred" as const, text: "Antwort", startMs: 2, endMs: 3 },
      { speaker: "Du" as const, text: " Neue Frage.", startMs: 4, endMs: 5 },
    ];
    expect(fredLiveUserTranscript(rows)).toBe("Alte Frage. Neue Frage.");
    expect(fredLiveQuestionFromTranscript(rows, "Alte Frage.".length)).toBe("Neue Frage.");
    expect(fredLiveQuestionFromTranscript(rows, 0)).toBe("Alte Frage. Neue Frage.");
    expect(fredLiveQuestionFromTranscript(rows, 9_999)).toBe("");
    expect(fredLiveQuestionFromTranscript([{ speaker: "Du", text: "x".repeat(2_100), startMs: 0, endMs: 1 }], 0))
      .toHaveLength(2_000);
  });

  it("keeps the follow-up question when the running row grew after the last delegation", () => {
    // The user's row keeps growing, so a row index would consume the follow-up unseen.
    const state = reduceAll([
      ["session.input_transcript.delta", "Erste Frage.", 0, 1_000],
      ["session.input_transcript.delta", " Und für 2025?", 1_200, 2_000],
    ]);
    expect(state.transcript).toHaveLength(1);
    expect(fredLiveQuestionFromTranscript(state.transcript, "Erste Frage.".length)).toBe("Und für 2025?");
  });

  it("estimates four ASCII characters and one umlaut to the token", () => {
    expect(estimateFredLiveTokens("abcd")).toBe(1);
    expect(estimateFredLiveTokens("ä")).toBe(1);
    expect(estimateFredLiveTokens("")).toBe(0);
  });

  it("splits a long answer into appends below the provider limit, on sentence ends", () => {
    const sentence = "Die Pendlerpauschale betraegt im Jahr 2026 einen festen Betrag. ";
    const chunks = splitFredLiveAppend(sentence.repeat(60));
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(estimateFredLiveTokens(chunk)).toBeLessThanOrEqual(FRED_LIVE_APPEND_TOKEN_BUDGET);
      expect(chunk.trim()).toBe(chunk);
    }
    expect(chunks.join(" ")).toBe(sentence.repeat(60).trim().replace(/\s+/gu, " "));
    expect(chunks.every((chunk) => chunk.endsWith("."))).toBe(true);
  });

  it("splits a sentence that exceeds the limit on its own", () => {
    const chunks = splitFredLiveAppend("wort ".repeat(1_000));
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(estimateFredLiveTokens(chunk)).toBeLessThanOrEqual(FRED_LIVE_APPEND_TOKEN_BUDGET);
    }
    expect(splitFredLiveAppend("   ")).toEqual([]);
  });

  it("builds interim, notice and chunked answer commentary payloads", () => {
    expect(fredLiveInterimCommentary("del-1")).toEqual({
      type: "session.commentary.append",
      event_id: "fred-live-interim-del-1",
      delegation_id: "del-1",
      content: expect.stringContaining("Wissensbasis"),
    });
    expect(fredLiveAnswerCommentary("del-1", "Die Antwort.")).toEqual([{
      type: "session.commentary.append",
      event_id: "fred-live-answer-del-1-1",
      delegation_id: "del-1",
      content: "Die Antwort.",
    }]);
    const long = fredLiveAnswerCommentary("del-1", "Ein ganzer Satz mit Inhalt. ".repeat(200));
    expect(long.length).toBeGreaterThan(1);
    expect(long.map((append) => append.event_id))
      .toEqual(long.map((_, index) => `fred-live-answer-del-1-${index + 1}`));
    expect(long.every((append) => append.delegation_id === "del-1")).toBe(true);
    expect(fredLiveAnswerCommentary("del-1", "   ")).toEqual([]);
    expect(fredLiveNoticeCommentary("del-1", "Kurzer Hinweis."))
      .toEqual({
        type: "session.commentary.append",
        event_id: "fred-live-notice-del-1",
        delegation_id: "del-1",
        content: "Kurzer Hinweis.",
      });
  });

  it("collects the question until the transcript stops growing", async () => {
    const samples = ["Wie", "Wie hoch", "Wie hoch ist der Betrag?", "Wie hoch ist der Betrag?"];
    let call = 0;
    const sleep = vi.fn(async () => undefined);
    const question = await collectFredLiveQuestion({
      readQuestion: () => samples[Math.min(call++, samples.length - 1)],
      signal: new AbortController().signal,
      graceMs: 300,
      maxWaitMs: 3_000,
      pollMs: 150,
      sleep,
    });
    expect(question).toBe("Wie hoch ist der Betrag?");
    expect(sleep).toHaveBeenCalled();
  });

  it("gives up on an empty transcript after the maximum wait", async () => {
    const sleep = vi.fn(async () => undefined);
    await expect(collectFredLiveQuestion({
      readQuestion: () => "",
      signal: new AbortController().signal,
      graceMs: 300,
      maxWaitMs: 600,
      pollMs: 150,
      sleep,
    })).resolves.toBe("");
    expect(sleep).toHaveBeenCalledTimes(4);
  });

  it("stops collecting when the delegation is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(collectFredLiveQuestion({
      readQuestion: () => "Frage",
      signal: controller.signal,
      sleep: (_ms, signal) => Promise.reject(signal.reason ?? new Error("aborted")),
    })).rejects.toBeDefined();
  });

  it("surfaces rejected events instead of leaving the session silently stuck", () => {
    expect(fredLiveErrorMessage({ type: "session.started" })).toBeUndefined();
    expect(fredLiveErrorMessage({ type: "session.error", error: { message: "append too long" } }))
      .toBe("append too long");
    expect(fredLiveErrorMessage({ type: "error", error: { code: "invalid_request_error" } }))
      .toBe("invalid_request_error");
    expect(fredLiveErrorMessage({ type: "session.error" })).toContain("abgelehnt");
  });

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

  it("reads the delegation id and falls back when no ask route is deployed", () => {
    expect(fredLiveDelegationId({ type: "session.delegation.created", delegation: { id: " del-7 " } })).toBe("del-7");
    expect(fredLiveDelegationId({ type: "session.delegation.created", delegation: {} })).toBe("");
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

  it("sends a follow-up on the same upstream session when one is known", () => {
    expect(fredLiveAskBody("Wie hoch ist der Betrag?")).toEqual({ question: "Wie hoch ist der Betrag?" });
    expect(fredLiveAskBody("Und für 2025?", "session-1"))
      .toEqual({ question: "Und für 2025?", upstreamSessionId: "session-1" });
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
