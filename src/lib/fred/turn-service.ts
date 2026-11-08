import { randomUUID } from "node:crypto";

import { UserVisibleError } from "@/lib/errors";
import {
  createCitationStreamFilter,
  mapOutsideCitationTags,
  publicCitedSources,
  renderCitedAnswer,
  stripCitationTags,
} from "@/lib/fred/citations";
import {
  normalizeGeneratedArtifactLinks,
  parseGeneratedArtifacts,
  type ParsedGeneratedArtifact,
} from "@/lib/fred-generated-artifacts";
import {
  extractStreamStableBfgGzCandidates,
  FINAL_ANSWER_CITATION_WAIT_MS,
  linkVerifiedBfgCitations,
  verifyBfgCitations,
  type VerifiedBfgCitation,
} from "@/lib/findok/bfg-citations";
import {
  EOF_WITHOUT_FINAL_CLIENT_MESSAGE,
  isPreambleRetractingToolCall,
  isUpstreamCompleteEvent,
  upstreamDelta,
  upstreamFinalContent,
} from "@/lib/fred/run-diagnostics";
import {
  fredAgentName,
  type FredAgentKey,
} from "@/lib/weknora/fred-agent";
import {
  mergeFredResearchStep,
  mergeFredSources,
  parseWeKnoraResearchEvent,
  type FredResearchStep,
  type FredSourceReference,
} from "@/lib/weknora/fred-research";
import { stripSourceReferenceIds } from "./execution-sanitize";
import {
  finalizeExecutionTrace,
  mergeFredExecutionStep,
  mergeFredExecutionUpdate,
  parseWeKnoraExecutionEvent,
  type FredExecutionStep,
} from "./execution-trace";

import {
  createThinkingCollector,
  type ThinkingTranslator,
} from "./thinking-trace";

import type { FredGeneratedArtifact } from "@/lib/fred-native-stream";

import type {
  FredTurnAttachmentMeta,
  FredTurnEvent,
  FredTurnRequest,
  FredTurnResult,
} from "./turn-types";

// ── Dependency injection interfaces ──────────────────────────────────────────

export interface TurnServiceUpstreamDeps {
  /**
   * Translates one sanitized English reasoning block to German (null on failure). Together with
   * `request.includeThinking` this enables the admin-only "Gedankengang" trace; absent → never captured.
   */
  translateThinking?: ThinkingTranslator;
  /** Mint a Fred embed session token. */
  mintSession(params: {
    channelId: string;
    publishToken: string;
    exchangeOrigin: string;
    signal: AbortSignal;
  }): Promise<{ token: string; expiresIn: number }>;
  /** Fetch the upstream agent config. */
  fetchUpstreamConfig(params: {
    sessionToken: string;
    channelId: string;
    publishToken: string;
    exchangeOrigin: string;
    signal: AbortSignal;
  }): Promise<{
    agentId: string;
    knowledgeBaseIds: string[];
    allowWebSearch: boolean;
    allowFileUpload: boolean;
  }>;
  /** Create a new WeKnora session. */
  createSession(params: {
    sessionToken: string;
    channelId: string;
    publishToken: string;
    exchangeOrigin: string;
    signal: AbortSignal;
  }): Promise<{ id: string; signature: string }>;
  /** Derive a session signature for an existing session. */
  deriveSessionSignature(params: {
    channelId: string;
    publishToken: string;
    sessionId: string;
  }): string;
  /** Open the upstream SSE chat stream. */
  openStream(params: {
    sessionToken: string;
    channelId: string;
    publishToken: string;
    exchangeOrigin: string;
    sessionId: string;
    sessionSignature: string;
    visitorId: string;
    query: string;
    agentId: string;
    knowledgeBaseIds: string[];
    webSearchEnabled: boolean;
    signal: AbortSignal;
  }): Promise<ReadableStream<Uint8Array>>;
  /** Compute the visitor HMAC for a user. */
  visitorId(publishToken: string, userId: string): string;
  /** Stop the upstream session for a given message. */
  stopSession(params: {
    sessionToken: string;
    channelId: string;
    publishToken: string;
    exchangeOrigin: string;
    sessionId: string;
    sessionSignature: string;
    messageId: string;
    signal: AbortSignal;
  }): Promise<void>;
}

export interface TurnServicePersistenceDeps {
  /** Persist a native event and return conversation summary + optional message ID. */
  recordEvent(params: {
    clientId: string;
    channelId: string;
    sessionId: string;
    eventId: string;
    eventType: "message_sent" | "message_received";
    content: string;
    occurredAt: string;
    attachments: FredTurnAttachmentMeta[];
    webSearchEnabled: boolean;
    agentKey: FredAgentKey;
    weknoraAgentId: string;
    displayContent?: string;
    researchTrace?: FredResearchStep[];
    executionTrace?: FredExecutionStep[];
    sourceReferences?: FredSourceReference[];
  }): Promise<{
    conversation: { id: string; title: string; createdAt: string; updatedAt: string; agentKey: FredAgentKey };
    messageId?: number;
  }>;
  /** Load an owned conversation row. */
  loadConversation(params: {
    clientId: string;
    conversationId: string;
  }): Promise<{
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
    weknora_channel_id: string;
    weknora_session_id: string;
    agent_key: string;
    weknora_agent_id: string | null;
  } | null>;
  /** Persist validated artifact metadata and return client-safe DTOs. */
  persistGeneratedArtifacts?: (params: {
    clientId: string;
    conversationId: string;
    messageId: number;
    upstreamMessageId: string;
    artifacts: ParsedGeneratedArtifact[];
  }) => Promise<FredGeneratedArtifact[]>;
  /** Latest messages of an owned conversation in chronological order (fallback context). */
  loadRecentMessages?: (params: {
    clientId: string;
    conversationId: string;
    limit: number;
  }) => Promise<Array<{ role: "user" | "assistant"; content: string }>>;
}

