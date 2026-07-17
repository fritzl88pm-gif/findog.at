import { randomUUID } from "node:crypto";

import { runWithTimeout } from "../deadline";

export const FRED_EMBED_ORIGIN = "https://taxdog.cloud";
export const FRED_EMBED_EXCHANGE_TIMEOUT_MS = 15_000;

const DEFAULT_EXCHANGE_ORIGIN = "https://findog.at";
const MAX_EXCHANGE_RESPONSE_BYTES = 64 * 1_024;
const CHANNEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const PUBLISH_TOKEN_PATTERN = /^em_[A-Za-z0-9_-]{16,512}$/u;
const SESSION_TOKEN_PATTERN = /^ems_[A-Za-z0-9_-]{16,512}$/u;

type Environment = Record<string, string | undefined>;

export type FredEmbedServerConfig = {
  channelId: string;
  publishToken: string;
  exchangeOrigin: string;
};

export type FredEmbedSession = {
  token: string;
  expiresIn: number;
  channelId: string;
  embedOrigin: typeof FRED_EMBED_ORIGIN;
};

export class FredEmbedConfigurationError extends Error {
  constructor() {
    super("Fred Secure Embed ist nicht vollständig konfiguriert.");
    this.name = "FredEmbedConfigurationError";
  }
}

export class FredEmbedUpstreamError extends Error {
  readonly kind: "rejected" | "rate_limited" | "unavailable" | "invalid_response";

  constructor(kind: FredEmbedUpstreamError["kind"]) {
    super("Fred Secure Embed konnte keine Sitzung ausstellen.");
    this.name = "FredEmbedUpstreamError";
    this.kind = kind;
  }
}

function exactHttpOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    const isLocalDevelopment = url.protocol === "http:"
      && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if (url.protocol !== "https:" && !isLocalDevelopment) return undefined;
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

export function readFredEmbedServerConfig(
  environment: Environment = process.env,
): FredEmbedServerConfig {
  const channelId = environment.WEKNORA_FRED_CHANNEL_ID?.trim() ?? "";
  const publishToken = environment.WEKNORA_FRED_PUBLISH_TOKEN?.trim() ?? "";
  const exchangeOrigin = exactHttpOrigin(
    environment.WEKNORA_FRED_EXCHANGE_ORIGIN?.trim() || DEFAULT_EXCHANGE_ORIGIN,
  );

  if (
    !CHANNEL_ID_PATTERN.test(channelId)
    || !PUBLISH_TOKEN_PATTERN.test(publishToken)
    || !exchangeOrigin
  ) {
    throw new FredEmbedConfigurationError();
  }

  return { channelId, publishToken, exchangeOrigin };
}

function parsedSessionPayload(value: unknown): { token: string; expiresIn: number } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const root = value as Record<string, unknown>;
  if (root.success !== true || !root.data || typeof root.data !== "object" || Array.isArray(root.data)) {
    return undefined;
  }
  const data = root.data as Record<string, unknown>;
  const token = typeof data.session_token === "string" ? data.session_token.trim() : "";
  const expiresIn = data.expires_in;
  if (
    !SESSION_TOKEN_PATTERN.test(token)
    || typeof expiresIn !== "number"
    || !Number.isInteger(expiresIn)
    || expiresIn < 60
    || expiresIn > 3_600
  ) {
    return undefined;
  }
  return { token, expiresIn };
}

async function readBoundedResponseText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_EXCHANGE_RESPONSE_BYTES) {
    throw new FredEmbedUpstreamError("invalid_response");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_EXCHANGE_RESPONSE_BYTES) {
        await reader.cancel();
        throw new FredEmbedUpstreamError("invalid_response");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export async function mintFredEmbedSession(options: {
  environment?: Environment;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
} = {}): Promise<FredEmbedSession> {
  const config = readFredEmbedServerConfig(options.environment);
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  let bodyText: string;

  try {
    ({ response, bodyText } = await runWithTimeout(
      (signal) => fetchImpl(
        `${FRED_EMBED_ORIGIN}/api/v1/embed/${encodeURIComponent(config.channelId)}/exchange`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Embed ${config.publishToken}`,
            Origin: config.exchangeOrigin,
            "X-Request-ID": randomUUID(),
          },
          cache: "no-store",
          signal,
        },
      ).then(async (upstreamResponse) => ({
        response: upstreamResponse,
        bodyText: upstreamResponse.ok ? await readBoundedResponseText(upstreamResponse) : "",
      })),
      {
        signal: options.signal,
        timeoutMs: FRED_EMBED_EXCHANGE_TIMEOUT_MS,
        timeoutMessage: "Fred Secure Embed hat nicht rechtzeitig geantwortet.",
      },
    ));
  } catch (error) {
    if (error instanceof FredEmbedUpstreamError) throw error;
    throw new FredEmbedUpstreamError("unavailable");
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new FredEmbedUpstreamError("rejected");
    }
    if (response.status === 429) {
      throw new FredEmbedUpstreamError("rate_limited");
    }
    throw new FredEmbedUpstreamError("unavailable");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    throw new FredEmbedUpstreamError("invalid_response");
  }
  const session = parsedSessionPayload(payload);
  if (!session) {
    throw new FredEmbedUpstreamError("invalid_response");
  }

  return {
    ...session,
    channelId: config.channelId,
    embedOrigin: FRED_EMBED_ORIGIN,
  };
}
