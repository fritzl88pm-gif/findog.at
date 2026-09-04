import { randomUUID } from "node:crypto";

import { UserVisibleError } from "@/lib/errors";
import {
  extractStreamStableBfgGzCandidates,
  linkVerifiedBfgCitations,
  verifyBfgCitations,
  type VerifiedBfgCitation,
} from "@/lib/findok/bfg-citations";
import {
  EOF_WITHOUT_FINAL_CLIENT_MESSAGE,
  isUpstreamCompleteEvent,
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
import {
  mergeFredExecutionStep,
  parseWeKnoraExecutionEvent,
  type FredExecutionStep,
} from "./execution-trace";

import type {
  FredTurnAttachmentMeta,
  FredTurnEvent,
  FredTurnRequest,
  FredTurnResult,
} from "./turn-types";

// ── Dependency injection interfaces ──────────────────────────────────────────

export interface TurnServiceUpstreamDeps {
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
    summaryModelId: string;
    signal: AbortSignal;
  }): Promise<ReadableStream<Uint8Array>>;
  /** Compute the visitor HMAC for a user. */
  visitorId(publishToken: string, userId: string): string;
  /** Relay a webhook event (best-effort, fire-and-forget). */
  relayEvent(params: {
    sessionToken: string;
    channelId: string;
    publishToken: string;
    exchangeOrigin: string;
    sessionId: string;
    sessionSignature: string;
    type: "message_sent" | "message_received";
    content: string;
    signal: AbortSignal;
  }): Promise<void>;
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
    proModeEnabled: boolean;
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
  /** Read the Pro model ID. */
  readProModelId(): string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_LIVE_BFG_CITATIONS = 20;

// ── Helpers ──────────────────────────────────────────────────────────────────

