import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { UserVisibleError } from "../errors";
import type { FindogAgentSecretPatch } from "./types";

/**
 * Dedicated runtime key for Findog Agent secrets. It is expected to exist only in
 * server runtime configuration and in tests; the repository never creates it.
 */
export const FINDOG_AGENT_CREDENTIALS_ENV = "FINDOG_AGENT_CREDENTIALS_KEY";

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_SECRET_CHARACTERS = 8000;

function credentialsUnavailable(): UserVisibleError {
  return new UserVisibleError(
    "Die Findog-Agent-Zugangsdaten sind serverseitig nicht verfügbar.",
    503,
  );
}

/**
 * The single validation boundary for the dedicated 32-byte base64 runtime key.
 *
 * The worker entrypoint and the encryption helpers share it, so a startup check
 * can never accept a key the runtime would reject (or vice versa). The value is
 * only ever decoded in memory; it is never logged or returned.
 */
export function parseFindogAgentCredentialsKey(encoded: string | null | undefined): Buffer {
  const value = typeof encoded === "string" ? encoded.trim() : "";
  const key = Buffer.from(value, "base64");
  const normalized = (input: string) => input.replace(/=+$/, "");
  if (!value || key.length !== 32 || normalized(key.toString("base64")) !== normalized(value)) {
    throw credentialsUnavailable();
  }
  return key;
}

function encryptionKey(): Buffer {
  return parseFindogAgentCredentialsKey(process.env[FINDOG_AGENT_CREDENTIALS_ENV]);
}

export function encryptFindogAgentSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptFindogAgentSecret(ciphertext: string): string {
  try {
    const [version, ivValue, tagValue, encryptedValue, extra] = ciphertext.split(".");
    if (version !== VERSION || !ivValue || !tagValue || !encryptedValue || extra !== undefined) {
      throw credentialsUnavailable();
    }

    const iv = Buffer.from(ivValue, "base64url");
    const tag = Buffer.from(tagValue, "base64url");
    const encrypted = Buffer.from(encryptedValue, "base64url");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || encrypted.length === 0) {
      throw credentialsUnavailable();
    }

    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch (error) {
    if (error instanceof UserVisibleError) {
      throw error;
    }
    throw credentialsUnavailable();
  }
}

/** Server-only helper for the worker. Never call this from a route handler. */
export function decryptFindogAgentSecretMap(
  encrypted: Record<string, string> | null | undefined,
): Record<string, string> {
  const decrypted: Record<string, string> = {};
  for (const [name, ciphertext] of Object.entries(encrypted ?? {})) {
    if (typeof ciphertext !== "string") {
      throw credentialsUnavailable();
    }
    decrypted[name] = decryptFindogAgentSecret(ciphertext);
  }
  return decrypted;
}

/**
 * Applies a secret patch to an existing ciphertext map.
 *
 * - omitted key: the stored ciphertext is preserved untouched (no decryption needed)
 * - explicit `null`: the secret is removed
 * - non-empty string: the value is validated, encrypted and stored
 * - blank string: rejected, so a stray empty form field can never wipe a secret
 */
export function applyFindogAgentSecretPatch(
  existing: Record<string, string>,
  allowedNames: readonly string[],
  patch: FindogAgentSecretPatch,
): Record<string, string> {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new UserVisibleError("Die Zugangsdaten-Angabe ist ungültig.", 400);
  }

  const allowed = new Set(allowedNames);
  const next: Record<string, string> = { ...existing };

  for (const [name, value] of Object.entries(patch)) {
    if (!allowed.has(name)) {
      throw new UserVisibleError("Diese Zugangsdaten-Angabe ist unbekannt.", 400);
    }

    if (value === undefined) {
      continue;
    }

    if (value === null) {
      delete next[name];
      continue;
    }

    if (typeof value !== "string") {
      throw new UserVisibleError("Die Zugangsdaten-Angabe ist ungültig.", 400);
    }

    const trimmed = value.trim();
    if (!trimmed) {
      throw new UserVisibleError("Ein Zugangsdaten-Wert darf nicht leer sein.", 400);
    }
    if (trimmed.length > MAX_SECRET_CHARACTERS) {
      throw new UserVisibleError("Ein Zugangsdaten-Wert ist zu lang.", 400);
    }

    next[name] = encryptFindogAgentSecret(trimmed);
  }

  return next;
}
