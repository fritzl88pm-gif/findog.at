import type { SupabaseClient } from "@supabase/supabase-js";

import { UserVisibleError } from "./errors";
import type {
  OpenRouterAdminUsageSnapshot,
  OpenRouterCreditsSnapshot,
  OpenRouterFredUserStats,
  OpenRouterKeyUsage,
  OpenRouterModelUsage,
  OpenRouterTimeTrendBucket,
  OpenRouterUsageRange,
  OpenRouterUsageSummary,
  OpenRouterUserCostAttribution,
  OpenRouterUserUsage,
} from "./openrouter-usage-types";

export const OPENROUTER_USAGE_CACHE_TTL_MS = 5 * 60 * 1_000;
export const OPENROUTER_USAGE_TIMEOUT_MS = 10_000;
export const MAX_OPENROUTER_RESPONSE_BYTES = 2 * 1_024 * 1_024;
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_FRED_COST_ATTRIBUTION: OpenRouterUserCostAttribution = "estimated_request_share";

type JsonRecord = Record<string, unknown>;

type OpenRouterServerConfig = {
  apiKey: string;
};

type UsageCacheEntry = {
  fetchedAt: number;
  snapshot: Omit<OpenRouterAdminUsageSnapshot, "stale" | "warning">;
};

class OpenRouterPayloadError extends Error {
  constructor() {
    super("OpenRouter returned an invalid payload.");
    this.name = "OpenRouterPayloadError";
  }
}

const usageCache = new Map<OpenRouterUsageRange, UsageCacheEntry>();

export function clearOpenRouterUsageCacheForTests(): void {
  usageCache.clear();
}

function serverConfig(): OpenRouterServerConfig {
  const apiKey = process.env.OPENROUTER_MANAGEMENT_KEY?.trim();
  if (!apiKey) {
    throw new UserVisibleError("OpenRouter ist serverseitig nicht konfiguriert.", 503);
  }
  return { apiKey };
}

