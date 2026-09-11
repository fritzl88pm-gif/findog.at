/**
 * HTTP boundary for the Findog Agent admin API.
 *
 * Every route funnels through this module so that:
 * - authentication is always the current administrator check;
 * - responses are explicit allowlisted DTOs (never a raw row, never a lease
 *   token, never ciphertext) and always `no-store`;
 * - request bodies/params are validated before any work happens.
 *
 * These helpers live here and not in a `route.ts` file, because Next.js route
 * modules may only export HTTP handlers.
 */

import { NextResponse } from "next/server";

import { UserVisibleError } from "@/lib/errors";
import { createFindogAgentStore, FindogAgentStoreError } from "@/lib/findog-agent/store";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  FINDOG_AGENT_EXA_SECRET_NAME,
  FINDOG_AGENT_KNOWLEDGE_SECRET_NAME,
  findogAgentConnectionSecretName,
} from "@/lib/findog-agent/types";
import type {
  FindogAgentConversation,
  FindogAgentMessage,
  FindogAgentRun,
  FindogAgentRunEvent,
  FindogAgentSettingsSnapshot,
} from "@/lib/findog-agent/types";

export const FINDOG_AGENT_API_LIMITS = {
  conversationListDefault: 20,
  conversationListMax: 100,
  messageListDefault: 50,
  messageListMax: 200,
  eventListDefault: 100,
  eventListMax: 500,
} as const;

export const FINDOG_AGENT_CONNECTION_TEST_KINDS = ["model", "weknora", "exa", "mcp"] as const;
export type FindogAgentConnectionTestKind = (typeof FINDOG_AGENT_CONNECTION_TEST_KINDS)[number];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function findogAgentJson(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function findogAgentErrorResponse(error: unknown): NextResponse {
  if (error instanceof UserVisibleError) {
    return findogAgentJson({ error: error.message }, error.status);
  }
  if (error instanceof FindogAgentStoreError) {
    return findogAgentJson({ error: error.message, code: error.code }, error.status);
  }
  return findogAgentJson({ error: "Die Findog-Agent-Anfrage konnte nicht verarbeitet werden." }, 500);
}

export function requireFindogAgentStore(): {
  store: ReturnType<typeof createFindogAgentStore>;
  client: NonNullable<ReturnType<typeof getSupabaseServerClient>>;
} {
  const client = getSupabaseServerClient();
  if (!client) {
    throw new UserVisibleError("Der Findog-Agent ist derzeit nicht verfügbar.", 503);
  }
  return { store: createFindogAgentStore(client), client };
}

export function parseFindogAgentUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    throw new UserVisibleError(`${field} ist keine gültige UUID.`, 400);
  }
  return value.trim().toLowerCase();
}

function parseIntegerParam(
  value: string | null,
  field: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === null || value === "") {
    return fallback;
  }
  if (!/^\d+$/.test(value)) {
    throw new UserVisibleError(`${field} ist ungültig.`, 400);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new UserVisibleError(`${field} liegt außerhalb des erlaubten Bereichs.`, 400);
  }
  return parsed;
}

export function parseFindogAgentLimitParam(
  value: string | null,
  fallback: number,
  max: number,
): number {
  return parseIntegerParam(value, "limit", fallback, 1, max);
}

export function parseFindogAgentAfterSequenceParam(value: string | null): number {
  return parseIntegerParam(value, "afterSequence", 0, 0, Number.MAX_SAFE_INTEGER);
}

export function toFindogAgentConversationDto(conversation: FindogAgentConversation) {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

export function toFindogAgentMessageDto(message: FindogAgentMessage) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    runId: message.runId,
    isPartial: message.isPartial,
    createdAt: message.createdAt,
  };
}

export function toFindogAgentEventDto(event: FindogAgentRunEvent) {
  return {
    sequence: event.sequence,
    kind: event.kind,
    payload: event.payload,
    createdAt: event.createdAt,
  };
}

/** Allowlisted run result projection; the raw jsonb column never leaves the server. */
function toRunResultDto(result: Record<string, unknown> | null) {
  if (!result) {
    return null;
  }
  const pick = <T>(key: string): T | null => (key in result ? result[key] as T : null);
  return {
    answer: pick<string>("answer"),
    citations: pick<Record<string, unknown>>("citations"),
    sources: pick<unknown[]>("sources"),
    plan: pick<Record<string, unknown>>("plan"),
    notices: pick<unknown[]>("notices"),
    context: pick<Record<string, unknown>>("context"),
    webResearchPerformed: pick<boolean>("webResearchPerformed"),
    trace: pick<unknown[]>("trace"),
  };
}

function toRunErrorDto(error: Record<string, unknown> | null) {
  if (!error) {
    return null;
  }
  return {
    code: typeof error.code === "string" ? error.code : null,
    message: typeof error.message === "string" ? error.message : "Der Lauf ist fehlgeschlagen.",
  };
}

/** Redacted run DTO: no owner id, no idempotency key, no lease token. */
export function toFindogAgentRunDto(run: FindogAgentRun) {
  return {
    id: run.id,
    conversationId: run.conversationId,
    state: run.state,
    cancelRequested: run.cancelRequested,
    attemptCount: run.attemptCount,
    settingsRevision: run.settingsRevision,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    result: toRunResultDto(run.result),
    error: toRunErrorDto(run.error),
    usage: run.usage ?? null,
    cost: run.cost ?? null,
  };
}

export type FindogAgentEnqueueInput = {
  conversationId: string;
  question: string;
  idempotencyKey: string;
  conversationTitle: string | null;
};

