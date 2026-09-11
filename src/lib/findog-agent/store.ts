import type { SupabaseClient } from "@supabase/supabase-js";

import { UserVisibleError } from "../errors";
import { createDefaultFindogAgentSettings, normalizeFindogAgentSettings } from "./settings";
import type {
  FindogAgentConversation,
  FindogAgentEventKind,
  FindogAgentMessage,
  FindogAgentRun,
  FindogAgentRunEvent,
  FindogAgentSettings,
  FindogAgentSettingsSnapshot,
  FindogAgentRunState,
} from "./types";

type FindogAgentStoreClient = Pick<SupabaseClient, "from" | "rpc">;

export type FindogAgentStoreErrorCode =
  | "conflict"
  | "not_found"
  | "forbidden"
  | "invalid"
  | "stale_lease"
  | "unavailable";

const STORE_ERROR_STATUS: Record<FindogAgentStoreErrorCode, number> = {
  conflict: 409,
  not_found: 404,
  forbidden: 403,
  invalid: 400,
  stale_lease: 409,
  unavailable: 503,
};

const STORE_ERROR_MESSAGE: Record<FindogAgentStoreErrorCode, string> = {
  conflict: "Die Konfiguration wurde zwischenzeitlich geändert. Bitte neu laden.",
  not_found: "Der Findog-Agent-Datensatz wurde nicht gefunden.",
  forbidden: "Diese Aktion ist für dieses Konto nicht erlaubt.",
  invalid: "Die Anfrage an den Findog-Agent-Speicher war ungültig.",
  stale_lease: "Der Findog-Agent-Lauf ist nicht mehr aktiv oder die Lease ist abgelaufen.",
  unavailable: "Der Findog-Agent-Speicher ist derzeit nicht erreichbar.",
};

/** Typed store failure. Carries a stable code plus the HTTP status to surface. */
export class FindogAgentStoreError extends Error {
  readonly code: FindogAgentStoreErrorCode;
  readonly status: number;

  constructor(code: FindogAgentStoreErrorCode, message?: string) {
    super(message ?? STORE_ERROR_MESSAGE[code]);
    this.name = "FindogAgentStoreError";
    this.code = code;
    this.status = STORE_ERROR_STATUS[code];
  }
}

type PostgresError = { code?: string; message?: string };

function mapPostgresError(error: unknown): FindogAgentStoreError {
  const code = typeof (error as PostgresError)?.code === "string"
    ? (error as PostgresError).code as string
    : "";

  switch (code) {
    case "40001":
      return new FindogAgentStoreError("conflict");
    case "55000":
      return new FindogAgentStoreError("stale_lease");
    case "42501":
      return new FindogAgentStoreError("forbidden");
    case "22023":
    case "22P02":
    case "23502":
    case "23514":
      return new FindogAgentStoreError("invalid");
    case "23505":
      return new FindogAgentStoreError("conflict", "Für dieses Gespräch läuft bereits eine Recherche.");
    case "PGRST116":
      return new FindogAgentStoreError("not_found");
    default:
      return new FindogAgentStoreError("unavailable");
  }
}

type RunRow = {
  id: string;
  conversation_id: string;
  owner_id: string;
  idempotency_key: string;
  state: FindogAgentRunState;
  settings_revision: number | string;
  user_message_id: string | null;
  assistant_message_id: string | null;
  lease_token: string | null;
  lease_expires_at: string | null;
  attempt_count: number;
  cancel_requested: boolean;
  result: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  usage: Record<string, unknown> | null;
  cost: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
};

type EventRow = {
  id: number | string;
  run_id: string;
  owner_id: string;
  sequence: number | string;
  kind: FindogAgentEventKind;
  payload: Record<string, unknown>;
  created_at: string;
};

type ConversationRow = {
  id: string;
  owner_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  owner_id: string;
  run_id: string | null;
  role: "user" | "assistant";
  content: string;
  is_partial: boolean;
  created_at: string;
  updated_at: string;
};

