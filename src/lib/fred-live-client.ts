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

export type FredLiveAppendEvent = {
  type: "session.commentary.append";
  event_id: string;
  delegation_id: string;
  content: string;
};

/**
 * A speaker keeps the same row while their fragments follow each other within this gap.
 * GPT-Live emits no turn-completed event, so rows are grouped from the timeline intervals
 * (verified against real events: input/output transcript deltas carry `start_ms`/`end_ms`).
 */
export const FRED_LIVE_ROW_GAP_MS = 2_500;

/** A delegated question counts as finished once the user transcript stops growing for this long. */
export const FRED_LIVE_QUESTION_GRACE_MS = 700;
/** Transcript fragments lag the audio, so the question is collected for at most this long. */
export const FRED_LIVE_QUESTION_MAX_WAIT_MS = 3_000;
/** How often the growing transcript is sampled while the question settles. */
export const FRED_LIVE_QUESTION_POLL_MS = 150;

export const FRED_LIVE_MAX_QUESTION_CHARS = 2_000;

/**
 * GPT-Live rejects a context append longer than 500 tokens, and a rejected append is simply
 * never spoken. Answers are therefore split into appends below that limit, estimating four
 * ASCII characters to the token and one token for everything else (umlauts, punctuation).
 */
export const FRED_LIVE_APPEND_TOKEN_BUDGET = 450;

export const FRED_LIVE_NO_BACKEND_REPLY =
  "In dieser Version ist kein Backend-Agent verbunden. Antworte aus deinem eigenen Wissen und sage offen, wenn du etwas nicht prüfen kannst.";

export const FRED_LIVE_INTERIM_REPLY =
  "Ich schaue kurz in der Wissensbasis nach und melde mich gleich mit der Antwort.";

export const FRED_LIVE_EMPTY_QUESTION_REPLY =
  "Ich habe die Frage akustisch nicht sicher verstanden. Bitte frage kurz noch einmal nach.";

export const FRED_LIVE_BACKEND_ERROR_REPLY =
  "Die Wissensbasis ist gerade nicht erreichbar. Sage das offen und biete an, es gleich noch einmal zu versuchen.";

export function estimateFredLiveTokens(text: string): number {
  let tokens = 0;
  for (const char of text) {
    tokens += (char.codePointAt(0) ?? 0) < 128 ? 0.25 : 1;
  }
  return Math.ceil(tokens);
}

/** Largest prefix of `text`, in UTF-16 code units, that still fits the token budget. */
function charBudgetWithin(text: string, budget: number): number {
  let tokens = 0;
  let chars = 0;
  for (const char of text) {
    const cost = (char.codePointAt(0) ?? 0) < 128 ? 0.25 : 1;
    if (chars > 0 && tokens + cost > budget) break;
    tokens += cost;
    chars += char.length;
  }
  return Math.max(1, chars);
}

/** Keeps the trailing whitespace with its sentence so the chunks rejoin without losing spacing. */
function splitIntoSentences(text: string): string[] {
  const sentences: string[] = [];
  let current = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    current += char;
    const next = text[index + 1];
    const closesSentence = char === "." || char === "!" || char === "?" || char === "…" || char === "\n";
    if (closesSentence && (next === undefined || /\s/u.test(next))) {
      sentences.push(current);
      current = "";
    }
  }
  if (current) sentences.push(current);
  return sentences;
}

function splitOversized(text: string, budget: number): string[] {
  if (estimateFredLiveTokens(text) <= budget) return [text];
  const parts: string[] = [];
  let rest = text;
  while (estimateFredLiveTokens(rest) > budget) {
    const cut = charBudgetWithin(rest, budget);
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) parts.push(rest);
  return parts;
}

/** Splits an answer into appends that stay below the GPT-Live limit, cutting on sentence ends. */
export function splitFredLiveAppend(
  content: string,
  budget: number = FRED_LIVE_APPEND_TOKEN_BUDGET,
): string[] {
  const text = content.trim();
  if (!text) return [];
  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = "";
  };
  for (const sentence of splitIntoSentences(text)) {
    for (const piece of splitOversized(sentence, budget)) {
      if (current && estimateFredLiveTokens(current + piece) > budget) flush();
      current += piece;
    }
  }
  flush();
  return chunks;
}

function commentary(eventId: string, delegationId: string, content: string): FredLiveAppendEvent {
  return {
    type: "session.commentary.append",
    event_id: eventId,
    delegation_id: delegationId,
    content,
  };
}

/** Spoken bridge sent right away so the conversation does not fall silent while the backend runs. */
export function fredLiveInterimCommentary(delegationId: string): FredLiveAppendEvent {
  return commentary(`fred-live-interim-${delegationId}`, delegationId, FRED_LIVE_INTERIM_REPLY);
}

/**
 * The delegated answer, as one or more appends. Repeated appends with the same delegation id
 * continue the same delegation, so a long answer arrives complete instead of being rejected.
 */
