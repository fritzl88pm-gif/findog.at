/**
 * Outbound network layer for the Findog Agent.
 *
 * Every external call in this feature goes through {@link FindogAgentTransport}.
 * The production transport enforces the destination policy that the admin
 * configured: https-only public endpoints, no URL credentials, no cloud
 * metadata or private/link-local destinations, same-origin redirects only and
 * bounded responses.
 *
 * Tests and the worker may inject a different transport, but the policy options
 * themselves are server-side constructor arguments. No caller-supplied JSON,
 * model output or retrieved content can widen them.
 */

import { lookup as resolveHostname } from "node:dns/promises";
import {
  request as httpRequest,
  type IncomingHttpHeaders,
  type RequestOptions,
} from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";

import { FindogAgentNetworkError } from "./errors";

export const FINDOG_AGENT_ALLOWED_PRIVATE_ORIGINS_ENV =
  "FINDOG_AGENT_ALLOWED_PRIVATE_ORIGINS";

export const FINDOG_AGENT_DEFAULT_TIMEOUT_MS = 120_000;
export const FINDOG_AGENT_DEFAULT_MAX_RESPONSE_BYTES = 2_000_000;
const MAX_REDIRECTS = 3;

export type FindogAgentTransportRequest = {
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string | null;
  /**
   * Call-site label used for run events and for the engine's pre-call fence.
   * It is descriptive only; it never changes the destination policy.
   */
  purpose?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  signal?: AbortSignal | null;
};

export type FindogAgentTransportResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
};

export interface FindogAgentTransport {
  send(request: FindogAgentTransportRequest): Promise<FindogAgentTransportResponse>;
}

export type FindogAgentHttpTransportOptions = {
  /** Exact origins (scheme://host[:port]) that may be private or plain http. */
  allowedPrivateOrigins?: string[];
  /** Injected resolver, used by tests to simulate DNS results/rebinding. */
  resolveHost?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
};

type ResolvedAddress = { address: string; family: number };

export function normalizeFindogAgentOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

/** Parses the server-side allowlist for explicitly permitted private endpoints. */
export function parseFindogAgentAllowedPrivateOrigins(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  const origins = new Set<string>();
  for (const entry of value.split(",")) {
    const origin = normalizeFindogAgentOrigin(entry);
    if (origin) {
      origins.add(origin);
    }
  }
  return [...origins];
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null;
  }
  return octets;
}

function isPrivateIpv4(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) {
    return true;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true; // link-local, includes cloud metadata 169.254.169.254
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 192 && b === 0) {
    return true;
  }
  if (a === 198 && (b === 18 || b === 19)) {
    return true;
  }
  return a >= 224; // multicast and reserved space
}

/**
 * True for loopback, private, link-local, unique-local, metadata and reserved
 * addresses (IPv4 and IPv6, including IPv4-mapped IPv6).
 */
export function isFindogAgentBlockedAddress(address: string): boolean {
  const literal = address.trim().replace(/^\[|\]$/g, "");
  if (!literal) {
    return true;
  }

  const zoneIndex = literal.indexOf("%");
  const withoutZone = zoneIndex === -1 ? literal : literal.slice(0, zoneIndex);

  if (isIP(withoutZone) === 4) {
    const octets = parseIpv4(withoutZone);
    return octets ? isPrivateIpv4(octets) : true;
  }
  if (isIP(withoutZone) !== 6) {
    return true; // not an address at all: refuse rather than guess
  }

  const lower = withoutZone.toLowerCase();
  const mapped = /^(?:::ffff:)(.+)$/.exec(lower);
  if (mapped) {
    const octets = parseIpv4(mapped[1].trim());
    return octets ? isPrivateIpv4(octets) : true;
  }
  if (lower === "::" || lower === "::1") {
    return true;
  }
  if (lower.startsWith("fc") || lower.startsWith("fd")) {
    return true; // unique local fc00::/7
  }
  if (/^fe[89ab]/.test(lower)) {
    return true; // link-local fe80::/10
  }
  if (lower.startsWith("ff")) {
    return true; // multicast
  }
  if (lower.startsWith("64:ff9b") || lower.startsWith("2001:db8")) {
    return true;
  }
  return false;
}

export function isIpLiteralHost(hostname: string): boolean {
  const literal = hostname.replace(/^\[|\]$/g, "");
  return isIP(literal) !== 0;
}

/** Host must equal the configured domain or be a real subdomain of it. */
export function hostMatchesAllowedDomain(hostname: string, allowedDomains: string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return allowedDomains.some((domain) => {
    const candidate = domain.toLowerCase().replace(/^\./, "").replace(/\.$/, "");
    if (!candidate) {
      return false;
    }
    return host === candidate || host.endsWith(`.${candidate}`);
  });
}

/**
 * Synchronous `http(s)` validation used for URLs that arrive from a provider or
 * a model. It refuses credentials, non-http(s) schemes and literal
 * private/metadata hosts. DNS is re-checked by the transport before connecting.
 */
