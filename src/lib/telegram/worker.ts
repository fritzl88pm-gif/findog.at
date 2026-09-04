import { createHash, randomUUID } from "node:crypto";

import type { BotApi } from "./bot-api";
import { createBotApi } from "./bot-api";
import { looksLikeSlashCommand, parseSlashCommand } from "./commands";
import { deliverFinalAnswer, type DeliveryLedger } from "./delivery";
import { createGenerationWatchdog } from "./generation-watchdog";
import {
  cancelUpdate,
  checkUpdateCancelled,
  claimPendingUpdates,
  completeUpdate,
  failUpdate,
  heartbeatUpdate,
  requestCancelForChat,
  retryUpdate,
  TelegramUpdateLeaseLostError,
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
  FredOptionalReceiptTransition,
  FredRequestReceipt,
  FredRequestResume,
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
    updateRowId: number;
    leaseId: string;
    content: string;
    userEventId: string;
    assistantEventId: string;
    conversationId?: string;
    webSearchEnabled: boolean;
    proModeEnabled: boolean;
  }): Promise<FredRequestReceipt | false>;
  resumeRequestReceipt(params: {
    requestId: string;
    clientId: string;
    telegramUpdateId: number;
  }): Promise<FredRequestResume>;
  transitionRequestReceipt(params: {
    requestId: string;
    status: FredRequestStatus;
    conversationId?: string;
    userMessageId?: number;
    assistantMessageId?: number;
    failurePhase?: FredRequestFailurePhase;
    errorCode?: string;
  }): Promise<void>;
  transitionRequestReceiptIfPresent(params: {
    requestId: string;
    updateRowId: number;
    leaseId: string;
    status: "failed" | "cancelled";
    failurePhase: FredRequestFailurePhase;
    errorCode: string;
  }): Promise<FredOptionalReceiptTransition>;
  claimDelivery(params: {
    updateRowId: number;
    chunkIndex: number;
    content: string;
    leaseId: string;
  }): Promise<"claimed" | "sent" | "uncertain" | "cancelled" | "lease_lost">;
  finishDelivery(params: {
    updateRowId: number;
    chunkIndex: number;
    leaseId: string;
    status: "sent" | "uncertain" | "failed";
    telegramMessageId?: number;
    lastErrorCode?: string;
  }): Promise<boolean>;
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
  generationTimeoutMs?: number;
  generationIdleTimeoutMs?: number;
  onUnresponsiveGeneration?: () => void;
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
  onHealth?: (lane: "generation" | "control", healthy: boolean) => void;
}

// ── Constants ───────────────────────────────────────────────────────────────

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
    return requeueForShutdown(config, update);
  }
  if (update.cancelRequested) {
    return cancelRetryRequested(config, update, "ingress");
  }

  let integration: WorkerIntegration | null;
  try {
    integration = await storage.loadIntegration(update.integrationId);
  } catch (error) {
    if (options.shutdownSignal?.aborted) {
      return requeueForShutdown(config, update);
    }
    // A control-plane read failure must not consume the last processing
    // attempt: an earlier attempt may already have committed the answer, and
    // without the integration token this worker cannot safely deliver or
    // conclude that delivery is impossible. The max+1 cleanup marker may be
    // reclaimed repeatedly, but it never starts preprocessing/upstream work.
    const retryOutcome = await retryUpdate(rpc, {
      rowId: update.id,
      leaseId: update.leaseId,
      retryDelaySeconds: Math.min(60 * 2 ** update.attemptCount, 600),
      lastErrorCode: "INTEGRATION_READ_FAILED",
    });
    if (retryOutcome === "cancel_requested") {
      return cancelRetryRequested(config, update, "ingress");
    }
    return { updateId: update.updateId, status: "retry", error: errorMessage(error) };
  }
  if (
    !integration
    || integration.status !== "active"
    || integration.pairedTelegramUserId === null
    || integration.pairedTelegramChatId === null
  ) {
    await terminalizeExistingReceipt(config, update, "integration_inactive");
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
    await terminalizeExistingReceipt(config, update, "telegram_identity_mismatch");
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
    await terminalizeExistingReceipt(config, update, "token_decryption_failed");
    await failUpdate(rpc, { rowId: update.id, leaseId: update.leaseId, lastErrorCode: "DECRYPT_FAILED" });
    return { updateId: update.updateId, status: "failed", error: "token decryption failed" };
  }
  const botApi = createBotApiForToken(token);

  // A lease-expired final attempt is reclaimed with the explicit max+1 marker.
  // It may reconcile/deliver already committed work, but must never start a
  // sixth preprocessing or upstream attempt.
  if (update.attemptCount > update.maxAttempts) {
    return handleProcessingError(
      config,
      botApi,
      update,
      chatId,
      new Error("EXHAUSTED_ATTEMPT_CLEANUP"),
    );
  }

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
      true,
      (lifecycle) => handleFredTurn(
        config, botApi, executeTurn, integration, update, handle, chatId, text, lifecycle,
        undefined, undefined, receipt,
      ),
    );
  } catch (error) {
    if (error instanceof TelegramUpdateLeaseLostError) {
      throw error;
    }
    if (options.shutdownSignal?.aborted) {
      return requeueForShutdown(config, update);
    }
    return await handleProcessingError(config, botApi, update, chatId, error);
  }
}

