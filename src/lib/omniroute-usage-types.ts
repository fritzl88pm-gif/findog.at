export type OmniRouteUsageRange = "24h" | "7d" | "30d";

export type OmniRouteQuotaSnapshot = {
  used: number | null;
  total: number | null;
  remaining: number | null;
  remainingPercent: number | null;
  unlimited: boolean;
  resetAt: string | null;
  plan: string | null;
  source: string | null;
  quotaLabel: string | null;
  quotaFetchedAt: string | null;
  quotaSyncIntervalMinutes: number | null;
};

export type OmniRouteUsageSummary = {
  totalRequests: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  successfulRequests: number | null;
  successRatePct: number | null;
  avgLatencyMs: number | null;
  totalCost: number | null;
  fallbackCount: number | null;
  lastRequest: string | null;
};

export type OmniRouteModelUsage = {
  model: string;
  provider: string;
  requests: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  avgLatencyMs: number | null;
  successRatePct: number | null;
  cost: number | null;
  lastUsed: string | null;
};

export type OmniRouteProviderUsage = {
  provider: string;
  requests: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  avgLatencyMs: number | null;
  successRatePct: number | null;
  cost: number | null;
  lastUsed: string | null;
};

export type OmniRouteDailyTrend = {
  date: string;
  requests: number | null;
  tokens: number | null;
  cost: number | null;
};

export type OmniRouteUsageSnapshot = {
  summary: OmniRouteUsageSummary | null;
  models: OmniRouteModelUsage[];
  providers: OmniRouteProviderUsage[];
  dailyTrend: OmniRouteDailyTrend[];
};

export type OmniRouteComboModelStats = {
  model: string;
  requests: number | null;
  successes: number | null;
  failures: number | null;
  avgLatencyMs: number | null;
  lastStatus: string | null;
  lastUsedAt: string | null;
};

export type OmniRouteComboSnapshot = {
  name: string;
  strategy: string | null;
  targets: string[];
  version: number | null;
  updatedAt: string | null;
  productionTraffic: boolean;
  requests: number | null;
  successes: number | null;
  failures: number | null;
  fallbacks: number | null;
  avgLatencyMs: number | null;
  successRatePct: number | null;
  fallbackRatePct: number | null;
  lastUsedAt: string | null;
  models: OmniRouteComboModelStats[];
};

export type OmniRouteModelHealth = {
  model: string;
  status: string | null;
  isLockedOut: boolean;
  lockoutRemainingMs: number | null;
  requests: number | null;
  successes: number | null;
  successRatePct: number | null;
  avgLatencyMs: number | null;
  lastStatus: string | null;
  lastErrorStatus: string | null;
  lastRequestAt: string | null;
  lastErrorAt: string | null;
};

export type OmniRouteProviderHealth = {
  provider: "codex" | "gemini";
  state: string | null;
  connections: number | null;
  modelLockoutCount: number | null;
  requests: number | null;
  successRatePct: number | null;
  avgLatencyMs: number | null;
  cooldownRemainingMs: number | null;
  rateLimitedUntil: string | null;
  lastRequestAt: string | null;
  lastErrorAt: string | null;
  lastErrorType: string | null;
  lastErrorCode: string | null;
  models: OmniRouteModelHealth[];
};

export type OmniRouteAdminUsageSnapshot = {
  generatedAt: string;
  stale: boolean;
  range: OmniRouteUsageRange;
  quota: OmniRouteQuotaSnapshot | null;
  codexQuota: OmniRouteQuotaSnapshot | null;
  usage: OmniRouteUsageSnapshot;
  combo: OmniRouteComboSnapshot | null;
  providerHealth: OmniRouteProviderHealth[];
  warning?: string;
};
