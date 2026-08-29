import { createHash, randomUUID } from "node:crypto";

import type { BotApi } from "./bot-api";
import { createBotApi } from "./bot-api";
import { looksLikeSlashCommand, parseSlashCommand } from "./commands";
import { deliverFinalAnswer, type DeliveryLedger } from "./delivery";
import {
  cancelUpdate,
  checkUpdateCancelled,
  claimPendingUpdates,
  completeUpdate,
  failUpdate,
  heartbeatUpdate,
  requestCancelForChat,
  retryUpdate,
  type ClaimedUpdate,
  type JobQueueRpc,
  type UpdateHandle,
} from "./jobs";
import { chunkTelegramMessage, hasGfmTable, normalizeFredMarkdown } from "./text";
import type { EncryptionAad } from "./credentials";
import type { TelegramUpdate } from "./types";
import type { FredTurnAttachmentMeta, FredTurnEvent, FredTurnRequest, FredTurnResult } from "../fred/turn-types";
import type {
  FredRequestFailurePhase,
  FredRequestReceipt,
  FredRequestStatus,
} from "../fred/request-ledger";
import { UserVisibleError } from "../errors";
import {
  executeFredTurn,
  type TurnServiceConfigDeps,
  type TurnServicePersistenceDeps,
  type TurnServiceUpstreamDeps,
} from "../fred/turn-service";

// ── Types ───────────────────────────────────────────────────────────────────

export interface WorkerIntegration {
  id: string;
  clientId: string;
  botUserId: number;
  encryptedToken: string;
  status: string;
  pairedTelegramUserId: number | null;
  pairedTelegramChatId: number | null;
  proModeEnabled: boolean;
  webSearchEnabled: boolean;
}

export interface WorkerStorage {
  loadIntegration(id: string): Promise<WorkerIntegration | null>;
  getActiveConversation(integrationId: string, chatId: number): Promise<string | null>;
  clearActiveConversation(integrationId: string, chatId: number): Promise<void>;
  bindConversation(integrationId: string, chatId: number, conversationId: string): Promise<void>;
  markTelegramOrigin(clientId: string, conversationId: string, integrationId: string): Promise<void>;
  createRequestReceipt(params: {
    requestId: string;
    clientId: string;
    telegramUpdateId: number;
    content: string;
    userEventId: string;
    assistantEventId: string;
  }): Promise<FredRequestReceipt>;
  transitionRequestReceipt(params: {
    requestId: string;
    status: FredRequestStatus;
    conversationId?: string;
    userMessageId?: number;
    assistantMessageId?: number;
    failurePhase?: FredRequestFailurePhase;
    errorCode?: string;
  }): Promise<void>;
  getDeliveryState(updateRowId: number): Promise<{ chunkIndex: number; status: string }[]>;
  recordDelivery(
    updateRowId: number,
    chunkIndex: number,
    content: string,
    status: "pending" | "sent" | "uncertain" | "failed",
    telegramMessageId?: number,
  ): Promise<void>;
  setMode(integrationId: string, mode: "pro" | "web", enabled: boolean): Promise<Pick<WorkerIntegration, "proModeEnabled" | "webSearchEnabled">>;
}

export interface AttachmentPreprocessResult {
  upstreamQuery: string;
  metadata: FredTurnAttachmentMeta;
}

export type AttachmentPreprocessor = (
  botApi: BotApi,
  fileId: string,
  fileName: string | undefined,
  mimeType: string | undefined,
  fileSize: number | undefined,
  caption: string | undefined,
  signal?: AbortSignal,
) => Promise<AttachmentPreprocessResult>;