export function parseFindogAgentEnqueueBody(body: unknown): FindogAgentEnqueueInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new UserVisibleError("Die Anfrage enthält keinen gültigen Lauf.", 400);
  }
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!["conversationId", "question", "idempotencyKey", "conversationTitle"].includes(key)) {
      throw new UserVisibleError(`Unbekanntes Feld "${key}" in der Anfrage.`, 400);
    }
  }

  const conversationId = parseFindogAgentUuid(record.conversationId, "conversationId");

  if (typeof record.question !== "string" || !record.question.trim()) {
    throw new UserVisibleError("Die Frage darf nicht leer sein.", 400);
  }
  const question = record.question.trim();
  if (question.length > 20000) {
    throw new UserVisibleError("Die Frage ist zu lang.", 400);
  }

  if (
    typeof record.idempotencyKey !== "string"
    || record.idempotencyKey.trim().length === 0
    || record.idempotencyKey.trim().length > 200
  ) {
    throw new UserVisibleError("Der Idempotenz-Schlüssel ist ungültig.", 400);
  }

  let conversationTitle: string | null = null;
  if (record.conversationTitle !== undefined && record.conversationTitle !== null) {
    if (typeof record.conversationTitle !== "string") {
      throw new UserVisibleError("Der Gesprächstitel ist ungültig.", 400);
    }
    const trimmed = record.conversationTitle.trim();
    if (trimmed.length > 300) {
      throw new UserVisibleError("Der Gesprächstitel ist zu lang.", 400);
    }
    conversationTitle = trimmed || null;
  }

  return { conversationId, question, idempotencyKey: record.idempotencyKey.trim(), conversationTitle };
}

export type FindogAgentConnectionTestInput = {
  revision: number;
  kind: FindogAgentConnectionTestKind;
  id: string | null;
};

export function parseFindogAgentConnectionTestBody(body: unknown): FindogAgentConnectionTestInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new UserVisibleError("Die Anfrage enthält keinen gültigen Verbindungstest.", 400);
  }
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!["revision", "kind", "id"].includes(key)) {
      throw new UserVisibleError(`Unbekanntes Feld "${key}" in der Anfrage.`, 400);
    }
  }

  if (
    typeof record.revision !== "number"
    || !Number.isInteger(record.revision)
    || record.revision < 1
  ) {
    throw new UserVisibleError("Die Konfigurationsrevision ist ungültig.", 400);
  }

  if (typeof record.kind !== "string" || !FINDOG_AGENT_CONNECTION_TEST_KINDS.includes(
    record.kind as FindogAgentConnectionTestKind,
  )) {
    throw new UserVisibleError("Die Testart ist unbekannt.", 400);
  }
  const kind = record.kind as FindogAgentConnectionTestKind;

  const requiresId = kind === "model" || kind === "mcp";
  let id: string | null = null;
  if (record.id !== undefined && record.id !== null) {
    if (typeof record.id !== "string" || !record.id.trim() || record.id.trim().length > 200) {
      throw new UserVisibleError("Die Kennung für den Verbindungstest ist ungültig.", 400);
    }
    id = record.id.trim();
  }
  if (requiresId && !id) {
    throw new UserVisibleError("Für diesen Verbindungstest ist eine Kennung erforderlich.", 400);
  }

  return { revision: record.revision, kind, id };
}

export type FindogAgentEnqueueBlock = { code: string; message: string; status: number };

/**
 * A run may only be enqueued against a revision that can actually execute:
 * enabled agent, active model with a connection and credential, and every
 * credential required by the configured knowledge/web mode.
 */
export function findogAgentEnqueueBlockReason(
  snapshot: FindogAgentSettingsSnapshot,
): FindogAgentEnqueueBlock | null {
  if (snapshot.revision === null) {
    return {
      code: "agent_not_configured",
      message: "Der Findog-Agent wurde noch nicht konfiguriert.",
      status: 409,
    };
  }
  const { settings } = snapshot;
  const stored = snapshot.encryptedCredentials;
  const configured = (name: string) => typeof stored[name] === "string" && stored[name].length > 0;

  if (!settings.enabled) {
    return { code: "agent_disabled", message: "Der Findog-Agent ist nicht aktiviert.", status: 409 };
  }

  const model = settings.models.find((entry) => entry.id === settings.activeModelId) ?? null;
  const connection = model
    ? settings.connections.find((entry) => entry.id === model.connectionId) ?? null
    : null;
  if (!model || !connection) {
    return {
      code: "model_not_configured",
      message: "Es ist kein ausführbares Modell konfiguriert.",
      status: 409,
    };
  }
  if (!configured(findogAgentConnectionSecretName(connection.id))) {
    return {
      code: "credentials_missing",
      message: "Für das aktive Modell ist kein Zugangsschlüssel hinterlegt.",
      status: 409,
    };
  }

  if (settings.knowledge.enabled) {
    if (!settings.knowledge.baseUrl || settings.knowledge.knowledgeBaseIds.length === 0) {
      return {
        code: "knowledge_not_configured",
        message: "Die Wissensdatenbank ist aktiviert, aber nicht vollständig konfiguriert.",
        status: 409,
      };
    }
    if (!configured(FINDOG_AGENT_KNOWLEDGE_SECRET_NAME)) {
      return {
        code: "credentials_missing",
        message: "Für die Wissensdatenbank ist kein Zugangsschlüssel hinterlegt.",
        status: 409,
      };
    }
  }

  if (settings.web.mode !== "off" && !configured(FINDOG_AGENT_EXA_SECRET_NAME)) {
    return {
      code: "credentials_missing",
      message: "Für die Websuche ist kein Exa-Zugangsschlüssel hinterlegt.",
      status: 409,
    };
  }

  // MCP bearer auth is optional: a server may legitimately be unauthenticated,
  // so a missing bearer is not an enqueue prerequisite.

  return null;
}
