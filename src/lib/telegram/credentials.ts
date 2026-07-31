
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { UserVisibleError } from "@/lib/errors";

const ENV_NAME = "TELEGRAM_CREDENTIALS_KEY";
const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface EncryptionAad {
  integrationId: string;
  clientId: string;
  botUserId: number;
}

function credentialsError(): UserVisibleError {
  return new UserVisibleError(
    "Telegram-Zugangsdaten sind serverseitig nicht verfügbar.",
    503,
  );
}

function encryptionKey(): Buffer {
  const encoded = process.env[ENV_NAME]?.trim();
  if (!encoded) {
    throw credentialsError();
  }

  let key: Buffer;
  try {
    key = Buffer.from(encoded, "base64");
  } catch {
    throw credentialsError();
  }
  if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) {
    throw credentialsError();
  }
  return key;
}

function buildAad(aad: EncryptionAad): Buffer {
  return Buffer.from(
    `telegram:${aad.integrationId}:${aad.clientId}:${aad.botUserId}`,
    "utf8",
  );
}

export function encryptTelegramToken(token: string, aad: EncryptionAad): string {
  if (!token || token.length === 0) {
    throw credentialsError();
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(buildAad(aad));
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptTelegramToken(ciphertext: string, aad: EncryptionAad): string {
  try {
    const [version, ivValue, tagValue, encryptedValue, extra] = ciphertext.split(".");
    if (version !== VERSION || !ivValue || !tagValue || !encryptedValue || extra !== undefined) {
      throw credentialsError();
    }
    const iv = Buffer.from(ivValue, "base64url");
    const tag = Buffer.from(tagValue, "base64url");
    const encrypted = Buffer.from(encryptedValue, "base64url");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || encrypted.length === 0) {
      throw credentialsError();
    }
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAAD(buildAad(aad));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch (error) {
    if (error instanceof UserVisibleError) {
      throw error;
    }
    throw credentialsError();
  }
}