export function fredLiveAnswerCommentary(delegationId: string, answer: string): FredLiveAppendEvent[] {
  return splitFredLiveAppend(answer).map((chunk, index) =>
    commentary(`fred-live-answer-${delegationId}-${index + 1}`, delegationId, chunk));
}

/** A short note to Fred (empty question, unreachable backend) that never exceeds one append. */
export function fredLiveNoticeCommentary(
  delegationId: string,
  content: string,
  eventId = `fred-live-notice-${delegationId}`,
): FredLiveAppendEvent {
  return commentary(eventId, delegationId, splitFredLiveAppend(content)[0] ?? content);
}

/** The user's spoken text so far; rows only ever grow at the end, so offsets stay stable. */
export function fredLiveUserTranscript(rows: readonly FredLiveTranscriptRow[]): string {
  return rows.filter((row) => row.speaker === "Du").map((row) => row.text).join("");
}

/**
 * Everything the user has said since `consumedChars`. A character offset is used rather than a
 * row index because a running row keeps growing after a delegation, which a row index misses.
 */
export function fredLiveQuestionFromTranscript(
  rows: readonly FredLiveTranscriptRow[],
  consumedChars: number,
): string {
  const spoken = fredLiveUserTranscript(rows);
  return spoken
    .slice(Math.min(Math.max(0, consumedChars), spoken.length))
    .trim()
    .slice(0, FRED_LIVE_MAX_QUESTION_CHARS);
}

export function fredLiveSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const rejection = () => signal?.reason ?? new DOMException("Aborted", "AbortError");
    if (signal?.aborted) {
      reject(rejection());
      return;
    }
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }, ms);
    const handleAbort = () => {
      clearTimeout(timeout);
      reject(rejection());
    };
    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

/**
 * `session.delegation.created` carries no task text, so the question is read back from the
 * transcript. Transcript fragments trail the audio, so sampling continues until the text has
 * been unchanged for the grace period, and never longer than the maximum wait.
 */
export async function collectFredLiveQuestion(options: {
  readQuestion: () => string;
  signal: AbortSignal;
  graceMs?: number;
  maxWaitMs?: number;
  pollMs?: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}): Promise<string> {
  const graceMs = options.graceMs ?? FRED_LIVE_QUESTION_GRACE_MS;
  const maxWaitMs = options.maxWaitMs ?? FRED_LIVE_QUESTION_MAX_WAIT_MS;
  const pollMs = Math.max(1, options.pollMs ?? FRED_LIVE_QUESTION_POLL_MS);
  const sleep = options.sleep ?? fredLiveSleep;

  let question = options.readQuestion();
  let waited = 0;
  let unchangedMs = 0;
  while (waited < maxWaitMs) {
    await sleep(pollMs, options.signal);
    waited += pollMs;
    const next = options.readQuestion();
    if (next !== question) {
      question = next;
      unchangedMs = 0;
      continue;
    }
    unchangedMs += pollMs;
    if (question && unchangedMs >= graceMs) break;
  }
  return question;
}

/** Request body for the admin ask route; a known upstream session makes follow-ups work. */
export function fredLiveAskBody(
  question: string,
  upstreamSessionId?: string,
): { question: string; upstreamSessionId?: string } {
  return upstreamSessionId ? { question, upstreamSessionId } : { question };
}

export function fredLiveSpeakerFor(type: string): FredLiveSpeaker | undefined {
  if (type === "session.input_transcript.delta") return "Du";
  if (type === "session.output_transcript.delta") return "Fred";
  return undefined;
}

/**
 * GPT-Live reports a rejected event (an oversized append, an invalid payload) as an error event
 * on the data channel. Without surfacing it the voice session just stays silent.
 */
export function fredLiveErrorMessage(event: Record<string, unknown>): string | undefined {
  const type = typeof event.type === "string" ? event.type : "";
  if (type !== "error" && !type.endsWith(".error")) return undefined;
  const detail = event.error && typeof event.error === "object" && !Array.isArray(event.error)
    ? event.error as Record<string, unknown>
    : undefined;
  const message = [detail?.message, event.message, detail?.code, event.code]
    .find((value): value is string => typeof value === "string" && value.trim() !== "");
  return message?.trim() || "GPT-Live hat ein Ereignis abgelehnt.";
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
 * Fallback for a deployment where the ask route is missing: the delegation is answered at once
 * instead of leaving the spoken conversation waiting for a backend that never replies.
 */
export function fredLiveDelegationReply(
  event: Record<string, unknown>,
): FredLiveAppendEvent | null {
  if (event.type !== "session.delegation.created") return null;
  const delegation = event.delegation as { id?: unknown } | undefined;
  const id = delegation && typeof delegation.id === "string" ? delegation.id : "";
  if (!id) return null;
  return commentary(`no-backend-${id}`, id, FRED_LIVE_NO_BACKEND_REPLY);
}

export function fredLiveDelegationId(event: Record<string, unknown>): string {
  const delegation = event.delegation as { id?: unknown } | undefined;
  return delegation && typeof delegation.id === "string" ? delegation.id.trim() : "";
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