function upstreamDelta(value: unknown): { content?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const event = value as Record<string, unknown>;
  const responseType = typeof event.response_type === "string" ? event.response_type : "";
  if (responseType === "answer" || event.type === "answer") {
    return { content: typeof event.content === "string" ? event.content : undefined };
  }
  if (!responseType && typeof event.content === "string") {
    return { content: event.content };
  }
  return {};
}

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

  async function requestStop(): Promise<void> {
    if (stopRequested) return;
    stopRequested = true;
    if (sessionConfigCache && upstreamMsgId) {
      try {
        await upstream.stopSession({
          ...sessionConfigCache,
          messageId: upstreamMsgId,
          signal: AbortSignal.timeout(5_000),
        });
      } catch { /* best effort */ }
    }
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
  let sourceReferences: FredSourceReference[] = [];

  let acceptingCitationUpdates = true;
  const selectedAgentName = fredAgentName(request.agentKey);
  let requestTerminal = false;
  let requestFailurePhase: "connecting" | "streaming" = "connecting";
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

    if (quickFredConfig && request.proModeEnabled) {
      throw new UserVisibleError("Fred Pro ist in einer QuickFred-Unterhaltung nicht verfügbar.", 400);
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

    sessionConfigCache = {
      sessionToken: embedSession.token,
      channelId: fredConfig.channelId,
      publishToken: fredConfig.publishToken,
      exchangeOrigin: fredConfig.exchangeOrigin,
      sessionId: upstreamSession.id,
      sessionSignature: upstreamSession.signature,
      weknoraAgentId: upstreamConfig.agentId,
    };

    const summaryModelId = request.proModeEnabled ? config.readProModelId() : "";

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
      proModeEnabled: request.proModeEnabled,
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

    // Relay webhook event (best-effort)
    void upstream.relayEvent({
      ...sessionConfigCache,
      type: "message_sent",
      content: request.query,
      signal: request.signal ? request.signal : new AbortController().signal,
    }).catch(() => undefined);

    // ── Open upstream stream ────────────────────────────────────────────────
    const visitorId = upstream.visitorId(fredConfig.publishToken, request.clientId);
    await request.onRequestTransition?.({ status: "generating" });
    const upstreamBody = await upstream.openStream({
      sessionToken: embedSession.token,
      channelId: fredConfig.channelId,
      publishToken: fredConfig.publishToken,
      exchangeOrigin: fredConfig.exchangeOrigin,
      sessionId: upstreamSession.id,
      sessionSignature: upstreamSession.signature,
      visitorId,
      query: request.upstreamQuery ?? request.query,
      agentId: upstreamConfig.agentId,
      knowledgeBaseIds: upstreamConfig.knowledgeBaseIds,
      webSearchEnabled: request.webSearchEnabled,
      summaryModelId,
      signal: request.signal ? request.signal : new AbortController().signal,
    });

    const upstreamReader = upstreamBody.getReader();
    activeUpstreamReader = upstreamReader;
    requestFailurePhase = "streaming";
    const decoder = new TextDecoder();

    let buffer = "";
    let sawUpstreamCompletion = false;
    const externalAbort = abortSignalPromise(request.signal);
    let stoppedByCaller = false;

    // ── BFG citation pipeline ───────────────────────────────────────────────
    const verifiedCitations = new Map<string, VerifiedBfgCitation>();
    const pendingCitationSteps: FredResearchStep[] = [];
    const pendingExecCitationSteps: FredExecutionStep[] = [];

    const verifyFinalCitations = async (text: string) => {
      const candidates = [
        ...new Set(extractStreamStableBfgGzCandidates(text, true)),
      ].slice(0, MAX_LIVE_BFG_CITATIONS);
      if (candidates.length === 0) return;
      const verification = await verifyBfgCitations(candidates, fetch, {
        signal: request.signal,
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

    // ── SSE frame processing ────────────────────────────────────────────────
    const processFrame = (frame: string): void => {
      const data = sseData(frame);
      if (!data || data === "[DONE]") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        throw new UserVisibleError("Fred hat ein ungültiges Streaming-Ereignis geliefert.", 502);
      }
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const upstreamEvent = parsed as Record<string, unknown>;
        if (
          upstreamEvent.response_type === "agent_query"
          && typeof upstreamEvent.assistant_message_id === "string"
        ) {
          upstreamMsgId = upstreamEvent.assistant_message_id;
        }
      }
      const research = parseWeKnoraResearchEvent(parsed, { includeDirectSources: isAdvanced });
      if (research.fatalError) {
        throw new UserVisibleError(
          `${selectedAgentName} konnte die Anfrage nicht abschließen.`,
          502,
        );
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
        const exec = parseWeKnoraExecutionEvent(parsed);
        if (exec.step) {
          executionTrace = mergeFredExecutionStep(executionTrace, exec.step);
          // yield is handled by caller
        }
      }
      if (isUpstreamCompleteEvent(parsed)) {
        sawUpstreamCompletion = true;
      }
      const event = upstreamDelta(parsed);
      if (event.content) {
        answerChunks.push(event.content);
        // yield is handled by caller
      }
    };

    // ── Stream processing loop ──────────────────────────────────────────────
    const yieldedResearchSteps = new Map<string, string>();
    const yieldedExecutionSteps = new Map<string, string>();
    let yieldedChunkCount = 0;
    while (true) {
      const readResult = request.signal
        ? await Promise.race([
            upstreamReader.read().then((result) => ({ kind: "read" as const, result })),
            externalAbort.then(() => ({ kind: "abort" as const })),
          ])
        : { kind: "read" as const, result: await upstreamReader.read() };
      if (readResult.kind === "abort") {
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
          for (const step of executionTrace) {
            const signature = JSON.stringify(step);
            if (step.id && step.kind && yieldedExecutionSteps.get(step.id) !== signature) {
              yieldedExecutionSteps.set(step.id, signature);
              yield { type: "execution", step };
            }
          }
        }
        // Yield any new content chunks from this frame
        for (const chunk of answerChunks.slice(yieldedChunkCount)) {
          yield { type: "delta", content: chunk };
        }
        yieldedChunkCount = answerChunks.length;
      }
    }

    if (stoppedByCaller) {
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

    buffer += decoder.decode();
    if (buffer.trim()) processFrame(buffer);

    if (!sawUpstreamCompletion) {
      throw new UserVisibleError(EOF_WITHOUT_FINAL_CLIENT_MESSAGE, 502);
    }

    const rawAnswer = answerChunks.join("");
    const plainFinalAnswer = rawAnswer.trim();
    if (!plainFinalAnswer) {
      throw new UserVisibleError(`${selectedAgentName} hat keine Antwort geliefert.`, 502);
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
      for (const step of executionTrace) {
        const signature = JSON.stringify(step);
        if (step.id && step.kind && yieldedExecutionSteps.get(step.id) !== signature) {
          yieldedExecutionSteps.set(step.id, signature);
          yield { type: "execution", step };
        }
      }
    }

    await verifyFinalCitations(plainFinalAnswer);
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

    const finalAnswer = linkVerifiedBfgCitations(
      plainFinalAnswer,
      [...verifiedCitations.values()],
      { target: "fullText" },
    );

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
      proModeEnabled: false,
      agentKey,
      weknoraAgentId: upstreamConfig.agentId,
    });

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

    void upstream.relayEvent({
      ...sessionConfigCache,
      type: "message_received",
      content: rawAnswer,
      signal: request.signal ? request.signal : new AbortController().signal,
    }).catch(() => undefined);

    yield {
      type: "final",
      answer: finalAnswer,
      assistantMessageId,
      conversation: finalConversation,
      researchTrace,
      executionTrace: isAdvanced ? executionTrace : undefined,
      sourceReferences,
    };

    return {
      answer: finalAnswer,
      rawAnswer,
      conversation: finalConversation,
      assistantMessageId,
      researchTrace,
      executionTrace: isAdvanced ? executionTrace : undefined,
      sourceReferences,
      stopped: stopRequested,
    };
  } catch (error) {
    acceptingCitationUpdates = false;
    if (
      !requestTerminal
      && request.onRequestTransition
      && !request.deferUnsuccessfulTerminalTransition
    ) {
      try {
        await request.onRequestTransition({
          status: request.signal?.aborted ? "cancelled" : "failed",
          failurePhase: requestFailurePhase,
          errorCode: request.signal?.aborted ? "request_cancelled" : "turn_failed",
        });
        requestTerminal = true;
      } catch {
        // Preserve the original turn failure. The stale receipt is itself a
        // completeness alert and can be reconciled by its deterministic event IDs.
      }
    }
    // Best-effort stop
    if (sessionConfigCache && upstreamMsgId && !stopRequested) {
      stopRequested = true;
      try {
        await upstream.stopSession({
          ...sessionConfigCache,
          messageId: upstreamMsgId,
          signal: AbortSignal.timeout(5_000),
        });
      } catch { /* best effort */ }
    }
    if (activeUpstreamReader) {
      try { await activeUpstreamReader.cancel(error); } catch { /* already closed */ }
    }
    if (error instanceof UserVisibleError) {
      yield { type: "error", error: error.message };
    } else {
      yield { type: "error", error: `${selectedAgentName} konnte die Anfrage nicht abschließen.` };
    }
    throw error;
  }
}