export interface TurnServiceConfigDeps {
  /** Read the default Fred server config. */
  readFredConfig(): {
    channelId: string;
    publishToken: string;
    exchangeOrigin: string;
    expectedAgentId?: string;
  };
  /** Read QuickFred server config. */
  readQuickFredConfig(): {
    channelId: string;
    publishToken: string;
    exchangeOrigin: string;
    expectedAgentId: string;
  } | null;
  /** Optional Fred-Fallback config (other model, own channel); null/absent disables the fallback. */
  readFredFallbackConfig?(): {
    channelId: string;
    publishToken: string;
    exchangeOrigin: string;
    expectedAgentId: string;
  } | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_LIVE_BFG_CITATIONS = 20;

const FALLBACK_STEP_ID = "fallback";
const FALLBACK_STEP_LABEL = "Fred formuliert neu …";
const FALLBACK_STEP_DONE_LABEL = "Antwort über Ersatzmodell erstellt";
const FALLBACK_NOTE = "\n\n_Antwort über Ersatzmodell erstellt._";
const REFUSED_MESSAGE = "Fred konnte die Anfrage nicht beantworten. Bitte formuliere sie um.";
/** WeKnora's answer when the model provider blocks a request (internal/agent/observe.go). */
const REFUSAL_SENTINEL = "sorry, this request was blocked by the content safety policy.";
const FALLBACK_HISTORY_MESSAGES = 6;
const FALLBACK_HISTORY_MESSAGE_CHARS = 2_000;
const FALLBACK_HISTORY_TOTAL_CHARS = 8_000;

type FallbackReason = "refusal" | "empty" | "stream_error" | "upstream_error";

/** A failed primary attempt the fallback may take over (also the user-visible error if it cannot). */
class FallbackTrigger extends UserVisibleError {
  readonly reason: FallbackReason;
  constructor(reason: FallbackReason, message: string) {
    super(message, 502);
    this.reason = reason;
  }
}

type AttemptTarget = {
  sessionToken: string;
  channelId: string;
  publishToken: string;
  exchangeOrigin: string;
  sessionId: string;
  sessionSignature: string;
  agentId: string;
  knowledgeBaseIds: string[];
  query: string;
  webSearchEnabled: boolean;
};

type AttemptResult =
  | { stopped: true }
  | {
      stopped: false;
      rawAnswer: string;
      finalAnswer: string;
      citedAnswer: ReturnType<typeof renderCitedAnswer>;
      generatedArtifacts: ParsedGeneratedArtifact[];
    };

// ── Helpers ──────────────────────────────────────────────────────────────────

function sseData(frame: string): string | null {
  const lines = frame.split(/\r?\n/u);
  const data = lines
    .filter((line) => line === "data" || line.startsWith("data:"))
    .map((line) => (line.startsWith("data:") ? line.slice(5).trimStart() : ""))
    .join("\n");
  return data || null;
}

/** Resolves once the given signal aborts. Never resolves when no signal is given. */
function abortSignalPromise(signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (!signal) return;
    if (signal.aborted) { resolve(); return; }
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

/**
 * A request deadline aborts the turn signal with its 504 timeout error (see
 * createDeadline). That is a failed turn, not a caller stop, and must be
 * reported as such.
 */
function isDeadlineAbort(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
    && signal.reason instanceof UserVisibleError
    && signal.reason.status === 504;
}

function isRefusalAnswer(answer: string): boolean {
  return [answer, stripCitationTags(answer)].some((text) =>
    text.trim().toLowerCase().startsWith(REFUSAL_SENTINEL));
}

/**
 * Why a failed primary attempt may be retried on the fallback, or null when the
 * failure is terminal: caller stop, request deadline, or a client-class error
 * such as an unsupported action (409).
 */
function fallbackReason(error: unknown, signal: AbortSignal | undefined): FallbackReason | null {
  if (signal?.aborted) return null;
  if (error instanceof FallbackTrigger) return error.reason;
  if (error instanceof UserVisibleError && error.status < 500) return null;
  return "upstream_error";
}

function formatFallbackQuery(
  history: Array<{ role: "user" | "assistant"; content: string }>,
  question: string,
): string {
  const lines = history
    .slice(-FALLBACK_HISTORY_MESSAGES)
    .map((message) => ({
      role: message.role,
      text: stripCitationTags(message.content).trim().slice(0, FALLBACK_HISTORY_MESSAGE_CHARS),
    }))
    .filter((message) => message.text);
  let total = lines.reduce((sum, message) => sum + message.text.length, 0);
  while (lines.length > 0 && total > FALLBACK_HISTORY_TOTAL_CHARS) total -= lines.shift()!.text.length;
  if (lines.length === 0) return question;
  const rendered = lines
    .map((message) => `${message.role === "user" ? "Nutzer" : "Fred"}: ${message.text}`)
    .join("\n");
  return `[Bisheriger Gesprächsverlauf – nur Kontext]\n${rendered}\n[Ende Verlauf]\n\n${question}`;
}

// ── Core turn execution ─────────────────────────────────────────────────────

export async function* executeFredTurn(
  request: FredTurnRequest,
  upstream: TurnServiceUpstreamDeps,
  persistence: TurnServicePersistenceDeps,
  config: TurnServiceConfigDeps,
): AsyncGenerator<FredTurnEvent, FredTurnResult> {
  let upstreamMsgId = "";
  let stopRequested = false;
  let activeUpstreamReader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  // We store the session config here so requestStop() can use it.
  let sessionConfigCache: {
    sessionToken: string;
    channelId: string;
    publishToken: string;
    exchangeOrigin: string;
    sessionId: string;
    sessionSignature: string;
    weknoraAgentId: string;
  } | null = null;

  async function stopUpstreamMessage(): Promise<void> {
    if (!sessionConfigCache || !upstreamMsgId) return;
    try {
      await upstream.stopSession({
        ...sessionConfigCache,
        messageId: upstreamMsgId,
        signal: AbortSignal.timeout(5_000),
      });
    } catch { /* best effort */ }
  }

  async function requestStop(): Promise<void> {
    if (stopRequested) return;
    stopRequested = true;
    await stopUpstreamMessage();
    if (activeUpstreamReader) {
      try { await activeUpstreamReader.cancel(request.signal?.reason ?? "stop requested"); } catch { /* already closed */ }
    }
  }

  // Hoisted above the try block so the explicit-stop path (and the catch
  // block) can see whatever was accumulated/persisted so far.
  const isAdvanced = request.researchDisplayMode === "advanced";
  const answerChunks: string[] = [];
  let researchTrace: FredResearchStep[] = [];
  let executionTrace: FredExecutionStep[] = [];
  // Admin gate: only callers that resolved an admin user set `includeThinking`; everyone else never gets a collector.
  const thinking = isAdvanced && request.includeThinking === true && upstream.translateThinking
    ? createThinkingCollector({
      translate: upstream.translateThinking,
      currentStepId: () => executionTrace[executionTrace.length - 1]?.id,
      signal: request.signal,
    })
    : null;
  let sourceReferences: FredSourceReference[] = [];
  let acceptingCitationUpdates = true;
  const selectedAgentName = fredAgentName(request.agentKey);
  let requestTerminal = false;
  let requestFailurePhase: "connecting" | "streaming" = "connecting";
  let deltaYielded = false;

  /** Current question preceded by a compact history, since the fallback has no upstream session memory. */
  async function buildFallbackQuery(conversationId: string): Promise<string> {
    const question = request.upstreamQuery ?? request.query;
    if (!persistence.loadRecentMessages) return question;
    try {
      const recent = [...await persistence.loadRecentMessages({
        clientId: request.clientId,
        conversationId,
        limit: FALLBACK_HISTORY_MESSAGES + 1,
      })];
      const last = recent[recent.length - 1];
      if (last?.role === "user" && last.content.trim() === request.query.trim()) recent.pop();
      return formatFallbackQuery(recent, question);
    } catch {
      return question;
    }
  }
  try {
    // ── Resolve agent key & config ──────────────────────────────────────────
    const agentKey = request.agentKey;
    // selectedAgentName is now declared above

    let fredConfig: ReturnType<typeof config.readFredConfig>;
    let quickFredConfig: ReturnType<typeof config.readQuickFredConfig>;

    if (agentKey === "quickfred") {
      const qfConfig = config.readQuickFredConfig();
      if (!qfConfig) {
        throw new UserVisibleError("QuickFred ist noch nicht vollständig eingerichtet.", 503);
      }
      const defaultConfig = config.readFredConfig();
      if (qfConfig.channelId === defaultConfig.channelId) {
        throw new UserVisibleError("QuickFred benötigt einen eigenen WeKnora-Kanal.", 503);
      }
      quickFredConfig = qfConfig;
      fredConfig = qfConfig;
    } else {
      fredConfig = config.readFredConfig();
      quickFredConfig = null;
    }

    // ── Load stored conversation if continuing ──────────────────────────────
    let storedConversation: Awaited<ReturnType<typeof persistence.loadConversation>> = null;
    if (request.conversationId) {
      storedConversation = await persistence.loadConversation({
        clientId: request.clientId,
        conversationId: request.conversationId,
      });
      if (!storedConversation) {
        throw new UserVisibleError("Die Fred-Unterhaltung wurde nicht gefunden.", 404);
      }
      if (
        storedConversation
        && storedConversation.agent_key !== agentKey
      ) {
        throw new UserVisibleError("Der Agent ist für diese Unterhaltung bereits festgelegt.", 409);
      }
    }

    // ── Mint session & config ───────────────────────────────────────────────
    const embedSession = await upstream.mintSession({
      channelId: fredConfig.channelId,
      publishToken: fredConfig.publishToken,
      exchangeOrigin: fredConfig.exchangeOrigin,
      signal: request.signal ? request.signal : new AbortController().signal,
    });

    const upstreamConfig = await upstream.fetchUpstreamConfig({
      sessionToken: embedSession.token,
      channelId: fredConfig.channelId,
      publishToken: fredConfig.publishToken,
      exchangeOrigin: fredConfig.exchangeOrigin,
      signal: request.signal ? request.signal : new AbortController().signal,
    });

    // Verify QuickFred agent binding
    if (
      quickFredConfig?.expectedAgentId
      && upstreamConfig.agentId !== quickFredConfig.expectedAgentId
    ) {
      throw new UserVisibleError("Der QuickFred-Kanal ist nicht an den erwarteten Agenten gebunden.", 503);
    }

    if (
      storedConversation?.weknora_agent_id
      && storedConversation.weknora_agent_id !== upstreamConfig.agentId
    ) {
      throw new UserVisibleError("Die Agentenkonfiguration dieser Unterhaltung hat sich geändert.", 409);
    }

    if (request.webSearchEnabled && !upstreamConfig.allowWebSearch) {
      throw new UserVisibleError(`Die Websuche ist für ${selectedAgentName} nicht freigeschaltet.`, 400);
    }

    // ── Create or resume upstream session ───────────────────────────────────
    let upstreamSession: { id: string; signature: string };
    if (storedConversation?.weknora_session_id) {
      if (storedConversation.weknora_channel_id !== fredConfig.channelId) {
        throw new UserVisibleError("Diese Unterhaltung gehört zu einer älteren Kanalkonfiguration.", 409);
      }
      upstreamSession = {
        id: storedConversation.weknora_session_id,
        signature: upstream.deriveSessionSignature({
          channelId: fredConfig.channelId,
          publishToken: fredConfig.publishToken,
          sessionId: storedConversation.weknora_session_id,
        }),
      };
    } else {
      upstreamSession = await upstream.createSession({
        sessionToken: embedSession.token,
        channelId: fredConfig.channelId,
        publishToken: fredConfig.publishToken,
        exchangeOrigin: fredConfig.exchangeOrigin,
        signal: request.signal ? request.signal : new AbortController().signal,
      });
    }

    // ── Record user event ───────────────────────────────────────────────────
    const userOccurredAt = new Date().toISOString();
    const userEventId = request.userEventId ?? randomUUID();
    const { conversation, messageId: userMessageId } = await persistence.recordEvent({
      clientId: request.clientId,
      channelId: fredConfig.channelId,
      sessionId: upstreamSession.id,
      eventId: userEventId,
      eventType: "message_sent",
      content: request.query,
      occurredAt: userOccurredAt,
      attachments: request.attachments ?? [],
      webSearchEnabled: request.webSearchEnabled,
      agentKey,
      weknoraAgentId: upstreamConfig.agentId,
    });

    if (request.onRequestTransition) {
      if (userMessageId === undefined) {
        throw new UserVisibleError("Die gespeicherte Anfrage hat keine Nachrichten-ID.", 503);
      }
      await request.onRequestTransition({
        status: "user_persisted",
        conversationId: conversation.id,
        userMessageId,
      });
    }

    yield { type: "conversation", conversation };
    await request.onConversationEvent?.(conversation);

    // ── Fallback availability (Fred only, user event already persisted) ─────
    let fallbackConfig: NonNullable<ReturnType<NonNullable<TurnServiceConfigDeps["readFredFallbackConfig"]>>> | null = null;
    if (agentKey === "fred" && config.readFredFallbackConfig) {
      try {
        const candidate = config.readFredFallbackConfig();
        if (candidate && candidate.channelId !== fredConfig.channelId) fallbackConfig = candidate;
      } catch { /* feature stays off */ }
    }

    // ── Attempt streaming (primary Fred run and, if needed, the fallback) ───
    const streamAttempt = async function* (
      target: AttemptTarget,
      detectRefusal: boolean,
    ): AsyncGenerator<FredTurnEvent, AttemptResult> {
      sessionConfigCache = {
        sessionToken: target.sessionToken,
        channelId: target.channelId,
        publishToken: target.publishToken,
        exchangeOrigin: target.exchangeOrigin,
        sessionId: target.sessionId,
        sessionSignature: target.sessionSignature,
        weknoraAgentId: target.agentId,
      };
      const upstreamBody = await upstream.openStream({
        sessionToken: target.sessionToken,
        channelId: target.channelId,
        publishToken: target.publishToken,
        exchangeOrigin: target.exchangeOrigin,
        sessionId: target.sessionId,
        sessionSignature: target.sessionSignature,
        visitorId: upstream.visitorId(target.publishToken, request.clientId),
        query: target.query,
        agentId: target.agentId,
        knowledgeBaseIds: target.knowledgeBaseIds,
        webSearchEnabled: target.webSearchEnabled,
        signal: request.signal ? request.signal : new AbortController().signal,
      });

      const upstreamReader = upstreamBody.getReader();
      activeUpstreamReader = upstreamReader;
      requestFailurePhase = "streaming";
      const decoder = new TextDecoder();

      let buffer = "";
      let sawUpstreamCompletion = false;
      let finalContent = "";
      let answerRetracted = false;
      const externalAbort = abortSignalPromise(request.signal);
      let stoppedByCaller = false;
      let generatedArtifacts: ParsedGeneratedArtifact[] = [];

      // ── BFG citation pipeline ─────────────────────────────────────────────
      const verifiedCitations = new Map<string, VerifiedBfgCitation>();
      const pendingCitationSteps: FredResearchStep[] = [];
      const pendingExecCitationSteps: FredExecutionStep[] = [];
      // Steps changed by the frame being processed; only these are checked/yielded per frame.
      const touchedExecutionSteps = new Map<string, FredExecutionStep>();

      const verifyFinalCitations = async (text: string) => {
        const candidates = [
          ...new Set(extractStreamStableBfgGzCandidates(text, true)),
        ].slice(0, MAX_LIVE_BFG_CITATIONS);
        if (candidates.length === 0) return;
        const verification = await verifyBfgCitations(candidates, fetch, {
          signal: request.signal,
          maxWaitMs: FINAL_ANSWER_CITATION_WAIT_MS,
          onMetrics: (metrics) => console.info("findok citation verification", {
            path: "fred_turn_service",
            ...metrics,
          }),
        });
        for (const resolution of verification.verified) {
          if (!acceptingCitationUpdates) return;
          verifiedCitations.set(resolution.gz, resolution);
          sourceReferences = mergeFredSources(sourceReferences, [
            {
              kind: "web",
              url: resolution.fullTextUrl,
              title: `BFG ${resolution.gz}: ${resolution.title}`.slice(0, 512),
            },
          ]);
          const verificationStep: FredResearchStep = {
            id: `findok:${resolution.gz}`,
            kind: "sources",
            status: "completed",
            label: `BFG-Fundstelle ${resolution.gz} verifiziert`,
          };
          researchTrace = mergeFredResearchStep(researchTrace, verificationStep);
          pendingCitationSteps.push(verificationStep);

          if (isAdvanced) {
            const execVerificationStep: FredExecutionStep = {
              id: `findok:${resolution.gz}`,
              kind: "sources",
              status: "completed",
              label: `BFG-Fundstelle ${resolution.gz} verifiziert`,
            };
            executionTrace = mergeFredExecutionStep(executionTrace, execVerificationStep);
            pendingExecCitationSteps.push(execVerificationStep);
          }
        }
      };

      // ── SSE frame processing ──────────────────────────────────────────────
      const processFrame = (frame: string): void => {
        const data = sseData(frame);
        if (!data || data === "[DONE]") return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch {
          throw new FallbackTrigger("stream_error", "Fred hat ein ungültiges Streaming-Ereignis geliefert.");
        }
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const upstreamEvent = parsed as Record<string, unknown>;
          if (
            upstreamEvent.response_type === "agent_query"
            && typeof upstreamEvent.assistant_message_id === "string"
          ) {
            const messageId = upstreamEvent.assistant_message_id.trim();
            if (messageId) upstreamMsgId = messageId;
          }
        }
        const research = parseWeKnoraResearchEvent(parsed, { includeDirectSources: isAdvanced });
        if (research.fatalError) {
          throw new FallbackTrigger("stream_error", `${selectedAgentName} konnte die Anfrage nicht abschließen.`);
        }
        if (research.unsupported) {
          throw new UserVisibleError(
            "Diese Fred-Aktion benötigt eine zusätzliche Bestätigung, die hier noch nicht unterstützt wird.",
            409,
          );
        }
        sourceReferences = mergeFredSources(sourceReferences, research.sources);
        if (research.step) {
          researchTrace = mergeFredResearchStep(researchTrace, research.step);
          // yield is handled by caller
        }
        if (isAdvanced) {
          // Before the merge: a non-thinking event ends the open block anchored on the step it follows.
          thinking?.ingest(parsed);
          const merged = mergeFredExecutionUpdate(executionTrace, parseWeKnoraExecutionEvent(parsed));
          executionTrace = merged.trace;
          for (const step of merged.touched) touchedExecutionSteps.set(step.id, step);
          // Translations that finished in the meantime join the trace (never awaited here).
          for (const step of thinking?.drain() ?? []) {
            executionTrace = mergeFredExecutionStep(executionTrace, step);
            touchedExecutionSteps.set(step.id, step);
          }
          // yield is handled by caller
        }
        if (isUpstreamCompleteEvent(parsed)) {
          sawUpstreamCompletion = true;
          finalContent = upstreamFinalContent(parsed) || finalContent;
          if (persistence.persistGeneratedArtifacts) {
            const parsedArtifacts = parseGeneratedArtifacts(parsed);
            if (parsedArtifacts.length > 0) generatedArtifacts = parsedArtifacts;
          }
          if (!upstreamMsgId && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const envelopeId = (parsed as Record<string, unknown>).id;
            if (typeof envelopeId === "string" && envelopeId.trim()) upstreamMsgId = envelopeId.trim();
          }
        }
        if (isPreambleRetractingToolCall(parsed) && answerChunks.length > 0) {
          answerChunks.length = 0;
          answerRetracted = true;
        }
        const event = upstreamDelta(parsed);
        if (event.content) {
          answerChunks.push(event.content);
          // yield is handled by caller
        }
      };

      // ── Stream processing loop ────────────────────────────────────────────
      // Steps already shown (e.g. the fallback marker) must not be re-emitted.
      const yieldedResearchSteps = new Map<string, string>(
        researchTrace.map((step) => [step.id, JSON.stringify(step)]),
      );
      const yieldedExecutionSteps = new Map<string, string>(
        executionTrace.map((step) => [step.id, JSON.stringify(step)]),
      );
      let yieldedChunkCount = 0;
      // Citation tags (`<kb …/>`) may arrive split across deltas; they never reach the client.
      const citationFilter = createCitationStreamFilter();
      while (true) {
        const readResult = request.signal
          ? await Promise.race([
              upstreamReader.read().then((result) => ({ kind: "read" as const, result })),
              externalAbort.then(() => ({ kind: "abort" as const })),
            ])
          : { kind: "read" as const, result: await upstreamReader.read() };
        if (readResult.kind === "abort") {
          // A deadline is a failure: the catch block stops upstream, records
          // the timeout and reports it instead of ending the stream silently.
          if (isDeadlineAbort(request.signal)) throw request.signal?.reason;
          stoppedByCaller = true;
          await requestStop();
          break;
        }
        const { value, done } = readResult.result;
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/u);
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          processFrame(frame);
          for (const step of researchTrace) {
            const signature = JSON.stringify(step);
            if (step.id && step.kind && yieldedResearchSteps.get(step.id) !== signature) {
              yieldedResearchSteps.set(step.id, signature);
              yield { type: "research", step };
            }
          }
          if (isAdvanced) {
            for (const step of touchedExecutionSteps.values()) {
              const signature = JSON.stringify(step);
              if (step.id && step.kind && yieldedExecutionSteps.get(step.id) !== signature) {
                yieldedExecutionSteps.set(step.id, signature);
                yield { type: "execution", step };
              }
            }
            touchedExecutionSteps.clear();
          }
          if (answerRetracted) {
            answerRetracted = false;
            if (yieldedChunkCount > 0) yield { type: "replace", answer: "" };
            yieldedChunkCount = 0;
            citationFilter.reset();
          }
          // Yield any new content chunks from this frame
          for (const chunk of answerChunks.slice(yieldedChunkCount)) {
            const visible = citationFilter.push(chunk);
            if (visible) {
              deltaYielded = true;
              yield { type: "delta", content: visible };
            }
          }
          yieldedChunkCount = answerChunks.length;
        }
        // `complete` is WeKnora's last meaningful event and already carries the
        // persisted artifacts. On a session's first turn WeKnora keeps the
        // stream open for up to 3 s to send a title Findog does not use.
        if (sawUpstreamCompletion) {
          void upstreamReader.cancel().catch(() => undefined);
          break;
        }
      }

      if (stoppedByCaller) return { stopped: true };

      if (!sawUpstreamCompletion) {
        buffer += decoder.decode();
        if (buffer.trim()) processFrame(buffer);
      }

      if (!sawUpstreamCompletion) {
        throw new FallbackTrigger("stream_error", EOF_WITHOUT_FINAL_CLIENT_MESSAGE);
      }

      // In agent mode the completion carries the answer WeKnora persisted, after
      // preambles were dropped and artifact references reconciled.
      const rawAnswer = finalContent || answerChunks.join("");
      const plainFinalAnswer = rawAnswer.trim();
      if (!plainFinalAnswer) {
        throw new FallbackTrigger("empty", `${selectedAgentName} hat keine Antwort geliefert.`);
      }
      // Never persist or deliver a provider refusal when a retry is possible.
      if (detectRefusal && isRefusalAnswer(plainFinalAnswer)) {
        throw new FallbackTrigger("refusal", REFUSED_MESSAGE);
      }

      // A final unterminated SSE frame may have added a research step after the
      // stream loop's regular flush. Emit any such upstream update before the
      // citation verification adds its own steps.
      for (const step of researchTrace) {
        const signature = JSON.stringify(step);
        if (step.id && step.kind && yieldedResearchSteps.get(step.id) !== signature) {
          yieldedResearchSteps.set(step.id, signature);
          yield { type: "research", step };
        }
      }
      if (isAdvanced) {
        // Answer text is already streamed; give just-finished reasoning translations a short grace period.
        for (const step of (await thinking?.settle()) ?? []) {
          executionTrace = mergeFredExecutionStep(executionTrace, step);
        }
        // The run is over: a text-free analysis marker that never saw a `done` event must not keep pulsing.
        executionTrace = finalizeExecutionTrace(executionTrace);
        for (const step of executionTrace) {
          const signature = JSON.stringify(step);
          if (step.id && step.kind && yieldedExecutionSteps.get(step.id) !== signature) {
            yieldedExecutionSteps.set(step.id, signature);
            yield { type: "execution", step };
          }
        }
      }

      await verifyFinalCitations(stripCitationTags(plainFinalAnswer));
      // Flush any pending citation research steps
      for (const step of pendingCitationSteps) {
        const signature = JSON.stringify(step);
        if (step.id && step.kind && yieldedResearchSteps.get(step.id) !== signature) {
          yieldedResearchSteps.set(step.id, signature);
          yield { type: "research", step };
        }
      }
      if (isAdvanced) {
        for (const step of pendingExecCitationSteps) {
          const signature = JSON.stringify(step);
          if (step.id && step.kind && yieldedExecutionSteps.get(step.id) !== signature) {
            yieldedExecutionSteps.set(step.id, signature);
            yield { type: "execution", step };
          }
        }
      }

      // The stored answer keeps its citation tags; readers turn them into
      // numbered markers with renderCitedAnswer (single source of truth).
      const finalAnswer = normalizeGeneratedArtifactLinks(mapOutsideCitationTags(
        plainFinalAnswer,
        (segment) => linkVerifiedBfgCitations(segment, [...verifiedCitations.values()], { target: "fullText" }),
      ), generatedArtifacts);
      return {
        stopped: false,
        rawAnswer,
        finalAnswer,
        citedAnswer: renderCitedAnswer(finalAnswer),
        generatedArtifacts,
      };
    };

