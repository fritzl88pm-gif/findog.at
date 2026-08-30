/** Standalone Telegram worker entrypoint. */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getScanningSettings } from "@/lib/scanning/settings";

import type { JobQueueRpc } from "@/lib/telegram/jobs";
import {
  runWorkerLoop,
  type WorkerConfig,
  type WorkerIntegration,
  type WorkerStorage,
} from "@/lib/telegram/worker";
import { decryptTelegramToken } from "@/lib/telegram/credentials";
import {
  createAttachmentPreprocessor,
  type AttachmentPreprocessorProviders,
} from "@/lib/telegram/attachment-preprocessor";
import { processMineruBatch } from "@/lib/attachments/mineru-cloud";
import { describeImage } from "@/lib/attachments/gemini-image-context";
import { extractDocumentsWithConfiguredModel } from "@/lib/attachments/document-fallback";
import { createConfiguredDocumentProvider } from "@/lib/attachments/document-pipeline";
import {
  mintFredEmbedSession,
  readFredEmbedServerConfig,
  readFredProModelId,
  readQuickFredEmbedServerConfig,
  FRED_EMBED_ORIGIN,
} from "@/lib/weknora/fred-embed";
import {
  createFredUpstreamSession,
  deriveFredSessionSignature,
  fetchFredUpstreamConfig,
  fredVisitorId,
  openFredUpstreamStream,
  relayFredWebhookEvent,
  stopFredUpstreamSession,
} from "@/lib/weknora/fred-native";
import { parseFredConversationSummary } from "@/lib/weknora/fred-history";
import { FRED_CONTENT_TRANSFORMATION } from "@/lib/weknora/fred-research";
import type {
  TurnServiceConfigDeps,
  TurnServicePersistenceDeps,
  TurnServiceUpstreamDeps,
} from "@/lib/fred/turn-service";
import {
  createFredRequestReceipt,
  resumeFredRequestReceipt,
  transitionFredRequestReceipt,
  transitionFredRequestReceiptIfPresent,
} from "@/lib/fred/request-ledger";

interface RpcResult {
  data: unknown;
  error: { message?: string } | null;
}

type Supabase = SupabaseClient;

interface IntegrationRow {
  id: string;
  client_id: string;
  bot_user_id: number;
  encrypted_token: string;
  status: string;
  paired_telegram_user_id: number | null;
  paired_telegram_chat_id: number | null;
  pro_mode_enabled: boolean;
  web_search_enabled: boolean;
}

interface ConversationRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  weknora_channel_id: string;
  weknora_session_id: string;
  agent_key: string;
  weknora_agent_id: string;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`MISSING_ENV_${name}`);
  return value;
}

function parseBoundedInteger(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`INVALID_ENV_${name}`);
  }
  return value;
}

function validateCredentialKey(encoded: string): void {
  const key = Buffer.from(encoded, "base64");
  const canonical = key.toString("base64").replace(/=+$/, "");
  if (key.length !== 32 || canonical !== encoded.replace(/=+$/, "")) {
    throw new Error("INVALID_ENV_TELEGRAM_CREDENTIALS_KEY");
  }
}

function invokeRpc(supabase: Supabase, name: string, params: Record<string, unknown>): Promise<RpcResult> {
  return supabase.rpc(name as never, params as never) as unknown as Promise<RpcResult>;
}

export function buildRpc(supabase: Supabase): JobQueueRpc {
  return {
    claimPending: (params) => invokeRpc(supabase, "claim_pending_telegram_updates", params),
    heartbeat: (params) => invokeRpc(supabase, "heartbeat_telegram_update", params),
    complete: (params) => invokeRpc(supabase, "complete_telegram_update", params),
    retry: (params) => invokeRpc(supabase, "retry_or_cancel_telegram_update", params),
    cancel: (params) => invokeRpc(supabase, "cancel_telegram_update", params),
    cancelAll: (params) => invokeRpc(supabase, "cancel_all_telegram_updates_for_integration", params),
    fail: (params) => invokeRpc(supabase, "fail_telegram_update", params),
    requestCancelForChat: (params) => invokeRpc(supabase, "request_cancel_telegram_update_for_chat", params),
    checkCancelled: (params) => invokeRpc(supabase, "check_telegram_update_cancelled", params),
    enqueue: (params) => invokeRpc(supabase, "enqueue_telegram_update", params),
  };
}