const MESSAGE_COLUMNS =
  "id, conversation_id, owner_id, run_id, role, content, is_partial, created_at, updated_at";

function toRun(row: RunRow): FindogAgentRun {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    ownerId: row.owner_id,
    idempotencyKey: row.idempotency_key,
    state: row.state,
    settingsRevision: Number(row.settings_revision),
    userMessageId: row.user_message_id,
    assistantMessageId: row.assistant_message_id,
    leaseToken: row.lease_token,
    leaseExpiresAt: row.lease_expires_at,
    attemptCount: row.attempt_count,
    cancelRequested: row.cancel_requested,
    result: row.result,
    error: row.error,
    usage: row.usage,
    cost: row.cost,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function toRunEvent(row: EventRow): FindogAgentRunEvent {
  return {
    id: Number(row.id),
    runId: row.run_id,
    ownerId: row.owner_id,
    sequence: Number(row.sequence),
    kind: row.kind,
    payload: row.payload,
    createdAt: row.created_at,
  };
}

function toConversation(row: ConversationRow): FindogAgentConversation {
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMessage(row: MessageRow): FindogAgentMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    ownerId: row.owner_id,
    runId: row.run_id,
    role: row.role,
    content: row.content,
    isPartial: row.is_partial,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowsOf<T>(data: unknown): T[] {
  if (Array.isArray(data)) {
    return data as T[];
  }
  if (data && typeof data === "object") {
    return [data as T];
  }
  return [];
}

/**
 * Normalizes a stored settings document. A validation failure is projected onto
 * a store-level `unavailable` error, because a corrupt or unreadable revision is
 * not a client mistake. Shared by the current and the captured-revision loaders.
 */
function normalizeStoredSettings(raw: unknown): FindogAgentSettings {
  try {
    return normalizeFindogAgentSettings(raw);
  } catch (error) {
    if (error instanceof UserVisibleError) {
      throw new FindogAgentStoreError("unavailable");
    }
    throw error;
  }
}

export type EnqueueRunInput = {
  ownerId: string;
  conversationId: string;
  idempotencyKey: string;
  settingsRevision: number;
  question: string;
  conversationTitle?: string | null;
};

export type FindogAgentStore = ReturnType<typeof createFindogAgentStore>;

/**
 * Typed wrapper around the Findog Agent SQL lifecycle functions.
 *
 * The store never trusts the caller for ownership: every function call passes the
 * authenticated owner id and the SQL layer re-validates it together with the lease
 * token, run state and administrator membership.
 */
export function createFindogAgentStore(client: FindogAgentStoreClient) {
  return {
    async getSettings(): Promise<FindogAgentSettingsSnapshot> {
      const current = await client
        .from("findog_agent_settings_current")
        .select("revision, updated_at, active_model_id")
        .eq("id", 1)
        .maybeSingle();
      if (current.error) {
        throw mapPostgresError(current.error);
      }
      if (!current.data) {
        return {
          revision: null,
          updatedAt: null,
          settings: createDefaultFindogAgentSettings(),
          encryptedCredentials: {},
        };
      }

      const revision = Number((current.data as { revision: number | string }).revision);
      const version = await client
        .from("findog_agent_settings_versions")
        .select("settings, encrypted_credentials")
        .eq("revision", revision)
        .maybeSingle();
      if (version.error) {
        throw mapPostgresError(version.error);
      }
      if (!version.data) {
        throw new FindogAgentStoreError("unavailable");
      }

      const row = version.data as {
        settings: unknown;
        encrypted_credentials: Record<string, string> | null;
      };

      return {
        revision,
        updatedAt: (current.data as { updated_at: string | null }).updated_at,
        settings: normalizeStoredSettings(row.settings),
        encryptedCredentials: row.encrypted_credentials ?? {},
      };
    },

    /**
     * Loads the immutable settings revision that a run captured at enqueue time.
     *
     * The durable worker must never fall back to the *current* configuration:
     * a run is always executed against the revision it was created with.
     */
    async getSettingsSnapshotByRevision(input: {
      revision: number;
    }): Promise<FindogAgentSettingsSnapshot> {
      const version = await client
        .from("findog_agent_settings_versions")
        .select("revision, created_at, settings, encrypted_credentials")
        .eq("revision", input.revision)
        .maybeSingle();
      if (version.error) {
        throw mapPostgresError(version.error);
      }
      if (!version.data) {
        throw new FindogAgentStoreError("not_found");
      }

      const row = version.data as {
        revision: number | string;
        created_at: string;
        settings: unknown;
        encrypted_credentials: Record<string, string> | null;
      };

      return {
        revision: Number(row.revision),
        updatedAt: row.created_at,
        settings: normalizeStoredSettings(row.settings),
        encryptedCredentials: row.encrypted_credentials ?? {},
      };
    },

    async updateSettings(input: {
      expectedRevision: number | null;
      createdBy: string;
      settings: FindogAgentSettings;
      encryptedCredentials: Record<string, string>;
    }): Promise<{ revision: number; createdAt: string }> {
      const { data, error } = await client.rpc("set_findog_agent_settings", {
        p_expected_revision: input.expectedRevision,
        p_created_by: input.createdBy,
        p_settings: input.settings,
        p_encrypted_credentials: input.encryptedCredentials,
      });
      if (error) {
        throw mapPostgresError(error);
      }
      const [row] = rowsOf<{ revision: number | string; created_at: string }>(data);
      if (!row) {
        throw new FindogAgentStoreError("unavailable");
      }
      return { revision: Number(row.revision), createdAt: row.created_at };
    },

    async enqueueRun(input: EnqueueRunInput): Promise<FindogAgentRun> {
      const { data, error } = await client.rpc("enqueue_findog_agent_run", {
        p_owner_id: input.ownerId,
        p_conversation_id: input.conversationId,
        p_idempotency_key: input.idempotencyKey,
        p_settings_revision: input.settingsRevision,
        p_question: input.question,
        p_conversation_title: input.conversationTitle ?? null,
      });
      if (error) {
        throw mapPostgresError(error);
      }
      const [row] = rowsOf<RunRow>(data);
      if (!row) {
        throw new FindogAgentStoreError("unavailable");
      }
      return toRun(row);
    },

    /** Owner-scoped conversation list for the history sidebar. */
    async listConversations(input: {
      ownerId: string;
      limit?: number;
    }): Promise<FindogAgentConversation[]> {
      const { data, error } = await client
        .from("findog_agent_conversations")
        .select("id, owner_id, title, created_at, updated_at")
        .eq("owner_id", input.ownerId)
        .order("created_at", { ascending: false })
        .limit(input.limit ?? 50);
      if (error) {
        throw mapPostgresError(error);
      }
      return rowsOf<ConversationRow>(data).map(toConversation);
    },

    async getConversation(input: {
      ownerId: string;
      conversationId: string;
    }): Promise<FindogAgentConversation> {
      const { data, error } = await client
        .from("findog_agent_conversations")
        .select("id, owner_id, title, created_at, updated_at")
        .eq("id", input.conversationId)
        .eq("owner_id", input.ownerId)
        .maybeSingle();
      if (error) {
        throw mapPostgresError(error);
      }
      if (!data) {
        throw new FindogAgentStoreError("not_found");
      }
      return toConversation(data as ConversationRow);
    },

    /**
     * Owner-scoped, bounded message window. Partial answers are never returned.
     *
     * Messages are ordered deterministically by `(created_at, id)` — the id is the
     * tie-break, because two messages can share a timestamp. The window always
     * contains the *most recent* messages up to the optional cursor, so a caller
     * that passes the current user message as `before` can never silently lose the
     * latest prior turns; `hasMore` reports explicit truncation.
     */
    async listMessages(input: {
      ownerId: string;
      conversationId: string;
      limit?: number;
      /** Return only messages strictly older than this `(created_at, id)` cursor. */
      before?: { createdAt: string; messageId: string };
    }): Promise<{ messages: FindogAgentMessage[]; hasMore: boolean }> {
      const limit = Math.max(1, Math.trunc(input.limit ?? 50));
      const base = () => client
        .from("findog_agent_messages")
        .select(MESSAGE_COLUMNS)
        .eq("conversation_id", input.conversationId)
        .eq("owner_id", input.ownerId)
        .eq("is_partial", false);

      let rows: MessageRow[];
      if (input.before) {
        const older = await base()
          .lt("created_at", input.before.createdAt)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(limit + 1);
        if (older.error) {
          throw mapPostgresError(older.error);
        }
        const sameTimestamp = await base()
          .eq("created_at", input.before.createdAt)
          .lt("id", input.before.messageId)
          .order("id", { ascending: false })
          .limit(limit + 1);
        if (sameTimestamp.error) {
          throw mapPostgresError(sameTimestamp.error);
        }
        // The two windows are mutually exclusive (strictly older vs. equal
        // timestamp with a smaller id), so concatenating the descending rows
        // yields the combined order without a deduplicating map.
        rows = [
          ...rowsOf<MessageRow>(older.data),
          ...rowsOf<MessageRow>(sameTimestamp.data),
        ].sort((left, right) => {
          if (left.created_at !== right.created_at) {
            return left.created_at < right.created_at ? 1 : -1;
          }
          return left.id < right.id ? 1 : -1;
        });
      } else {
        const recent = await base()
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(limit + 1);
        if (recent.error) {
          throw mapPostgresError(recent.error);
        }
        rows = rowsOf<MessageRow>(recent.data);
      }

      const hasMore = rows.length > limit;
      return {
        messages: rows.slice(0, limit).reverse().map(toMessage),
        hasMore,
      };
    },

    /** Owner-scoped single message read (used to locate the exact run question). */
    async getMessage(input: {
      ownerId: string;
      messageId: string;
    }): Promise<FindogAgentMessage> {
      const { data, error } = await client
        .from("findog_agent_messages")
        .select(MESSAGE_COLUMNS)
        .eq("id", input.messageId)
        .eq("owner_id", input.ownerId)
        .maybeSingle();
      if (error) {
        throw mapPostgresError(error);
      }
      if (!data) {
        throw new FindogAgentStoreError("not_found");
      }
      return toMessage(data as MessageRow);
    },

    /** The single active (queued or running) run of an owned conversation, if any. */
    async getActiveRun(input: {
      ownerId: string;
      conversationId: string;
    }): Promise<FindogAgentRun | null> {
      const { data, error } = await client
        .from("findog_agent_runs")
        .select("*")
        .eq("conversation_id", input.conversationId)
        .eq("owner_id", input.ownerId)
        .in("state", ["queued", "running"])
        .maybeSingle();
      if (error) {
        throw mapPostgresError(error);
      }
      return data ? toRun(data as RunRow) : null;
    },

    async getRun(input: { ownerId: string; runId: string }): Promise<FindogAgentRun> {
      const { data, error } = await client
        .from("findog_agent_runs")
        .select("*")
        .eq("id", input.runId)
        .eq("owner_id", input.ownerId)
        .maybeSingle();
      if (error) {
        throw mapPostgresError(error);
      }
      if (!data) {
        throw new FindogAgentStoreError("not_found");
      }
      return toRun(data as RunRow);
    },

    async claimRuns(input: {
      leaseToken: string;
      leaseSeconds?: number;
      limit?: number;
    }): Promise<FindogAgentRun[]> {
      const { data, error } = await client.rpc("claim_findog_agent_runs", {
        p_lease_token: input.leaseToken,
        p_lease_seconds: input.leaseSeconds ?? 90,
        p_limit: input.limit ?? 1,
      });
      if (error) {
        throw mapPostgresError(error);
      }
      return rowsOf<RunRow>(data).map(toRun);
    },

    async heartbeatRun(input: {
      runId: string;
      ownerId: string;
      leaseToken: string;
      leaseSeconds?: number;
    }): Promise<FindogAgentRun> {
      const { data, error } = await client.rpc("heartbeat_findog_agent_run", {
        p_run_id: input.runId,
        p_owner_id: input.ownerId,
        p_lease_token: input.leaseToken,
        p_lease_seconds: input.leaseSeconds ?? 90,
      });
      if (error) {
        throw mapPostgresError(error);
      }
      const [row] = rowsOf<RunRow>(data);
      if (!row) {
        throw new FindogAgentStoreError("stale_lease");
      }
      return toRun(row);
    },

    async appendRunEvent(input: {
      runId: string;
      ownerId: string;
      leaseToken: string;
      kind: FindogAgentEventKind;
      payload?: Record<string, unknown>;
    }): Promise<FindogAgentRunEvent> {
      const { data, error } = await client.rpc("append_findog_agent_run_event", {
        p_run_id: input.runId,
        p_owner_id: input.ownerId,
        p_lease_token: input.leaseToken,
        p_kind: input.kind,
        p_payload: input.payload ?? {},
      });
      if (error) {
        throw mapPostgresError(error);
      }
      const [row] = rowsOf<EventRow>(data);
      if (!row) {
        throw new FindogAgentStoreError("stale_lease");
      }
      return toRunEvent(row);
    },

    async listRunEvents(input: {
      runId: string;
      ownerId: string;
      afterSequence?: number;
    }): Promise<FindogAgentRunEvent[]> {
      const { data, error } = await client.rpc("list_findog_agent_run_events", {
        p_run_id: input.runId,
        p_owner_id: input.ownerId,
        p_after_sequence: input.afterSequence ?? 0,
      });
      if (error) {
        throw mapPostgresError(error);
      }
      return rowsOf<EventRow>(data).map(toRunEvent);
    },

    async saveRunPartialAnswer(input: {
      runId: string;
      ownerId: string;
      leaseToken: string;
      content: string;
    }): Promise<string> {
      const { data, error } = await client.rpc("save_findog_agent_run_partial_answer", {
        p_run_id: input.runId,
        p_owner_id: input.ownerId,
        p_lease_token: input.leaseToken,
        p_content: input.content,
      });
      if (error) {
        throw mapPostgresError(error);
      }
      if (typeof data === "string" && data) {
        return data;
      }
      const [row] = rowsOf<string>(data);
      if (!row) {
        throw new FindogAgentStoreError("stale_lease");
      }
      return row;
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
      const { data, error } = await client.rpc("finish_findog_agent_run", {
        p_run_id: input.runId,
        p_owner_id: input.ownerId,
        p_lease_token: input.leaseToken,
        p_status: input.status,
        p_result: input.result ?? null,
        p_error: input.error ?? null,
        p_usage: input.usage ?? null,
        p_cost: input.cost ?? null,
        p_assistant_content: input.assistantContent ?? null,
      });
      if (error) {
        throw mapPostgresError(error);
      }
      const [row] = rowsOf<RunRow>(data);
      if (!row) {
        throw new FindogAgentStoreError("stale_lease");
      }
      return toRun(row);
    },

    async cancelRun(input: { runId: string; ownerId: string }): Promise<FindogAgentRun> {
      const { data, error } = await client.rpc("cancel_findog_agent_run", {
        p_run_id: input.runId,
        p_owner_id: input.ownerId,
      });
      if (error) {
        throw mapPostgresError(error);
      }
      const [row] = rowsOf<RunRow>(data);
      if (!row) {
        throw new FindogAgentStoreError("not_found");
      }
      return toRun(row);
    },

    /** Terminates expired leases and revoked-owner runs. Returns affected count. */
    async reapRuns(limit = 200): Promise<number> {
      const { data, error } = await client.rpc("reap_findog_agent_runs", { p_limit: limit });
      if (error) {
        throw mapPostgresError(error);
      }
      if (typeof data === "number") {
        return data;
      }
      const [row] = rowsOf<number>(data);
      return Number(row ?? 0);
    },
  };
}
