import { randomUUID } from "node:crypto";

import type { AgentStep, PdfArtifactDraft, PdfArtifactOffer } from "./agent-steps";
import { summarizeStepText } from "./agent-steps";
import { UserVisibleError } from "./errors";
import type { ModelRunProvenance } from "./model-settings";
import { getSupabaseServerClient } from "./supabase/server";
import type { StichtagResolution } from "./legal-stichtag";
import type { ResearchEvidenceDraft } from "./research-evidence";
import {
  RESEARCH_MEMORY_CARD_PROMPT_VERSION,
  type ResearchMemoryCard,
} from "./research-memory-cards";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ConversationLookupSupabaseClient = {
  from: (table: "conversations") => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<{
          data: { client_id: string | null; title?: string } | null;
          error: unknown;
        }>;
      };
    };
  };
};

function isUuid(value: string): boolean {
  return uuidPattern.test(value);
}

function throwIfPersistenceAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("Chat persistence was aborted");
}

function withPersistenceSignal<T extends { abortSignal(signal: AbortSignal): T }>(
  query: T,
  signal?: AbortSignal,
): T {
  return signal ? query.abortSignal(signal) : query;
}

export function isConversationOwnedByClient(
  existingClientId: string | null | undefined,
  clientId: string,
): boolean {
  return !existingClientId || existingClientId === clientId;
}

export async function resolveConversationIdForClient(options: {
  conversationId?: string;
  clientId: string;
  supabase?: unknown;
}): Promise<string> {
  return (await resolveConversationContextForClient(options)).id;
}

export async function resolveConversationContextForClient(options: {
  conversationId?: string;
  clientId: string;
  supabase?: unknown;
}): Promise<{ id: string; title?: string; isNew: boolean }> {
  if (!isUuid(options.clientId)) {
    throw new UserVisibleError("Anmeldung konnte keinem gültigen Benutzer zugeordnet werden.", 401);
  }

  const requestedConversationId = options.conversationId?.trim();
  if (!requestedConversationId) {
    return { id: randomUUID(), isNew: true };
  }
  if (!isUuid(requestedConversationId)) {
    throw new UserVisibleError("Gespräch-ID ist ungültig.", 400);
  }

  const supabase = (options.supabase ?? getSupabaseServerClient()) as ConversationLookupSupabaseClient | null;
  if (!supabase) {
    throw new UserVisibleError("Gesprächszuordnung kann derzeit nicht geprüft werden.", 503);
  }

  const { data: existingConversation, error: lookupError } = await supabase
    .from("conversations")
    .select("client_id,title")
    .eq("id", requestedConversationId)
    .maybeSingle();
  if (lookupError) {
    throw new UserVisibleError("Gesprächszuordnung konnte nicht geprüft werden.", 503);
  }
  if (!isConversationOwnedByClient(existingConversation?.client_id, options.clientId)) {
    throw new UserVisibleError("Dieses Gespräch gehört nicht zu deinem Konto.", 403);
  }
  return {
    id: requestedConversationId,
    ...(existingConversation?.title ? { title: existingConversation.title } : {}),
    isNew: !existingConversation?.client_id,
  };
}

type PersistedStep = {
  step_order: number;
  step_type: string;
  title: string;
  content: string;
  tool_name: string | null;
  success: boolean | null;
  arguments: string | null;
  tools: string[] | null;
};

function sanitizeTraceText(value: unknown, maxLength: number): string {
  return summarizeStepText(value, maxLength * 2)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9._-]{8,}/giu, "sk-[redacted]")
    .slice(0, maxLength);
}

function sanitizeSteps(steps: AgentStep[]): PersistedStep[] {
  return steps.slice(0, 100).map((step, index) => ({
    step_order: index,
    step_type: step.type,
    title: sanitizeTraceText(step.title, 200),
    content: sanitizeTraceText(step.content, 4_000),
    tool_name: step.type === "tool_call" || step.type === "tool_result"
      ? sanitizeTraceText(step.toolName, 120)
      : null,
    success: step.type === "tool_result" ? step.success : null,
    arguments: step.type === "tool_call" && step.arguments !== undefined
      ? sanitizeTraceText(step.arguments, 1_000)
      : null,
    tools: step.type === "tools"
      ? (step.tools ?? []).slice(0, 30).map((tool) => sanitizeTraceText(tool, 120))
      : null,
  }));
}

