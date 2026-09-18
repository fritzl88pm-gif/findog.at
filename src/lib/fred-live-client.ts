export type FredLiveSpeaker = "Du" | "Fred";

export type FredLiveTranscriptRow = {
  speaker: FredLiveSpeaker;
  text: string;
  startMs: number;
  endMs: number;
};

export type FredLiveTranscriptState = {
  status: string;
  transcript: FredLiveTranscriptRow[];
  usageSeconds?: number;
};

/**
 * A speaker keeps the same row while their fragments follow each other within this gap.
 * GPT-Live emits no turn-completed event, so rows are grouped from the timeline intervals
 * (verified against real events: input/output transcript deltas carry `start_ms`/`end_ms`).
 */
export const FRED_LIVE_ROW_GAP_MS = 2_500;
export const FRED_LIVE_QUESTION_GRACE_MS = 700;

export const FRED_LIVE_NO_BACKEND_REPLY =
  "In dieser Version ist kein Backend-Agent verbunden. Antworte aus deinem eigenen Wissen und sage offen, wenn du etwas nicht prüfen kannst.";

export function fredLiveQuestionFromTranscript(rows: readonly FredLiveTranscriptRow[], fromIndex: number): string {
  return rows.slice(Math.max(0, fromIndex))
    .filter((row) => row.speaker === "Du")
    .map((row) => row.text)
    .join("")
    .trim()
    .slice(0, 2_000);
}

/** Request body for the admin ask route; a known upstream session makes follow-ups work. */
export function fredLiveAskBody(
  question: string,
  upstreamSessionId?: string,
): { question: string; upstreamSessionId?: string } {
  return upstreamSessionId ? { question, upstreamSessionId } : { question };
}

export function fredLiveDelegationFollowUp(
  delegationId: string,
  answer: string,
): [{ type: "session.commentary.append"; event_id: string; delegation_id: string; content: string }, { type: "session.commentary.append"; event_id: string; delegation_id: string; content: string }] {
  const interim = {
    type: "session.commentary.append" as const,
    event_id: `fred-live-interim-${delegationId}`,
    delegation_id: delegationId,
    content: "Ich schaue kurz in der Wissensbasis nach und melde mich gleich mit der Antwort.",
  };
  return [interim, {
    type: "session.commentary.append" as const,
    event_id: `fred-live-answer-${delegationId}`,
    delegation_id: delegationId,
    content: answer,
  }];
}

export function fredLiveSpeakerFor(type: string): FredLiveSpeaker | undefined {
  if (type === "session.input_transcript.delta") return "Du";
  if (type === "session.output_transcript.delta") return "Fred";
  return undefined;
}

export function describeFredLiveStartError(error: unknown): string {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Der Browser blockiert den Mikrofonzugriff. Im Adressfeld das Schloss-Symbol öffnen, Mikrofon auf Erlauben stellen und die Seite neu laden.";
    }
    if (error.name === "NotFoundError" || error.name === "OverconstrainedError") {
      return "Es wurde kein Mikrofon gefunden.";
    }
    if (error.name === "NotReadableError" || error.name === "AbortError") {
      return "Das Mikrofon ist gerade nicht verfügbar, möglicherweise verwendet es ein anderes Programm.";
    }
  }
  return error instanceof Error && error.message
    ? error.message
    : "Fred Live konnte nicht gestartet werden.";
}

export function isFredLiveConnectionActive(
  activeConnection: RTCPeerConnection | null,
  capturedConnection: RTCPeerConnection,
): boolean {
  return activeConnection === capturedConnection;
}

export function waitForIceGathering(
  connection: RTCPeerConnection,
  timeoutMs: number,
): Promise<void> {
  if (connection.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      connection.removeEventListener("icegatheringstatechange", handleStateChange);
      reject(new Error("ICE gathering timeout"));
    }, timeoutMs);
    const handleStateChange = () => {
      if (connection.iceGatheringState !== "complete") return;
      clearTimeout(timeout);
      connection.removeEventListener("icegatheringstatechange", handleStateChange);
      resolve();
    };
    connection.addEventListener("icegatheringstatechange", handleStateChange);
  });
}

/**
 * Client delegation: GPT-Live may still ask for a backend. This version has none, so the request
 * is answered immediately instead of leaving the spoken conversation waiting.
 */
export function fredLiveDelegationReply(
  event: Record<string, unknown>,
): { type: "session.commentary.append"; event_id: string; delegation_id: string; content: string } | null {
  if (event.type !== "session.delegation.created") return null;
  const delegation = event.delegation as { id?: unknown } | undefined;
  const id = delegation && typeof delegation.id === "string" ? delegation.id : "";
  if (!id) return null;
  return {
    type: "session.commentary.append",
    event_id: `no-backend-${id}`,
    delegation_id: id,
    content: FRED_LIVE_NO_BACKEND_REPLY,
  };
}

function usageSeconds(event: Record<string, unknown>): number | undefined {
  const usage = event.usage as { seconds?: unknown } | undefined;
  return typeof usage?.seconds === "number" ? usage.seconds : undefined;
}

export function reduceFredLiveEvent(
  state: FredLiveTranscriptState,
  event: Record<string, unknown>,
): FredLiveTranscriptState {
  const type = typeof event.type === "string" ? event.type : "";
  if (type === "session.started") return { ...state, status: "Verbunden" };
  if (type === "session.closed") {
    return { ...state, status: "Beendet", usageSeconds: usageSeconds(event) ?? state.usageSeconds };
  }
  if (type === "session.usage.updated") {
    const seconds = usageSeconds(event);
    return seconds === undefined ? state : { ...state, usageSeconds: seconds };
  }

  const speaker = fredLiveSpeakerFor(type);
  if (!speaker) return state;
  const text = typeof event.delta === "string" ? event.delta : typeof event.text === "string" ? event.text : "";
  if (!text) return state;

  const startMs = typeof event.start_ms === "number" ? event.start_ms : undefined;
  const endMs = typeof event.end_ms === "number" ? event.end_ms : undefined;
  // Each speaker keeps growing its own row during overlapping speech; a new row starts only
  // when that speaker resumes after a longer gap.
  const rows = [...state.transcript];
  let index = -1;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rows[i].speaker === speaker) {
      index = i;
      break;
    }
  }
  const target: FredLiveTranscriptRow | undefined = index >= 0 ? rows[index] : undefined;
  if (target && startMs !== undefined && startMs - target.endMs <= FRED_LIVE_ROW_GAP_MS) {
    rows[index] = {
      ...target,
      // Fragments are concatenated exactly as received, without trimming or inserted spaces.
      text: target.text + text,
      endMs: endMs ?? target.endMs,
    };
  } else {
    rows.push({
      speaker,
      text,
      startMs: startMs ?? target?.endMs ?? 0,
      endMs: endMs ?? startMs ?? 0,
    });
  }
  return { ...state, transcript: rows };
}
