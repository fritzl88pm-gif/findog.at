/**
 * Test-only store adapter.
 *
 * It implements the `FindogAgentStore` surface on top of an embedded PGlite
 * database by calling the *real* SQL lifecycle functions. This lets the worker
 * integration tests exercise queue -> claim -> heartbeat -> event append ->
 * finish against real PostgreSQL semantics without any Supabase or production
 * dependency. It is never imported by production code.
 */

import type { PGlite } from "@electric-sql/pglite";

import { createDefaultFindogAgentSettings, normalizeFindogAgentSettings } from "./settings";
import { FindogAgentStoreError } from "./store";
import type {
  FindogAgentConversation,
  FindogAgentEventKind,
  FindogAgentMessage,
  FindogAgentRun,
  FindogAgentRunEvent,
  FindogAgentSettingsSnapshot,
  FindogAgentRunState,
} from "./types";

const MESSAGE_COLUMNS =
  "id, conversation_id, owner_id, run_id, role, content, is_partial, created_at, updated_at";

function asRecord(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}

function iso(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return new Date(0).toISOString();
}

function isoOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : iso(value);
}

function mapError(error: unknown): FindogAgentStoreError {
  const code = typeof (error as { code?: unknown })?.code === "string"
    ? (error as { code: string }).code
    : "";
  switch (code) {
    case "40001":
      return new FindogAgentStoreError("conflict");
    case "55000":
      return new FindogAgentStoreError("stale_lease");
    case "42501":
      return new FindogAgentStoreError("forbidden");
    case "23505":
      return new FindogAgentStoreError("conflict");
    case "22023":
    case "22P02":
    case "23502":
    case "23514":
      return new FindogAgentStoreError("invalid");
    case "PGRST116":
      return new FindogAgentStoreError("not_found");
    default:
      return new FindogAgentStoreError("unavailable");
  }
}

function toRun(row: Record<string, unknown>): FindogAgentRun {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    ownerId: String(row.owner_id),
    idempotencyKey: String(row.idempotency_key),
    state: row.state as FindogAgentRunState,
    settingsRevision: Number(row.settings_revision),
    userMessageId: (row.user_message_id as string | null) ?? null,
    assistantMessageId: (row.assistant_message_id as string | null) ?? null,
    leaseToken: (row.lease_token as string | null) ?? null,
    leaseExpiresAt: isoOrNull(row.lease_expires_at),
    attemptCount: Number(row.attempt_count),
    cancelRequested: Boolean(row.cancel_requested),
    result: (row.result as Record<string, unknown> | null) ?? null,
    error: (row.error as Record<string, unknown> | null) ?? null,
    usage: (row.usage as Record<string, unknown> | null) ?? null,
    cost: (row.cost as Record<string, unknown> | null) ?? null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    startedAt: isoOrNull(row.started_at),
    finishedAt: isoOrNull(row.finished_at),
  };
}

