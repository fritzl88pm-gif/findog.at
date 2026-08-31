import { UserVisibleError } from "./errors";
import type {
  OmniRouteAdminUsageSnapshot,
  OmniRouteComboModelStats,
  OmniRouteDailyTrend,
  OmniRouteModelHealth,
  OmniRouteModelUsage,
  OmniRouteProviderHealth,
  OmniRouteProviderUsage,
  OmniRouteQuotaSnapshot,
  OmniRouteRouteSnapshot,
  OmniRouteUsageRange,
  OmniRouteUsageSnapshot,
  OmniRouteUsageSummary,
} from "./omniroute-usage-types";

export const OMNIROUTE_USAGE_CACHE_TTL_MS = 5 * 60 * 1_000;
export const OMNIROUTE_USAGE_TIMEOUT_MS = 10_000;
const MAX_OMNIROUTE_RESPONSE_BYTES = 2 * 1_024 * 1_024;

type JsonRecord = Record<string, unknown>;
type ProviderKind = "codex" | "gemini" | "openrouter" | "deepseek";
type ProviderConnectionMap = Map<string, ProviderKind>;

type InternalRouteTarget = {
  model: string;
  provider: ProviderKind;
};

type OmniRouteServerConfig = {
  baseUrl: string;
  apiKey: string;
};

type UsageCacheEntry = {
  fetchedAt: number;
  snapshot: Omit<OmniRouteAdminUsageSnapshot, "stale" | "warning">;
};

class OmniRoutePayloadError extends Error {
  constructor() {
    super("OmniRoute returned an invalid payload.");
    this.name = "OmniRoutePayloadError";
  }
}

const usageCache = new Map<OmniRouteUsageRange, UsageCacheEntry>();

export function clearOmniRouteUsageCacheForTests(): void {
  usageCache.clear();
}

function recordOf(value: unknown): JsonRecord | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new OmniRoutePayloadError();
  return value as JsonRecord;
}

function requiredArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new OmniRoutePayloadError();
  return value;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonnegativeNumber(value: unknown): number | null {
  const number = finiteNumber(value);
  return number === null || number < 0 ? null : number;
}

function integer(value: unknown): number | null {
  const number = nonnegativeNumber(value);
  return number !== null && Number.isSafeInteger(number) ? number : null;
}

function percent(value: unknown): number | null {
  let candidate: number | null;
  if (typeof value === "string") {
    const text = value.trim();
    if (text.length === 0 || text.length > 16 || !/^\d+(?:\.\d+)?$/u.test(text)) return null;
    candidate = Number(text);
    if (!Number.isFinite(candidate)) return null;
  } else {
    candidate = nonnegativeNumber(value);
  }
  return candidate === null ? null : Math.min(100, candidate);
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function latestTimestamp(current: string | null, next: string | null): string | null {
  if (!current) return next;
  if (!next) return current;
  return new Date(next).getTime() >= new Date(current).getTime() ? next : current;
}

function publicText(value: unknown, maxLength = 120): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) return null;
  if (/[\u0000-\u001f\u007f]/u.test(value)) return null;
  return value.trim() || null;
}

function publicToken(value: unknown, maxLength = 100): string | null {
  const text = publicText(value, maxLength);
  return text && /^[A-Za-z0-9][A-Za-z0-9 _./:-]*$/u.test(text) ? text : null;
}

function modelText(value: unknown): string | null {
  const text = publicText(value, 200);
  return text && /^[A-Za-z0-9][A-Za-z0-9._/:+-]{0,199}$/u.test(text) ? text : null;
}

function providerKind(value: unknown): ProviderKind | null {
  const text = typeof value === "string" ? value.toLowerCase() : "";
  if (text.includes("deepseek")) return "deepseek";
  if (text.includes("codex")) return "codex";
  if (text.includes("antigravity") || text.includes("agy") || text.includes("gemini")) return "gemini";
  if (text.includes("openrouter")) return "openrouter";
  return null;
}

function publicProvider(kind: ProviderKind): string {
  if (kind === "deepseek") return "DeepSeek";
  if (kind === "codex") return "OpenAI Codex";
  return kind === "gemini" ? "Gemini / Antigravity" : "OpenRouter";
}

function sameModel(candidate: string, target: string): boolean {
  if (candidate === target) return true;
  const candidateBase = candidate.split("/").pop() ?? candidate;
  const targetBase = target.split("/").pop() ?? target;
  return candidateBase === targetBase;
}

