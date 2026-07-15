import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { UserVisibleError } from "./errors";

const ENV_NAME = "OPENAI_COMPATIBLE_CREDENTIALS_KEY";
const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function credentialsError(): UserVisibleError {
  return new UserVisibleError(
    "OpenAI-kompatible Zugangsdaten sind serverseitig nicht verfügbar.",
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

export function encryptOpenAICompatibleApiKey(apiKey: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptOpenAICompatibleApiKey(ciphertext: string): string {
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
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch (error) {
    if (error instanceof UserVisibleError) {
      throw error;
    }
    throw credentialsError();
  }
}