async function terminalizeExistingReceipt(
  config: WorkerConfig,
  update: ClaimedUpdate,
  errorCode: string,
): Promise<void> {
  await transitionRequestReceiptUnderLease(config, update, {
    requestId: deriveEventId(`${update.integrationId}:${update.updateId}:request`),
    status: "failed",
    failurePhase: "ingress",
    errorCode,
  });
}

async function transitionRequestReceiptUnderLease(
  config: WorkerConfig,
  update: ClaimedUpdate,
  transition: {
    requestId: string;
    status: "failed" | "cancelled";
    failurePhase: FredRequestFailurePhase;
    errorCode: string;
  },
): Promise<FredOptionalReceiptTransition> {
  const outcome = await config.storage.transitionRequestReceiptIfPresent({
    ...transition,
    updateRowId: update.id,
    leaseId: update.leaseId,
  });
  if (!outcome.leaseValid) {
    throw new TelegramUpdateLeaseLostError("transition request receipt");
  }
  return outcome;
}

export async function runWorkerLoop(options: WorkerLoopOptions): Promise<void> {
  const { config, signal, onHealth } = options;
  async function runLane(controlsOnly: boolean): Promise<void> {
    const lane = controlsOnly ? "control" : "generation";
    const capacity = controlsOnly ? 1 : config.concurrency;
    const active = new Set<Promise<void>>();
    let wake: (() => void) | undefined;
    const wait = () => new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", finish);
        if (wake === finish) wake = undefined;
        resolve();
      };
      wake = finish;
      signal?.addEventListener("abort", finish, { once: true });
      if (config.sleep) void config.sleep(config.pollIntervalMs).then(finish);
      else timer = setTimeout(finish, config.pollIntervalMs);
      if (signal?.aborted) finish();
    });
    try {
      while (!signal?.aborted) {
        const free = capacity - active.size;
        if (free === 0) {
          onHealth?.(lane, true);
          await wait();
          continue;
        }
        let updates: ClaimedUpdate[];
        try {
          updates = await claimPendingUpdates(config.rpc, free, randomUUID(), config.leaseSeconds, controlsOnly);
          onHealth?.(lane, true);
        } catch {
          onHealth?.(lane, false);
          await wait();
          continue;
        }
        for (const update of updates) {
          const task = processUpdate(config, update, { shutdownSignal: signal })
            .then(() => undefined, () => {
              // Durable leases are reclaimed after errors; do not stop other jobs.
              onHealth?.(lane, false);
            }).finally(() => { active.delete(task); wake?.(); });
          active.add(task);
        }
        // Refill immediately after a completion, otherwise poll for new arrivals.
        if (updates.length === 0 || active.size >= capacity) await wait();
      }
    } finally {
      await Promise.allSettled(active);
    }
  }
  await Promise.all([runLane(false), runLane(true)]);
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
  generationError?: Error;
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
        state.controlPlaneError = new TelegramUpdateLeaseLostError("heartbeat update");
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
    return requeueForShutdown(config, update);
  }
  if (lifecycle.state.controlPlaneError) {
    throw lifecycle.state.controlPlaneError;
  }
  if (lifecycle.state.generationError) throw lifecycle.state.generationError;
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
  const resume = await config.storage.resumeRequestReceipt({
    requestId: receipt.requestId,
    clientId: integration.clientId,
    telegramUpdateId: update.id,
  });
  if (
    resume.contentDeleted
    || resume.status === "completed"
    || resume.status === "failed"
    || resume.status === "cancelled"
  ) {
    return runWithTurnLifecycle(
      config,
      botApi,
      handle,
      chatId,
      shutdownSignal,
      true,
      (lifecycle) => handleFredTurn(
        config,
        botApi,
        executeTurn,
        integration,
        update,
        handle,
        chatId,
        originalQuestion,
        lifecycle,
        undefined,
        undefined,
        receipt,
        resume,
      ),
    );
  }
  const isPhoto = photo !== undefined && photo.length > 0;
  const limit = isPhoto ? MAX_PHOTO_BYTES : MAX_DOCUMENT_BYTES;
  if (fileSize !== undefined && fileSize > limit) {
    const message = isPhoto
      ? "Ein Bild darf maximal 10 MB groß sein."
      : "Eine Datei darf maximal 20 MB groß sein.";
    await transitionRequestReceiptUnderLease(config, update, {
      requestId: receipt.requestId,
      status: "failed",
      failurePhase: "preprocessing",
      errorCode: "attachment_too_large",
    });
    const settled = await config.storage.resumeRequestReceipt({
      requestId: receipt.requestId,
      clientId: integration.clientId,
      telegramUpdateId: update.id,
    });
    if (settled.contentDeleted || settled.status === "completed" || settled.status === "cancelled") {
      return runWithTurnLifecycle(
        config,
        botApi,
        handle,
        chatId,
        shutdownSignal,
        true,
        (lifecycle) => handleFredTurn(
          config,
          botApi,
          executeTurn,
          integration,
          update,
          handle,
          chatId,
          originalQuestion,
          lifecycle,
          undefined,
          undefined,
          receipt,
          settled,
        ),
      );
    }
    if (settled.status !== "failed") {
      throw new Error("Attachment receipt did not settle after rejection");
    }
    try {
      await botApi.sendMessage({ chat_id: chatId, text: message });
    } catch {
      // Best-effort
    }
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
      if (lifecycle.state.cancellationRequested) {
        await transitionRequestReceiptUnderLease(config, update, {
          requestId: receipt.requestId,
          status: "cancelled",
          failurePhase: "preprocessing",
          errorCode: "request_cancelled",
        });
      }
      const initialInterruption = await lifecycleInterruptionResult(config, update, handle, lifecycle);
      if (initialInterruption) return initialInterruption;

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

      if (lifecycle.state.cancellationRequested) {
        await transitionRequestReceiptUnderLease(config, update, {
          requestId: receipt.requestId,
          status: "cancelled",
          failurePhase: "preprocessing",
          errorCode: "request_cancelled",
        });
      }
      const preprocessInterruption = await lifecycleInterruptionResult(config, update, handle, lifecycle);
      if (preprocessInterruption) return preprocessInterruption;
      if (preprocessError) {
        if (preprocessError instanceof UserVisibleError) {
          await transitionRequestReceiptUnderLease(config, update, {
            requestId: receipt.requestId,
            status: "failed",
            failurePhase: "preprocessing",
            errorCode: "attachment_rejected",
          });
          const settled = await config.storage.resumeRequestReceipt({
            requestId: receipt.requestId,
            clientId: integration.clientId,
            telegramUpdateId: update.id,
          });
          if (
            settled.contentDeleted
            || settled.status === "completed"
            || settled.status === "cancelled"
          ) {
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
              undefined,
              undefined,
              receipt,
              settled,
            );
          }
          if (settled.status !== "failed") {
            throw new Error("Attachment receipt did not settle after rejection");
          }
          try {
            await botApi.sendMessage({ chat_id: chatId, text: preprocessError.message });
          } catch {
            // Best-effort
          }
          await completeUpdate(rpc, handle);
          return { updateId: update.updateId, status: "completed" };
        }
        if (update.attemptCount >= update.maxAttempts) {
          await transitionRequestReceiptUnderLease(config, update, {
            requestId: receipt.requestId,
            status: "failed",
            failurePhase: "preprocessing",
            errorCode: "preprocessing_failed",
          });
          const settled = await config.storage.resumeRequestReceipt({
            requestId: receipt.requestId,
            clientId: integration.clientId,
            telegramUpdateId: update.id,
          });
          if (
            settled.contentDeleted
            || settled.status === "completed"
            || settled.status === "cancelled"
          ) {
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
              undefined,
              undefined,
              receipt,
              settled,
            );
          }
        }
        throw preprocessError;
      }
      if (!preprocessResult) {
        if (update.attemptCount >= update.maxAttempts) {
          await transitionRequestReceiptUnderLease(config, update, {
            requestId: receipt.requestId,
            status: "failed",
            failurePhase: "preprocessing",
            errorCode: "preprocessing_failed",
          });
          const settled = await config.storage.resumeRequestReceipt({
            requestId: receipt.requestId,
            clientId: integration.clientId,
            telegramUpdateId: update.id,
          });
          if (
            settled.contentDeleted
            || settled.status === "completed"
            || settled.status === "cancelled"
          ) {
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
              undefined,
              undefined,
              receipt,
              settled,
            );
          }
        }
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
  resumeSnapshot?: FredRequestResume,
): Promise<ProcessedUpdateResult> {
  const { rpc, storage } = config;
  const resume = receipt
    ? (resumeSnapshot ?? await storage.resumeRequestReceipt({
        requestId: receipt.requestId,
        clientId: integration.clientId,
        telegramUpdateId: update.id,
      }))
    : undefined;

  if (
    receipt
    && lifecycle.state.cancellationRequested
    && resume
    && !resume.contentDeleted
    && (resume.status === "received" || resume.status === "user_persisted" || resume.status === "generating")
  ) {
    await transitionRequestReceiptUnderLease(config, update, {
      requestId: receipt.requestId,
      status: "cancelled",
      failurePhase: "connecting",
      errorCode: "request_cancelled",
    });
  }
  const initialInterruption = await lifecycleInterruptionResult(config, update, handle, lifecycle);
  if (initialInterruption) return initialInterruption;

  if (resume?.contentDeleted || resume?.status === "cancelled") {
    await cancelUpdate(rpc, handle);
    return { updateId: update.updateId, status: "cancelled" };
  }
  if (resume?.status === "failed") {
    await failUpdate(rpc, {
      rowId: update.id,
      leaseId: update.leaseId,
      lastErrorCode: "REQUEST_TERMINAL",
    });
    return { updateId: update.updateId, status: "failed", error: "request already failed" };
  }
  if (resume?.status === "completed") {
    if (!resume.answer) {
      throw new Error("Completed Fred request has no persisted answer");
    }
    const deliveryInterruption = await deliverAnswer(
      config,
      botApi,
      update,
      handle,
      lifecycle,
      chatId,
      resume.answer,
    );
    if (deliveryInterruption) return deliveryInterruption;
    await completeUpdate(rpc, handle);
    return { updateId: update.updateId, status: "completed" };
  }

  const conversationId = receipt
    ? resume?.conversationId
    : (await storage.getActiveConversation(integration.id, chatId)) ?? undefined;
  let failurePhase: FredRequestFailurePhase = "connecting";
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
    webSearchEnabled: resume?.webSearchEnabled ?? integration.webSearchEnabled,
    proModeEnabled: resume?.proModeEnabled ?? integration.proModeEnabled,
    userEventId: receipt?.userEventId ?? deriveEventId(`${integration.id}:${update.updateId}:user`),
    assistantEventId: receipt?.assistantEventId ?? deriveEventId(`${integration.id}:${update.updateId}:assistant`),
    ...(receipt ? {
      onRequestTransition: async (transition: import("../fred/turn-types").FredRequestLifecycleTransition) => {
        await storage.transitionRequestReceipt({
          requestId: receipt.requestId,
          ...transition,
        });
        if (transition.status === "generating") failurePhase = "streaming";
      },
    } : {}),
    deferUnsuccessfulTerminalTransition: receipt !== undefined,
    onConversationEvent: async (conversation) => {
      await storage.markTelegramOrigin(integration.clientId, conversation.id, integration.id);
      await storage.bindConversation(integration.id, chatId, conversation.id);
    },
    signal: lifecycle.controller.signal,
  };

  let finalResult: FredTurnResult | undefined;
  let turnError: unknown;
  let streamedError: Error | undefined;
  const watchdog = createGenerationWatchdog({
    timeoutMs: config.generationTimeoutMs,
    idleTimeoutMs: config.generationIdleTimeoutMs,
    onTimeout: (error) => {
      lifecycle.state.generationError = error;
      lifecycle.controller.abort(error);
    },
    onUnresponsive: config.onUnresponsiveGeneration,
  });
  try {
    const gen = executeTurn(request, config.turnUpstream, config.turnPersistence, config.turnConfig);
    while (true) {
      const { value, done } = await gen.next();
      if (done) {
        finalResult = value;
        break;
      }
      const event = value as FredTurnEvent;
      watchdog.observe(event);
      if (event.type === "error") streamedError = new Error(event.error);
    }
    if (streamedError) throw streamedError;
  } catch (error) {
    turnError = error;
  } finally {
    watchdog.dispose();
  }

  if (lifecycle.state.cancellationRequested && receipt) {
    await transitionRequestReceiptUnderLease(config, update, {
      requestId: receipt.requestId,
      status: "cancelled",
      failurePhase,
      errorCode: "request_cancelled",
    });
  }
  const interruption = await lifecycleInterruptionResult(config, update, handle, lifecycle);
  if (interruption) return interruption;
  if (turnError) {
    if (receipt && update.attemptCount >= update.maxAttempts) {
      await transitionRequestReceiptUnderLease(config, update, {
        requestId: receipt.requestId,
        status: "failed",
        failurePhase,
        errorCode: "turn_failed",
      });

      const terminalResume = await storage.resumeRequestReceipt({
        requestId: receipt.requestId,
        clientId: integration.clientId,
        telegramUpdateId: update.id,
      });

      if (terminalResume.contentDeleted || terminalResume.status === "cancelled") {
        await cancelUpdate(rpc, handle);
        return { updateId: update.updateId, status: "cancelled" };
      }
      if (terminalResume.status === "completed") {
        if (!terminalResume.answer) {
          throw new Error("Completed Fred request has no persisted answer");
        }
        const deliveryInterruption = await deliverAnswer(
          config,
          botApi,
          update,
          handle,
          lifecycle,
          chatId,
          terminalResume.answer,
        );
        if (deliveryInterruption) return deliveryInterruption;
        await completeUpdate(rpc, handle);
        return { updateId: update.updateId, status: "completed" };
      }
    }
    throw turnError;
  }
  if (!finalResult) throw new Error("Fred turn returned no final result");
  if (finalResult.stopped) {
    if (receipt) {
      await transitionRequestReceiptUnderLease(config, update, {
        requestId: receipt.requestId,
        status: "cancelled",
        failurePhase,
        errorCode: "request_cancelled",
      });
    }
    await cancelUpdate(rpc, handle);
    return { updateId: update.updateId, status: "cancelled" };
  }

  const deliveryInterruption = await deliverAnswer(
    config,
    botApi,
    update,
    handle,
    lifecycle,
    chatId,
    finalResult.answer,
  );
  if (deliveryInterruption) return deliveryInterruption;
  await completeUpdate(rpc, handle);
  return { updateId: update.updateId, status: "completed" };
}