    // ── Run the primary attempt; on refusal/failure retry once on the fallback ─
    const primaryTarget: AttemptTarget = {
      sessionToken: embedSession.token,
      channelId: fredConfig.channelId,
      publishToken: fredConfig.publishToken,
      exchangeOrigin: fredConfig.exchangeOrigin,
      sessionId: upstreamSession.id,
      sessionSignature: upstreamSession.signature,
      agentId: upstreamConfig.agentId,
      knowledgeBaseIds: upstreamConfig.knowledgeBaseIds,
      query: request.upstreamQuery ?? request.query,
      webSearchEnabled: request.webSearchEnabled,
    };
    await request.onRequestTransition?.({ status: "generating" });
    let attempt: AttemptResult;
    let usedFallback = false;
    try {
      attempt = yield* streamAttempt(primaryTarget, fallbackConfig !== null);
    } catch (primaryError) {
      const reason = fallbackConfig ? fallbackReason(primaryError, request.signal) : null;
      if (!fallbackConfig || !reason) throw primaryError;
      console.warn("fred fallback", { requestId: request.requestId, reason });

      // Abandon the primary run before starting the second one.
      await stopUpstreamMessage();
      if (activeUpstreamReader) {
        try { await activeUpstreamReader.cancel(primaryError); } catch { /* already closed */ }
        activeUpstreamReader = undefined;
      }
      upstreamMsgId = "";
      stopRequested = false;
      answerChunks.length = 0;
      sourceReferences = [];
      requestFailurePhase = "connecting";

      if (deltaYielded) yield { type: "replace", answer: "" };
      const runningStep: FredResearchStep = {
        id: FALLBACK_STEP_ID,
        kind: "tool",
        status: "running",
        label: FALLBACK_STEP_LABEL,
      };
      researchTrace = [runningStep];
      yield { type: "research", step: runningStep };
      executionTrace = [];
      thinking?.reset();
      if (isAdvanced) {
        executionTrace = [{ ...runningStep }];
        yield { type: "execution", step: executionTrace[0] };
      }

      let fallbackTarget: AttemptTarget;
      try {
        const fallbackSignal = request.signal ? request.signal : new AbortController().signal;
        const session = await upstream.mintSession({
          channelId: fallbackConfig.channelId,
          publishToken: fallbackConfig.publishToken,
          exchangeOrigin: fallbackConfig.exchangeOrigin,
          signal: fallbackSignal,
        });
        const fallbackUpstreamConfig = await upstream.fetchUpstreamConfig({
          sessionToken: session.token,
          channelId: fallbackConfig.channelId,
          publishToken: fallbackConfig.publishToken,
          exchangeOrigin: fallbackConfig.exchangeOrigin,
          signal: fallbackSignal,
        });
        if (fallbackUpstreamConfig.agentId !== fallbackConfig.expectedAgentId) {
          throw new Error("fallback agent binding mismatch");
        }
        const fallbackSession = await upstream.createSession({
          sessionToken: session.token,
          channelId: fallbackConfig.channelId,
          publishToken: fallbackConfig.publishToken,
          exchangeOrigin: fallbackConfig.exchangeOrigin,
          signal: fallbackSignal,
        });
        fallbackTarget = {
          sessionToken: session.token,
          channelId: fallbackConfig.channelId,
          publishToken: fallbackConfig.publishToken,
          exchangeOrigin: fallbackConfig.exchangeOrigin,
          sessionId: fallbackSession.id,
          sessionSignature: fallbackSession.signature,
          agentId: fallbackUpstreamConfig.agentId,
          knowledgeBaseIds: fallbackUpstreamConfig.knowledgeBaseIds,
          query: await buildFallbackQuery(conversation.id),
          webSearchEnabled: request.webSearchEnabled && fallbackUpstreamConfig.allowWebSearch,
        };
      } catch {
        // The fallback could not be set up: report the original failure.
        throw primaryError;
      }

      attempt = yield* streamAttempt(fallbackTarget, true);
      usedFallback = true;
    }

