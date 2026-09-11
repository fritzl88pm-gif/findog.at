/**
 * Shared contracts for the Findog Independent Agent (Preview).
 *
 * Everything here is feature-local. Configuration is stored as immutable
 * revisions; secrets never appear in the settings document and are held only as
 * server-encrypted ciphertext in a separate column.
 */

export const FINDOG_AGENT_SCHEMA_VERSION = 1;

export const FINDOG_AGENT_PROVIDERS = ["deepseek", "openrouter", "openai-compatible"] as const;
export type FindogAgentProvider = (typeof FINDOG_AGENT_PROVIDERS)[number];

export const FINDOG_AGENT_MODEL_CAPABILITIES = ["tools", "reasoning", "streaming"] as const;
export type FindogAgentModelCapability = (typeof FINDOG_AGENT_MODEL_CAPABILITIES)[number];

export const FINDOG_AGENT_REASONING_EFFORTS = ["low", "medium", "high", "max"] as const;
export type FindogAgentReasoningEffort = (typeof FINDOG_AGENT_REASONING_EFFORTS)[number];

export const FINDOG_AGENT_WEB_MODES = ["off", "auto", "on"] as const;
export type FindogAgentWebMode = (typeof FINDOG_AGENT_WEB_MODES)[number];

export const FINDOG_AGENT_RUN_STATES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type FindogAgentRunState = (typeof FINDOG_AGENT_RUN_STATES)[number];

export const FINDOG_AGENT_EVENT_KINDS = [
  "status",
  "plan",
  "step",
  "tool_call",
  "tool_result",
  "source",
  "usage",
  "output",
  "error",
  "heartbeat",
] as const;
export type FindogAgentEventKind = (typeof FINDOG_AGENT_EVENT_KINDS)[number];

/** Bounds shared by settings validation, the SQL layer and the worker. */
export const FINDOG_AGENT_LIMITS = {
  maxNameCharacters: 120,
  maxSystemPromptCharacters: 20000,
  maxModelLabelCharacters: 120,
  maxModelIdCharacters: 200,
  maxUrlCharacters: 500,
  maxKnowledgeBaseIds: 25,
  maxAllowedDomains: 25,
  maxMcpServers: 10,
  maxMcpAllowedTools: 50,
  maxQuestionCharacters: 20000,
  maxAnswerCharacters: 200000,
  minLeaseSeconds: 15,
  maxLeaseSeconds: 3600,
} as const;

export type FindogAgentConnection = {
  id: string;
  name: string;
  provider: FindogAgentProvider;
  baseUrl: string;
};

export type FindogAgentModel = {
  id: string;
  label: string;
  connectionId: string;
  model: string;
  reasoningEffort: FindogAgentReasoningEffort | null;
  capabilities: FindogAgentModelCapability[];
  maxOutputTokens: number | null;
  contextTokens: number | null;
  /**
   * Optional, explicit USD per-million-token rates. `null` means "unknown" and
   * is never treated as zero; the engine then relies on provider-reported cost
   * or reports the cost as unknown.
   */
  inputCostPerMillionUsd: number | null;
  outputCostPerMillionUsd: number | null;
};

export type FindogAgentKnowledgeSettings = {
  enabled: boolean;
  baseUrl: string | null;
  knowledgeBaseIds: string[];
};

export type FindogAgentWebSettings = {
  mode: FindogAgentWebMode;
  allowedDomains: string[];
  maxResults: number;
  maxTextCharacters: number;
};

export type FindogAgentMcpServer = {
  id: string;
  name: string;
  url: string;
  allowedTools: string[];
};

export type FindogAgentMcpSettings = {
  servers: FindogAgentMcpServer[];
};

export type FindogAgentRunLimits = {
  requestTimeoutSeconds: number;
  deadlineSeconds: number;
  maxSteps: number;
  maxToolCalls: number;
  maxOutputTokens: number;
  estimatedCostLimitUsd: number | null;
};

/**
 * Persisted (and admin-visible) configuration. Contains no secrets: the UI and
 * GET responses only expose `*Configured` presence flags via the redacted DTO.
 */
export type FindogAgentSettings = {
  schemaVersion: typeof FINDOG_AGENT_SCHEMA_VERSION;
  agentName: string;
  systemPrompt: string;
  enabled: boolean;
  activeModelId: string | null;
  connections: FindogAgentConnection[];
  models: FindogAgentModel[];
  knowledge: FindogAgentKnowledgeSettings;
  web: FindogAgentWebSettings;
  mcp: FindogAgentMcpSettings;
  limits: FindogAgentRunLimits;
};

export type FindogAgentRedactedConnection = FindogAgentConnection & {
  apiKeyConfigured: boolean;
};

export type FindogAgentRedactedKnowledgeSettings = FindogAgentKnowledgeSettings & {
  apiKeyConfigured: boolean;
};

export type FindogAgentRedactedWebSettings = FindogAgentWebSettings & {
  exaApiKeyConfigured: boolean;
};

export type FindogAgentRedactedMcpServer = FindogAgentMcpServer & {
  bearerConfigured: boolean;
};

export type FindogAgentRedactedSettings = Omit<
  FindogAgentSettings,
  "connections" | "knowledge" | "web" | "mcp"
> & {
  connections: FindogAgentRedactedConnection[];
  knowledge: FindogAgentRedactedKnowledgeSettings;
  web: FindogAgentRedactedWebSettings;
  mcp: { servers: FindogAgentRedactedMcpServer[] };
};

export type FindogAgentSecretPatch = Record<string, string | null | undefined>;

export type FindogAgentRun = {
  id: string;
  conversationId: string;
  ownerId: string;
  idempotencyKey: string;
  state: FindogAgentRunState;
  settingsRevision: number;
  userMessageId: string | null;
  assistantMessageId: string | null;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  attemptCount: number;
  cancelRequested: boolean;
  result: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  usage: Record<string, unknown> | null;
  cost: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type FindogAgentRunEvent = {
  id: number;
  runId: string;
  ownerId: string;
  sequence: number;
  kind: FindogAgentEventKind;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type FindogAgentMessage = {
  id: string;
  conversationId: string;
  ownerId: string;
  runId: string | null;
  role: "user" | "assistant";
  content: string;
  isPartial: boolean;
  createdAt: string;
  updatedAt: string;
};

export type FindogAgentConversation = {
  id: string;
  ownerId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FindogAgentSettingsSnapshot = {
  /** `null` until the first settings revision has been written. */
  revision: number | null;
  updatedAt: string | null;
  settings: FindogAgentSettings;
  /** Server-only ciphertext map; never serialized into an HTTP response. */
  encryptedCredentials: Record<string, string>;
};

/** Secret identifiers are derived from the configured catalog, never free-form. */
export function findogAgentConnectionSecretName(connectionId: string): string {
  return `connection:${connectionId}:apiKey`;
}

export const FINDOG_AGENT_KNOWLEDGE_SECRET_NAME = "knowledge:apiKey";
export const FINDOG_AGENT_EXA_SECRET_NAME = "web:exaApiKey";

export function findogAgentMcpSecretName(serverId: string): string {
  return `mcp:${serverId}:bearer`;
}