async function createTelegramRequestReceipt(
  config: WorkerConfig,
  integration: WorkerIntegration,
  update: ClaimedUpdate,
  content: string,
): Promise<FredRequestReceipt> {
  const conversationId = await config.storage.getActiveConversation(
    integration.id,
    update.telegramChatId,
  );
  const receipt = await config.storage.createRequestReceipt({
    requestId: deriveEventId(`${integration.id}:${update.updateId}:request`),
    clientId: integration.clientId,
    telegramUpdateId: update.id,
    updateRowId: update.id,
    leaseId: update.leaseId,
    content,
    userEventId: deriveEventId(`${integration.id}:${update.updateId}:user`),
    assistantEventId: deriveEventId(`${integration.id}:${update.updateId}:assistant`),
    ...(conversationId ? { conversationId } : {}),
    webSearchEnabled: integration.webSearchEnabled,
    proModeEnabled: integration.proModeEnabled,
  });
  if (receipt === false) {
    throw new TelegramUpdateLeaseLostError("create request receipt");
  }
  return receipt;
}

async function requeueForShutdown(
  config: WorkerConfig,
  update: ClaimedUpdate,
): Promise<ProcessedUpdateResult> {
  const retryOutcome = await retryUpdate(config.rpc, {
    rowId: update.id,
    leaseId: update.leaseId,
    retryDelaySeconds: 0,
    lastErrorCode: "WORKER_SHUTDOWN",
  });
  if (retryOutcome === "cancel_requested") {
    return cancelRetryRequested(config, update, "connecting");
  }
  return { updateId: update.updateId, status: "retry", error: "worker shutdown" };
}