function quotaModelScore(model: string): number {
  const normalized = model.toLowerCase();
  if (normalized === "gemini-3.7-flash-high") return 1_000;
  if (normalized === "gemini-3.6-flash-high") return 900;
  if (normalized.includes("gemini") && normalized.includes("flash")) return 800;
  return -1;
}

function normalizeQuota(
  value: unknown,
  cache: JsonRecord,
  intervalMinutes: unknown,
): OmniRouteQuotaSnapshot | null {
  const quota = recordOf(value);
  if (!quota) return null;
  const unlimited = quota.unlimited === true;
  const used = nonnegativeNumber(quota.used);
  const total = unlimited ? null : nonnegativeNumber(quota.total);
  const reportedRemaining = unlimited ? null : nonnegativeNumber(quota.remaining);
  const reportedRemainingPercent = percent(quota.remainingPercentage);
  const calculatedRemainingPercent = reportedRemaining !== null && total !== null && total > 0
    ? (reportedRemaining / total) * 100
    : used !== null && total !== null && total > 0
      ? ((total - used) / total) * 100
      : null;
  const remainingPercent = reportedRemainingPercent
    ?? (calculatedRemainingPercent === null ? null : Math.max(0, Math.min(100, calculatedRemainingPercent)));
  if (
    !unlimited
    && used === null
    && total === null
    && reportedRemaining === null
    && remainingPercent === null
  ) return null;

  return {
    used,
    total,
    remaining: unlimited ? null : reportedRemaining,
    remainingPercent: unlimited ? 100 : remainingPercent,
    unlimited,
    resetAt: timestamp(quota.resetAt),
    plan: publicText(quota.plan ?? cache.plan, 120),
    source: publicText(quota.quotaSource ?? cache.source, 120),
    quotaLabel: publicToken(quota.displayName ?? quota.interval ?? cache.displayName, 40),
    quotaFetchedAt: timestamp(quota.fetchedAt ?? cache.fetchedAt),
    quotaSyncIntervalMinutes: integer(intervalMinutes ?? cache.intervalMinutes),
  };
}

function preferredQuota<T extends { score?: number }>(
  candidates: Array<T & { quota: OmniRouteQuotaSnapshot }>,
): T & { quota: OmniRouteQuotaSnapshot } | null {
  return candidates.sort((left, right) => (right.score ?? 0) - (left.score ?? 0)
    || (right.quota.quotaFetchedAt ? new Date(right.quota.quotaFetchedAt).getTime() : 0)
      - (left.quota.quotaFetchedAt ? new Date(left.quota.quotaFetchedAt).getTime() : 0))[0] ?? null;
}

export function normalizeProviderConnectionsPayload(payload: unknown): ProviderConnectionMap {
  const root = recordOf(payload);
  if (!root) throw new OmniRoutePayloadError();
  const connections = root.connections === undefined || root.connections === null
    ? []
    : requiredArray(root.connections);
  const mapping: ProviderConnectionMap = new Map();
  for (const connectionValue of connections) {
    const connection = recordOf(connectionValue);
    if (!connection) continue;
    const id = publicText(connection.id, 200);
    const kind = providerKind(connection.provider);
    if (!id || !kind) continue;
    const existing = mapping.get(id);
    if (existing && existing !== kind) throw new OmniRoutePayloadError();
    mapping.set(id, kind);
  }
  return mapping;
}

function cacheProviderKind(cacheId: string, connections: ProviderConnectionMap): ProviderKind | null {
  return connections.get(cacheId) ?? null;
}

