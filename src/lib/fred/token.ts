import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const FRED_TOKEN_VERSION = 1;
export const FRED_TOKEN_TTL_MS = 30 * 60 * 1000;
export const FRED_MAX_QUERY_LENGTH = 4000;

const TOKEN_PREFIX = "fred_";
const ENCRYPTION_CONTEXT = "findog:fred:session-token:encryption:v1";
const SIGNING_CONTEXT = "findog:fred:session-token:signing:v1";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export type FredSessionTokenPayload = {
  version: number;
  userId: string;
  weknoraSessionId: string;
  expiresAt: number;
};

type EncodedPayload = {
  v: number;
  u: string;
  s: string;
  e: number;
};

function deriveKey(apiKey: string, context: string): Buffer {
  return createHash("sha256")
    .update(context, "utf8")
    .update("\0", "utf8")
    .update(apiKey, "utf8")
    .digest();
}

function signPayload(apiKey: string, encryptedPayload: string): Buffer {
  return createHmac("sha256", deriveKey(apiKey, SIGNING_CONTEXT))
    .update(encryptedPayload, "utf8")
    .digest();
}

function encryptPayload(apiKey: string, payload: EncodedPayload): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(
    "aes-256-gcm",
    deriveKey(apiKey, ENCRYPTION_CONTEXT),
    iv,
  );
  cipher.setAAD(Buffer.from(ENCRYPTION_CONTEXT, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, ciphertext]).toString("base64url");
}

function decryptPayload(apiKey: string, encryptedPayload: string): EncodedPayload | null {
  try {
    const packed = Buffer.from(encryptedPayload, "base64url");
    if (packed.length <= IV_BYTES + AUTH_TAG_BYTES) {
      return null;
    }

    const iv = packed.subarray(0, IV_BYTES);
    const authTag = packed.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
    const ciphertext = packed.subarray(IV_BYTES + AUTH_TAG_BYTES);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveKey(apiKey, ENCRYPTION_CONTEXT),
      iv,
    );
    decipher.setAAD(Buffer.from(ENCRYPTION_CONTEXT, "utf8"));
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
    const parsed = JSON.parse(plaintext) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as EncodedPayload;
  } catch {
    return null;
  }
}

export function createFredSessionToken(options: {
  apiKey: string;
  userId: string;
  weknoraSessionId: string;
  now?: number;
}): string {
  const now = options.now ?? Date.now();
  const encryptedPayload = encryptPayload(options.apiKey, {
    v: FRED_TOKEN_VERSION,
    u: options.userId,
    s: options.weknoraSessionId,
    e: now + FRED_TOKEN_TTL_MS,
  });
  const signature = signPayload(options.apiKey, encryptedPayload).toString("base64url");

  return `${TOKEN_PREFIX}${encryptedPayload}.${signature}`;
}

export function parseFredSessionToken(options: {
  apiKey: string;
  token: string;
  expectedUserId: string;
  now?: number;
}): FredSessionTokenPayload | null {
  try {
    if (!options.token.startsWith(TOKEN_PREFIX)) {
      return null;
    }

    const tokenBody = options.token.slice(TOKEN_PREFIX.length);
    const separatorIndex = tokenBody.lastIndexOf(".");
    if (separatorIndex <= 0 || separatorIndex === tokenBody.length - 1) {
      return null;
    }

    const encryptedPayload = tokenBody.slice(0, separatorIndex);
    const suppliedSignature = Buffer.from(
      tokenBody.slice(separatorIndex + 1),
      "base64url",
    );
    const expectedSignature = signPayload(options.apiKey, encryptedPayload);
    if (
      suppliedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(suppliedSignature, expectedSignature)
    ) {
      return null;
    }

    const payload = decryptPayload(options.apiKey, encryptedPayload);
    if (
      !payload ||
      payload.v !== FRED_TOKEN_VERSION ||
      typeof payload.u !== "string" ||
      typeof payload.s !== "string" ||
      !payload.s ||
      typeof payload.e !== "number" ||
      !Number.isFinite(payload.e) ||
      payload.u !== options.expectedUserId ||
      (options.now ?? Date.now()) >= payload.e
    ) {
      return null;
    }

    return {
      version: payload.v,
      userId: payload.u,
      weknoraSessionId: payload.s,
      expiresAt: payload.e,
    };
  } catch {
    return null;
  }
}
