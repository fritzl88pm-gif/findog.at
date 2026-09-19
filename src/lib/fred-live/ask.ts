import "server-only";

import { UserVisibleError } from "@/lib/errors";
import { isUpstreamCompleteEvent, upstreamDelta } from "@/lib/fred/run-diagnostics";
import {
  mergeFredSources,
  parseWeKnoraResearchEvent,
  type FredSourceReference,
} from "@/lib/weknora/fred-research";
import {
  createFredUpstreamSession,
  deriveFredSessionSignature,
  fetchFredUpstreamConfig,
  fredVisitorId,
  openFredUpstreamStream,
  stopFredUpstreamSession,
} from "@/lib/weknora/fred-native";
import {
  FredEmbedConfigurationError,
  mintFredEmbedSession,
  readQuickFredEmbedServerConfig,
  type FredEmbedServerConfig,
  type FredEmbedSession,
} from "@/lib/weknora/fred-embed";

export type FredLiveAskResult = {
  answer: string;
  sources: { title: string; channel?: string; knowledgeBaseId?: string }[];
  upstreamSessionId: string;
  elapsedMs: number;
};

type AnswerEvent = Record<string, unknown>;

const MAX_ANSWER_CHARS = 6_000;

/**
 * QuickFred answers in Markdown. The live answer is spoken, not rendered, so the markup is
 * reduced to plain sentences: link labels replace their URL, list and heading markers and
 * emphasis characters are dropped, and code fences lose their delimiters.
 */