async function cancelRetryRequested(
  config: WorkerConfig,
  update: ClaimedUpdate,
  failurePhase: FredRequestFailurePhase,
): Promise<ProcessedUpdateResult> {
  await transitionRequestReceiptUnderLease(config, update, {
    requestId: deriveEventId(`${update.integrationId}:${update.updateId}:request`),
    status: "cancelled",
    failurePhase,
    errorCode: "request_cancelled",
  });
  await cancelUpdate(config.rpc, { rowId: update.id, leaseId: update.leaseId });
  return { updateId: update.updateId, status: "cancelled" };
}

async function deliverAnswer(
  config: WorkerConfig,
  botApi: BotApi,
  update: ClaimedUpdate,
  handle: UpdateHandle,
  lifecycle: TurnLifecycle,
  chatId: number,
  answer: string,
): Promise<ProcessedUpdateResult | undefined> {
  const { storage } = config;
  const chunks = chunkTelegramMessage(normalizeFredMarkdown(answer));
  const richMarkdown = hasGfmTable(answer)
    && answer.length <= RICH_MESSAGE_MAX_LENGTH
    && chunks.length === 1
    ? answer
    : undefined;

  for (let i = 0; i < chunks.length; i++) {
    const content = chunks[i];
    await refreshDeliveryLifecycle(config, handle, lifecycle);
    const preSendInterruption = await lifecycleInterruptionResult(
      config,
      update,
      handle,
      lifecycle,
    );
    if (preSendInterruption) return preSendInterruption;

    const claim = await storage.claimDelivery({
      updateRowId: update.id,
      chunkIndex: i,
      content,
      leaseId: update.leaseId,
    });
    if (claim === "lease_lost") {
      throw new TelegramUpdateLeaseLostError("claim delivery chunk");
    }
    if (claim === "cancelled") {
      lifecycle.state.cancellationRequested = true;
      lifecycle.controller.abort();
      return { updateId: update.updateId, status: "cancelled" };
    }
    if (claim === "uncertain") {
      throw new UncertainDeliveryError();
    }
    if (claim === "sent") continue;

    const ledger: DeliveryLedger = { chunks: [], uncertainChunks: [] };
    try {
      await deliverFinalAnswer(botApi, chatId, content, {
        ledger,
        maxRetries: config.maxDeliveryRetries,
        richMarkdown: i === 0 ? richMarkdown : undefined,
        signal: lifecycle.controller.signal,
      });
    } catch (error) {
      const finished = await storage.finishDelivery({
        updateRowId: update.id,
        chunkIndex: i,
        leaseId: update.leaseId,
        status: "uncertain",
        lastErrorCode: "DELIVERY_INTERRUPTED",
      });
      if (!finished) throw new TelegramUpdateLeaseLostError("finish delivery chunk");
      const interruption = await lifecycleInterruptionResult(
        config,
        update,
        handle,
        lifecycle,
      );
      if (interruption) return interruption;
      throw error;
    }
    const entry = ledger.chunks[0];

    if (entry?.status === "sent" && entry.messageId !== undefined) {
      const finished = await storage.finishDelivery({
        updateRowId: update.id,
        chunkIndex: i,
        leaseId: update.leaseId,
        status: "sent",
        telegramMessageId: entry.messageId,
      });
      if (!finished) throw new TelegramUpdateLeaseLostError("finish delivery chunk");
    } else if (entry?.status === "uncertain") {
      // Ambiguous outcome (e.g. network error after the request was sent):
      // record it but never blindly resend on a later retry.
      const finished = await storage.finishDelivery({
        updateRowId: update.id,
        chunkIndex: i,
        leaseId: update.leaseId,
        status: "uncertain",
        lastErrorCode: "DELIVERY_UNCERTAIN",
      });
      if (!finished) throw new TelegramUpdateLeaseLostError("finish delivery chunk");
    } else {
      const finished = await storage.finishDelivery({
        updateRowId: update.id,
        chunkIndex: i,
        leaseId: update.leaseId,
        status: "failed",
        lastErrorCode: sanitizeErrorCode(entry?.error ?? "DELIVERY_FAILED"),
      });
      if (!finished) throw new TelegramUpdateLeaseLostError("finish delivery chunk");
    }

    const postSendInterruption = await lifecycleInterruptionResult(
      config,
      update,
      handle,
      lifecycle,
    );
    if (postSendInterruption) return postSendInterruption;
    if (entry?.status === "uncertain") throw new UncertainDeliveryError();
    if (entry?.status !== "sent") {
      throw new Error(`Telegram-Zustellung fehlgeschlagen: ${entry?.error ?? "unbekannter Fehler"}`);
    }
  }

  return undefined;
}

