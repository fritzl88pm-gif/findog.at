import type { SupabaseClient } from "@supabase/supabase-js";

// ── Bounded status / phase / code values ────────────────────────────────────

export const GENERATION_RUN_STATUSES = [
  "preprocessing",
  "connecting",
  "streaming",
  "completed",
  "failed",
  "cancelled",
] as const;

export type GenerationRunStatus = (typeof GENERATION_RUN_STATUSES)[number];

export const FAILURE_PHASES = [
  "preprocessing",
  "connecting",
  "streaming",
] as const;

export type FailurePhase = (typeof FAILURE_PHASES)[number];

/** Stable, sanitized error codes — never derived from raw exception messages. */
export const ERROR_CODES = {
  PREPROCESSING_FAILED: "preprocessing_failed",
  UPSTREAM_EOF_WITHOUT_FINAL: "upstream_eof_without_final",
  TIMEOUT: "timeout",
  UNEXPECTED_ERROR: "unexpected_error",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// ── Run creation ────────────────────────────────────────────────────────────

export interface CreateGenerationRunParams {
  supabase: SupabaseClient;
  clientId: string;
  attachmentCount?: number;
  attachmentTotalBytes?: number;
  modelRoute?: string;
}

/**
 * Insert a new generation run with status=preprocessing.
 * Best-effort: returns the run ID on success, or null on failure.
 * Never throws.
 */
export async function createGenerationRun(
  params: CreateGenerationRunParams,
): Promise<string | null> {
  try {
    const { data, error } = await params.supabase
      .from("fred_generation_runs")
      .insert({
        client_id: params.clientId,
        status: "preprocessing",
        attachment_count: params.attachmentCount ?? 0,
        attachment_total_bytes: params.attachmentTotalBytes ?? 0,
        model_route: params.modelRoute ?? null,
      })
      .select("id")
      .single();

    if (error) return null;
    return (data as { id: string }).id;
  } catch {
    return null;
  }
}

// ── Run update ──────────────────────────────────────────────────────────────

export interface UpdateGenerationRunParams {
  supabase: SupabaseClient;
  runId: string;
  status?: GenerationRunStatus;
  failurePhase?: FailurePhase;
  errorCode?: ErrorCode;
  upstreamHttpStatus?: number;
  upstreamRequestId?: string;
  conversationId?: string;
  modelRoute?: string;
  /** Set this to true to persist first_delta_at as now() when not already set. */
  firstDelta?: boolean;
  /** Set this to true to persist completed_at as now(). */
  completed?: boolean;
}

/**
 * Update an existing generation run.
 * Best-effort: never throws.
 */
export async function updateGenerationRun(
  params: UpdateGenerationRunParams,
): Promise<void> {
  try {
    const updates: Record<string, unknown> = {};

    if (params.status !== undefined) {
      updates.status = params.status;
    }
    if (params.failurePhase !== undefined) {
      updates.failure_phase = params.failurePhase;
    }
    if (params.errorCode !== undefined) {
      updates.error_code = params.errorCode;
    }
    if (params.upstreamHttpStatus !== undefined) {
      updates.upstream_http_status = params.upstreamHttpStatus;
    }
    if (params.upstreamRequestId !== undefined) {
      updates.upstream_request_id = params.upstreamRequestId;
    }
    if (params.conversationId !== undefined) {
      updates.conversation_id = params.conversationId;
    }
    if (params.modelRoute !== undefined) {
      updates.model_route = params.modelRoute;
    }
    if (params.completed) {
      updates.completed_at = new Date().toISOString();
    }
    if (params.firstDelta) {
      updates.first_delta_at = new Date().toISOString();
    }

    if (Object.keys(updates).length === 0) return;

    await params.supabase
      .from("fred_generation_runs")
      .update(updates)
      .eq("id", params.runId);
  } catch {
    // Best-effort: silently ignore failures.
  }
}

// ── Route formatting helper ─────────────────────────────────────────────────

/**
 * Build the bounded model_route after upstream config is fetched.
 * Format: `weknora:<agentKey>:<agentId>` or
 * `weknora:<agentKey>:<agentId>:pro=<proModelId>` when pro is enabled.
 * Only includes fields actually returned by the upstream route.
 */
export function formatExactModelRoute(params: {
  agentKey: string;
  agentId: string;
  proModelId?: string;
}): string {
  const base = `weknora:${params.agentKey}:${params.agentId}`;
  if (params.proModelId) {
    return `${base}:pro=${params.proModelId}`;
  }
  return base;
}

// ── EOF detection helper ────────────────────────────────────────────────────

/**
 * Terminal error message the web client receives when the upstream SSE stream
 * ends without a completed/final answer event.
 */
export const EOF_WITHOUT_FINAL_CLIENT_MESSAGE =
  "Fred konnte die Antwort nicht abschließen. Die Frage wurde gespeichert; bitte erneut senden.";

/**
 * Returns true when the parsed upstream event represents the final
 * completion of the stream. We consider the stream "completed" when we see
 * response_type === "complete".
 */
export function isUpstreamCompleteEvent(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const event = parsed as Record<string, unknown>;
  return event.response_type === "complete";
}

/**
 * Returns true when the parsed upstream event contains actual answer content
 * (not thinking/status/tool metadata).
 */
export function isAnswerDelta(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const event = parsed as Record<string, unknown>;
  const responseType = typeof event.response_type === "string" ? event.response_type : "";
  // answer deltas are response_type === "answer" with content
  if (responseType === "answer" || event.type === "answer") {
    return typeof event.content === "string" && event.content.length > 0;
  }
  return false;
}
