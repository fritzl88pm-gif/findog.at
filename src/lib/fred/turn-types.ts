import type { FredAgentKey } from "@/lib/weknora/fred-agent";
import type {
  FredResearchStep,
  FredSourceReference,
} from "@/lib/weknora/fred-research";
import type { FredNativeConversation } from "@/lib/fred-native-stream";
import type { FredExecutionStep } from "@/lib/fred/execution-trace";

/** Attachment metadata for persistence – never carries raw bytes. */
export interface FredTurnAttachmentMeta {
  kind: "image" | "file";
  name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
}

export type FredRequestLifecycleTransition =
  | {
      status: "user_persisted";
      conversationId: string;
      userMessageId: number;
    }
  | { status: "generating" }
  | { status: "completed"; assistantMessageId: number }
  | {
      status: "failed" | "cancelled";
      failurePhase: "ingress" | "preprocessing" | "connecting" | "streaming" | "delivery";
      errorCode: string;
    };

/** Trusted server-side input for a Fred turn. */
export interface FredTurnRequest {
  /** The authenticated client (user) ID. */
  clientId: string;
  /** Optional conversation ID for session resume. */
  conversationId?: string;
  /** The user's question text (may include pre-processed attachment content). */
  query: string;
  /**
   * Server-only upstream query. When set, this is sent to the streaming
   * LLM upstream instead of `query`. Persistence, audit, and webhook
   * always use `query` unchanged. Used by Telegram workers to inject
   * attachment content without persisting raw bytes.
   */
  upstreamQuery?: string;
  /** Origin of the request. */
  origin: "web" | "telegram";
  /** For telegram-origin turns, the integration row ID. */
  telegramIntegrationId?: string;
  /** Durable ingress receipt ID created before any upstream work. */
  requestId?: string;
  /** The Fred agent key to use. */
  agentKey: FredAgentKey;
  /** Whether web search should be enabled for this turn. */
  webSearchEnabled: boolean;
  /** Whether Pro mode is active. */
  proModeEnabled: boolean;
  /** Research display mode resolved by server from user preferences. */
  researchDisplayMode?: "simple" | "advanced";
  /** Attachment metadata for persistence. */
  attachments?: FredTurnAttachmentMeta[];
  /**
   * Deterministic event ID for the user's message. Callers that must be
   * idempotent under at-least-once delivery (e.g. the Telegram worker
   * retrying a claimed update) should derive this from a stable key
   * instead of leaving it to a fresh random ID on every attempt.
   */
  userEventId?: string;
  /** Deterministic event ID for the assistant's reply. See `userEventId`. */
  assistantEventId?: string;
  /** Advances the durable receipt. Production callers provide this fail-closed hook. */
  onRequestTransition?: (transition: FredRequestLifecycleTransition) => Promise<void>;
  /**
   * Invoked once, right after the user's message has been persisted and the
   * (possibly newly created) conversation is known. Lets origin-specific
   * callers (e.g. the Telegram worker) bind/tag the conversation without the
   * turn service needing to know about that origin's storage model.
   */
  onConversationEvent?: (conversation: FredNativeConversation) => void | Promise<void>;
  /**
   * AbortSignal for explicit cancellation (e.g. Telegram /stop). When this
   * signal is aborted, the turn stops the upstream session, discards any
   * partial assistant answer (nothing is persisted or returned to send),
   * and resolves normally with `stopped: true` instead of throwing.
   */
  signal?: AbortSignal;
}

/** A single event emitted during a Fred turn. */
export type FredTurnEvent =
  | { type: "conversation"; conversation: FredNativeConversation }
  | { type: "delta"; content: string }
  | { type: "research"; step: FredResearchStep }
  | { type: "execution"; step: FredExecutionStep }
  | { type: "status"; label: string }
  | {
      type: "final";
      answer: string;
      assistantMessageId?: number;
      conversation: FredNativeConversation;
      researchTrace?: FredResearchStep[];
      executionTrace?: FredExecutionStep[];
      sourceReferences?: FredSourceReference[];
    }
  | { type: "cancelled"; conversation: FredNativeConversation }
  | { type: "error"; error: string };

/** Result returned by the turn service. */
export interface FredTurnResult {
  /** The final answer text (display content). Empty when `stopped` is true. */
  answer: string;
  /** The raw answer text (before citation transforms). Empty when `stopped` is true. */
  rawAnswer: string;
  /** The conversation summary. */
  conversation: FredNativeConversation;
  /** The assistant message ID from persistence. Absent when `stopped` is true. */
  assistantMessageId?: number;
  /** Research trace steps. */
  researchTrace: FredResearchStep[];
  /** Execution trace steps (advanced mode only). */
  executionTrace?: FredExecutionStep[];
  /** Source references. */
  sourceReferences: FredSourceReference[];
  /** Whether the upstream was explicitly stopped (via `request.signal`). */
  stopped: boolean;
}
