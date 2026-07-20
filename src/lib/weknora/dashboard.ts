import "server-only";

import { UserVisibleError } from "../errors";
import type {
  WeKnoraDashboard,
  WeKnoraKnowledgeBase,
  WeKnoraKnowledgeKind,
} from "./dashboard-types";

const DEFAULT_MCP_ENDPOINT = "https://taxdog.cloud/mcp/bfg-query";
const MCP_TIMEOUT_MS = 10_000;
const MAX_MCP_RESPONSE_BYTES = 256 * 1_024;
const AVAILABILITY_MESSAGE = "Die Wissenslandschaft ist derzeit nicht verfügbar.";

export const DASHBOARD_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
export const DASHBOARD_STALE_RETRY_MS = 5 * 60 * 1_000;

type ApprovedKnowledgeBase = {
  id: string;
  name: string;
  kind: WeKnoraKnowledgeKind;
};

const APPROVED_KNOWLEDGE_BASES: readonly ApprovedKnowledgeBase[] = [
  {
    id: "582f577a-ee1b-462d-ac55-636749320ae7",
    name: "Allgemeine Informationen Wiki",
    kind: "document",
  },
  {
    id: "22dee3ae-2c61-438e-8609-f9e12144157e",
    name: "Arbeitsbehelfe und interne Dokumente",
    kind: "document",
  },
  {
    id: "7eac30a9-3add-4f84-bac2-4a3ae3c7c2c2",
    name: "FEXklusiv",
    kind: "document",
  },
  {
    id: "e0282ab8-b94f-4553-962e-68705201cf9a",
    name: "Gesetze und Verordnungen",
    kind: "document",
  },
  {
    id: "442ad2e8-c69f-4cb5-985c-f3afadeb8645",
    name: "Betragstabelle FAQ",
    kind: "faq",
  },
  {
    id: "952bd9ad-59a5-4ca4-ad28-3c945dab9515",
    name: "Win ANV",
    kind: "faq",
  },
  {
    id: "7e203a75-9e51-4839-afd4-7d24d2e5b033",
    name: "BFG Entscheidungen Findok",
    kind: "document",
  },
] as const;

const FAQ_KNOWLEDGE_BASES = APPROVED_KNOWLEDGE_BASES.filter(
  (knowledgeBase) => knowledgeBase.kind === "faq",
);

type DashboardCacheEntry = {
  dashboard: WeKnoraDashboard;
  expiresAt: number;
};

type FetchOptions = {
  endpoint: string;
  token: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  signal?: AbortSignal;
};

type CachedFetchOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
};

let dashboardCache: DashboardCacheEntry | null = null;
let dashboardRefresh: Promise<WeKnoraDashboard> | null = null;