export function buildPreprocessorProviders(supabase: Supabase): AttachmentPreprocessorProviders {
  return {
    document: createConfiguredDocumentProvider({
      getSettings: () => getScanningSettings(supabase),
      mineruProvider: (files, options = {}) => processMineruBatch(files, options),
      omnirouteProvider: (files, options) => extractDocumentsWithConfiguredModel(files, {
        signal: options?.signal,
      }),
    }),
    gemini: (uri, options = {}) => describeImage(uri, options),
  };
}

function dbError(code: string): Error {
  return new Error(code);
}

export function buildStorage(supabase: Supabase): WorkerStorage {
  return {
    async loadIntegration(id): Promise<WorkerIntegration | null> {
      const { data, error } = await supabase
        .from("telegram_integrations")
        .select("id,client_id,bot_user_id,encrypted_token,status,paired_telegram_user_id,paired_telegram_chat_id,pro_mode_enabled,web_search_enabled")
        .eq("id", id)
        .maybeSingle();
      if (error) throw dbError("TELEGRAM_INTEGRATION_READ_FAILED");
      if (!data) return null;
      const row = data as unknown as IntegrationRow;
      return {
        id: row.id,
        clientId: row.client_id,
        botUserId: row.bot_user_id,
        encryptedToken: row.encrypted_token,
        status: row.status,
        pairedTelegramUserId: row.paired_telegram_user_id,
        pairedTelegramChatId: row.paired_telegram_chat_id,
        proModeEnabled: row.pro_mode_enabled,
        webSearchEnabled: row.web_search_enabled,
      };
    },

    async getActiveConversation(integrationId, chatId) {
      const { data, error } = await supabase
        .from("telegram_chat_bindings")
        .select("active_conversation_id")
        .eq("integration_id", integrationId)
        .eq("telegram_chat_id", chatId)
        .maybeSingle();
      if (error) throw dbError("TELEGRAM_BINDING_READ_FAILED");
      return data && typeof data.active_conversation_id === "string"
        ? data.active_conversation_id
        : null;
    },

    async clearActiveConversation(integrationId, chatId) {
      const { error } = await supabase.from("telegram_chat_bindings").upsert(
        {
          integration_id: integrationId,
          telegram_chat_id: chatId,
          active_conversation_id: null,
        },
        { onConflict: "integration_id,telegram_chat_id" },
      );
      if (error) throw dbError("TELEGRAM_BINDING_CLEAR_FAILED");
    },

    async bindConversation(integrationId, chatId, conversationId) {
      const { error } = await supabase.from("telegram_chat_bindings").upsert(
        {
          integration_id: integrationId,
          telegram_chat_id: chatId,
          active_conversation_id: conversationId,
        },
        { onConflict: "integration_id,telegram_chat_id" },
      );
      if (error) throw dbError("TELEGRAM_BINDING_WRITE_FAILED");
    },

    async markTelegramOrigin(clientId, conversationId, integrationId) {
      const { data, error } = await supabase
        .from("fred_conversations")
        .update({ origin: "telegram", telegram_integration_id: integrationId })
        .eq("id", conversationId)
        .eq("client_id", clientId)
        .select("id")
        .maybeSingle();
      if (error || !data) throw dbError("TELEGRAM_CONVERSATION_OWNERSHIP_FAILED");
    },

    async createRequestReceipt(params) {
      return createFredRequestReceipt({
        supabase,
        clientId: params.clientId,
        origin: "telegram",
        agentKey: "fred",
        content: params.content,
        requestId: params.requestId,
        userEventId: params.userEventId,
        assistantEventId: params.assistantEventId,
        telegramUpdateId: params.telegramUpdateId,
        updateRowId: params.updateRowId,
        leaseId: params.leaseId,
        conversationId: params.conversationId,
        webSearchEnabled: params.webSearchEnabled,
        proModeEnabled: params.proModeEnabled,
      });
    },

    async resumeRequestReceipt(params) {
      return resumeFredRequestReceipt({
        supabase,
        ...params,
      });
    },

    async transitionRequestReceipt(params) {
      await transitionFredRequestReceipt({
        supabase,
        ...params,
      });
    },

    async transitionRequestReceiptIfPresent(params) {
      return transitionFredRequestReceiptIfPresent({
        supabase,
        ...params,
      });
    },

    async claimDelivery(params) {
      const { data, error } = await supabase.rpc("claim_telegram_delivery_chunk", {
        p_update_id: params.updateRowId,
        p_chunk_index: params.chunkIndex,
        p_lease_id: params.leaseId,
        p_message_content: params.content,
      });
      if (
        error
        || (data !== "claimed"
          && data !== "sent"
          && data !== "uncertain"
          && data !== "cancelled"
          && data !== "lease_lost")
      ) {
        throw dbError("TELEGRAM_DELIVERY_CLAIM_FAILED");
      }
      return data;
    },

    async finishDelivery(params) {
      const { data, error } = await supabase.rpc("finish_telegram_delivery_chunk", {
        p_update_id: params.updateRowId,
        p_chunk_index: params.chunkIndex,
        p_lease_id: params.leaseId,
        p_status: params.status,
        p_telegram_message_id: params.telegramMessageId ?? null,
        p_last_error_code: params.lastErrorCode ?? null,
      });
      if (error || typeof data !== "boolean") {
        throw dbError("TELEGRAM_DELIVERY_FINISH_FAILED");
      }
      return data;
    },

    async setMode(integrationId, mode, enabled) {
      const column = mode === "pro" ? "pro_mode_enabled" : "web_search_enabled";
      const { error: updateError } = await supabase
        .from("telegram_integrations")
        .update({ [column]: enabled })
        .eq("id", integrationId);
      if (updateError) throw dbError("TELEGRAM_MODE_UPDATE_FAILED");

      const { data, error: readError } = await supabase
        .from("telegram_integrations")
        .select("pro_mode_enabled,web_search_enabled")
        .eq("id", integrationId)
        .maybeSingle();
      if (readError || !data) throw dbError("TELEGRAM_MODE_READ_FAILED");

      return {
        proModeEnabled: (data as Record<string, unknown>).pro_mode_enabled as boolean,
        webSearchEnabled: (data as Record<string, unknown>).web_search_enabled as boolean,
      };
    },
  };
}