export function assertFindogAgentPublicUrl(
  value: string,
  options: { allowedDomains?: string[]; allowPrivateHosts?: boolean } = {},
): URL {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new FindogAgentNetworkError("invalid_url", "Die Ziel-URL ist ungültig.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new FindogAgentNetworkError("invalid_url", "Diese URL-Art ist nicht erlaubt.");
  }
  if (parsed.username || parsed.password) {
    throw new FindogAgentNetworkError(
      "url_credentials",
      "URLs mit eingebetteten Zugangsdaten sind nicht erlaubt.",
    );
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (!hostname) {
    throw new FindogAgentNetworkError("invalid_url", "Die Ziel-URL ist ungültig.");
  }
  if (!options.allowPrivateHosts) {
    if (isIpLiteralHost(hostname) && isFindogAgentBlockedAddress(hostname)) {
      throw new FindogAgentNetworkError(
        "blocked_destination",
        "Lokale oder private Adressen sind nicht erlaubt.",
      );
    }
    if (hostname.toLowerCase() === "localhost" || hostname.toLowerCase().endsWith(".localhost")) {
      throw new FindogAgentNetworkError(
        "blocked_destination",
        "Lokale oder private Adressen sind nicht erlaubt.",
      );
    }
  }
  if (options.allowedDomains && options.allowedDomains.length > 0
    && !hostMatchesAllowedDomain(hostname, options.allowedDomains)) {
    throw new FindogAgentNetworkError(
      "blocked_destination",
      "Die Domain ist für die Websuche nicht freigegeben.",
    );
  }
  return parsed;
}

function flattenHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      result[key.toLowerCase()] = value;
    } else if (Array.isArray(value)) {
      result[key.toLowerCase()] = value.join(", ");
    }
  }
  return result;
}

type SingleRequestInput = {
  url: URL;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body: string | null;
  timeoutMs: number;
  maxResponseBytes: number;
  addresses: ResolvedAddress[];
  signal: AbortSignal | null;
};

function performSingleRequest(input: SingleRequestInput): Promise<FindogAgentTransportResponse> {
  return new Promise((resolve, reject) => {
    const pinned = input.addresses[0];
    const lookup: LookupFunction = (hostname, options, callback) => {
      if (options && typeof options === "object" && options.all) {
        (
          callback as unknown as (
            error: NodeJS.ErrnoException | null,
            addresses: Array<{ address: string; family: number }>,
          ) => void
        )(null, input.addresses);
        return;
      }
      (
        callback as unknown as (
          error: NodeJS.ErrnoException | null,
          address: string,
          family: number,
        ) => void
      )(null, pinned.address, pinned.family);
    };

    const requestOptions: RequestOptions = {
      method: input.method,
      headers: input.headers,
      lookup,
    };

    const request = (input.url.protocol === "https:" ? httpsRequest : httpRequest)(
      input.url,
      requestOptions,
      (response) => {
        const chunks: Buffer[] = [];
        let received = 0;
        let truncated = false;

        response.on("data", (chunk: Buffer) => {
          if (truncated) {
            return;
          }
          received += chunk.length;
          if (received > input.maxResponseBytes) {
            truncated = true;
            chunks.push(chunk.subarray(0, Math.max(0, chunk.length - (received - input.maxResponseBytes))));
            response.destroy();
            settle({
              status: response.statusCode ?? 0,
              headers: flattenHeaders(response.headers),
              body: Buffer.concat(chunks).toString("utf8"),
              truncated: true,
            });
            return;
          }
          chunks.push(chunk);
        });

        response.on("end", () => {
          if (truncated) {
            return;
          }
          settle({
            status: response.statusCode ?? 0,
            headers: flattenHeaders(response.headers),
            body: Buffer.concat(chunks).toString("utf8"),
            truncated: false,
          });
        });

        response.on("error", (error: Error) => {
          fail(new FindogAgentNetworkError(
            "transport_failure",
            error.message || "Antwort konnte nicht gelesen werden.",
          ));
        });
      },
    );

    let settled = false;
    let failure: FindogAgentNetworkError | null = null;

    const settle = (value: FindogAgentTransportResponse) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    };

    const fail = (error: FindogAgentNetworkError) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    const timer = setTimeout(() => {
      failure = new FindogAgentNetworkError(
        "timeout",
        "Die Netzwerkanfrage hat das Zeitlimit überschritten.",
      );
      request.destroy();
    }, input.timeoutMs);

    const onAbort = () => {
      failure = new FindogAgentNetworkError("aborted", "Die Netzwerkanfrage wurde abgebrochen.");
      request.destroy();
    };

    function cleanup() {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
    }

    input.signal?.addEventListener("abort", onAbort, { once: true });
    if (input.signal?.aborted) {
      onAbort();
    }

    request.on("error", (error: Error) => {
      if (failure) {
        fail(failure);
        return;
      }
      if (input.signal?.aborted) {
        fail(new FindogAgentNetworkError("aborted", "Die Netzwerkanfrage wurde abgebrochen."));
        return;
      }
      fail(new FindogAgentNetworkError("transport_failure", error.message || "Netzwerkfehler"));
    });

    if (input.body !== null) {
      request.write(input.body);
    }
    request.end();
  });
}