function normalizeQuotaSnapshots(
  payload: unknown,
  connections: ProviderConnectionMap,
): { quota: OmniRouteQuotaSnapshot | null; codexQuota: OmniRouteQuotaSnapshot | null } {
  const root = recordOf(payload);
  const caches = root?.caches === undefined || root.caches === null ? null : recordOf(root.caches);
  if (!root || !caches) return { quota: null, codexQuota: null };

  const geminiCandidates: Array<{ model: string; quota: OmniRouteQuotaSnapshot; score: number }> = [];
  const codexCandidates: Array<{ quota: OmniRouteQuotaSnapshot }> = [];
  for (const [cacheId, cacheValue] of Object.entries(caches)) {
    const kind = cacheProviderKind(cacheId, connections);
    if (!kind) continue;
    const cache = recordOf(cacheValue);
    if (!cache) continue;
    const quotasValue = cache.quotas === undefined || cache.quotas === null ? null : recordOf(cache.quotas);
    if (!quotasValue) continue;

    if (kind === "codex") {
      const session = quotasValue.session === undefined || quotasValue.session === null
        ? null
        : recordOf(quotasValue.session);
      if (session) {
        const quota = normalizeQuota(session, cache, root.intervalMinutes);
        if (quota) codexCandidates.push({ quota });
      }
      continue;
    }

    if (kind !== "gemini") continue;
    for (const [model, quotaValue] of Object.entries(quotasValue)) {
      const score = quotaModelScore(model);
      if (score < 0) continue;
      const quota = normalizeQuota(quotaValue, cache, root.intervalMinutes);
      if (quota) geminiCandidates.push({ quota, model, score });
    }
  }

  const preferredGemini = preferredQuota(geminiCandidates);
  return {
    quota: preferredGemini?.quota ?? null,
    codexQuota: preferredQuota(codexCandidates)?.quota ?? null,
  };
}

export function normalizeProviderLimitsPayload(
  payload: unknown,
  providerConnections?: unknown,
): OmniRouteQuotaSnapshot | null {
  return normalizeQuotaSnapshots(
    payload,
    normalizeProviderConnectionsPayload(providerConnections ?? { connections: [] }),
  ).quota;
}

export function normalizeProviderQuotasPayload(
  payload: unknown,
  providerConnections: unknown,
): { quota: OmniRouteQuotaSnapshot | null; codexQuota: OmniRouteQuotaSnapshot | null } {
  return normalizeQuotaSnapshots(payload, normalizeProviderConnectionsPayload(providerConnections));
}

function normalizeUsageSummary(value: unknown): OmniRouteUsageSummary | null {
  const summary = recordOf(value);
  if (!summary) return null;
  return {
    totalRequests: integer(summary.totalRequests),
    promptTokens: integer(summary.promptTokens),
    completionTokens: integer(summary.completionTokens),
    totalTokens: integer(summary.totalTokens),
    successfulRequests: integer(summary.successfulRequests),
    successRatePct: percent(summary.successRatePct),
    avgLatencyMs: nonnegativeNumber(summary.avgLatencyMs),
    totalCost: nonnegativeNumber(summary.totalCost),
    fallbackCount: integer(summary.fallbackCount),
    lastRequest: timestamp(summary.lastRequest),
  };
}

function normalizeModelUsage(value: unknown): OmniRouteModelUsage | null {
  const entry = recordOf(value);
  if (!entry) return null;
  const kind = providerKind(entry.provider) ?? providerKind(entry.model);
  if (!kind) return null;
  const model = modelText(entry.model);
  if (!model) return null;
  return {
    model,
    provider: publicProvider(kind),
    requests: integer(entry.requests),
    promptTokens: integer(entry.promptTokens),
    completionTokens: integer(entry.completionTokens),
    totalTokens: integer(entry.totalTokens),
    avgLatencyMs: nonnegativeNumber(entry.avgLatencyMs),
    successRatePct: percent(entry.successRatePct),
    cost: nonnegativeNumber(entry.cost),
    lastUsed: timestamp(entry.lastUsed),
  };
}

function normalizeProviderUsage(value: unknown): OmniRouteProviderUsage | null {
  const entry = recordOf(value);
  if (!entry) return null;
  const kind = providerKind(entry.provider);
  if (!kind) return null;
  return {
    provider: publicProvider(kind),
    requests: integer(entry.requests),
    promptTokens: integer(entry.promptTokens),
    completionTokens: integer(entry.completionTokens),
    totalTokens: integer(entry.totalTokens),
    avgLatencyMs: nonnegativeNumber(entry.avgLatencyMs),
    successRatePct: percent(entry.successRatePct),
    cost: nonnegativeNumber(entry.cost),
    lastUsed: timestamp(entry.lastUsed),
  };
}

function normalizeDailyTrend(value: unknown): OmniRouteDailyTrend | null {
  const entry = recordOf(value);
  if (!entry) return null;
  const date = publicText(entry.date, 32);
  if (!date || !/^\d{4}-\d{2}-\d{2}(?:[Tt][^\s]+)?$/u.test(date)) return null;
  return {
    date,
    requests: integer(entry.requests),
    tokens: integer(entry.tokens ?? entry.totalTokens),
    cost: nonnegativeNumber(entry.cost),
  };
}