function buildTurnUpstream(fetchImpl: typeof fetch): TurnServiceUpstreamDeps {
  return {
    async mintSession(params) {
      const session = await mintFredEmbedSession({
        config: {
          channelId: params.channelId,
          publishToken: params.publishToken,
          exchangeOrigin: params.exchangeOrigin,
        },
        signal: params.signal,
        fetchImpl,
      });
      return { token: session.token, expiresIn: session.expiresIn };
    },
    async fetchUpstreamConfig(params) {
      return fetchFredUpstreamConfig({
        session: {
          token: params.sessionToken,
          expiresIn: 0,
          channelId: params.channelId,
          embedOrigin: FRED_EMBED_ORIGIN,
        },
        config: {
          channelId: params.channelId,
          publishToken: params.publishToken,
          exchangeOrigin: params.exchangeOrigin,
        },
        signal: params.signal,
        fetchImpl,
      });
    },
    async createSession(params) {
      const session = await createFredUpstreamSession({
        session: {
          token: params.sessionToken,
          expiresIn: 0,
          channelId: params.channelId,
          embedOrigin: FRED_EMBED_ORIGIN,
        },
        config: {
          channelId: params.channelId,
          publishToken: params.publishToken,
          exchangeOrigin: params.exchangeOrigin,
        },
        signal: params.signal,
        fetchImpl,
      });
      return { id: session.id, signature: session.signature };
    },
    deriveSessionSignature(params) {
      return deriveFredSessionSignature(
        { channelId: params.channelId, publishToken: params.publishToken },
        params.sessionId,
      );
    },
    async openStream(params) {
      const response = await openFredUpstreamStream({
        session: {
          token: params.sessionToken,
          expiresIn: 0,
          channelId: params.channelId,
          embedOrigin: FRED_EMBED_ORIGIN,
        },
        config: {
          channelId: params.channelId,
          publishToken: params.publishToken,
          exchangeOrigin: params.exchangeOrigin,
        },
        upstreamConfig: {
          agentId: params.agentId,
          knowledgeBaseIds: params.knowledgeBaseIds,
          allowWebSearch: params.webSearchEnabled,
          allowFileUpload: false,
          allowImageUpload: false,
        },
        upstreamSession: { id: params.sessionId, signature: params.sessionSignature },
        visitorId: params.visitorId,
        query: params.query,
        webSearchEnabled: params.webSearchEnabled,
        summaryModelId: params.summaryModelId,
        signal: params.signal,
        fetchImpl,
      });
      if (!response.body) throw dbError("FRED_UPSTREAM_BODY_MISSING");
      return response.body;
    },
    visitorId: (publishToken, userId) => fredVisitorId(publishToken, userId),
    async relayEvent(params) {
      await relayFredWebhookEvent({
        session: {
          token: params.sessionToken,
          expiresIn: 0,
          channelId: params.channelId,
          embedOrigin: FRED_EMBED_ORIGIN,
        },
        config: {
          channelId: params.channelId,
          publishToken: params.publishToken,
          exchangeOrigin: params.exchangeOrigin,
        },
        upstreamSession: { id: params.sessionId, signature: params.sessionSignature },
        type: params.type,
        content: params.content,
        signal: params.signal,
        fetchImpl,
      });
    },
    async stopSession(params) {
      await stopFredUpstreamSession({
        session: {
          token: params.sessionToken,
          expiresIn: 0,
          channelId: params.channelId,
          embedOrigin: FRED_EMBED_ORIGIN,
        },
        config: {
          channelId: params.channelId,
          publishToken: params.publishToken,
          exchangeOrigin: params.exchangeOrigin,
        },
        upstreamSession: { id: params.sessionId, signature: params.sessionSignature },
        messageId: params.messageId,
        signal: params.signal,
        fetchImpl,
      });
    },
  };
}