async function refreshDeliveryLifecycle(
  config: WorkerConfig,
  handle: UpdateHandle,
  lifecycle: TurnLifecycle,
): Promise<void> {
  if (
    lifecycle.state.cancellationRequested
    || lifecycle.state.shutdownRequested
    || lifecycle.state.controlPlaneError
  ) {
    return;
  }

  try {
    const leaseOk = await heartbeatUpdate(config.rpc, handle);
    if (!leaseOk) {
      lifecycle.state.controlPlaneError = new TelegramUpdateLeaseLostError("delivery heartbeat");
      lifecycle.controller.abort();
      return;
    }
    if (await checkUpdateCancelled(config.rpc, handle)) {
      lifecycle.state.cancellationRequested = true;
      lifecycle.controller.abort();
    }
  } catch (error) {
    lifecycle.state.controlPlaneError = error;
    lifecycle.controller.abort();
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

  if (update.attemptCount < update.maxAttempts) {
    const retryOutcome = await retryUpdate(rpc, {
      rowId: update.id,
      leaseId: update.leaseId,
      retryDelaySeconds: Math.min(60 * 2 ** update.attemptCount, 600),
      lastErrorCode: errorCode,
    });
    if (retryOutcome === "cancel_requested") {
      return cancelRetryRequested(config, update, "connecting");
    }
    return { updateId: update.updateId, status: "failed", error: message };
  }

  const terminalOutcome = await transitionRequestReceiptUnderLease(config, update, {
    requestId: deriveEventId(`${update.integrationId}:${update.updateId}:request`),
    status: "failed",
    failurePhase: "connecting",
    errorCode,
  });
  if (terminalOutcome.receiptPresent) {
    if (terminalOutcome.contentDeleted || terminalOutcome.status === "cancelled") {
      await cancelUpdate(rpc, { rowId: update.id, leaseId: update.leaseId });
      return { updateId: update.updateId, status: "cancelled" };
    }
    if (terminalOutcome.status === "completed") {
      if (!terminalOutcome.answer) {
        throw new Error("Completed Fred request has no persisted answer");
      }
      const persistedAnswer = terminalOutcome.answer;
      try {
        return await runWithTurnLifecycle(
          config,
          botApi,
          { rowId: update.id, leaseId: update.leaseId },
          chatId,
          undefined,
          true,
          async (lifecycle) => {
            const interruption = await deliverAnswer(
              config,
              botApi,
              update,
              { rowId: update.id, leaseId: update.leaseId },
              lifecycle,
              chatId,
              persistedAnswer,
            );
            if (interruption) return interruption;
            await completeUpdate(rpc, { rowId: update.id, leaseId: update.leaseId });
            return { updateId: update.updateId, status: "completed" };
          },
        );
      } catch (deliveryError) {
        if (deliveryError instanceof TelegramUpdateLeaseLostError) throw deliveryError;
        const uncertain = deliveryError instanceof UncertainDeliveryError;
        await failUpdate(rpc, {
          rowId: update.id,
          leaseId: update.leaseId,
          lastErrorCode: uncertain ? "DELIVERY_UNCERTAIN" : "DELIVERY_FAILED",
        });
        return {
          updateId: update.updateId,
          status: "failed",
          error: errorMessage(deliveryError),
        };
      }
    }
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