function optionalMetadataText(
  evidence: ResearchEvidenceDraft,
  maxLength: number,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const value = evidence.classificationMetadata?.[key];
    if (typeof value === "string" && value.trim() && value.trim().length <= maxLength) {
      return value.trim();
    }
  }
  return null;
}

function optionalMetadataDate(
  evidence: ResearchEvidenceDraft,
  ...keys: string[]
): string | null {
  const value = optionalMetadataText(evidence, 10, ...keys);
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() + 1 === month
    && parsed.getUTCDate() === day
    ? value
    : null;
}

function queryText(evidence: ResearchEvidenceDraft): string | null {
  for (const key of ["query", "question", "search_query", "keyword"] as const) {
    const value = evidence.semanticArguments[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 4_000);
  }
  return null;
}

function stichtagColumns(stichtag: StichtagResolution): {
  date: string | null;
  kind: StichtagResolution["kind"];
  reason: string | null;
  matchedText: string | null;
  referenceYear: number | null;
} {
  if (stichtag.kind === "explicit") {
    return {
      date: stichtag.stichtag,
      kind: stichtag.kind,
      reason: null,
      matchedText: stichtag.matchedText,
      referenceYear: null,
    };
  }
  if (stichtag.kind === "implicit") {
    return {
      date: stichtag.stichtag,
      kind: stichtag.kind,
      reason: stichtag.reason,
      matchedText: null,
      referenceYear: null,
    };
  }
  return {
    date: null,
    kind: stichtag.kind,
    reason: stichtag.reason,
    matchedText: null,
    referenceYear: stichtag.referenceYear ?? null,
  };
}

function cardsByEvidenceId(
  cards: readonly ResearchMemoryCard[],
): Map<string, ResearchMemoryCard> {
  const mapped = new Map<string, ResearchMemoryCard>();
  const ambiguous = new Set<string>();
  for (const card of cards) {
    // The storage model intentionally keeps exactly one derivation per
    // evidence row. Multi-evidence claims require a normalized join model.
    if (
      card.evidenceIds.length !== 1
      || !card.summary.trim()
      || card.summary.length > 1_500
      || card.topics.length > 8
      || card.topics.some((topic) => !topic.trim() || topic.length > 80)
    ) continue;
    const evidenceId = card.evidenceIds[0];
    if (!evidenceId || ambiguous.has(evidenceId)) continue;
    if (mapped.has(evidenceId)) {
      mapped.delete(evidenceId);
      ambiguous.add(evidenceId);
      continue;
    }
    mapped.set(evidenceId, card);
  }
  return mapped;
}

function sameStichtag(left: StichtagResolution, right: StichtagResolution): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export type PersistedConversationTurn = {
  assistantMessageId: number;
  agentRunId: string;
  pdfArtifacts: PdfArtifactOffer[];
  artifactsPersisted: boolean;
};

export type PersistConversationTurnOptions = {
  conversationId?: string;
  clientId?: string;
  userMessage?: string;
  assistantMessage: string;
  title?: string;
  modelProvenance?: ModelRunProvenance;
  steps?: AgentStep[];
  researchResultLimit?: number;
  researchResultLimitSource?: "database" | "fallback";
  researchStichtag?: StichtagResolution;
  researchEvidence?: ResearchEvidenceDraft[];
  researchMemoryCards?: ResearchMemoryCard[];
  pdfArtifacts?: PdfArtifactDraft[];
  startedAt?: string;
  completedAt?: string;
  /**
   * Stable idempotency key for an uncertain commit retry. It is stored as the
   * agent_run.id, so retries must reuse both this key and the exact payload.
   */
  turnKey?: string;
  /** Cancels the single atomic PostgREST RPC. */
  signal?: AbortSignal;
};