function toMessage(row: Record<string, unknown>): FindogAgentMessage {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    ownerId: String(row.owner_id),
    runId: (row.run_id as string | null) ?? null,
    role: row.role as "user" | "assistant",
    content: String(row.content),
    isPartial: Boolean(row.is_partial),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function toConversation(row: Record<string, unknown>): FindogAgentConversation {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    title: (row.title as string | null) ?? null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function toEvent(row: Record<string, unknown>): FindogAgentRunEvent {
  return {
    id: Number(row.id),
    runId: String(row.run_id),
    ownerId: String(row.owner_id),
    sequence: Number(row.sequence),
    kind: row.kind as FindogAgentEventKind,
    payload: asRecord(row.payload),
    createdAt: iso(row.created_at),
  };
}

export function createPgliteFindogAgentStore(db: PGlite) {
  async function selectRuns(sql: string, params: unknown[]): Promise<FindogAgentRun[]> {
    const result = await db.query<Record<string, unknown>>(sql, params);
    return result.rows.map(toRun);
  }

  function jsonOrNull(value: Record<string, unknown> | null | undefined): string | null {
    return value === null || value === undefined ? null : JSON.stringify(value);
  }

  async function getSettingsSnapshotByRevision(input: {
    revision: number;
  }): Promise<FindogAgentSettingsSnapshot> {
    const result = await db.query<{
      revision: string;
      created_at: unknown;
      settings: unknown;
      encrypted_credentials: Record<string, string> | null;
    }>(
      "select revision, created_at, settings, encrypted_credentials"
      + " from public.findog_agent_settings_versions where revision = $1",
      [input.revision],
    );
    if (result.rows.length === 0) {
      throw new FindogAgentStoreError("not_found");
    }
    const row = result.rows[0];
    return {
      revision: Number(row.revision),
      updatedAt: iso(row.created_at),
      settings: normalizeFindogAgentSettings(row.settings),
      encryptedCredentials: row.encrypted_credentials ?? {},
    };
  }

  return {
    async getSettings(): Promise<FindogAgentSettingsSnapshot> {
      const current = await db.query<{ revision: string; updated_at: unknown }>(
        "select revision, updated_at from public.findog_agent_settings_current where id = 1",
      );
      if (current.rows.length === 0) {
        return {
          revision: null,
          updatedAt: null,
          settings: createDefaultFindogAgentSettings(),
          encryptedCredentials: {},
        };
      }
      return getSettingsSnapshotByRevision({ revision: Number(current.rows[0].revision) });
    },

    getSettingsSnapshotByRevision,

    async updateSettings(input: {
      expectedRevision: number | null;
      createdBy: string;
      settings: Record<string, unknown>;
      encryptedCredentials: Record<string, string>;
    }): Promise<{ revision: number; createdAt: string }> {
      try {
        const result = await db.query<{ revision: string; created_at: unknown }>(
          "select revision, created_at from public.set_findog_agent_settings($1, $2, $3::jsonb, $4::jsonb)",
          [
            input.expectedRevision,
            input.createdBy,
            JSON.stringify(input.settings),
            JSON.stringify(input.encryptedCredentials),
          ],
        );
        return { revision: Number(result.rows[0].revision), createdAt: iso(result.rows[0].created_at) };
      } catch (error) {
        throw mapError(error);
      }
    },

    async enqueueRun(input: {
      ownerId: string;
      conversationId: string;
      idempotencyKey: string;
      settingsRevision: number;
      question: string;
      conversationTitle?: string | null;
    }): Promise<FindogAgentRun> {
      const runs = await selectRuns(
        "select * from public.enqueue_findog_agent_run($1, $2, $3, $4, $5, $6)",
        [
          input.ownerId,
          input.conversationId,
          input.idempotencyKey,
          input.settingsRevision,
          input.question,
          input.conversationTitle ?? null,
        ],
      );
      if (runs.length === 0) {
        throw new FindogAgentStoreError("unavailable");
      }
      return runs[0];
    },

    async listConversations(input: {
      ownerId: string;
      limit?: number;
    }): Promise<FindogAgentConversation[]> {
      const result = await db.query<Record<string, unknown>>(
        "select id, owner_id, title, created_at, updated_at from public.findog_agent_conversations"
        + " where owner_id = $1 order by created_at asc limit $2",
        [input.ownerId, input.limit ?? 50],
      );
      return result.rows.map(toConversation);
    },

    async getConversation(input: {
      ownerId: string;
      conversationId: string;
    }): Promise<FindogAgentConversation> {
      const result = await db.query<Record<string, unknown>>(
        "select id, owner_id, title, created_at, updated_at from public.findog_agent_conversations"
        + " where id = $1 and owner_id = $2",
        [input.conversationId, input.ownerId],
      );
      if (result.rows.length === 0) {
        throw new FindogAgentStoreError("not_found");
      }
      return toConversation(result.rows[0]);
    },

    async listMessages(input: {
      ownerId: string;
      conversationId: string;
      limit?: number;
      before?: { createdAt: string; messageId: string };
    }): Promise<{ messages: FindogAgentMessage[]; hasMore: boolean }> {
      const limit = Math.max(1, Math.trunc(input.limit ?? 50));
      const cursor = input.before
        ? "and (created_at, id) < ($3::timestamptz, $4::uuid)"
        : "";
      const params: unknown[] = [input.conversationId, input.ownerId];
      if (input.before) {
        params.push(input.before.createdAt, input.before.messageId);
      }
      params.push(limit + 1);

      const result = await db.query<Record<string, unknown>>(
        `select ${MESSAGE_COLUMNS} from (
           select ${MESSAGE_COLUMNS} from public.findog_agent_messages
           where conversation_id = $1 and owner_id = $2 and is_partial = false ${cursor}
           order by created_at desc, id desc
           limit $${params.length}
         ) as windowed
         order by created_at asc, id asc`,
        params,
      );
      const rows = result.rows;
      return {
        messages: rows.slice(0, limit).map(toMessage),
        hasMore: rows.length > limit,
      };
    },

    async getMessage(input: {
      ownerId: string;
      messageId: string;
    }): Promise<FindogAgentMessage> {
      const result = await db.query<Record<string, unknown>>(
        `select ${MESSAGE_COLUMNS} from public.findog_agent_messages`
        + " where id = $1 and owner_id = $2",
        [input.messageId, input.ownerId],
      );
      if (result.rows.length === 0) {
        throw new FindogAgentStoreError("not_found");
      }
      return toMessage(result.rows[0]);
    },

    async getRun(input: { ownerId: string; runId: string }): Promise<FindogAgentRun> {
      const runs = await selectRuns(
        "select * from public.findog_agent_runs where id = $1 and owner_id = $2",
        [input.runId, input.ownerId],
      );
      if (runs.length === 0) {
        throw new FindogAgentStoreError("not_found");
      }
      return runs[0];
    },

    async getActiveRun(input: {
      ownerId: string;
      conversationId: string;
    }): Promise<FindogAgentRun | null> {
      const runs = await selectRuns(
        "select * from public.findog_agent_runs where conversation_id = $1 and owner_id = $2"
        + " and state in ('queued', 'running') limit 1",
        [input.conversationId, input.ownerId],
      );
      return runs[0] ?? null;
    },

    async claimRuns(input: {
      leaseToken: string;
      leaseSeconds?: number;
      limit?: number;
    }): Promise<FindogAgentRun[]> {
      return selectRuns(
        "select * from public.claim_findog_agent_runs($1, $2, $3)",
        [input.leaseToken, input.leaseSeconds ?? 90, input.limit ?? 1],
      );
    },

    async heartbeatRun(input: {
      runId: string;
      ownerId: string;
      leaseToken: string;
      leaseSeconds?: number;
    }): Promise<FindogAgentRun> {
      try {
        const runs = await selectRuns(
          "select * from public.heartbeat_findog_agent_run($1, $2, $3, $4)",
          [input.runId, input.ownerId, input.leaseToken, input.leaseSeconds ?? 90],
        );
        if (runs.length === 0) {
          throw new FindogAgentStoreError("stale_lease");
        }
        return runs[0];
      } catch (error) {
        if (error instanceof FindogAgentStoreError) {
          throw error;
        }
        throw mapError(error);
      }
    },

    async appendRunEvent(input: {
      runId: string;
      ownerId: string;
      leaseToken: string;
      kind: FindogAgentEventKind;
      payload?: Record<string, unknown>;
    }): Promise<FindogAgentRunEvent> {
      try {
        const result = await db.query<Record<string, unknown>>(
          "select * from public.append_findog_agent_run_event($1, $2, $3, $4, $5::jsonb)",
          [input.runId, input.ownerId, input.leaseToken, input.kind, JSON.stringify(input.payload ?? {})],
        );
        if (result.rows.length === 0) {
          throw new FindogAgentStoreError("stale_lease");
        }
        return toEvent(result.rows[0]);
      } catch (error) {
        if (error instanceof FindogAgentStoreError) {
          throw error;
        }
        throw mapError(error);
      }
    },

    async listRunEvents(input: {
      runId: string;
      ownerId: string;
      afterSequence?: number;
    }): Promise<FindogAgentRunEvent[]> {
      const result = await db.query<Record<string, unknown>>(
        "select * from public.list_findog_agent_run_events($1, $2, $3)",
        [input.runId, input.ownerId, input.afterSequence ?? 0],
      );
      return result.rows.map(toEvent);
    },

    async finishRun(input: {
      runId: string;
      ownerId: string;
      leaseToken: string;
      status: "succeeded" | "failed";
      result?: Record<string, unknown> | null;
      error?: Record<string, unknown> | null;
      usage?: Record<string, unknown> | null;
      cost?: Record<string, unknown> | null;
      assistantContent?: string | null;
    }): Promise<FindogAgentRun> {
      try {
        const runs = await selectRuns(
          "select * from public.finish_findog_agent_run($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9)",
          [
            input.runId,
            input.ownerId,
            input.leaseToken,
            input.status,
            jsonOrNull(input.result),
            jsonOrNull(input.error),
            jsonOrNull(input.usage),
            jsonOrNull(input.cost),
            input.assistantContent ?? null,
          ],
        );
        if (runs.length === 0) {
          throw new FindogAgentStoreError("stale_lease");
        }
        return runs[0];
      } catch (error) {
        if (error instanceof FindogAgentStoreError) {
          throw error;
        }
        throw mapError(error);
      }
    },

    async cancelRun(input: { runId: string; ownerId: string }): Promise<FindogAgentRun> {
      try {
        const runs = await selectRuns(
          "select * from public.cancel_findog_agent_run($1, $2)",
          [input.runId, input.ownerId],
        );
        if (runs.length === 0) {
          throw new FindogAgentStoreError("not_found");
        }
        return runs[0];
      } catch (error) {
        if (error instanceof FindogAgentStoreError) {
          throw error;
        }
        throw mapError(error);
      }
    },

    async reapRuns(limit = 200): Promise<number> {
      const result = await db.query<{ reap_findog_agent_runs: number }>(
        "select public.reap_findog_agent_runs($1) as reap_findog_agent_runs",
        [limit],
      );
      return Number(result.rows[0]?.reap_findog_agent_runs ?? 0);
    },
  };
}