export function normalizeAnalyticsPayload(payload: unknown): OmniRouteUsageSnapshot {
  const root = recordOf(payload);
  if (!root) {
    return { summary: null, models: [], providers: [], dailyTrend: [] };
  }
  const summary = normalizeUsageSummary(root.summary);
  const models = root.byModel === undefined || root.byModel === null
    ? []
    : requiredArray(root.byModel)
      .map(normalizeModelUsage)
      .filter((entry): entry is OmniRouteModelUsage => entry !== null)
      .slice(0, 100);
  const providers = root.byProvider === undefined || root.byProvider === null
    ? []
    : requiredArray(root.byProvider)
      .map(normalizeProviderUsage)
      .filter((entry): entry is OmniRouteProviderUsage => entry !== null)
      .slice(0, 10);
  const dailyTrend = root.dailyTrend === undefined || root.dailyTrend === null
    ? []
    : requiredArray(root.dailyTrend)
      .map(normalizeDailyTrend)
      .filter((entry): entry is OmniRouteDailyTrend => entry !== null)
      .slice(0, 31);

  return { summary, models, providers, dailyTrend };
}

export type NormalizedComboConfig = {
  name: string;
  strategy: string | null;
  targets: string[];
  routeTargets: InternalRouteTarget[];
  version: number | null;
  updatedAt: string | null;
};

export function normalizeCombosConfiguration(
  payload: unknown,
  connections?: ProviderConnectionMap,
): NormalizedComboConfig[] {
  let combos: unknown[] | null = null;
  if (Array.isArray(payload)) {
    combos = payload;
  } else {
    const root = recordOf(payload);
    combos = root?.combos === undefined || root?.combos === null
      ? null
      : requiredArray(root.combos);
  }
  if (!combos) return [];

  const results: NormalizedComboConfig[] = [];
  for (const item of combos) {
    const combo = recordOf(item);
    if (!combo) continue;
    const name = publicToken(combo.name, 120);
    if (!name) continue;

    const rawModels = combo.models === undefined || combo.models === null
      ? []
      : requiredArray(combo.models)
        .map((value) => recordOf(value))
        .filter((value): value is JsonRecord => value !== null);

    const routeTargets: InternalRouteTarget[] = [];
    const targets: string[] = [];
    for (const modelVal of rawModels) {
      const model = modelText(modelVal.model);
      const providerId = publicText(modelVal.providerId, 200);
      const kind = (providerId && connections ? connections.get(providerId) : null) ?? providerKind(providerId);
      if (model) {
        targets.push(model);
        if (kind) {
          routeTargets.push({ model, provider: kind });
        }
      }
    }

    results.push({
      name,
      strategy: publicToken(combo.strategy, 60),
      targets,
      routeTargets,
      version: integer(combo.version),
      updatedAt: timestamp(combo.updatedAt),
    });
  }
  return results;
}

function comboModelEntries(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "object") {
    return Object.entries(value as JsonRecord).map(([model, stats]) => {
      const entry = recordOf(stats);
      return entry ? { ...entry, model: entry.model ?? model } : stats;
    });
  }
  throw new OmniRoutePayloadError();
}

function normalizeComboModelStats(
  value: unknown,
  targets: string[],
): OmniRouteComboModelStats | null {
  const entry = recordOf(value);
  if (!entry) return null;
  const model = modelText(entry.model);
  if (!model || (targets.length > 0 && !targets.some((target) => sameModel(model, target)))) return null;
  return {
    model,
    requests: integer(entry.requests ?? entry.totalRequests),
    successes: integer(entry.successes ?? entry.totalSuccesses),
    failures: integer(entry.failures ?? entry.totalFailures),
    avgLatencyMs: nonnegativeNumber(entry.avgLatencyMs),
    lastStatus: publicToken(entry.lastStatus, 60),
    lastUsedAt: timestamp(entry.lastUsedAt ?? entry.lastUsed),
  };
}