function parsePersistedConversationTurn(value: unknown): PersistedConversationTurn | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (
    typeof result.assistantMessageId !== "number"
    || !Number.isSafeInteger(result.assistantMessageId)
    || typeof result.agentRunId !== "string"
    || !isUuid(result.agentRunId)
    || result.artifactsPersisted !== true
    || !Array.isArray(result.pdfArtifacts)
  ) {
    return null;
  }

  const pdfArtifacts = result.pdfArtifacts.flatMap((artifact) => {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) return [];
    const candidate = artifact as Record<string, unknown>;
    if (
      typeof candidate.id !== "string"
      || !isUuid(candidate.id)
      || typeof candidate.title !== "string"
      || !candidate.title.trim()
      || typeof candidate.filename !== "string"
      || !candidate.filename.trim()
    ) return [];
    return [{
      id: candidate.id,
      title: candidate.title,
      filename: candidate.filename,
    }];
  });
  if (pdfArtifacts.length !== result.pdfArtifacts.length) return null;

  return {
    assistantMessageId: result.assistantMessageId,
    agentRunId: result.agentRunId,
    pdfArtifacts,
    artifactsPersisted: true,
  };
}

export async function persistConversationTurn(
  options: PersistConversationTurnOptions,
): Promise<PersistedConversationTurn | null> {
  const supabase = getSupabaseServerClient();
  if (
    !supabase
    || !options.conversationId
    || !options.clientId
    || !options.userMessage
    || !options.modelProvenance
  ) {
    return null;
  }
  if (!isUuid(options.conversationId) || !isUuid(options.clientId)) {
    return null;
  }
  throwIfPersistenceAborted(options.signal);
  const agentRunId = options.turnKey?.trim() || randomUUID();
  if (!isUuid(agentRunId)) return null;
  const now = options.completedAt ?? new Date().toISOString();
  const title = options.title?.trim().slice(0, 80)
    || options.userMessage.replace(/\s+/gu, " ").trim().slice(0, 80)
    || "Neue Unterhaltung";
  const provenance = options.modelProvenance;
  const runStichtag = options.researchStichtag
    ? stichtagColumns(options.researchStichtag)
    : null;
  if (
    (options.steps?.length ?? 0) > 100
    || (options.researchEvidence?.length ?? 0) > 100
    || (options.pdfArtifacts?.length ?? 0) > 3
  ) {
    console.error("Supabase atomic conversation persistence validation failed");
    return null;
  }
  const steps = sanitizeSteps(options.steps ?? []);
  const evidenceDrafts = options.researchEvidence ?? [];
  let evidenceRows: Record<string, unknown>[] = [];
  if (
    evidenceDrafts.length > 0
    && runStichtag
    && options.researchResultLimit !== undefined
    && options.researchResultLimitSource !== undefined
  ) {
    const cards = cardsByEvidenceId(options.researchMemoryCards ?? []);
    const stepByOrder = new Map(steps.map((step) => [step.step_order, step]));
    evidenceRows = evidenceDrafts.flatMap((evidence) => {
      const step = stepByOrder.get(evidence.resultStepOrder);
      if (
        !step
        || step.step_type !== "tool_result"
        || step.success !== true
        || step.tool_name !== evidence.semanticToolName
        || !sameStichtag(evidence.stichtag, options.researchStichtag!)
      ) {
        return [];
      }
      const evidenceStichtag = stichtagColumns(evidence.stichtag);
      const card = cards.get(evidence.id);
      const llmCard = card?.generatedBy === "llm";
      return [{
        id: evidence.id,
        result_step_order: evidence.resultStepOrder,
        evidence_order: evidence.evidenceOrder,
        semantic_tool_name: evidence.semanticToolName,
        raw_tool_name: evidence.rawToolName,
        source_key: evidence.source.key,
        source_name: evidence.source.name,
        source_kb_id: evidence.source.kbId,
        source_system: evidence.source.system ?? null,
        evidence_kind: evidence.kind,
        requery_required: evidence.requeryRequired,
        semantic_arguments: evidence.semanticArguments,
        effective_arguments: evidence.effectiveArguments,
        result_limit_applied: evidence.resultLimit !== null,
        effective_result_limit: evidence.resultLimit,
        query_text: queryText(evidence),
        retrieval_stichtag: evidenceStichtag.date,
        retrieval_stichtag_kind: evidenceStichtag.kind,
        retrieval_stichtag_reason: evidenceStichtag.reason,
        retrieval_stichtag_matched_text: evidenceStichtag.matchedText,
        reference_year: evidenceStichtag.referenceYear,
        structured_content: evidence.structuredContent ?? null,
        classification_metadata: evidence.classificationMetadata ?? {},
        canonical_id: optionalMetadataText(evidence, 500, "canonical_id", "canonicalId"),
        version_id: optionalMetadataText(evidence, 500, "version_id", "versionId"),
        official_uri: optionalMetadataText(evidence, 2_048, "official_uri", "officialUri"),
        valid_from: optionalMetadataDate(evidence, "valid_from", "validFrom"),
        valid_to: optionalMetadataDate(evidence, "valid_to", "validTo"),
        rechtssatz_id: optionalMetadataText(evidence, 500, "rechtssatz_id", "rechtssatzId"),
        decision_id: optionalMetadataText(evidence, 500, "decision_id", "decisionId"),
        chunk_id: optionalMetadataText(evidence, 500, "chunk_id", "chunkId"),
        decision_date: optionalMetadataDate(evidence, "decision_date", "decisionDate"),
        content: evidence.content,
        content_sha256: evidence.contentSha256,
        original_content_sha256: evidence.originalContentSha256,
        original_content_chars: evidence.originalContentChars,
        content_truncated: evidence.contentTruncated,
        card_summary: card?.summary ?? null,
        card_topics: card?.topics ?? [],
        card_generation: card?.generatedBy ?? null,
        card_model: llmCard ? provenance.model : null,
        card_model_provider: llmCard ? provenance.provider : null,
        card_upstream_model: llmCard ? provenance.upstreamModel : null,
        card_reasoning: llmCard ? "disabled" : null,
        card_prompt_version: card ? RESEARCH_MEMORY_CARD_PROMPT_VERSION : null,
        retrieved_at: evidence.retrievedAt,
        card_generated_at: card ? now : null,
      }];
    });
  }
  if (evidenceRows.length !== evidenceDrafts.length) {
    // Evidence is audit material. Never commit a turn after silently dropping
    // a draft whose exact successful result step or Stichtag cannot be proven.
    console.error("Supabase atomic conversation persistence validation failed");
    return null;
  }
  const artifactDrafts = options.pdfArtifacts ?? [];
  const payload = {
    conversation_id: options.conversationId,
    client_id: options.clientId,
    title,
    user_message: options.userMessage,
    assistant_message: {
      content: options.assistantMessage,
      model: provenance.model,
      model_provider: provenance.provider,
      upstream_model: provenance.upstreamModel,
      reasoning_setting: provenance.reasoning,
      model_settings_revision: provenance.settingsRevision,
      model_settings_source: provenance.settingsSource,
    },
    agent_run: {
      id: agentRunId,
      started_at: options.startedAt ?? now,
      completed_at: now,
      research_result_limit: options.researchResultLimit ?? null,
      research_result_limit_source: options.researchResultLimitSource ?? null,
      research_stichtag: runStichtag?.date ?? null,
      research_stichtag_kind: runStichtag?.kind ?? null,
      research_stichtag_reason: runStichtag?.reason ?? null,
      research_stichtag_matched_text: runStichtag?.matchedText ?? null,
      research_reference_year: runStichtag?.referenceYear ?? null,
    },
    agent_steps: steps,
    research_evidence: evidenceRows,
    document_artifacts: artifactDrafts.map((artifact) => ({
        id: artifact.id,
        kind: "pdf",
        title: artifact.title,
        filename: artifact.filename,
        content_markdown: artifact.contentMarkdown,
        content_sha256: artifact.contentSha256,
        stichtag: artifact.stichtag,
        provenance: artifact.provenance,
      })),
  };

  throwIfPersistenceAborted(options.signal);
  const rpcQuery = withPersistenceSignal(
    supabase.rpc("persist_conversation_turn", { payload }),
    options.signal,
  );
  const { data, error, status } = await rpcQuery;
  throwIfPersistenceAborted(options.signal);
  if (error && status === 0) {
    // postgrest-js reports Fetch/connection failures as a resolved status-0
    // result. The database may nevertheless have committed, so let the route
    // reconcile once with the same idempotency key and exact payload.
    throw new Error("Supabase atomic conversation persistence transport failed");
  }
  if (error) {
    console.error("Supabase atomic conversation persistence failed");
    return null;
  }
  const persisted = parsePersistedConversationTurn(data);
  if (
    !persisted
    || persisted.agentRunId !== agentRunId
    || persisted.pdfArtifacts.length !== artifactDrafts.length
  ) {
    console.error("Supabase atomic conversation persistence returned an invalid result");
    return null;
  }
  return persisted;
}