export function toSpokenAnswer(markdown: string): string {
  return markdown
    .replace(/```[^\n]*\n?/gu, "")
    .replace(/~~~[^\n]*\n?/gu, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/<https?:\/\/[^>\s]+>/gu, "")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gmu, "")
    .replace(/^[ \t]{0,3}>[ \t]?/gmu, "")
    .replace(/^[ \t]{0,3}(?:[-*+]|\d{1,3}[.)])[ \t]+/gmu, "")
    // Table delimiter rows carry no words; they are dropped with their line break.
    .replace(/^[ \t]{0,3}\|?(?:[ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*\|?[ \t]*(?:\n|$)/gmu, "")
    .replace(/^[ \t]{0,3}(?:[-*_][ \t]?){3,}[ \t]*(?:\n|$)/gmu, "")
    .replace(/\|/gu, " ")
    .replace(/(\*\*|__|\*|`)/gu, "")
    .replace(/[ \t]{2,}/gu, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function assembleFredLiveAnswer(events: readonly AnswerEvent[]): string {
  const answer = toSpokenAnswer(events
    .map(upstreamDelta)
    .map((event) => event.content ?? "")
    .join(""));
  return answer.length > MAX_ANSWER_CHARS
    ? `${answer.slice(0, MAX_ANSWER_CHARS - 1)}…`
    : answer;
}

export function projectFredLiveSources(
  references: readonly FredSourceReference[],
): FredLiveAskResult["sources"] {
  const result: FredLiveAskResult["sources"] = [];
  const seen = new Set<string>();
  for (const source of mergeFredSources([...references])) {
    const title = source.kind === "knowledge" ? source.doc : source.title ?? "";
    if (!title) continue;
    const channel = source.kind === "knowledge" ? undefined : "Web";
    const key = `${title}\u0000${channel ?? ""}\u0000${source.kind === "knowledge" ? source.knowledgeBaseId ?? "" : ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      title,
      ...(channel ? { channel } : {}),
      ...(source.kind === "knowledge" && source.knowledgeBaseId
        ? { knowledgeBaseId: source.knowledgeBaseId }
        : {}),
    });
    if (result.length >= 5) break;
  }
  return result;
}

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

function toUpstreamError(error: unknown, signal: AbortSignal): UserVisibleError {
  if (isAbortError(error, signal)) {
    return new UserVisibleError("Die Wissensbasis hat nicht rechtzeitig geantwortet.", 504);
  }
  if (error instanceof UserVisibleError && [400, 503, 504].includes(error.status)) return error;
  return new UserVisibleError("Die Wissensbasis konnte die Frage nicht beantworten.", 502);
}

export async function askQuickFred(input: {
  question: string;
  upstreamSessionId?: string;
  signal: AbortSignal;
}): Promise<FredLiveAskResult> {
  const startedAt = Date.now();
  let config: FredEmbedServerConfig;
  try {
    config = readQuickFredEmbedServerConfig();
  } catch (error) {
    if (error instanceof FredEmbedConfigurationError) {
      throw new UserVisibleError("Die QuickFred-Wissensbasis ist derzeit nicht konfiguriert.", 503);
    }
    throw error;
  }

  let session: FredEmbedSession | undefined;
  let upstreamSession: { id: string; signature: string } | undefined;
  let assistantMessageId = "";
  try {
    session = await mintFredEmbedSession({ config, signal: input.signal });
    const upstreamConfig = await fetchFredUpstreamConfig({ session, config, signal: input.signal });
    if (upstreamConfig.agentId !== config.expectedAgentId) {
      throw new UserVisibleError("QuickFred hat eine ungültige Konfiguration geliefert.", 502);
    }
    if (input.upstreamSessionId) {
      upstreamSession = {
        id: input.upstreamSessionId,
        signature: deriveFredSessionSignature(config, input.upstreamSessionId),
      };
    } else {
      upstreamSession = await createFredUpstreamSession({ session, config, signal: input.signal });
    }

    const response = await openFredUpstreamStream({
      session,
      config,
      upstreamConfig,
      upstreamSession,
      visitorId: fredVisitorId(config.publishToken, "fred-live"),
      query: input.question,
      webSearchEnabled: false,
      summaryModelId: "",
      signal: input.signal,
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const events: AnswerEvent[] = [];
    const references: FredSourceReference[] = [];
    let complete = false;

    const consume = (frame: string) => {
      const data = frame.split(/\r?\n/u)
        .filter((line) => line === "data" || line.startsWith("data:"))
        .map((line) => line.startsWith("data:") ? line.slice(5).trimStart() : "")
        .join("\n");
      if (!data || data === "[DONE]") return;
      let parsed: unknown;
      try { parsed = JSON.parse(data); } catch { throw new UserVisibleError("Die Wissensbasis lieferte einen ungültigen Antwortstream.", 502); }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      const event = parsed as AnswerEvent;
      events.push(event);
      if (typeof event.assistant_message_id === "string") assistantMessageId = event.assistant_message_id.trim();
      const research = parseWeKnoraResearchEvent(event, { includeDirectSources: true });
      if (research.fatalError) throw new UserVisibleError("Die Wissensbasis konnte die Frage nicht beantworten.", 502);
      references.push(...research.sources);
      if (isUpstreamCompleteEvent(event)) complete = true;
    };

    try {
      while (true) {
        if (input.signal.aborted) throw new DOMException("Aborted", "AbortError");
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/u);
        buffer = frames.pop() ?? "";
        frames.forEach(consume);
      }
      buffer += decoder.decode();
      if (buffer.trim()) consume(buffer);
    } finally {
      reader.releaseLock();
    }
    if (!complete || !assembleFredLiveAnswer(events)) {
      throw new UserVisibleError("Die Wissensbasis konnte die Frage nicht abschließen.", 502);
    }
    return {
      answer: assembleFredLiveAnswer(events),
      sources: projectFredLiveSources(references),
      upstreamSessionId: upstreamSession.id,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (input.signal.aborted && session && config && upstreamSession) {
      await stopFredUpstreamSession({
        session,
        config,
        upstreamSession,
        messageId: assistantMessageId,
        signal: new AbortController().signal,
      });
    }
    throw toUpstreamError(error, input.signal);
  }
}