function availabilityError(): UserVisibleError {
  return new UserVisibleError(AVAILABILITY_MESSAGE, 503);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function parseApprovedList(payload: unknown): Map<string, Record<string, unknown>> {
  if (!isRecord(payload) || payload.success !== true || !Array.isArray(payload.data)) {
    throw availabilityError();
  }

  const approvedIds = new Set(APPROVED_KNOWLEDGE_BASES.map(({ id }) => id));
  const found = new Map<string, Record<string, unknown>>();
  for (const value of payload.data) {
    if (!isRecord(value) || typeof value.id !== "string" || !approvedIds.has(value.id)) {
      continue;
    }
    if (found.has(value.id)) {
      throw availabilityError();
    }
    found.set(value.id, value);
  }

  if (found.size !== APPROVED_KNOWLEDGE_BASES.length) {
    throw availabilityError();
  }
  return found;
}

export function normalizeWeKnoraDashboard(
  listPayload: unknown,
  faqTotals: Readonly<Record<string, unknown>>,
  fetchedAt: string,
): WeKnoraDashboard {
  if (!Number.isFinite(Date.parse(fetchedAt))) {
    throw availabilityError();
  }

  const rawKnowledgeBases = parseApprovedList(listPayload);
  const knowledgeBases = APPROVED_KNOWLEDGE_BASES.map((approved): WeKnoraKnowledgeBase => {
    const raw = rawKnowledgeBases.get(approved.id);
    if (
      !raw
      || typeof raw.is_processing !== "boolean"
      || !nonNegativeInteger(raw.processing_count)
    ) {
      throw availabilityError();
    }

    const count = approved.kind === "document"
      ? raw.knowledge_count
      : faqTotals[approved.id];
    if (!nonNegativeInteger(count)) {
      throw availabilityError();
    }

    return {
      id: approved.id,
      name: approved.name,
      kind: approved.kind,
      count,
      isProcessing: raw.is_processing,
      processingCount: raw.processing_count,
    };
  });

  const documents = knowledgeBases
    .filter(({ kind }) => kind === "document")
    .reduce((sum, { count }) => sum + count, 0);
  const faqEntries = knowledgeBases
    .filter(({ kind }) => kind === "faq")
    .reduce((sum, { count }) => sum + count, 0);
  const processing = knowledgeBases.reduce((sum, { processingCount }) => sum + processingCount, 0);

  return {
    knowledgeBases,
    totals: {
      knowledgeBases: knowledgeBases.length,
      contents: documents + faqEntries,
      documents,
      faqEntries,
      processing,
    },
    fetchedAt,
    stale: false,
  };
}

function parseJsonRecord(value: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw availabilityError();
  }
  if (!isRecord(parsed)) {
    throw availabilityError();
  }
  return parsed;
}

export function parseMcpSseResponse(body: string, expectedId: number): Record<string, unknown> {
  const events = body.split(/\r?\n\r?\n/u);
  let matchingPayload: Record<string, unknown> | null = null;

  for (const event of events) {
    const dataLines = event
      .split(/\r?\n/u)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());
    if (dataLines.length === 0) continue;

    const rpcPayload = parseJsonRecord(dataLines.join("\n"));
    if (rpcPayload.id !== expectedId) continue;
    if (matchingPayload || rpcPayload.jsonrpc !== "2.0" || rpcPayload.error !== undefined) {
      throw availabilityError();
    }
    if (!isRecord(rpcPayload.result) || rpcPayload.result.isError === true) {
      throw availabilityError();
    }
    const content = rpcPayload.result.content;
    if (!Array.isArray(content) || content.length !== 1 || !isRecord(content[0])) {
      throw availabilityError();
    }
    if (content[0].type !== "text" || typeof content[0].text !== "string") {
      throw availabilityError();
    }
    matchingPayload = parseJsonRecord(content[0].text);
  }

  if (!matchingPayload) {
    throw availabilityError();
  }
  return matchingPayload;
}

async function readBoundedMcpResponse(response: Response): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isFinite(parsedLength) || parsedLength < 0 || parsedLength > MAX_MCP_RESPONSE_BYTES) {
      throw availabilityError();
    }
  }
  if (!response.ok || !response.body) {
    throw availabilityError();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_MCP_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw availabilityError();
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return body;
  } catch (error) {
    if (error instanceof UserVisibleError) throw error;
    throw availabilityError();
  } finally {
    reader.releaseLock();
  }
}

async function callMcpTool(options: {
  endpoint: string;
  token: string;
  id: number;
  name: string;
  arguments: Record<string, unknown>;
  fetchImpl: typeof fetch;
  signal: AbortSignal;
}): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await options.fetchImpl(options.endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${options.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: options.id,
        method: "tools/call",
        params: {
          name: options.name,
          arguments: options.arguments,
        },
      }),
      cache: "no-store",
      signal: options.signal,
    });
  } catch {
    throw availabilityError();
  }
  const body = await readBoundedMcpResponse(response);
  return parseMcpSseResponse(body, options.id);
}

function faqTotal(payload: unknown): number {
  if (
    !isRecord(payload)
    || payload.success !== true
    || !isRecord(payload.data)
    || !nonNegativeInteger(payload.data.total)
  ) {
    throw availabilityError();
  }
  return payload.data.total;
}

