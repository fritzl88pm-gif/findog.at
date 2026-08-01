import { randomUUID } from "node:crypto";

import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";

import type { BotApi } from "./bot-api";
import { createBotApi, sanitizeTelegramError } from "./bot-api";
import type { EncryptionAad } from "./credentials";
import { decryptTelegramToken, encryptTelegramToken } from "./credentials";
import { generatePairingToken, generateWebhookSecret, hashToken } from "./pairing";
import type { TelegramBotCommand, TelegramBotInfo } from "./types";

const PAIRING_EXPIRY_MINUTES = 10;

export interface GetTelegramIntegrationResult {
  id: string;
  status: string;
  botUsername: string | null;
  pairingExpiresAt: string | null;
  hasActivePairing: boolean;
  hasPairedChat: boolean;
  lastErrorCode: number | null;
  lastErrorDescription: string | null;
  lastErrorAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterTelegramIntegrationResult {
  status: string;
  deepLink?: string;
  pairingExpiresAt?: string;
  conflict?: string;
}

export interface RotatePairingTokenResult {
  deepLink: string;
  pairingExpiresAt: string;
}

export interface DeleteTelegramIntegrationResult {
  deleted: boolean;
  error?: string;
}

function requireSupabase() {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    throw new UserVisibleError("Datenbankzugang ist derzeit nicht verfügbar.", 503);
  }
  return supabase;
}

function requireEncryptionKeyEnv(): string {
  const key = process.env.TELEGRAM_CREDENTIALS_KEY?.trim();
  if (!key) {
    throw new UserVisibleError("Telegram-Verschlüsselung ist nicht konfiguriert.", 503);
  }
  return key;
}

function requirePublicOrigin(): string {
  const origin = process.env.TELEGRAM_PUBLIC_ORIGIN?.trim();
  if (!origin) {
    throw new UserVisibleError("Telegram-öffentliche Adresse ist nicht konfiguriert.", 503);
  }
  return origin.replace(/\/+$/, "");
}

function buildAad(integrationId: string, clientId: string, botUserId: number): EncryptionAad {
  return { integrationId, clientId, botUserId };
}

function buildPairingDeepLink(botUsername: string, pairingToken: string): string {
  return `https://t.me/${botUsername}?start=${pairingToken}`;
}

function selectIntegrationRow(supabase: ReturnType<typeof requireSupabase>, clientId: string) {
  return supabase
    .from("telegram_integrations")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();
}