export interface WorkerConfig {
  rpc: JobQueueRpc;
  storage: WorkerStorage;
  turnUpstream: TurnServiceUpstreamDeps;
  turnPersistence: TurnServicePersistenceDeps;
  turnConfig: TurnServiceConfigDeps;
  /** Defaults to `executeFredTurn`; injectable for tests. */
  executeTurn?: typeof executeFredTurn;
  /** Preprocess a Telegram attachment (download + validate + build context). */
  attachmentPreprocessor?: AttachmentPreprocessor;
  /** Defaults to `createBotApi`; injectable for tests. */
  createBotApiForToken?: (token: string) => BotApi;
  decryptToken: (ciphertext: string, aad: EncryptionAad) => string;
  encryptionKey: string;
  concurrency: number;
  leaseSeconds: number;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  draftRefreshIntervalMs: number;
  maxDraftRefreshes: number;
  maxDeliveryRetries: number;
  /** Overridable sleep for deterministic loop tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface ProcessedUpdateResult {
  updateId: number;
  status: "completed" | "failed" | "cancelled" | "retry";
  error?: string;
}

export interface ProcessUpdateOptions {
  shutdownSignal?: AbortSignal;
}

export interface WorkerLoopOptions {
  config: WorkerConfig;
  signal?: AbortSignal;
}

// ── Constants ───────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 5;
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const RICH_MESSAGE_MAX_LENGTH = 32_768;

const START_TEXT =
  "Willkommen bei Findog! 🐕\n\nStelle deine Frage zum österreichischen Steuerrecht und Fred wird sie beantworten.\n\nBefehle:\n/help – Alle Befehle anzeigen\n/new – Neue Unterhaltung\n/stop – Aktuelle Antwort abbrechen\n/status – Verbindungsstatus\n/settings – Einstellungen\n/pro – Pro-Modus einstellen\n/web – Websuche einstellen";
const HELP_TEXT =
  "🐕 Findog – Dein Assistent für österreichisches Steuerrecht\n\nBefehle:\n/start – Bot starten\n/new – Neue Unterhaltung beginnen\n/stop – Aktuelle Antwort abbrechen\n/status – Verbindungsstatus prüfen\n/help – Diese Hilfe anzeigen\n/settings – Einstellungen\n/pro – Pro-Modus einstellen\n/web – Websuche einstellen\n\nStelle einfach deine Frage und Fred wird antworten!";
const STATUS_TEXT = "✅ Findog ist verbunden und bereit.";
function buildSettingsText(proEnabled: boolean, webEnabled: boolean): string {
  const proStatus = proEnabled ? "aktiviert" : "deaktiviert";
  const webStatus = webEnabled ? "aktiviert" : "deaktiviert";
  return `Einstellungen\n• Pro-Modus: ${proStatus}\n• Websuche: ${webStatus}\n\nÄndern: /pro on|off · /web on|off`;
}
function buildProStatusText(enabled: boolean): string {
  if (enabled) {
    return "Pro-Modus: aktiviert.\nGilt für deine nächsten Fragen. Deaktivieren: /pro off";
  }
  return "Pro-Modus: deaktiviert.\nAktivieren: /pro on";
}
function buildWebStatusText(enabled: boolean): string {
  if (enabled) {
    return "Websuche: aktiviert.\nDeaktivieren: /web off";
  }
  return "Websuche: deaktiviert.\nAktivieren: /web on";
}
const NEW_CONVERSATION_TEXT = "Neue Unterhaltung gestartet. Stelle deine nächste Frage!";
const STOP_STOPPED_TEXT = "⏹️ Die laufende Antwort wurde abgebrochen.";
const STOP_NOTHING_TEXT = "Es läuft gerade keine Antwort, die abgebrochen werden könnte.";
const DEFAULT_ATTACHMENT_QUESTION = "Bitte analysiere diesen Anhang.";
const UNSUPPORTED_MEDIA_TEXT = "Dieser Nachrichtentyp wird nicht unterstützt. Bitte sende deine Frage als Text.";
const UNKNOWN_COMMAND_TEXT = "Unbekannter Befehl. Nutze /help für eine Übersicht aller Befehle.";
const GENERIC_FAILURE_TEXT =
  "Entschuldigung, bei der Verarbeitung ist ein Fehler aufgetreten. Bitte versuche es später erneut.";

class UncertainDeliveryError extends Error {
  constructor() {
    super("Telegram delivery outcome is uncertain");
    this.name = "UncertainDeliveryError";
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function processUpdate(
  config: WorkerConfig,
  update: ClaimedUpdate,
  options: ProcessUpdateOptions = {},
): Promise<ProcessedUpdateResult> {
  const { rpc, storage } = config;
  const executeTurn = config.executeTurn ?? executeFredTurn;
  const createBotApiForToken = config.createBotApiForToken ?? createBotApi;
  const handle: UpdateHandle = { rowId: update.id, leaseId: update.leaseId };

  if (options.shutdownSignal?.aborted) {
    return requeueForShutdown(rpc, update);
  }

  const integration = await storage.loadIntegration(update.integrationId).catch(() => null);
  if (
    !integration
    || integration.status !== "active"
    || integration.pairedTelegramUserId === null
    || integration.pairedTelegramChatId === null
  ) {
    await failUpdate(rpc, { rowId: update.id, leaseId: update.leaseId, lastErrorCode: "INTEGRATION_INACTIVE" });
    return { updateId: update.updateId, status: "failed", error: "integration missing or inactive" };
  }

  const tgUpdate = update.rawUpdate as unknown as TelegramUpdate;
  const message = tgUpdate.message;
  if (!message || !message.from || message.chat.type !== "private") {
    await completeUpdate(rpc, handle);
    return { updateId: update.updateId, status: "completed" };
  }

  const chatId = message.chat.id;
  if (
    message.from.id !== integration.pairedTelegramUserId
    || chatId !== integration.pairedTelegramChatId
    || chatId !== update.telegramChatId
  ) {
    await completeUpdate(rpc, handle);
    return { updateId: update.updateId, status: "completed" };
  }

  let token: string;
  try {
    token = config.decryptToken(integration.encryptedToken, {
      integrationId: integration.id,
      clientId: integration.clientId,
      botUserId: integration.botUserId,
    });
  } catch {
    await failUpdate(rpc, { rowId: update.id, leaseId: update.leaseId, lastErrorCode: "DECRYPT_FAILED" });
    return { updateId: update.updateId, status: "failed", error: "token decryption failed" };
  }
  const botApi = createBotApiForToken(token);

  try {
    if (message.document && config.attachmentPreprocessor) {
      return await handleAttachmentTurn(
        config, botApi, executeTurn, integration, update, handle, chatId,
        message.document, undefined, message.caption, options.shutdownSignal,
      );
    }
    if (message.photo && message.photo.length > 0 && config.attachmentPreprocessor) {
      return await handleAttachmentTurn(
        config, botApi, executeTurn, integration, update, handle, chatId,
        undefined, message.photo, message.caption, options.shutdownSignal,
      );
    }

    if (!message.text) {
      await botApi.sendMessage({ chat_id: chatId, text: UNSUPPORTED_MEDIA_TEXT });
      await completeUpdate(rpc, handle);
      return { updateId: update.updateId, status: "completed" };
    }

    const text = message.text.trim();
    const command = parseSlashCommand(text);
    if (command) {
      return await handleSlashCommand(config, botApi, integration, update, handle, command, chatId);
    }
    if (looksLikeSlashCommand(text)) {
      await botApi.sendMessage({ chat_id: chatId, text: UNKNOWN_COMMAND_TEXT });
      await completeUpdate(rpc, handle);
      return { updateId: update.updateId, status: "completed" };
    }

    const receipt = await createTelegramRequestReceipt(config, integration, update, text);
    return await runWithTurnLifecycle(
      config,
      botApi,
      handle,
      chatId,
      options.shutdownSignal,
      false,
      (lifecycle) => handleFredTurn(
        config, botApi, executeTurn, integration, update, handle, chatId, text, lifecycle,
        undefined, undefined, receipt,
      ),
    );
  } catch (error) {
    if (options.shutdownSignal?.aborted) {
      return requeueForShutdown(rpc, update);
    }
    return await handleProcessingError(config, botApi, update, chatId, error);
  }
}

export async function runWorkerLoop(options: WorkerLoopOptions): Promise<void> {
  const { config, signal } = options;
  const { rpc, concurrency } = config;
  const sleepFn = config.sleep ?? sleep;

  while (!signal?.aborted) {
    const leaseId = randomUUID();
    let updates: ClaimedUpdate[];
    try {
      updates = await claimPendingUpdates(rpc, concurrency, leaseId, config.leaseSeconds);
    } catch {
      await sleepFn(config.pollIntervalMs);
      continue;
    }

    if (updates.length === 0) {
      await sleepFn(config.pollIntervalMs);
      continue;
    }

    await Promise.allSettled(
      updates.map((update) => processUpdate(config, update, { shutdownSignal: signal })),
    );
  }
}

// ── Command handling ────────────────────────────────────────────────────────

async function handleSlashCommand(
  config: WorkerConfig,
  botApi: BotApi,
  integration: WorkerIntegration,
  update: ClaimedUpdate,
  handle: UpdateHandle,
  parsed: import("./commands").ParsedSlashCommand,
  chatId: number,
): Promise<ProcessedUpdateResult> {
  const { rpc, storage } = config;
  const command = parsed.command;
  const argument = parsed.argument;

  switch (command) {
    case "start":
      await botApi.sendMessage({ chat_id: chatId, text: START_TEXT });
      break;

    case "help":
      await botApi.sendMessage({ chat_id: chatId, text: HELP_TEXT });
      break;

    case "status":
      await botApi.sendMessage({ chat_id: chatId, text: STATUS_TEXT });
      break;

    case "settings": {
      await botApi.sendMessage({
        chat_id: chatId,
        text: buildSettingsText(integration.proModeEnabled, integration.webSearchEnabled),
      });
      break;
    }

    case "new":
      await storage.clearActiveConversation(integration.id, chatId);
      await botApi.sendMessage({ chat_id: chatId, text: NEW_CONVERSATION_TEXT });
      break;

    case "stop": {
      const stopped = await requestCancelForChat(rpc, {
        integrationId: integration.id,
        telegramChatId: chatId,
        excludeRowId: update.id,
      });
      await botApi.sendMessage({ chat_id: chatId, text: stopped ? STOP_STOPPED_TEXT : STOP_NOTHING_TEXT });
      break;
    }

    case "pro": {
      if (argument === undefined || argument === "status") {
        await botApi.sendMessage({ chat_id: chatId, text: buildProStatusText(integration.proModeEnabled) });
      } else if (argument === "on" || argument === "off") {
        const enable = argument === "on";
        const updated = await storage.setMode(integration.id, "pro", enable);
        await botApi.sendMessage({ chat_id: chatId, text: buildProStatusText(updated.proModeEnabled) });
      } else {
        await botApi.sendMessage({ chat_id: chatId, text: "Nutzung: /pro on|off|status" });
      }
      break;
    }

    case "web": {
      if (argument === undefined || argument === "status") {
        await botApi.sendMessage({ chat_id: chatId, text: buildWebStatusText(integration.webSearchEnabled) });
      } else if (argument === "on" || argument === "off") {
        const enable = argument === "on";
        const updated = await storage.setMode(integration.id, "web", enable);
        await botApi.sendMessage({ chat_id: chatId, text: buildWebStatusText(updated.webSearchEnabled) });
      } else {
        await botApi.sendMessage({ chat_id: chatId, text: "Nutzung: /web on|off|status" });
      }
      break;
    }

    default:
      // Unreachable: parseSlashCommand only returns known commands.
      break;
  }

  await completeUpdate(rpc, handle);
  return { updateId: update.updateId, status: "completed" };
}

// ── Fred turn handling ──────────────────────────────────────────────────────

interface TurnLifecycleState {
  cancellationRequested: boolean;
  shutdownRequested: boolean;
  controlPlaneError: unknown;
}

interface TurnLifecycle {
  controller: AbortController;
  typingController: AbortController;
  typingTimer: ReturnType<typeof setInterval>;
  heartbeatTimer?: ReturnType<typeof setInterval>;
  shutdownSignal?: AbortSignal;
  shutdownListener: () => void;
  state: TurnLifecycleState;
  cleanup(): void;
}

async function createTurnLifecycle(
  config: WorkerConfig,
  botApi: BotApi,
  handle: UpdateHandle,
  chatId: number,
  shutdownSignal: AbortSignal | undefined,
  immediateHeartbeat: boolean,
): Promise<TurnLifecycle> {
  const controller = new AbortController();
  const typingController = new AbortController();
  const state: TurnLifecycleState = {
    cancellationRequested: false,
    shutdownRequested: shutdownSignal?.aborted === true,
    controlPlaneError: undefined,
  };
  let cleaned = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  const shutdownListener = (): void => {
    state.shutdownRequested = true;
    controller.abort();
  };
  if (shutdownSignal && !shutdownSignal.aborted) {
    shutdownSignal.addEventListener("abort", shutdownListener, { once: true });
  } else if (state.shutdownRequested) {
    controller.abort();
  }

  const sendTypingAction = (): void => {
    if (cleaned || typingController.signal.aborted) return;
    try {
      void botApi.sendChatAction(
        { chat_id: chatId, action: "typing" },
        { signal: typingController.signal },
      ).catch(() => undefined);
    } catch {
      return;
    }
  };
  sendTypingAction();
  const typingTimer = setInterval(sendTypingAction, 4_000);

  const runHeartbeat = async (): Promise<void> => {
    if (cleaned || controller.signal.aborted) return;
    try {
      const leaseOk = await heartbeatUpdate(config.rpc, handle);
      if (cleaned) return;
      if (!leaseOk) {
        state.controlPlaneError = new Error("Telegram update lease lost");
        controller.abort();
        return;
      }
      const cancelled = await checkUpdateCancelled(config.rpc, handle);
      if (cleaned) return;
      if (cancelled) {
        state.cancellationRequested = true;
        controller.abort();
      }
    } catch (error) {
      if (cleaned) return;
      state.controlPlaneError = error;
      controller.abort();
    }
  };

  if (immediateHeartbeat && !controller.signal.aborted) {
    await runHeartbeat();
  }
  if (!controller.signal.aborted) {
    heartbeatTimer = setInterval(() => {
      void runHeartbeat();
    }, config.heartbeatIntervalMs);
  }

  return {
    controller,
    typingController,
    typingTimer,
    heartbeatTimer,
    shutdownSignal,
    shutdownListener,
    state,
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(typingTimer);
      typingController.abort();
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      shutdownSignal?.removeEventListener("abort", shutdownListener);
    },
  };
}

async function runWithTurnLifecycle(
  config: WorkerConfig,
  botApi: BotApi,
  handle: UpdateHandle,
  chatId: number,
  shutdownSignal: AbortSignal | undefined,
  immediateHeartbeat: boolean,
  work: (lifecycle: TurnLifecycle) => Promise<ProcessedUpdateResult>,
): Promise<ProcessedUpdateResult> {
  const lifecycle = await createTurnLifecycle(
    config,
    botApi,
    handle,
    chatId,
    shutdownSignal,
    immediateHeartbeat,
  );
  try {
    return await work(lifecycle);
  } finally {
    lifecycle.cleanup();
  }
}

async function lifecycleInterruptionResult(
  config: WorkerConfig,
  update: ClaimedUpdate,
  handle: UpdateHandle,
  lifecycle: TurnLifecycle,
): Promise<ProcessedUpdateResult | undefined> {
  if (lifecycle.state.cancellationRequested) {
    await cancelUpdate(config.rpc, handle);
    return { updateId: update.updateId, status: "cancelled" };
  }
  if (lifecycle.state.shutdownRequested) {
    return requeueForShutdown(config.rpc, update);
  }
  if (lifecycle.state.controlPlaneError) {
    throw lifecycle.state.controlPlaneError;
  }
  return undefined;
}

async function handleAttachmentTurn(
  config: WorkerConfig,
  botApi: BotApi,
  executeTurn: typeof executeFredTurn,
  integration: WorkerIntegration,
  update: ClaimedUpdate,
  handle: UpdateHandle,
  chatId: number,
  document: import("./types").TelegramDocument | undefined,
  photo: import("./types").TelegramPhotoSize[] | undefined,
  caption: string | undefined,
  shutdownSignal?: AbortSignal,
): Promise<ProcessedUpdateResult> {
  const { rpc } = config;
  let fileId: string;
  let fileName: string | undefined;
  let mimeType: string | undefined;
  let fileSize: number | undefined;

  if (document) {
    fileId = document.file_id;
    fileName = document.file_name;
    mimeType = document.mime_type;
    fileSize = document.file_size;
  } else if (photo && photo.length > 0) {
    let largest = photo[0];
    for (let i = 1; i < photo.length; i++) {
      const current = photo[i];
      const largestMetric = largest.file_size ?? largest.width * largest.height;
      const currentMetric = current.file_size ?? current.width * current.height;
      if (currentMetric > largestMetric) largest = current;
    }
    fileId = largest.file_id;
    fileName = "photo.jpg";
    mimeType = "image/jpeg";
    fileSize = largest.file_size;
  } else {
    return handleProcessingError(config, botApi, update, chatId, new Error("No attachment found"));
  }

  const originalQuestion = caption?.trim() || DEFAULT_ATTACHMENT_QUESTION;
  const receipt = await createTelegramRequestReceipt(
    config,
    integration,
    update,
    originalQuestion,
  );
  const isPhoto = photo !== undefined && photo.length > 0;
  const limit = isPhoto ? MAX_PHOTO_BYTES : MAX_DOCUMENT_BYTES;
  if (fileSize !== undefined && fileSize > limit) {
    const message = isPhoto
      ? "Ein Bild darf maximal 10 MB groß sein."
      : "Eine Datei darf maximal 20 MB groß sein.";
    try {
      await botApi.sendMessage({ chat_id: chatId, text: message });
    } catch {
      // Best-effort
    }
    await config.storage.transitionRequestReceipt({
      requestId: receipt.requestId,
      status: "failed",
      failurePhase: "preprocessing",
      errorCode: "attachment_too_large",
    });
    await completeUpdate(rpc, handle);
    return { updateId: update.updateId, status: "completed" };
  }

  return runWithTurnLifecycle(
    config,
    botApi,
    handle,
    chatId,
    shutdownSignal,
    true,
    async (lifecycle) => {
      const initialInterruption = await lifecycleInterruptionResult(config, update, handle, lifecycle);
      if (initialInterruption) {
        await config.storage.transitionRequestReceipt({
          requestId: receipt.requestId,
          status: "cancelled",
          failurePhase: "preprocessing",
          errorCode: "request_cancelled",
        });
        return initialInterruption;
      }

      let preprocessResult: AttachmentPreprocessResult | undefined;
      let preprocessError: unknown;
      try {
        preprocessResult = await config.attachmentPreprocessor!(
          botApi,
          fileId,
          fileName,
          mimeType,
          fileSize,
          caption,
          lifecycle.controller.signal,
        );
      } catch (error) {
        preprocessError = error;
      }

      const preprocessInterruption = await lifecycleInterruptionResult(config, update, handle, lifecycle);
      if (preprocessInterruption) {
        await config.storage.transitionRequestReceipt({
          requestId: receipt.requestId,
          status: "cancelled",
          failurePhase: "preprocessing",
          errorCode: "request_cancelled",
        });
        return preprocessInterruption;
      }
      if (preprocessError) {
        await config.storage.transitionRequestReceipt({
          requestId: receipt.requestId,
          status: "failed",
          failurePhase: "preprocessing",
          errorCode: preprocessError instanceof UserVisibleError
            ? "attachment_rejected"
            : "preprocessing_failed",
        });
        if (preprocessError instanceof UserVisibleError) {
          try {
            await botApi.sendMessage({ chat_id: chatId, text: preprocessError.message });
          } catch {
            // Best-effort
          }
          await completeUpdate(rpc, handle);
          return { updateId: update.updateId, status: "completed" };
        }
        throw preprocessError;
      }
      if (!preprocessResult) {
        throw new Error("Attachment preprocessing returned no result");
      }

      return handleFredTurn(
        config,
        botApi,
        executeTurn,
        integration,
        update,
        handle,
        chatId,
        originalQuestion,
        lifecycle,
        preprocessResult.upstreamQuery,
        [preprocessResult.metadata],
        receipt,
      );
    },
  );
}

async function handleFredTurn(
  config: WorkerConfig,
  botApi: BotApi,
  executeTurn: typeof executeFredTurn,
  integration: WorkerIntegration,
  update: ClaimedUpdate,
  handle: UpdateHandle,
  chatId: number,
  text: string,
  lifecycle: TurnLifecycle,
  upstreamQuery?: string,
  attachments?: FredTurnAttachmentMeta[],
  receipt?: FredRequestReceipt,
): Promise<ProcessedUpdateResult> {
  const { rpc, storage } = config;
  const conversationId = await storage.getActiveConversation(integration.id, chatId);
  const request: FredTurnRequest = {
    clientId: integration.clientId,
    ...(conversationId ? { conversationId } : {}),
    query: text,
    ...(upstreamQuery ? { upstreamQuery } : {}),
    ...(attachments ? { attachments } : {}),
    origin: "telegram",
    telegramIntegrationId: integration.id,
    requestId: receipt?.requestId,
    agentKey: "fred",
    webSearchEnabled: integration.webSearchEnabled,
    proModeEnabled: integration.proModeEnabled,
    userEventId: receipt?.userEventId ?? deriveEventId(`${integration.id}:${update.updateId}:user`),
    assistantEventId: receipt?.assistantEventId ?? deriveEventId(`${integration.id}:${update.updateId}:assistant`),
    ...(receipt ? {
      onRequestTransition: (transition: import("../fred/turn-types").FredRequestLifecycleTransition) =>
        storage.transitionRequestReceipt({
          requestId: receipt.requestId,
          ...transition,
        }),
    } : {}),
    onConversationEvent: async (conversation) => {
      await storage.markTelegramOrigin(integration.clientId, conversation.id, integration.id);
      await storage.bindConversation(integration.id, chatId, conversation.id);
    },
    signal: lifecycle.controller.signal,
  };

  let finalResult: FredTurnResult | undefined;
  let turnError: unknown;
  try {
    const gen = executeTurn(request, config.turnUpstream, config.turnPersistence, config.turnConfig);
    while (true) {
      const { value, done } = await gen.next();
      if (done) {
        finalResult = value;
        break;
      }
      const event = value as FredTurnEvent;
      if (event.type === "error") throw new Error(event.error);
    }
  } catch (error) {
    turnError = error;
  }

  const interruption = await lifecycleInterruptionResult(config, update, handle, lifecycle);
  if (interruption) return interruption;
  if (turnError) throw turnError;
  if (!finalResult) throw new Error("Fred turn returned no final result");
  if (finalResult.stopped) {
    await cancelUpdate(rpc, handle);
    return { updateId: update.updateId, status: "cancelled" };
  }

  await deliverAnswer(config, botApi, chatId, update.id, finalResult.answer);
  await completeUpdate(rpc, handle);
  return { updateId: update.updateId, status: "completed" };
}

async function createTelegramRequestReceipt(
  config: WorkerConfig,
  integration: WorkerIntegration,
  update: ClaimedUpdate,
  content: string,
): Promise<FredRequestReceipt> {
  return config.storage.createRequestReceipt({
    requestId: deriveEventId(`${integration.id}:${update.updateId}:request`),
    clientId: integration.clientId,
    telegramUpdateId: update.id,
    content,
    userEventId: deriveEventId(`${integration.id}:${update.updateId}:user`),
    assistantEventId: deriveEventId(`${integration.id}:${update.updateId}:assistant`),
  });
}

async function requeueForShutdown(
  rpc: JobQueueRpc,
  update: ClaimedUpdate,
): Promise<ProcessedUpdateResult> {
  await retryUpdate(rpc, {
    rowId: update.id,
    leaseId: update.leaseId,
    retryDelaySeconds: 0,
    lastErrorCode: "WORKER_SHUTDOWN",
  });
  return { updateId: update.updateId, status: "retry", error: "worker shutdown" };
}

async function deliverAnswer(
  config: WorkerConfig,
  botApi: BotApi,
  chatId: number,
  updateRowId: number,
  answer: string,
): Promise<void> {
  const { storage } = config;
  const chunks = chunkTelegramMessage(normalizeFredMarkdown(answer));
  const richMarkdown = hasGfmTable(answer)
    && answer.length <= RICH_MESSAGE_MAX_LENGTH
    && chunks.length === 1
    ? answer
    : undefined;
  const existing = await storage.getDeliveryState(updateRowId);
  if (existing.some((entry) => entry.status === "uncertain")) {
    throw new UncertainDeliveryError();
  }
  const sentChunkIndexes = new Set(
    existing.filter((entry) => entry.status === "sent").map((entry) => entry.chunkIndex),
  );

  for (let i = 0; i < chunks.length; i++) {
    if (sentChunkIndexes.has(i)) continue;
    const content = chunks[i];

    await storage.recordDelivery(updateRowId, i, content, "pending");
    const ledger: DeliveryLedger = { chunks: [], uncertainChunks: [] };
    await deliverFinalAnswer(botApi, chatId, content, {
      ledger,
      maxRetries: config.maxDeliveryRetries,
      richMarkdown: i === 0 ? richMarkdown : undefined,
    });
    const entry = ledger.chunks[0];

    if (entry?.status === "sent") {
      await storage.recordDelivery(updateRowId, i, content, "sent", entry.messageId);
    } else if (entry?.status === "uncertain") {
      // Ambiguous outcome (e.g. network error after the request was sent):
      // record it but never blindly resend on a later retry.
      await storage.recordDelivery(updateRowId, i, content, "uncertain");
      throw new UncertainDeliveryError();
    } else {
      await storage.recordDelivery(updateRowId, i, content, "failed");
      throw new Error(`Telegram-Zustellung fehlgeschlagen: ${entry?.error ?? "unbekannter Fehler"}`);
    }
  }
}

// ── Error handling ──────────────────────────────────────────────────────────

async function handleProcessingError(
  config: WorkerConfig,
  botApi: BotApi,
  update: ClaimedUpdate,
  chatId: number,
  error: unknown,
): Promise<ProcessedUpdateResult> {
  const { rpc } = config;
  const message = errorMessage(error);
  const errorCode = sanitizeErrorCode(message);

  if (error instanceof UncertainDeliveryError) {
    await failUpdate(rpc, {
      rowId: update.id,
      leaseId: update.leaseId,
      lastErrorCode: "DELIVERY_UNCERTAIN",
    });
    return { updateId: update.updateId, status: "failed", error: message };
  }

  if (update.attemptCount < MAX_ATTEMPTS) {
    await retryUpdate(rpc, {
      rowId: update.id,
      leaseId: update.leaseId,
      retryDelaySeconds: Math.min(60 * 2 ** update.attemptCount, 600),
      lastErrorCode: errorCode,
    });
    return { updateId: update.updateId, status: "failed", error: message };
  }

  await failUpdate(rpc, { rowId: update.id, leaseId: update.leaseId, lastErrorCode: errorCode });
  try {
    await botApi.sendMessage({ chat_id: chatId, text: GENERIC_FAILURE_TEXT });
  } catch {
    // Best-effort — the update is already terminally failed.
  }
  return { updateId: update.updateId, status: "failed", error: message };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function deriveEventId(key: string): string {
  const hash = createHash("sha256").update(key).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return "Unknown error";
}

function sanitizeErrorCode(message: string): string {
  const truncated = message.slice(0, 60).replace(/[^a-zA-Z0-9_\- ]/g, "");
  return truncated || "UNKNOWN";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