export function formatOpenRouterUtcTimestamp(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}Z`;
}

export function rangeWindow(
  range: OpenRouterUsageRange,
  nowMs = Date.now(),
): {
  timeRange: { start: string; end: string };
  granularity: "hour" | "day";
  durationMs: number;
} {
  let durationMs: number;
  let granularity: "hour" | "day";

  switch (range) {
    case "24h":
      durationMs = 24 * 60 * 60 * 1_000;
      granularity = "hour";
      break;
    case "7d":
      durationMs = 7 * 24 * 60 * 60 * 1_000;
      granularity = "day";
      break;
    case "30d":
      durationMs = 30 * 24 * 60 * 60 * 1_000;
      granularity = "day";
      break;
    default:
      throw new UserVisibleError("Der Zeitraum ist ungültig.", 400);
  }

  const startDate = new Date(nowMs - durationMs);
  const endDate = new Date(nowMs);

  return {
    timeRange: {
      start: formatOpenRouterUtcTimestamp(startDate),
      end: formatOpenRouterUtcTimestamp(endDate),
    },
    granularity,
    durationMs,
  };
}

function recordOf(value: unknown): JsonRecord | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new OpenRouterPayloadError();
  return value as JsonRecord;
}

function cleanText(value: unknown, maxLength = 200): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) return null;
  if (/[\u0000-\u001f\u007f]/u.test(value)) return null;
  return value.trim() || null;
}

function parseNonnegativeNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  let candidate: number;
  if (typeof value === "number") {
    candidate = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > 32 || !/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/u.test(trimmed)) {
      return null;
    }
    candidate = Number(trimmed);
  } else {
    return null;
  }
  return Number.isFinite(candidate) && candidate >= 0 ? candidate : null;
}

function parseNonnegativeInteger(value: unknown): number | null {
  const candidate = parseNonnegativeNumber(value);
  return candidate !== null ? Math.round(candidate) : null;
}

function parsePercent(value: unknown): number | null {
  const num = parseNonnegativeNumber(value);
  if (num === null) return null;
  if (num <= 1 && num > 0) {
    return Math.min(100, Math.round(num * 100 * 100) / 100);
  }
  return Math.min(100, num);
}

function parseLatencyMs(value: unknown): number | null {
  const num = parseNonnegativeNumber(value);
  return num === null ? null : Math.round(num);
}

function analyticsEnvelope(payload: unknown): JsonRecord | null {
  const root = recordOf(payload);
  const possibleEnvelope = root?.data;
  if (possibleEnvelope && typeof possibleEnvelope === "object" && !Array.isArray(possibleEnvelope)) {
    const envelope = possibleEnvelope as JsonRecord;
    if (Array.isArray(envelope.data)) return envelope;
  }
  return root;
}

export function normalizeCreditsPayload(payload: unknown): OpenRouterCreditsSnapshot | null {
  const root = recordOf(payload);
  const data = recordOf(root?.data);
  if (!data) return null;

  const totalCredits = parseNonnegativeNumber(data.total_credits);
  const totalUsage = parseNonnegativeNumber(data.total_usage);
  const remaining = totalCredits !== null && totalUsage !== null
    ? Math.max(0, totalCredits - totalUsage)
    : null;
  const remainingPercent = totalCredits !== null && totalCredits > 0 && remaining !== null
    ? Math.min(100, Math.max(0, (remaining / totalCredits) * 100))
    : null;

  return {
    totalCredits,
    totalUsage,
    remaining,
    remainingPercent,
  };
}

export function normalizeKeysPayload(payload: unknown): OpenRouterKeyUsage[] {
  const root = recordOf(payload);
  const items = Array.isArray(root?.data) ? root.data : [];
  const keys: OpenRouterKeyUsage[] = [];

  for (const item of items) {
    const record = recordOf(item);
    if (!record) continue;
    const id = cleanText(record.id) ?? "";
    const rawName = cleanText(record.name);
    // Never expose secret tokens or hashes from labels
    const name = rawName || "API Key";
    const limit = parseNonnegativeNumber(record.limit);
    const usageDaily = parseNonnegativeNumber(record.usage_daily);
    const usageWeekly = parseNonnegativeNumber(record.usage_weekly);
    const usageMonthly = parseNonnegativeNumber(record.usage_monthly);
    const providerRemainingLimit = parseNonnegativeNumber(record.limit_remaining);
    const remainingLimit = providerRemainingLimit ?? (
      limit !== null && usageMonthly !== null
        ? Math.max(0, limit - usageMonthly)
        : null
    );

    keys.push({
      id,
      name,
      requests: null,
      cost: null,
      usageDaily,
      usageWeekly,
      usageMonthly,
      limit,
      remainingLimit,
    });
  }

  return keys;
}

function parseAnalyticsMetadataAndWarnings(payload: unknown): { truncated: boolean; warnings: string[] } {
  const root = analyticsEnvelope(payload);
  const metadata = recordOf(root?.metadata);
  const truncated = metadata?.truncated === true;
  const warnings: string[] = [];
  if (Array.isArray(root?.warnings)) {
    for (const w of root.warnings) {
      const text = cleanText(w);
      if (text) warnings.push(text);
    }
  }
  return { truncated, warnings };
}

function normalizeSummaryRow(row: JsonRecord | null): OpenRouterUsageSummary | null {
  if (!row) return null;
  return {
    requests: parseNonnegativeInteger(row.request_count),
    totalCost: parseNonnegativeNumber(row.total_usage),
    promptTokens: parseNonnegativeInteger(row.tokens_prompt),
    completionTokens: parseNonnegativeInteger(row.tokens_completion),
    reasoningTokens: parseNonnegativeInteger(row.reasoning_tokens),
    totalTokens: parseNonnegativeInteger(row.tokens_total),
    cachedTokens: parseNonnegativeInteger(row.cached_tokens),
    cacheHitRate: parsePercent(row.cache_hit_rate),
    avgLatencyMs: parseLatencyMs(row.avg_latency),
    p90LatencyMs: parseLatencyMs(row.p90_latency),
  };
}

export function normalizeOpenRouterUsagePayloads(inputs: {
  credits: unknown;
  keys: unknown;
  summaryQuery: unknown;
  modelsQuery: unknown;
  keyAnalyticsQuery: unknown;
  trendQuery: unknown;
  fredMessages: Array<{ client_id: string | null; created_at: string; role?: string }>;
  userMap: Map<string, string>;
  range: OpenRouterUsageRange;
  generatedAt: string;
}): OpenRouterAdminUsageSnapshot {
  const credits = normalizeCreditsPayload(inputs.credits);
  const keys = normalizeKeysPayload(inputs.keys);

  // Warnings and Truncated flags aggregation
  const allWarnings: string[] = [];
  let isTruncated = false;

  for (const queryPayload of [inputs.summaryQuery, inputs.modelsQuery, inputs.keyAnalyticsQuery, inputs.trendQuery]) {
    const meta = parseAnalyticsMetadataAndWarnings(queryPayload);
    if (meta.truncated) isTruncated = true;
    for (const w of meta.warnings) {
      if (!allWarnings.includes(w)) allWarnings.push(w);
    }
  }

  // Summary
  const summaryRoot = analyticsEnvelope(inputs.summaryQuery);
  const summaryData = Array.isArray(summaryRoot?.data) ? summaryRoot.data : [];
  const summaryRow = recordOf(summaryData[0]);
  const summary = normalizeSummaryRow(summaryRow);

  // Models
  const modelsRoot = analyticsEnvelope(inputs.modelsQuery);
  const modelsData = Array.isArray(modelsRoot?.data) ? modelsRoot.data : [];
  const models: OpenRouterModelUsage[] = [];

  for (const item of modelsData) {
    const row = recordOf(item);
    if (!row) continue;
    const model = cleanText(row.model) ?? "Unbekannt";
    const provider = cleanText(row.provider) || model.split("/")[0] || "OpenRouter";
    models.push({
      model,
      provider,
      requests: parseNonnegativeInteger(row.request_count),
      promptTokens: parseNonnegativeInteger(row.tokens_prompt),
      completionTokens: parseNonnegativeInteger(row.tokens_completion),
      reasoningTokens: parseNonnegativeInteger(row.reasoning_tokens),
      totalTokens: parseNonnegativeInteger(row.tokens_total),
      cost: parseNonnegativeNumber(row.total_usage),
      avgLatencyMs: parseLatencyMs(row.avg_latency),
    });
  }

  models.sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0));

  // Key Analytics & Map resolution
  const keyMap = new Map<string, OpenRouterKeyUsage>();
  for (const k of keys) {
    if (k.id) keyMap.set(k.id, k);
    if (k.name) keyMap.set(k.name.toLowerCase(), k);
  }

  let weKnoraCost = 0;
  const keyAnalyticsRoot = analyticsEnvelope(inputs.keyAnalyticsQuery);
  const keyAnalyticsData = Array.isArray(keyAnalyticsRoot?.data) ? keyAnalyticsRoot.data : [];

  for (const item of keyAnalyticsData) {
    const row = recordOf(item);
    if (!row) continue;
    const apiKeyId = cleanText(row.api_key_id) ?? "";
    const requests = parseNonnegativeInteger(row.request_count);
    const cost = parseNonnegativeNumber(row.total_usage);

    const existing = keyMap.get(apiKeyId) ?? keyMap.get(apiKeyId.toLowerCase());
    if (existing) {
      existing.requests = (existing.requests ?? 0) + (requests ?? 0);
      existing.cost = (existing.cost ?? 0) + (cost ?? 0);
    } else if (apiKeyId) {
      const newKey: OpenRouterKeyUsage = {
        id: apiKeyId,
        name: apiKeyId,
        requests,
        cost,
        usageDaily: null,
        usageWeekly: null,
        usageMonthly: null,
        limit: null,
        remainingLimit: null,
      };
      keys.push(newKey);
      keyMap.set(apiKeyId, newKey);
    }

    if (
      apiKeyId.toLowerCase().includes("weknora")
      || (existing && existing.name.toLowerCase().includes("weknora"))
    ) {
      weKnoraCost += cost ?? 0;
    }
  }

  // Time trend
  const trendRoot = analyticsEnvelope(inputs.trendQuery);
  const trendData = Array.isArray(trendRoot?.data) ? trendRoot.data : [];
  const dailyTrend: OpenRouterTimeTrendBucket[] = [];

  for (const item of trendData) {
    const row = recordOf(item);
    if (!row) continue;
    const rawDate = cleanText(row.date__hour)
      ?? cleanText(row.date__day)
      ?? cleanText(row.timestamp)
      ?? cleanText(row.date)
      ?? cleanText(row.time)
      ?? "";
    dailyTrend.push({
      date: rawDate,
      requests: parseNonnegativeInteger(row.request_count),
      tokens: parseNonnegativeInteger(row.tokens_total),
      cost: parseNonnegativeNumber(row.total_usage),
    });
  }

  // Fred per-user statistics
  const userQuestionCounts = new Map<string, { count: number; lastQuestionAt: string | null }>();
  let totalFredQuestions = 0;

  for (const msg of inputs.fredMessages) {
    const clientId = msg.client_id?.trim() || null;
    const key = clientId ?? "__system_unassigned__";
    const current = userQuestionCounts.get(key) ?? { count: 0, lastQuestionAt: null };
    current.count += 1;
    totalFredQuestions += 1;
    if (!current.lastQuestionAt || new Date(msg.created_at).getTime() > new Date(current.lastQuestionAt).getTime()) {
      current.lastQuestionAt = msg.created_at;
    }
    userQuestionCounts.set(key, current);
  }

  const fredUsersList: OpenRouterUserUsage[] = [];
  let systemRemainder: OpenRouterUserUsage | null = null;

  if (totalFredQuestions === 0) {
    systemRemainder = {
      clientId: null,
      email: "System / nicht zugeordnet",
      questions: 0,
      questionSharePct: 0,
      estimatedCost: weKnoraCost,
      costAttribution: DEFAULT_FRED_COST_ATTRIBUTION,
      lastQuestionAt: null,
    };
  } else {
    for (const [key, val] of userQuestionCounts.entries()) {
      const isUnassigned = key === "__system_unassigned__";
      const clientId = isUnassigned ? null : key;
      const email = isUnassigned
        ? "System / nicht zugeordnet"
        : inputs.userMap.get(key) ?? "Unbekannter User";
      const questionSharePct = (val.count / totalFredQuestions) * 100;
      const estimatedCost = (weKnoraCost * val.count) / totalFredQuestions;

      const userUsage: OpenRouterUserUsage = {
        clientId,
        email,
        questions: val.count,
        questionSharePct,
        estimatedCost,
        costAttribution: DEFAULT_FRED_COST_ATTRIBUTION,
        lastQuestionAt: val.lastQuestionAt,
      };

      if (isUnassigned) {
        systemRemainder = userUsage;
      } else {
        fredUsersList.push(userUsage);
      }
    }
  }

  fredUsersList.sort((a, b) => b.questions - a.questions);

  const fredUsers: OpenRouterFredUserStats = {
    totalQuestions: totalFredQuestions,
    weKnoraCost,
    costAttribution: DEFAULT_FRED_COST_ATTRIBUTION,
    users: fredUsersList,
    systemRemainder,
  };

  return {
    generatedAt: inputs.generatedAt,
    stale: false,
    range: inputs.range,
    credits,
    summary,
    models,
    keys,
    dailyTrend,
    fredUsers,
    warnings: allWarnings,
    truncated: isTruncated,
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(contentLength) && contentLength > MAX_OPENROUTER_RESPONSE_BYTES) {
    throw new Error("OpenRouter response exceeded maximum byte limit.");
  }
  if (!response.body) return response.json();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_OPENROUTER_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("OpenRouter response exceeded maximum byte limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return JSON.parse(text);
}

async function fetchOpenRouterJson(
  endpoint: string,
  options: { method?: "GET" | "POST"; body?: unknown },
  config: OpenRouterServerConfig,
  fetcher: typeof fetch,
): Promise<unknown> {
  const url = `${OPENROUTER_BASE_URL}${endpoint}`;
  const isPost = options.method === "POST";
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${config.apiKey}`,
  };
  if (isPost) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetcher(url, {
    method: options.method ?? "GET",
    headers,
    body: isPost ? JSON.stringify(options.body ?? {}) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(OPENROUTER_USAGE_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter request to ${endpoint} failed with status ${response.status}.`);
  }

  return readBoundedJson(response);
}

async function fetchFredMessagesAndUsers(
  supabase: SupabaseClient | null,
  startIso: string,
  endIso: string,
): Promise<{
  messages: Array<{ client_id: string | null; created_at: string; role: string }>;
  userMap: Map<string, string>;
}> {
  if (!supabase) {
    return { messages: [], userMap: new Map() };
  }

  const messages: Array<{ client_id: string | null; created_at: string; role: string }> = [];
  const messagePageSize = 1_000;
  for (let from = 0; ; from += messagePageSize) {
    const { data: messagesData, error: messagesError } = await supabase
      .from("fred_messages")
      .select("client_id, created_at, role")
      .eq("role", "user")
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .order("created_at", { ascending: false })
      .range(from, from + messagePageSize - 1);

    if (messagesError) {
      throw new Error(`Failed to query fred_messages: ${messagesError.message}`);
    }

    const page = Array.isArray(messagesData)
      ? messagesData as Array<{ client_id: string | null; created_at: string; role: string }>
      : [];
    messages.push(...page);
    if (page.length < messagePageSize) break;
  }

  const userMap = new Map<string, string>();

  // Resolve users with pagination
  let page = 1;
  const perPage = 1000;
  while (true) {
    const { data: authData, error: authError } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });
    if (authError || !authData?.users || authData.users.length === 0) {
      break;
    }
    for (const u of authData.users) {
      if (u.id) {
        userMap.set(u.id, u.email ?? u.id);
      }
    }
    if (authData.users.length < perPage) {
      break;
    }
    page += 1;
  }

  return { messages, userMap };
}

async function fetchUsageSnapshot(
  range: OpenRouterUsageRange,
  fetcher: typeof fetch,
  supabase: SupabaseClient | null,
): Promise<Omit<OpenRouterAdminUsageSnapshot, "stale" | "warning">> {
  const config = serverConfig();
  const generatedAt = new Date().toISOString();
  const window = rangeWindow(range);

  const metricsAll = [
    "request_count",
    "total_usage",
    "tokens_total",
    "tokens_prompt",
    "tokens_completion",
    "reasoning_tokens",
    "cached_tokens",
    "avg_latency",
    "p90_latency",
    "cache_hit_rate",
  ];

  const [
    credits,
    keys,
    summaryQuery,
    modelsQuery,
    keyAnalyticsQuery,
    trendQuery,
    fredData,
  ] = await Promise.all([
    fetchOpenRouterJson("/credits", { method: "GET" }, config, fetcher),
    fetchOpenRouterJson("/keys", { method: "GET" }, config, fetcher),
    fetchOpenRouterJson(
      "/analytics/query",
      {
        method: "POST",
        body: {
          time_range: window.timeRange,
          metrics: metricsAll,
        },
      },
      config,
      fetcher,
    ),
    fetchOpenRouterJson(
      "/analytics/query",
      {
        method: "POST",
        body: {
          time_range: window.timeRange,
          dimensions: ["model", "provider"],
          metrics: [
            "request_count",
            "total_usage",
            "tokens_prompt",
            "tokens_completion",
            "tokens_total",
            "reasoning_tokens",
            "avg_latency",
          ],
        },
      },
      config,
      fetcher,
    ),
    fetchOpenRouterJson(
      "/analytics/query",
      {
        method: "POST",
        body: {
          time_range: window.timeRange,
          dimensions: ["api_key_id"],
          metrics: ["request_count", "total_usage", "tokens_total"],
        },
      },
      config,
      fetcher,
    ),
    fetchOpenRouterJson(
      "/analytics/query",
      {
        method: "POST",
        body: {
          time_range: window.timeRange,
          granularity: window.granularity,
          metrics: ["request_count", "total_usage", "tokens_total"],
        },
      },
      config,
      fetcher,
    ),
    fetchFredMessagesAndUsers(supabase, window.timeRange.start, window.timeRange.end),
  ]);

  return normalizeOpenRouterUsagePayloads({
    credits,
    keys,
    summaryQuery,
    modelsQuery,
    keyAnalyticsQuery,
    trendQuery,
    fredMessages: fredData.messages,
    userMap: fredData.userMap,
    range,
    generatedAt,
  });
}

export async function getOpenRouterUsageSnapshot(
  range: OpenRouterUsageRange,
  options: {
    refresh?: boolean;
    fetcher?: typeof fetch;
    supabase?: SupabaseClient | null;
  } = {},
): Promise<OpenRouterAdminUsageSnapshot> {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const cached = usageCache.get(range);
  const now = Date.now();

  if (!options.refresh && cached && now - cached.fetchedAt < OPENROUTER_USAGE_CACHE_TTL_MS) {
    return { ...cached.snapshot, stale: false };
  }

  try {
    const snapshot = await fetchUsageSnapshot(range, fetcher, options.supabase ?? null);
    usageCache.set(range, {
      fetchedAt: Date.now(),
      snapshot,
    });
    return { ...snapshot, stale: false };
  } catch (error) {
    if (error instanceof UserVisibleError) throw error;
    if (cached) {
      return {
        ...cached.snapshot,
        stale: true,
        warning:
          "OpenRouter ist vorübergehend nicht erreichbar. Es werden zuletzt erfolgreich geladene Werte angezeigt.",
      };
    }
    throw new UserVisibleError("OpenRouter ist derzeit nicht erreichbar.", 503);
  }
}