function mapToPublicResult(row: Record<string, unknown>): GetTelegramIntegrationResult {
  const now = new Date();
  const pairingExpiresAt = row.pairing_expires_at
    ? new Date(row.pairing_expires_at as string)
    : null;
  const hasActivePairing = pairingExpiresAt !== null && pairingExpiresAt > now;

  return {
    id: row.id as string,
    status: row.status as string,
    botUsername: (row.bot_username as string) ?? null,
    pairingExpiresAt: pairingExpiresAt?.toISOString() ?? null,
    hasActivePairing,
    hasPairedChat: row.paired_telegram_user_id !== null,
    lastErrorCode: (row.last_error_code as number) ?? null,
    lastErrorDescription: (row.last_error_description as string) ?? null,
    lastErrorAt: (row.last_error_at as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

const TELEGRAM_BOT_COMMANDS: TelegramBotCommand[] = [
  { command: "start", description: "Bot starten und verknüpfen" },
  { command: "new", description: "Neue Unterhaltung beginnen" },
  { command: "stop", description: "Aktuelle Unterhaltung beenden" },
  { command: "status", description: "Status der Verbindung anzeigen" },
  { command: "help", description: "Hilfe und Verfügbare Befehle" },
  { command: "settings", description: "Einstellungen anzeigen" },
  { command: "pro", description: "Pro-Modus einstellen" },
  { command: "web", description: "Websuche einstellen" },
];

export async function getTelegramIntegration(
  clientId: string,
): Promise<GetTelegramIntegrationResult | null> {
  requireEncryptionKeyEnv();
  const supabase = requireSupabase();
  const { data, error } = await selectIntegrationRow(supabase, clientId);

  if (error) {
    throw new UserVisibleError("Telegram-Integration konnte nicht geladen werden.", 500);
  }
  if (!data) {
    return null;
  }

  return mapToPublicResult(data);
}

export async function registerTelegramIntegration(
  clientId: string,
  token: string,
  botApi?: BotApi,
  options?: { replaceExistingWebhook?: boolean },
): Promise<RegisterTelegramIntegrationResult> {
  requireEncryptionKeyEnv();
  const publicOrigin = requirePublicOrigin();
  const supabase = requireSupabase();
  const api = botApi ?? createBotApi(token);

  // Validate token through getMe
  let botInfo: TelegramBotInfo;
  try {
    botInfo = await api.getMe();
  } catch (err) {
    const sanitized = sanitizeTelegramError(token, err);
    throw new UserVisibleError(
      `Telegram-Bot-Token ist ungültig: ${sanitized.message}`,
      422,
    );
  }

  const botUsername = botInfo.username;
  if (!botUsername) {
    throw new UserVisibleError("Der Telegram-Bot hat keinen Benutzernamen.", 422);
  }

  // Check for existing integration for this client
  const { data: existingByClient } = await selectIntegrationRow(supabase, clientId);
  if (existingByClient) {
    throw new UserVisibleError(
      "Du hast bereits eine Telegram-Integration. Bitte entferne sie zuerst.",
      409,
    );
  }

  // Check that this bot is not already registered by another user
  const { data: existingByBot } = await supabase
    .from("telegram_integrations")
    .select("id, client_id")
    .eq("bot_user_id", botInfo.id)
    .maybeSingle();

  if (existingByBot) {
    throw new UserVisibleError(
      "Dieser Telegram-Bot ist bereits von einem anderen Benutzer registriert.",
      409,
    );
  }

  // Check webhook info for conflicts
  try {
    const webhookInfo = await api.getWebhookInfo();
    if (webhookInfo.url && webhookInfo.url.length > 0) {
      const expectedPrefix = `${publicOrigin}/api/webhooks/telegram/`;
      if (!webhookInfo.url.startsWith(expectedPrefix) && !options?.replaceExistingWebhook) {
        return {
          status: "awaiting_pairing",
          conflict: "foreign_webhook",
        };
      }
    }
  } catch (err) {
    const sanitized = sanitizeTelegramError(token, err);
    throw new UserVisibleError(
      `Webhook-Status konnte nicht geprüft werden: ${sanitized.message}`,
      502,
    );
  }

  // Generate secrets
  const integrationId = randomUUID();
  const webhookId = randomUUID();
  const webhookSecret = generateWebhookSecret();
  const pairingToken = generatePairingToken();
  const pairingExpiresAt = new Date(Date.now() + PAIRING_EXPIRY_MINUTES * 60 * 1000).toISOString();

  const aad = buildAad(integrationId, clientId, botInfo.id);
  const encryptedToken = encryptTelegramToken(token, aad);
  const webhookSecretHash = hashToken(webhookSecret);
  const pairingTokenHash = hashToken(pairingToken);

  const webhookUrl = `${publicOrigin}/api/webhooks/telegram/${webhookId}`;
  const commands = TELEGRAM_BOT_COMMANDS;

  // Persist integration first so the row exists before any external Telegram side effect
  const { error: insertError } = await supabase
    .from("telegram_integrations")
    .insert({
      id: integrationId,
      client_id: clientId,
      bot_user_id: botInfo.id,
      bot_username: botUsername,
      encrypted_token: encryptedToken,
      webhook_id: webhookId,
      webhook_secret_sha256: webhookSecretHash,
      pairing_token_sha256: pairingTokenHash,
      pairing_expires_at: pairingExpiresAt,
      status: "awaiting_pairing",
    });

  if (insertError) {
    // DB uniqueness conflicts happen before external side effects
    if (insertError.code === "23505") {
      throw new UserVisibleError("Telegram-Bot ist bereits registriert.", 409);
    }
    throw new UserVisibleError("Telegram-Integration konnte nicht gespeichert werden.", 500);
  }

  // Set commands first, then webhook last (webhook is the riskiest external effect)
  try {
    await api.setMyCommands(commands);
    await api.setWebhook({
      url: webhookUrl,
      secret_token: webhookSecret,
      allowed_updates: ["message", "my_chat_member"],
      drop_pending_updates: true,
      max_connections: 10,
    });
  } catch (err) {
    const sanitized = sanitizeTelegramError(token, err);
    // Preserve the integration row as 'error' so disconnect/retry can clean it up
    // Best-effort cleanup: try to remove commands and webhook
    try { await api.deleteWebhook(true); } catch { /* best effort */ }
    try { await api.deleteMyCommands(); } catch { /* best effort */ }

    await supabase
      .from("telegram_integrations")
      .update({
        status: "error",
        last_error_code: sanitized.error_code,
        last_error_description: sanitized.description ?? sanitized.message,
        last_error_retry_after: sanitized.retry_after,
        last_error_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", integrationId);

    throw new UserVisibleError(
      `Telegram-Registrierung fehlgeschlagen: ${sanitized.message}`,
      502,
    );
  }

  return {
    status: "awaiting_pairing",
    deepLink: buildPairingDeepLink(botUsername, pairingToken),
    pairingExpiresAt,
  };
}


export interface ReplaceTelegramBotResult {
  status: string;
  deepLink?: string;
  pairingExpiresAt?: string;
  conflict?: string;
}

export async function replaceTelegramBot(
  clientId: string,
  token: string,
  botApi?: BotApi,
  options?: { replaceExistingWebhook?: boolean; oldBotApi?: BotApi },
): Promise<ReplaceTelegramBotResult> {
  requireEncryptionKeyEnv();
  const publicOrigin = requirePublicOrigin();
  const supabase = requireSupabase();
  const api = botApi ?? createBotApi(token);

  // 1. Look up existing integration
  const { data: integration, error: fetchError } = await selectIntegrationRow(supabase, clientId);
  if (fetchError || !integration) {
    throw new UserVisibleError("Keine bestehende Telegram-Integration gefunden.", 404);
  }

  const integrationId = integration.id as string;
  const oldBotUserId = integration.bot_user_id as number;
  const oldEncryptedToken = integration.encrypted_token as string;

  // 2. Validate new token through getMe
  let newBotInfo: TelegramBotInfo;
  try {
    newBotInfo = await api.getMe();
  } catch (err) {
    const sanitized = sanitizeTelegramError(token, err);
    throw new UserVisibleError(
      `Neues Telegram-Bot-Token ist ungültig: ${sanitized.message}`,
      422,
    );
  }

  const newBotUsername = newBotInfo.username;
  if (!newBotUsername) {
    throw new UserVisibleError("Der neue Telegram-Bot hat keinen Benutzernamen.", 422);
  }
  const isSameBot = oldBotUserId === newBotInfo.id;

  // 3. Reject bot ownership collision (another user already owns this bot)
  const { data: existingByBot } = await supabase
    .from("telegram_integrations")
    .select("id, client_id")
    .eq("bot_user_id", newBotInfo.id)
    .neq("client_id", clientId)
    .maybeSingle();

  if (existingByBot) {
    throw new UserVisibleError(
      "Dieser Telegram-Bot ist bereits von einem anderen Benutzer registriert.",
      409,
    );
  }

  // 4. Check webhook info for foreign-webhook conflict
  try {
    const webhookInfo = await api.getWebhookInfo();
    if (webhookInfo.url && webhookInfo.url.length > 0) {
      const expectedPrefix = `${publicOrigin}/api/webhooks/telegram/`;
      if (!webhookInfo.url.startsWith(expectedPrefix) && !options?.replaceExistingWebhook) {
        return {
          status: "awaiting_pairing",
          conflict: "foreign_webhook",
        };
      }
    }
  } catch (err) {
    const sanitized = sanitizeTelegramError(token, err);
    throw new UserVisibleError(
      `Webhook-Status konnte nicht geprüft werden: ${sanitized.message}`,
      502,
    );
  }

  // 5. Decrypt old token (never returned or logged, used only for API cleanup)
  let oldToken: string;
  try {
    const oldAad = buildAad(integrationId, clientId, oldBotUserId);
    oldToken = decryptTelegramToken(oldEncryptedToken, oldAad);
  } catch {
    throw new UserVisibleError(
      "Alte Telegram-Zugangsdaten können nicht entschlüsselt werden. Bitte entferne die Integration zuerst manuell.",
      503,
    );
  }

  // 6. Generate new credentials
  const newWebhookId = isSameBot
    ? integration.webhook_id as string
    : randomUUID();
  const newWebhookSecret = isSameBot ? null : generateWebhookSecret();
  const newPairingToken = generatePairingToken();
  const newPairingExpiresAt = new Date(Date.now() + PAIRING_EXPIRY_MINUTES * 60 * 1000).toISOString();

  const newAad = buildAad(integrationId, clientId, newBotInfo.id);
  const newEncryptedToken = encryptTelegramToken(token, newAad);
  const newWebhookSecretHash = isSameBot
    ? integration.webhook_secret_sha256 as string
    : hashToken(newWebhookSecret as string);
  const newPairingTokenHash = hashToken(newPairingToken);

  const newWebhookUrl = `${publicOrigin}/api/webhooks/telegram/${newWebhookId}`;
  const commands = TELEGRAM_BOT_COMMANDS;

  // 7. Configure commands and webhook on the NEW bot FIRST
  try {
    await api.setMyCommands(commands);
    if (!isSameBot) {
      await api.setWebhook({
        url: newWebhookUrl,
        secret_token: newWebhookSecret as string,
        allowed_updates: ["message", "my_chat_member"],
        drop_pending_updates: true,
        max_connections: 10,
      });
    }
  } catch (err) {
    const sanitized = sanitizeTelegramError(token, err);
    // Best-effort cleanup of new bot's side effects
    if (!isSameBot) {
      try { await api.deleteWebhook(true); } catch { /* best effort */ }
      try { await api.deleteMyCommands(); } catch { /* best effort */ }
    }
    throw new UserVisibleError(
      `Telegram-Bot-Wechsel fehlgeschlagen: ${sanitized.message}`,
      502,
    );
  }

  // 8. Atomic DB switch via SECURITY DEFINER RPC
  const { data: rpcSwitched, error: rpcError } = await supabase.rpc("swap_telegram_bot", {
    p_integration_id: integrationId,
    p_client_id: clientId,
    p_old_bot_user_id: oldBotUserId,
    p_new_bot_user_id: newBotInfo.id,
    p_new_bot_username: newBotUsername,
    p_new_encrypted_token: newEncryptedToken,
    p_new_webhook_id: newWebhookId,
    p_new_webhook_secret_sha256: newWebhookSecretHash,
    p_new_pairing_token_sha256: newPairingTokenHash,
    p_new_pairing_expires_at: newPairingExpiresAt,
  });

  if (rpcError || !rpcSwitched) {
    // 9. RPC switch failed — roll back new bot's external state, preserve old DB row
    if (!isSameBot) {
      const newCleanupApi = botApi ?? createBotApi(token);
      try { await newCleanupApi.deleteWebhook(true); } catch { /* best effort */ }
      try { await newCleanupApi.deleteMyCommands(); } catch { /* best effort */ }
    }
    throw new UserVisibleError(
      "Datenbank-Aktualisierung fehlgeschlagen. Der bisherige Bot ist weiterhin aktiv.",
      500,
    );
  }

  // 10. After successful switch, remove OLD bot webhook and commands
  if (!isSameBot) {
    const oldCleanupApi = options?.oldBotApi ?? createBotApi(oldToken);
    try {
      await oldCleanupApi.deleteWebhook(true);
    } catch {
      // Non-authoritative cleanup debt — new integration is already active.
      // Record a bounded warning but do not change status to error.
      try { await supabase.rpc("record_telegram_integration_warning", {
        p_integration_id: integrationId,
        p_warning: `Old bot webhook cleanup failed (bot ${oldBotUserId}). New integration is active.`,
      }); } catch { /* best effort */ }
    }
    try {
      await oldCleanupApi.deleteMyCommands();
    } catch {
      try { await supabase.rpc("record_telegram_integration_warning", {
        p_integration_id: integrationId,
        p_warning: `Old bot commands cleanup failed (bot ${oldBotUserId}).`,
      }); } catch { /* best effort */ }
    }
  }

  return {
    status: "awaiting_pairing",
    deepLink: buildPairingDeepLink(newBotUsername, newPairingToken),
    pairingExpiresAt: newPairingExpiresAt,
  };
}
export async function rotatePairingToken(
  clientId: string,
): Promise<RotatePairingTokenResult> {
  requireEncryptionKeyEnv();
  const supabase = requireSupabase();

  const { data: integration, error } = await selectIntegrationRow(supabase, clientId);

  if (error || !integration) {
    throw new UserVisibleError("Keine Telegram-Integration gefunden.", 404);
  }

  const status = integration.status as string;

  if (status === "active") {
    throw new UserVisibleError("Pairing ist bereits abgeschlossen.", 409);
  }

  if (status !== "awaiting_pairing") {
    throw new UserVisibleError(
      `Pairing kann im Status "${status}" nicht durchgeführt werden.`,
      409,
    );
  }

  const pairingToken = generatePairingToken();
  const pairingTokenHash = hashToken(pairingToken);
  const pairingExpiresAt = new Date(Date.now() + PAIRING_EXPIRY_MINUTES * 60 * 1000).toISOString();

  const { error: updateError } = await supabase
    .from("telegram_integrations")
    .update({
      pairing_token_sha256: pairingTokenHash,
      pairing_expires_at: pairingExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", integration.id);

  if (updateError) {
    throw new UserVisibleError("Pairing-Token konnte nicht aktualisiert werden.", 500);
  }

  const botUsername = integration.bot_username as string;

  return {
    deepLink: buildPairingDeepLink(botUsername, pairingToken),
    pairingExpiresAt,
  };
}

export async function deleteTelegramIntegration(
  clientId: string,
  botApi?: BotApi,
): Promise<DeleteTelegramIntegrationResult> {
  const supabase = requireSupabase();

  const { data: integration, error } = await selectIntegrationRow(supabase, clientId);

  if (error || !integration) {
    throw new UserVisibleError("Keine Telegram-Integration gefunden.", 404);
  }
  requireEncryptionKeyEnv();

  const integrationId = integration.id as string;
  const encryptedToken = integration.encrypted_token as string;

  // Mark disconnecting
  const { error: markError } = await supabase
    .from("telegram_integrations")
    .update({ status: "disconnecting", updated_at: new Date().toISOString() })
    .eq("id", integrationId);
  if (markError) {
    return { deleted: false, error: "Telegram-Integration konnte nicht getrennt werden." };
  }

  // Cancel all pending/processing/retry jobs
  const { error: cancelError } = await supabase.rpc("cancel_all_telegram_updates_for_integration", {
    p_integration_id: integrationId,
  });
  if (cancelError) {
    await supabase
      .from("telegram_integrations")
      .update({
        status: "error",
        last_error_description: "Telegram-Aufträge konnten nicht abgebrochen werden.",
        last_error_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", integrationId);
    return { deleted: false, error: "Telegram-Integration konnte nicht getrennt werden." };
  }

  // Try to decrypt token for API calls
  let token: string;
  try {
    const aad = buildAad(
      integrationId,
      clientId,
      integration.bot_user_id as number,
    );
    token = decryptTelegramToken(encryptedToken, aad);
  } catch {
    // Can't decrypt — preserve encrypted row so live webhook is not orphaned
    await supabase
      .from("telegram_integrations")
      .update({
        status: "error",
        last_error_code: 400,
        last_error_description: "Credentials key unavailable — cannot disconnect webhook",
        last_error_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", integrationId);

    return {
      deleted: false,
      error: "Verschlüsselung fehlgeschlagen – Integration kann nicht automatisch getrennt werden.",
    };
  }

  const api = botApi ?? createBotApi(token);

  // Call Telegram to clean up
  try {
    await api.deleteWebhook(true);
  } catch (err) {
    const sanitized = sanitizeTelegramError(token, err);
    // Preserve the integration, update error state
    await supabase
      .from("telegram_integrations")
      .update({
        status: "error",
        last_error_code: sanitized.error_code,
        last_error_description: sanitized.description ?? sanitized.message,
        last_error_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", integrationId);

    return {
      deleted: false,
      error: `Telegram konnte nicht erreicht werden: ${sanitized.message}`,
    };
  }

  try {
    await api.deleteMyCommands();
  } catch (err) {
    const sanitized = sanitizeTelegramError(token, err);
    await supabase
      .from("telegram_integrations")
      .update({
        status: "error",
        last_error_code: sanitized.error_code,
        last_error_description: (sanitized.description ?? sanitized.message).slice(0, 500),
        last_error_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", integrationId);
    return { deleted: false, error: "Telegram-Befehle konnten nicht entfernt werden." };
  }

  // Delete the integration
  const { error: deleteError } = await supabase
    .from("telegram_integrations")
    .delete()
    .eq("id", integrationId);
  if (deleteError) {
    return { deleted: false, error: "Telegram-Integration konnte nicht entfernt werden." };
  }

  return { deleted: true };
}