    if (attempt.stopped) {
      acceptingCitationUpdates = false;
      if (!request.deferUnsuccessfulTerminalTransition) {
        await request.onRequestTransition?.({
          status: "cancelled",
          failurePhase: requestFailurePhase,
          errorCode: "request_cancelled",
        });
        requestTerminal = true;
      }
      return {
        answer: "",
        rawAnswer: answerChunks.join(""),
        conversation,
        researchTrace,
        executionTrace: isAdvanced ? executionTrace : undefined,
        sourceReferences,
        stopped: true,
      };
    }

    const { rawAnswer, citedAnswer, generatedArtifacts } = attempt;
    if (usedFallback) {
      const doneStep: FredResearchStep = {
        id: FALLBACK_STEP_ID,
        kind: "tool",
        status: "completed",
        label: FALLBACK_STEP_DONE_LABEL,
      };
      researchTrace = mergeFredResearchStep(researchTrace, doneStep);
      yield { type: "research", step: doneStep };
      if (isAdvanced) {
        executionTrace = mergeFredExecutionStep(executionTrace, { ...doneStep });
        yield { type: "execution", step: { ...doneStep } };
      }
    }
    const finalAnswer = attempt.finalAnswer + (usedFallback ? FALLBACK_NOTE : "");
    const finalCitedText = citedAnswer.text + (usedFallback ? FALLBACK_NOTE : "");
    sourceReferences = mergeFredSources(sourceReferences, citedAnswer.cited);