function buildTurnPersistence(supabase: Supabase): TurnServicePersistenceDeps {
  return {
    async recordEvent(params) {
      const payload = {
        client_id: params.clientId,
        channel_id: params.channelId,
        session_id: params.sessionId,
        event_id: params.eventId,
        event_type: params.eventType,
        content: params.content,
        occurred_at: params.occurredAt,
        attachments: params.attachments,
        web_search_enabled: params.webSearchEnabled,
        pro_mode_enabled: params.proModeEnabled,
        agent_key: params.agentKey,
        weknora_agent_id: params.weknoraAgentId,
        ...(params.displayContent === undefined
          ? {}
          : {
              display_content: params.displayContent,
              research_trace: params.researchTrace ?? [],
              source_references: params.sourceReferences ?? [],
              content_transformation: FRED_CONTENT_TRANSFORMATION,
            }),
      };
      const { data, error } = await invokeRpc(supabase, "record_fred_native_event", { payload });
      if (error) throw dbError("FRED_EVENT_WRITE_FAILED");
      const result = data as Record<string, unknown>;
      return {
        conversation: parseFredConversationSummary(data),
        ...(typeof result.message_id === "number" ? { messageId: result.message_id } : {}),
      };
    },
    async loadConversation(params) {
      const { data, error } = await supabase
        .from("fred_conversations")
        .select("id,title,created_at,updated_at,weknora_channel_id,weknora_session_id,agent_key,weknora_agent_id")
        .eq("id", params.conversationId)
        .eq("client_id", params.clientId)
        .maybeSingle();
      if (error) throw dbError("FRED_CONVERSATION_READ_FAILED");
      return data ? (data as unknown as ConversationRow) : null;
    },
  };
}

