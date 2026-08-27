export type OpenRouterUsageRange = "24h" | "7d" | "30d";

export type OpenRouterUserCostAttribution = "estimated_request_share";

export type OpenRouterCreditsSnapshot = {
  totalCredits: number | null;
  totalUsage: number | null;
  remaining: number | null;
  remainingPercent: number | null;
};

export type OpenRouterUsageSummary = {
  requests: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
  cachedTokens: number | null;
  cacheHitRate: number | null;
  avgLatencyMs: number | null;
  p90LatencyMs: number | null;
  totalCost: number | null;
};

export type OpenRouterModelUsage = {
  model: string;
  provider: string;
  requests: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
  cost: number | null;
  avgLatencyMs: number | null;
};

export type OpenRouterKeyUsage = {
  id: string;
  name: string;
  requests: number | null;
  cost: number | null;
  usageDaily: number | null;
  usageWeekly: number | null;
  usageMonthly: number | null;
  limit: number | null;
  remainingLimit: number | null;
};

export type OpenRouterTimeTrendBucket = {
  date: string;
  requests: number | null;
  tokens: number | null;
  cost: number | null;
};

export type OpenRouterUserUsage = {
  clientId: string | null;
  email: string;
  questions: number;
  questionSharePct: number;
  estimatedCost: number;
  costAttribution: OpenRouterUserCostAttribution;
  lastQuestionAt: string | null;
};

export type OpenRouterFredUserStats = {
  totalQuestions: number;
  weKnoraCost: number;
  costAttribution: OpenRouterUserCostAttribution;
  users: OpenRouterUserUsage[];
  systemRemainder: OpenRouterUserUsage | null;
};

export type OpenRouterAdminUsageSnapshot = {
  generatedAt: string;
  stale: boolean;
  range: OpenRouterUsageRange;
  credits: OpenRouterCreditsSnapshot | null;
  summary: OpenRouterUsageSummary | null;
  models: OpenRouterModelUsage[];
  keys: OpenRouterKeyUsage[];
  dailyTrend: OpenRouterTimeTrendBucket[];
  fredUsers: OpenRouterFredUserStats;
  warnings: string[];
  truncated: boolean;
  warning?: string;
};