export function normalizeRoutesPayload(
  providerStatsPayload: unknown,
  comboConfigs: NormalizedComboConfig[],
): OmniRouteRouteSnapshot[] {
  const root = recordOf(providerStatsPayload);
  const metricsRoot = root?.comboMetrics === undefined || root?.comboMetrics === null
    ? null
    : recordOf(root.comboMetrics);

  return comboConfigs.map((config) => {
    const metrics = metricsRoot && config.name in metricsRoot
      ? recordOf(metricsRoot[config.name])
      : null;

    const models = comboModelEntries(metrics?.byModel)
      .map((value) => normalizeComboModelStats(value, config.targets))
      .filter((value): value is OmniRouteComboModelStats => value !== null)
      .slice(0, 20);

    return {
      name: config.name,
      strategy: publicToken(metrics?.strategy ?? config.strategy, 60),
      targets: config.targets,
      version: config.version,
      updatedAt: config.updatedAt,
      productionTraffic: metrics?.productionTraffic === true,
      requests: integer(metrics?.totalRequests ?? metrics?.requests),
      successes: integer(metrics?.totalSuccesses ?? metrics?.successes),
      failures: integer(metrics?.totalFailures ?? metrics?.failures),
      fallbacks: integer(metrics?.totalFallbacks ?? metrics?.fallbacks),
      avgLatencyMs: nonnegativeNumber(metrics?.avgLatencyMs),
      successRatePct: percent(metrics?.successRate ?? metrics?.successRatePct),
      fallbackRatePct: percent(metrics?.fallbackRate ?? metrics?.fallbackRatePct),
      lastUsedAt: timestamp(metrics?.lastUsedAt ?? metrics?.lastUsed),
      models,
    };
  });
}

function aggregateModelHealth(
  entries: JsonRecord[],
  target: string,
): OmniRouteModelHealth {
  let requests = 0;
  let successes = 0;
  let latencyWeight = 0;
  let avgLatencySum = 0;
  let hasCounts = false;
  let isLockedOut = false;
  let lockoutRemainingMs: number | null = null;
  let status: string | null = null;
  let lastStatus: string | null = null;
  let lastErrorStatus: string | null = null;
  let lastRequestAt: string | null = null;
  let lastErrorAt: string | null = null;

  for (const entry of entries) {
    isLockedOut = isLockedOut || entry.isLockedOut === true;
    const remaining = integer(entry.lockoutRemainingMs);
    if (remaining !== null) lockoutRemainingMs = Math.max(lockoutRemainingMs ?? 0, remaining);
    const entryRequests = integer(entry.requests);
    const entrySuccesses = integer(entry.successes);
    const entryLatency = nonnegativeNumber(entry.avgLatencyMs);
    if (entryRequests !== null) {
      requests += entryRequests;
      hasCounts = true;
      if (entryLatency !== null) {
        avgLatencySum += entryLatency * entryRequests;
        latencyWeight += entryRequests;
      }
    }
    if (entrySuccesses !== null) {
      successes += entrySuccesses;
      hasCounts = true;
    }

    const entryLastRequestAt = timestamp(entry.lastRequestAt);
    if (entryLastRequestAt && (!lastRequestAt || new Date(entryLastRequestAt) >= new Date(lastRequestAt))) {
      lastRequestAt = entryLastRequestAt;
      status = publicToken(entry.status, 60);
      lastStatus = publicToken(entry.lastStatus ?? entry.status, 60);
    }
    const entryLastErrorAt = timestamp(entry.lastErrorAt);
    if (entryLastErrorAt && (!lastErrorAt || new Date(entryLastErrorAt) >= new Date(lastErrorAt))) {
      lastErrorAt = entryLastErrorAt;
      lastErrorStatus = publicToken(entry.lastErrorStatus ?? entry.errorCode, 60);
    }
  }

  const successRate = hasCounts && requests > 0
    ? Math.min(100, Math.max(0, (successes / requests) * 100))
    : null;
  return {
    model: target,
    status,
    isLockedOut,
    lockoutRemainingMs,
    requests: hasCounts ? requests : null,
    successes: hasCounts ? successes : null,
    successRatePct: successRate,
    avgLatencyMs: latencyWeight > 0 ? avgLatencySum / latencyWeight : null,
    lastStatus,
    lastErrorStatus,
    lastRequestAt,
    lastErrorAt,
  };
}

