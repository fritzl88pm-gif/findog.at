import { runWithTimeout } from "@/lib/deadline";
import { FredEmbedSessionRejectedError, UserVisibleError } from "@/lib/errors";
import { capText } from "@/lib/fred/execution-sanitize";
import { FRED_EMBED_ORIGIN, type FredEmbedServerConfig } from "@/lib/weknora/fred-embed";
import { withFredEmbedSession } from "@/lib/weknora/fred-embed-cache";

export const MAX_SNIPPET_CHARS = 4_000;
const MAX_CHUNK_RESPONSE_BYTES = 256 * 1_024;
const CHUNK_FETCH_TIMEOUT_MS = 10_000;

export const SNIPPET_UNAVAILABLE_MESSAGE = "Fundstelle nicht verfügbar.";

export type FredChunkSnippet = {
  /** Leading `> …` header line of the chunk (e.g. "DBA Deutschland | Art. 15 | Abs. 1"). */
  location?: string;
  text: string;
};

/** Splits a chunk into its leading location header line and the text below it. */
export function splitChunkContent(content: string): FredChunkSnippet {
  const normalized = content.replace(/\r\n?/gu, "\n").trim();
  const header = /^>[ \t]*([^\n]*)(?:\n|$)/u.exec(normalized);
  if (!header) return { text: capText(normalized, MAX_SNIPPET_CHARS) };
  const location = header[1].trim();
  const text = normalized.slice(header[0].length).trim();
  return {
    ...(location ? { location } : {}),
    text: capText(text, MAX_SNIPPET_CHARS),
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_CHUNK_RESPONSE_BYTES) {
    throw new UserVisibleError("Die Fundstelle konnte nicht geladen werden.", 502);
  }
  const text = await response.text();
  if (text.length > MAX_CHUNK_RESPONSE_BYTES) {
    throw new UserVisibleError("Die Fundstelle konnte nicht geladen werden.", 502);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new UserVisibleError("Die Fundstelle konnte nicht geladen werden.", 502);
  }
}

/**
 * Loads one cited chunk through the channel's embed route. WeKnora answers 403
 * for chunks outside the channel's knowledge bases and 404 for unknown ones;
 * both mean "not available" to the user.
 */
export async function fetchFredChunkSnippet(options: {
  config: FredEmbedServerConfig;
  chunkId: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<FredChunkSnippet> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${FRED_EMBED_ORIGIN}/api/v1/embed/${encodeURIComponent(options.config.channelId)}/chunks/${encodeURIComponent(options.chunkId)}`;
  const payload = await withFredEmbedSession(
    { config: options.config, signal: options.signal, fetchImpl },
    (session) => runWithTimeout(async (signal) => {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Embed ${session.token}`,
          Origin: options.config.exchangeOrigin,
        },
        cache: "no-store",
        redirect: "error",
        signal,
      });
      if (response.status === 401) throw new FredEmbedSessionRejectedError();
      if (response.status === 403 || response.status === 404) {
        throw new UserVisibleError(SNIPPET_UNAVAILABLE_MESSAGE, 404);
      }
      if (response.status === 429) {
        throw new UserVisibleError("Fred ist derzeit ausgelastet. Bitte versuche es gleich noch einmal.", 429);
      }
      if (!response.ok) {
        throw new UserVisibleError("Die Fundstelle konnte nicht geladen werden.", 502);
      }
      return readBoundedJson(response);
    }, {
      timeoutMs: CHUNK_FETCH_TIMEOUT_MS,
      timeoutMessage: "Die Fundstelle konnte nicht rechtzeitig geladen werden.",
      status: 502,
      signal: options.signal,
    }),
  );
  const data = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
  const chunk = data?.success === true && data.data && typeof data.data === "object" && !Array.isArray(data.data)
    ? (data.data as Record<string, unknown>)
    : null;
  if (!chunk || typeof chunk.content !== "string") {
    throw new UserVisibleError("Die Fundstelle konnte nicht geladen werden.", 502);
  }
  const snippet = splitChunkContent(chunk.content);
  if (!snippet.text) throw new UserVisibleError(SNIPPET_UNAVAILABLE_MESSAGE, 404);
  return snippet;
}