function buildTurnConfig(): TurnServiceConfigDeps {
  return {
    readFredConfig: () => readFredEmbedServerConfig(),
    readQuickFredConfig: () => {
      try {
        return readQuickFredEmbedServerConfig();
      } catch {
        return null;
      }
    },
    readProModelId: () => readFredProModelId(),
  };
}

function createHealthHandler(isReady: () => boolean) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("ok");
      return;
    }
    if (req.url === "/readyz") {
      res.writeHead(isReady() ? 200 : 503, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(isReady() ? "ready" : "not ready");
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
  };
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, "0.0.0.0", () => {
      server.off("error", onError);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

async function main(): Promise<void> {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const credentialKey = requireEnv("TELEGRAM_CREDENTIALS_KEY");
  validateCredentialKey(credentialKey);

  const port = parseBoundedInteger("TELEGRAM_WORKER_PORT", 3001, 1, 65_535);
  const concurrency = parseBoundedInteger("TELEGRAM_WORKER_CONCURRENCY", 2, 1, 10);
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let ready = false;
  const controller = new AbortController();
  const server = createServer(createHealthHandler(() => ready));
  await listen(server, port);

  const probe = await supabase
    .from("telegram_integrations")
    .select("id", { count: "exact", head: true })
    .limit(1);
  if (probe.error) {
    await closeServer(server);
    throw dbError("TELEGRAM_DB_PROBE_FAILED");
  }

  const preprocessorProviders = buildPreprocessorProviders(supabase);

  const config: WorkerConfig = {
    rpc: buildRpc(supabase),
    storage: buildStorage(supabase),
    turnUpstream: buildTurnUpstream(fetch),
    turnPersistence: buildTurnPersistence(supabase),
    turnConfig: buildTurnConfig(),
    attachmentPreprocessor: createAttachmentPreprocessor(preprocessorProviders),
    decryptToken: decryptTelegramToken,
    encryptionKey: credentialKey,
    concurrency,
    leaseSeconds: 60,
    pollIntervalMs: 2_000,
    heartbeatIntervalMs: 10_000,
    draftRefreshIntervalMs: 2_000,
    maxDraftRefreshes: 12,
    maxDeliveryRetries: 5,
  };

  let shuttingDown = false;
  let forceTimer: ReturnType<typeof setTimeout> | null = null;
  const requestShutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    ready = false;
    console.info("telegram_worker_shutdown", { signal });
    controller.abort();
    forceTimer = setTimeout(() => {
      console.error("telegram_worker_shutdown_timeout");
      process.exit(1);
    }, 30_000);
    forceTimer.unref();
  };
  process.once("SIGTERM", () => requestShutdown("SIGTERM"));
  process.once("SIGINT", () => requestShutdown("SIGINT"));

  ready = true;
  console.info("telegram_worker_started", { port, concurrency });

  try {
    await runWorkerLoop({ config, signal: controller.signal });
  } finally {
    ready = false;
    if (forceTimer) clearTimeout(forceTimer);
    await closeServer(server);
  }
}

// Direct-execution guard: only start the worker when this module is the
// entrypoint, not when it is imported (e.g. by tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    const code = error instanceof Error ? error.message.slice(0, 96) : "UNKNOWN_FATAL";
    console.error("telegram_worker_fatal", { code });
    process.exitCode = 1;
  });
}