/**
 * Production transport. It resolves the destination first, refuses blocked
 * addresses, pins the resolved address for the connection (no DNS rebinding
 * window) and follows same-origin redirects only.
 */
export function createFindogAgentHttpTransport(
  options: FindogAgentHttpTransportOptions = {},
): FindogAgentTransport {
  const allowedOrigins = new Set(
    (options.allowedPrivateOrigins ?? [])
      .map((origin) => normalizeFindogAgentOrigin(origin))
      .filter((origin): origin is string => origin !== null),
  );
  const resolveHost = options.resolveHost
    ?? (async (hostname: string): Promise<ResolvedAddress[]> => {
      const results = await resolveHostname(hostname, { all: true });
      return results.map((entry) => ({ address: entry.address, family: entry.family }));
    });

  return {
    async send(request): Promise<FindogAgentTransportResponse> {
      let originAllowed: boolean;
      try {
        originAllowed = allowedOrigins.has(new URL(request.url).origin);
      } catch {
        originAllowed = false;
      }
      const url = assertFindogAgentPublicUrl(request.url, { allowPrivateHosts: originAllowed });

      if (url.protocol !== "https:" && !originAllowed) {
        throw new FindogAgentNetworkError(
          "insecure_transport",
          "Externe Endpunkte müssen https verwenden.",
        );
      }

      const hostname = url.hostname.replace(/^\[|\]$/g, "");
      let addresses: ResolvedAddress[];
      if (isIpLiteralHost(hostname)) {
        addresses = [{ address: hostname, family: isIP(hostname) }];
      } else {
        try {
          addresses = await resolveHost(hostname);
        } catch {
          throw new FindogAgentNetworkError("dns_failure", "Der Hostname ist nicht auflösbar.");
        }
      }
      if (addresses.length === 0) {
        throw new FindogAgentNetworkError("dns_failure", "Der Hostname ist nicht auflösbar.");
      }
      if (!originAllowed && addresses.some((entry) => isFindogAgentBlockedAddress(entry.address))) {
        throw new FindogAgentNetworkError(
          "blocked_destination",
          "Lokale, private oder Metadaten-Adressen sind nicht erlaubt.",
        );
      }

      const timeoutMs = request.timeoutMs ?? FINDOG_AGENT_DEFAULT_TIMEOUT_MS;
      const maxResponseBytes = request.maxResponseBytes
        ?? FINDOG_AGENT_DEFAULT_MAX_RESPONSE_BYTES;
      const headers = { ...(request.headers ?? {}) };

      let currentUrl = url;
      let method = request.method;
      let body = method === "POST" ? request.body ?? "" : null;
      if (body !== null) {
        headers["content-length"] = Buffer.byteLength(body).toString();
      }

      for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        const response = await performSingleRequest({
          url: currentUrl,
          method,
          headers,
          body,
          timeoutMs,
          maxResponseBytes,
          addresses,
          signal: request.signal ?? null,
        });

        const location = response.headers.location;
        const isRedirect = response.status >= 300 && response.status < 400;
        if (!isRedirect || !location) {
          return response;
        }
        if (hop === MAX_REDIRECTS) {
          throw new FindogAgentNetworkError(
            "redirect_limit",
            "Zu viele Weiterleitungen beim externen Endpunkt.",
          );
        }

        let nextUrl: URL;
        try {
          nextUrl = new URL(location, currentUrl);
        } catch {
          throw new FindogAgentNetworkError("redirect_denied", "Die Weiterleitung ist ungültig.");
        }
        if (nextUrl.origin !== currentUrl.origin) {
          throw new FindogAgentNetworkError(
            "redirect_denied",
            "Weiterleitungen zu anderen Hosts sind nicht erlaubt.",
          );
        }
        assertFindogAgentPublicUrl(nextUrl.toString(), { allowPrivateHosts: originAllowed });

        if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
          method = "GET";
          body = null;
          delete headers["content-length"];
          delete headers["content-type"];
        }
        currentUrl = nextUrl;
      }

      throw new FindogAgentNetworkError(
        "redirect_limit",
        "Zu viele Weiterleitungen beim externen Endpunkt.",
      );
    },
  };
}

/** Transport used when the caller injects its own implementation (tests, worker). */
export function createFindogAgentStaticTransport(
  handler: (request: FindogAgentTransportRequest) => Promise<FindogAgentTransportResponse>,
): FindogAgentTransport {
  return { send: handler };
}
