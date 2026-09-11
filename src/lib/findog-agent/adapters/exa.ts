/**
 * Exa web adapter (fixed provider, read-only).
 *
 * Only `https://api.exa.ai/search` and `https://api.exa.ai/contents` are used,
 * with `x-api-key` from the server-side credential store. The configured domain
 * allowlist is applied before the request (`includeDomains`) and again to every
 * returned URL, so a suffix-confusion host such as `evil-example.com` can never
 * pass as `example.com`. Returned `costDollars` is recorded as an estimate.
 */

import { FindogAgentAdapterError } from "../errors";
import {
  assertFindogAgentPublicUrl,
  hostMatchesAllowedDomain,
  isFindogAgentBlockedAddress,
  isIpLiteralHost,
  type FindogAgentTransport,
} from "../network";
import { boundFindogAgentText } from "../text";

export const FINDOG_AGENT_EXA_ORIGIN = "https://api.exa.ai";

export type FindogAgentExaAdapterOptions = {
  apiKey: string;
  transport: FindogAgentTransport;
  timeoutMs: number;
  maxTextCharacters: number;
  allowedDomains: string[];
};

export type FindogAgentExaHit = {
  id: string | null;
  title: string;
  url: string;
  text: string;
  truncated: boolean;
  publishedDate: string | null;
};

export type FindogAgentExaSearchResult = {
  hits: FindogAgentExaHit[];
  /** Results dropped by the post-call domain/URL filter. */
  filtered: number;
  costUsd: number | null;
};

export type FindogAgentExaReadResult = {
  pages: FindogAgentExaHit[];
  errors: Array<{ url: string; reason: string }>;
  costUsd: number | null;
};

export type FindogAgentExaAdapter = {
  allowedDomains: string[];
  search(input: {
    query: string;
    numResults: number;
    signal?: AbortSignal | null;
  }): Promise<FindogAgentExaSearchResult>;
  read(input: {
    urls: string[];
    signal?: AbortSignal | null;
  }): Promise<FindogAgentExaReadResult>;
};

const MAX_READ_URLS = 5;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function createFindogAgentExaAdapter(
  options: FindogAgentExaAdapterOptions,
): FindogAgentExaAdapter {
  const allowedDomains = options.allowedDomains.map((domain) => domain.toLowerCase());

  async function send(
    path: string,
    body: unknown,
    signal?: AbortSignal | null,
  ): Promise<Record<string, unknown>> {
    const response = await options.transport.send({
      url: `${FINDOG_AGENT_EXA_ORIGIN}${path}`,
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-api-key": options.apiKey,
      },
      body: JSON.stringify(body),
      purpose: `web:${path.replace(/^\//, "")}`,
      timeoutMs: options.timeoutMs,
      signal: signal ?? null,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new FindogAgentAdapterError(
        "upstream_error",
        `Exa hat mit Status ${response.status} geantwortet.`,
        response.status,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.body);
    } catch {
      throw new FindogAgentAdapterError(
        "invalid_response",
        "Exa hat keine gültige JSON-Antwort geliefert.",
      );
    }
    const record = asRecord(parsed);
    if (!record) {
      throw new FindogAgentAdapterError("invalid_response", "Exa hat keine Ergebnisse geliefert.");
    }
    return record;
  }

  /** Post-call validation: public http(s) host and configured domain boundary. */
  function acceptResultUrl(value: unknown): string | null {
    const raw = asString(value);
    if (!raw) {
      return null;
    }
    let parsed: URL;
    try {
      parsed = assertFindogAgentPublicUrl(raw);
    } catch {
      return null;
    }
    if (isIpLiteralHost(parsed.hostname) && isFindogAgentBlockedAddress(parsed.hostname)) {
      return null;
    }
    if (allowedDomains.length > 0 && !hostMatchesAllowedDomain(parsed.hostname, allowedDomains)) {
      return null;
    }
    return parsed.toString();
  }

  function toHit(entry: unknown, filtered: { count: number }): FindogAgentExaHit | null {
    const record = asRecord(entry);
    if (!record) {
      filtered.count += 1;
      return null;
    }
    const url = acceptResultUrl(record.url);
    if (!url) {
      filtered.count += 1;
      return null;
    }
    const bounded = boundFindogAgentText(record.text, options.maxTextCharacters);
    return {
      id: asString(record.id),
      title: asString(record.title) ?? url,
      url,
      text: bounded.text,
      truncated: bounded.truncated || record.text === undefined,
      publishedDate: asString(record.publishedDate) ?? asString(record.published_date),
    };
  }

  return {
    allowedDomains: [...allowedDomains],

    async search(input) {
      const body: Record<string, unknown> = {
        query: input.query,
        type: "auto",
        numResults: Math.max(1, Math.min(20, input.numResults)),
        contents: { text: { maxCharacters: options.maxTextCharacters } },
      };
      if (allowedDomains.length > 0) {
        body.includeDomains = [...allowedDomains];
      }

      const response = await send("/search", body, input.signal);
      const results = Array.isArray(response.results) ? response.results : [];
      const filtered = { count: 0 };
      const hits: FindogAgentExaHit[] = [];
      for (const entry of results) {
        const hit = toHit(entry, filtered);
        if (hit) {
          hits.push(hit);
        }
      }
      return {
        hits,
        filtered: filtered.count,
        costUsd: asNumberOrNull(response.costDollars),
      };
    },

    async read(input) {
      const requested: string[] = [];
      for (const candidate of input.urls.slice(0, MAX_READ_URLS)) {
        // Refused before any network activity when it escapes the domain policy.
        const parsed = assertFindogAgentPublicUrl(candidate, {
          allowedDomains: allowedDomains.length > 0 ? allowedDomains : undefined,
        });
        if (!requested.includes(parsed.toString())) {
          requested.push(parsed.toString());
        }
      }
      if (requested.length === 0) {
        throw new FindogAgentAdapterError("invalid_request", "Es wurde keine gültige URL übergeben.");
      }

      const response = await send(
        "/contents",
        { ids: requested, text: { maxCharacters: options.maxTextCharacters } },
        input.signal,
      );
      const results = Array.isArray(response.results) ? response.results : [];
      const filtered = { count: 0 };
      const pages: FindogAgentExaHit[] = [];
      for (const entry of results) {
        const hit = toHit(entry, filtered);
        if (hit) {
          pages.push(hit);
        }
      }

      const statuses = Array.isArray(response.statuses) ? response.statuses : [];
      const errors: Array<{ url: string; reason: string }> = [];
      for (const entry of statuses) {
        const status = asRecord(entry);
        const id = status ? asString(status.id) : null;
        const state = status ? asString(status.status) : null;
        if (!status || !id || !state || state === "success" || state === "ok") {
          continue;
        }
        errors.push({ url: id, reason: asString(status.error) ?? state });
      }

      return { pages, errors, costUsd: asNumberOrNull(response.costDollars) };
    },
  };
}