function normalizeProviderHealth(
  value: unknown,
  targetModels: string[],
): OmniRouteProviderHealth | null {
  const provider = recordOf(value);
  if (!provider) return null;
  const kind = providerKind(provider.provider);
  if (kind !== "codex" && kind !== "gemini") return null;

  const accounts = provider.accounts === undefined || provider.accounts === null
    ? []
    : requiredArray(provider.accounts)
      .map((accountValue) => recordOf(accountValue))
      .filter((account): account is JsonRecord => account !== null);

  let cooldownRemainingMs: number | null = null;
  let rateLimitedUntil: string | null = null;
  let lastErrorAt: string | null = timestamp(provider.lastErrorAt);
  let lastErrorType: string | null = null;
  let lastErrorCode: string | null = null;
  const connections = typeof provider.connections === "object" && provider.connections !== null
    ? recordOf(provider.connections)?.total
    : provider.connections;

  const allAccountModels: JsonRecord[] = [];
  for (const account of accounts) {
    const accountCooldown = integer(account.cooldownRemainingMs);
    if (accountCooldown !== null) cooldownRemainingMs = Math.max(cooldownRemainingMs ?? 0, accountCooldown);
    rateLimitedUntil = latestTimestamp(rateLimitedUntil, timestamp(account.rateLimitedUntil));
    const accountErrorAt = timestamp(account.lastErrorAt);
    const providerErrorAt = timestamp(provider.lastErrorAt);
    const effectiveErrorAt = latestTimestamp(accountErrorAt, providerErrorAt === lastErrorAt ? providerErrorAt : null);
    if (effectiveErrorAt && (!lastErrorAt || new Date(effectiveErrorAt) >= new Date(lastErrorAt))) {
      lastErrorAt = effectiveErrorAt;
      lastErrorType = publicToken(account.lastErrorType, 80);
      lastErrorCode = publicToken(account.errorCode, 60);
    }
    const models = account.models === undefined || account.models === null
      ? []
      : requiredArray(account.models)
        .map((modelValue) => recordOf(modelValue))
        .filter((model): model is JsonRecord => model !== null);
    allAccountModels.push(...models);
  }

  const modelHealthList: OmniRouteModelHealth[] = [];
  for (const target of targetModels) {
    const matching = allAccountModels.filter((model) => {
      const candidate = modelText(model.model);
      return candidate !== null && sameModel(candidate, target);
    });
    if (matching.length > 0) {
      modelHealthList.push(aggregateModelHealth(matching, target));
    }
  }

  return {
    provider: kind,
    state: publicToken(provider.state, 60),
    connections: integer(connections),
    modelLockoutCount: integer(provider.modelLockoutCount),
    requests: integer(provider.requests),
    successRatePct: percent(provider.successRate),
    avgLatencyMs: nonnegativeNumber(provider.avgLatencyMs),
    cooldownRemainingMs,
    rateLimitedUntil,
    lastRequestAt: timestamp(provider.lastRequestAt),
    lastErrorAt,
    lastErrorType,
    lastErrorCode,
    models: modelHealthList,
  };
}

export function normalizeHealthMatrixPayload(
  payload: unknown,
  routeTargets: InternalRouteTarget[],
): OmniRouteProviderHealth[] {
  const root = recordOf(payload);
  if (!root) return [];
  const providers = root.providers === undefined || root.providers === null
    ? []
    : requiredArray(root.providers);
  const records = providers
    .map((value) => recordOf(value))
    .filter((value): value is JsonRecord => value !== null);

  const relevantProviders: Array<"codex" | "gemini"> = ["codex", "gemini"];
  const results: OmniRouteProviderHealth[] = [];

  for (const kind of relevantProviders) {
    const providerRecord = records
      .filter((entry) => providerKind(entry.provider) === kind)
      .sort((left, right) => {
        const score = (entry: JsonRecord) => (
          kind === "gemini" && entry.provider === "antigravity" ? 1 : 0
        );
        return score(right) - score(left);
      })[0];
    if (!providerRecord) continue;

    const targetsForProvider = routeTargets
      .filter((target) => target.provider === kind)
      .map((target) => target.model);
    const uniqueTargets = Array.from(new Set(targetsForProvider));

    const normalized = normalizeProviderHealth(providerRecord, uniqueTargets);
    if (normalized) results.push(normalized);
  }

  return results;
}