    const { conversation: finalConversation, messageId: assistantMessageId } = await persistence.recordEvent({
      clientId: request.clientId,
      channelId: fredConfig.channelId,
      sessionId: upstreamSession.id,
      eventId: request.assistantEventId ?? randomUUID(),
      eventType: "message_received",
      content: rawAnswer,
      occurredAt: new Date().toISOString(),
      attachments: [],
      webSearchEnabled: false,
      displayContent: finalAnswer,
      researchTrace,
      executionTrace: isAdvanced ? executionTrace : [],
      sourceReferences,
      agentKey,
      weknoraAgentId: upstreamConfig.agentId,
    });

    let persistedArtifacts: FredGeneratedArtifact[] = [];
    if (
      generatedArtifacts.length > 0
      && upstreamMsgId
      && assistantMessageId !== undefined
      && persistence.persistGeneratedArtifacts
    ) {
      persistedArtifacts = await persistence.persistGeneratedArtifacts({
        clientId: request.clientId,
        conversationId: finalConversation.id,
        messageId: assistantMessageId,
        upstreamMessageId: upstreamMsgId,
        artifacts: generatedArtifacts,
      });
    }

    if (request.onRequestTransition) {
      if (assistantMessageId === undefined) {
        throw new UserVisibleError("Die gespeicherte Antwort hat keine Nachrichten-ID.", 503);
      }
      await request.onRequestTransition({
        status: "completed",
        assistantMessageId,
      });
      requestTerminal = true;
    }

