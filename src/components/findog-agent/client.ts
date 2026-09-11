"use client";

/**
 * Client boundary shared by the Findog Agent chat and settings screens.
 *
 * Everything here is a thin projection of the existing admin API: one bearer
 * authenticated request helper, the allowlisted response shapes, and the
 * mappings between the redacted settings DTO and the writable settings payload.
 * There is no offline validation framework: the server stays the single
 * authority and its messages are surfaced verbatim.
 */

import {
  FINDOG_AGENT_EXA_SECRET_NAME,
  FINDOG_AGENT_KNOWLEDGE_SECRET_NAME,
  findogAgentConnectionSecretName,
  findogAgentMcpSecretName,
  type FindogAgentRedactedSettings,
  type FindogAgentSettings,
} from "@/lib/findog-agent/types";

const BASE_PATH = "/api/admin/findog-agent";

export class FindogAgentApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = "FindogAgentApiError";
    this.status = status;
    this.code = code;
  }
}

/** A revoked/absent administrator session: the feature state must be cleared. */
export function isFindogAgentAccessDenied(error: unknown): boolean {
  return error instanceof FindogAgentApiError && (error.status === 401 || error.status === 403);
}

export async function findogAgentRequest<T>(
  accessToken: string,
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(`${BASE_PATH}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: init.signal,
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const message = typeof payload?.error === "string" && payload.error
      ? payload.error
      : "Die Findog-Agent-Anfrage ist fehlgeschlagen.";
    throw new FindogAgentApiError(
      message,
      response.status,
      typeof payload?.code === "string" ? payload.code : null,
    );
  }
  if (!payload) {
    throw new FindogAgentApiError("Die Antwort des Findog-Agent ist unlesbar.", 502, null);
  }
  return payload as T;
}

export type FindogAgentConversationDto = {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FindogAgentMessageDto = {
  id: string;
  role: "user" | "assistant";
  content: string;
  runId: string | null;
  isPartial: boolean;
  createdAt: string;
};

export type FindogAgentSourceDto = {
  id: string;
  kind: "knowledge" | "wiki" | "web" | "mcp";
  provider: string;
  title: string;
  text: string;
  truncated: boolean;
  url: string | null;
  retrievedAt: string;
  provenance: Record<string, string>;
};

export type FindogAgentUsageDto = {
  modelCalls?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  reasoningTokens?: number | null;
  toolCalls?: number | null;
  knowledgeRetrievals?: number | null;
  webRetrievals?: number | null;
  mcpCalls?: number | null;
};

export type FindogAgentCostCoverage = "reported" | "estimated" | "unknown" | "uncovered" | "unused";

export type FindogAgentCostDto = {
  limitUsd?: number | null;
  limitStatus?: "not_configured" | "within" | "exceeded" | "unenforceable";
  modelReportedUsd?: number | null;
  modelEstimatedUsd?: number | null;
  webEstimatedUsd?: number | null;
  totalEstimatedUsd?: number | null;
  coverage?: Partial<Record<"model" | "web" | "knowledge" | "mcp", FindogAgentCostCoverage>>;
};

export type FindogAgentRunNoticeDto = { code: string; message: string; detail?: unknown };

export type FindogAgentRunResultDto = {
  answer: string | null;
  citations: { citedSourceIds?: string[] | null; unknownSourceIds?: string[] | null } | null;
  sources: FindogAgentSourceDto[] | null;
  plan: { steps?: string[] | null; notes?: string | null } | null;
  notices: FindogAgentRunNoticeDto[] | null;
  context: {
    truncated?: boolean;
    droppedHistoryMessages?: number | null;
    estimatedInputTokens?: number | null;
    contextTokens?: number | null;
  } | null;
  webResearchPerformed: boolean | null;
  trace: unknown[] | null;
};

export type FindogAgentRunDto = {
  id: string;
  conversationId: string;
  state: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  cancelRequested: boolean;
  attemptCount: number;
  settingsRevision: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  result: FindogAgentRunResultDto | null;
  error: { code: string | null; message: string } | null;
  usage: FindogAgentUsageDto | null;
  cost: FindogAgentCostDto | null;
};

export type FindogAgentRunEventDto = {
  sequence: number;
  kind: "status" | "plan" | "step" | "tool_call" | "tool_result" | "source" | "usage" | "output" | "error" | "heartbeat";
  payload: Record<string, unknown>;
  createdAt: string;
};

export type FindogAgentConversationListDto = {
  conversations: FindogAgentConversationDto[];
  limit: number;
  hasMore: boolean;
};

export type FindogAgentConversationViewDto = {
  conversation: FindogAgentConversationDto;
  messages: FindogAgentMessageDto[];
  messagesTruncated: boolean;
  limit: number;
  activeRun: FindogAgentRunDto | null;
};

export type FindogAgentEventPageDto = {
  events: FindogAgentRunEventDto[];
  afterSequence: number;
  limit: number;
  hasMore: boolean;
};

export type FindogAgentConnectionTestResultDto = {
  ok: boolean;
  kind: "model" | "weknora" | "exa" | "mcp";
  id: string | null;
  summary: string;
  latencyMs: number;
  code: string | null;
  detail: Record<string, unknown> | null;
};

export type FindogAgentSettingsResponseDto = {
  revision: number | null;
  updatedAt: string | null;
  settings: FindogAgentRedactedSettings;
};

/** The writable settings shape the server validates; redaction flags are stripped. */
export function toFindogAgentSettingsPayload(
  settings: FindogAgentRedactedSettings,
): FindogAgentSettings {
  return {
    schemaVersion: settings.schemaVersion,
    agentName: settings.agentName,
    systemPrompt: settings.systemPrompt,
    enabled: settings.enabled,
    activeModelId: settings.activeModelId,
    connections: settings.connections.map(({ id, name, provider, baseUrl }) => ({ id, name, provider, baseUrl })),
    models: settings.models.map((model) => ({ ...model, capabilities: [...model.capabilities] })),
    knowledge: {
      enabled: settings.knowledge.enabled,
      baseUrl: settings.knowledge.baseUrl,
      knowledgeBaseIds: [...settings.knowledge.knowledgeBaseIds],
    },
    web: {
      mode: settings.web.mode,
      allowedDomains: [...settings.web.allowedDomains],
      maxResults: settings.web.maxResults,
      maxTextCharacters: settings.web.maxTextCharacters,
    },
    mcp: {
      servers: settings.mcp.servers.map(({ id, name, url, allowedTools }) => ({ id, name, url, allowedTools: [...allowedTools] })),
    },
    limits: { ...settings.limits },
  };
}

/**
 * Secret names are derived from the *current* catalog, so a removed connection
 * or server can never contribute a stale secret key. Omitted names keep the
 * stored ciphertext, `null` removes it and a non-empty value replaces it; an
 * empty input is never sent, because the server rejects blank secrets.
 */
export function findogAgentSecretNames(settings: FindogAgentSettings): string[] {
  return [
    ...settings.connections.map((connection) => findogAgentConnectionSecretName(connection.id)),
    FINDOG_AGENT_KNOWLEDGE_SECRET_NAME,
    FINDOG_AGENT_EXA_SECRET_NAME,
    ...settings.mcp.servers.map((server) => findogAgentMcpSecretName(server.id)),
  ];
}

export function buildFindogAgentSecretPatch(
  settings: FindogAgentSettings,
  edits: Record<string, string>,
  removals: readonly string[],
): Record<string, string | null> {
  const removed = new Set(removals);
  const patch: Record<string, string | null> = {};
  for (const name of findogAgentSecretNames(settings)) {
    if (removed.has(name)) {
      patch[name] = null;
      continue;
    }
    const value = edits[name]?.trim();
    if (value) {
      patch[name] = value;
    }
  }
  return patch;
}

/** Client-side id for new catalog entries; the server validates the pattern. */
export function findogAgentCatalogId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `${prefix}-${random.replace(/[^a-z0-9]/gi, "").slice(0, 12).toLowerCase()}`;
}