export function normalizeOmniRouteUsagePayloads(input: {
  providerLimits: unknown;
  providerConnections: unknown;
  analytics: unknown;
  providerStats: unknown;
  healthMatrix: unknown;
  combos: unknown;
  range: OmniRouteUsageRange;
  generatedAt?: string;
}): Omit<OmniRouteAdminUsageSnapshot, "stale" | "warning"> {
  const connections = normalizeProviderConnectionsPayload(input.providerConnections);
  const comboConfigs = normalizeCombosConfiguration(input.combos, connections);
  const allRouteTargets = comboConfigs.flatMap((c) => c.routeTargets);
  const usage = normalizeAnalyticsPayload(input.analytics);
  const quotas = normalizeProviderQuotasPayload(input.providerLimits, input.providerConnections);
  const generatedAt = timestamp(input.generatedAt ?? new Date(Date.now()).toISOString()) ?? new Date(Date.now()).toISOString();

  const routes = normalizeRoutesPayload(input.providerStats, comboConfigs);

  return {
    generatedAt,
    range: input.range,
    quota: quotas.quota,
    codexQuota: quotas.codexQuota,
    usage,
    routes,
    providerHealth: normalizeHealthMatrixPayload(input.healthMatrix, allRouteTargets),
  };
}

function serverConfig(): OmniRouteServerConfig {
  const baseUrlValue = process.env.OMNIROUTE_ADMIN_BASE_URL?.trim() ?? "";
  const apiKey = process.env.OMNIROUTE_ADMIN_API_KEY?.trim() ?? "";
  if (!baseUrlValue || !apiKey) {
    throw new UserVisibleError("OmniRoute ist serverseitig nicht konfiguriert.", 503);
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(baseUrlValue);
  } catch {
    throw new UserVisibleError("OmniRoute ist serverseitig nicht konfiguriert.", 503);
  }
  if (
    (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:")
    || baseUrl.username
    || baseUrl.password
    || baseUrl.search
    || baseUrl.hash
  ) {
    throw new UserVisibleError("OmniRoute ist serverseitig nicht konfiguriert.", 503);
  }

  return { baseUrl: baseUrl.toString().replace(/\/+$/u, ""), apiKey };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(contentLength) && contentLength > MAX_OMNIROUTE_RESPONSE_BYTES) {
    throw new Error("OmniRoute request failed.");
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
      if (total > MAX_OMNIROUTE_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("OmniRoute request failed.");
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

async function fetchOmniRouteJson(
  endpoint: string,
  config: OmniRouteServerConfig,
  fetcher: typeof fetch,
): Promise<unknown> {
  const response = await fetcher(new URL(`${config.baseUrl}${endpoint}`).toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(OMNIROUTE_USAGE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("OmniRoute request failed.");
  try {
    return await readBoundedJson(response);
  } catch {
    throw new Error("OmniRoute request failed.");
  }
}

async function fetchUsageSnapshot(
  range: OmniRouteUsageRange,
  fetcher: typeof fetch,
): Promise<Omit<OmniRouteAdminUsageSnapshot, "stale" | "warning">> {
  const config = serverConfig();
  const generatedAt = new Date(Date.now()).toISOString();
  const [
    providerLimits,
    providerConnections,
    analytics,
    providerStats,
    healthMatrix,
    combos,
  ] = await Promise.all([
    fetchOmniRouteJson("/api/usage/provider-limits", config, fetcher),
    fetchOmniRouteJson("/api/providers", config, fetcher),
    fetchOmniRouteJson(`/api/usage/analytics?range=${encodeURIComponent(range)}`, config, fetcher),
    fetchOmniRouteJson("/api/provider-stats", config, fetcher),
    fetchOmniRouteJson("/api/providers/health-matrix", config, fetcher),
    fetchOmniRouteJson("/api/combos", config, fetcher),
  ]);

  return normalizeOmniRouteUsagePayloads({
    providerLimits,
    providerConnections,
    analytics,
    providerStats,
    healthMatrix,
    combos,
    range,
    generatedAt,
  });
}

export async function getOmniRouteUsageSnapshot(
  range: OmniRouteUsageRange,
  options: { refresh?: boolean; fetcher?: typeof fetch } = {},
): Promise<OmniRouteAdminUsageSnapshot> {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const cached = usageCache.get(range);
  const now = Date.now();
  if (!options.refresh && cached && now - cached.fetchedAt < OMNIROUTE_USAGE_CACHE_TTL_MS) {
    return { ...cached.snapshot, stale: false };
  }

  try {
    const snapshot = await fetchUsageSnapshot(range, fetcher);
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
        warning: "OmniRoute ist vorübergehend nicht erreichbar. Es werden zuletzt erfolgreich geladene Werte angezeigt.",
      };
    }
    throw new UserVisibleError("OmniRoute ist derzeit nicht erreichbar.", 503);
  }
}