    yield {
      type: "final",
      answer: finalCitedText,
      assistantMessageId,
      conversation: finalConversation,
      researchTrace,
      executionTrace: isAdvanced ? executionTrace : undefined,
      sourceReferences: isAdvanced ? stripSourceReferenceIds(sourceReferences) : sourceReferences,
      ...(citedAnswer.cited.length > 0 ? { citedSources: publicCitedSources(citedAnswer.cited) } : {}),
      ...(persistedArtifacts.length > 0 ? { artifacts: persistedArtifacts } : {}),
    };

    return {
      answer: finalAnswer,
      rawAnswer,
      conversation: finalConversation,
      assistantMessageId,
      researchTrace,
      executionTrace: isAdvanced ? executionTrace : undefined,
      sourceReferences,
      ...(persistedArtifacts.length > 0 ? { artifacts: persistedArtifacts } : {}),
      stopped: stopRequested,
    };
  } catch (error) {
    acceptingCitationUpdates = false;
    const timedOut = isDeadlineAbort(request.signal);
    const cancelled = request.signal?.aborted === true && !timedOut;
    if (
      !requestTerminal
      && request.onRequestTransition
      && !request.deferUnsuccessfulTerminalTransition
    ) {
      try {
        await request.onRequestTransition({
          status: cancelled ? "cancelled" : "failed",
          failurePhase: requestFailurePhase,
          errorCode: cancelled ? "request_cancelled" : timedOut ? "turn_timeout" : "turn_failed",
        });
        requestTerminal = true;
      } catch {
        // Preserve the original turn failure. The stale receipt is itself a
        // completeness alert and can be reconciled by its deterministic event IDs.
      }
    }
    // Best-effort stop
    if (!stopRequested) {
      stopRequested = true;
      await stopUpstreamMessage();
    }
    if (activeUpstreamReader) {
      try { await activeUpstreamReader.cancel(error); } catch { /* already closed */ }
    }
    const visibleError = timedOut ? request.signal?.reason : error;
    if (visibleError instanceof UserVisibleError) {
      yield { type: "error", error: visibleError.message };
    } else {
      yield { type: "error", error: `${selectedAgentName} konnte die Anfrage nicht abschließen.` };
    }
    throw error;
  }
}