export async function fetchWeKnoraDashboard(options: FetchOptions): Promise<WeKnoraDashboard> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), MCP_TIMEOUT_MS);
  const forwardAbort = () => timeoutController.abort(options.signal?.reason);
  if (options.signal?.aborted) forwardAbort();
  else options.signal?.addEventListener("abort", forwardAbort, { once: true });

  try {
    const listPayload = await callMcpTool({
      endpoint: options.endpoint,
      token: options.token,
      id: 1,
      name: "list_knowledge_bases",
      arguments: {},
      fetchImpl,
      signal: timeoutController.signal,
    });
    // The two FAQ totals are independent once the approved list has been validated.
    parseApprovedList(listPayload);
    const faqPayloads = await Promise.all(FAQ_KNOWLEDGE_BASES.map((knowledgeBase, index) => callMcpTool({
      endpoint: options.endpoint,
      token: options.token,
      id: index + 2,
      name: "faq_entries_search",
      arguments: {
        kb_id: knowledgeBase.id,
        keyword: "",
        page: 1,
        page_size: 1,
      },
      fetchImpl,
      signal: timeoutController.signal,
    })));
    const faqTotals = Object.fromEntries(FAQ_KNOWLEDGE_BASES.map((knowledgeBase, index) => [
      knowledgeBase.id,
      faqTotal(faqPayloads[index]),
    ]));
    return normalizeWeKnoraDashboard(listPayload, faqTotals, new Date(now()).toISOString());
  } catch (error) {
    if (error instanceof UserVisibleError) throw error;
    throw availabilityError();
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
}

function readServerConfig(): { endpoint: string; token: string } {
  const token = process.env.WEKNORA_READONLY_MCP_BEARER_TOKEN?.trim() ?? "";
  if (!token) {
    throw new UserVisibleError("Die Wissenslandschaft ist serverseitig nicht konfiguriert.", 503);
  }

  const endpoint = process.env.WEKNORA_READONLY_MCP_URL?.trim() || DEFAULT_MCP_ENDPOINT;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new UserVisibleError("Die Wissenslandschaft ist serverseitig nicht konfiguriert.", 503);
  }
  if (
    (process.env.NODE_ENV !== "test" && url.protocol !== "https:")
    || (url.protocol !== "https:" && url.protocol !== "http:")
    || url.username
    || url.password
  ) {
    throw new UserVisibleError("Die Wissenslandschaft ist serverseitig nicht konfiguriert.", 503);
  }
  return { endpoint: url.toString(), token };
}

export async function getWeKnoraDashboard(
  options: CachedFetchOptions = {},
): Promise<WeKnoraDashboard> {
  const now = options.now ?? Date.now;
  const currentTime = now();
  if (dashboardCache && currentTime < dashboardCache.expiresAt) {
    return dashboardCache.dashboard;
  }
  if (dashboardRefresh) return dashboardRefresh;

  const previous = dashboardCache;
  dashboardRefresh = (async () => {
    try {
      const config = readServerConfig();
      const dashboard = await fetchWeKnoraDashboard({
        ...config,
        fetchImpl: options.fetchImpl,
        now,
      });
      dashboardCache = {
        dashboard,
        expiresAt: now() + DASHBOARD_CACHE_TTL_MS,
      };
      return dashboard;
    } catch {
      if (previous) {
        const staleDashboard = { ...previous.dashboard, stale: true };
        dashboardCache = {
          dashboard: staleDashboard,
          expiresAt: now() + DASHBOARD_STALE_RETRY_MS,
        };
        return staleDashboard;
      }
      throw availabilityError();
    } finally {
      dashboardRefresh = null;
    }
  })();

  return dashboardRefresh;
}

export function __resetWeKnoraDashboardCacheForTests(): void {
  dashboardCache = null;
  dashboardRefresh = null;
}
