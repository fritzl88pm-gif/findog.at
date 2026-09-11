import { UserVisibleError } from "../errors";
import {
  FINDOG_AGENT_EXA_SECRET_NAME,
  FINDOG_AGENT_KNOWLEDGE_SECRET_NAME,
  FINDOG_AGENT_LIMITS,
  FINDOG_AGENT_MODEL_CAPABILITIES,
  FINDOG_AGENT_PROVIDERS,
  FINDOG_AGENT_REASONING_EFFORTS,
  FINDOG_AGENT_SCHEMA_VERSION,
  FINDOG_AGENT_WEB_MODES,
  findogAgentConnectionSecretName,
  findogAgentMcpSecretName,
  type FindogAgentModelCapability,
  type FindogAgentProvider,
  type FindogAgentReasoningEffort,
  type FindogAgentRedactedSettings,
  type FindogAgentSettings,
  type FindogAgentWebMode,
} from "./types";

export type NormalizeOptions = {
  /** Fixture/local-test escape hatch. Production endpoints must use https. */
  allowInsecureHttp?: boolean;
};

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function invalid(message: string): UserVisibleError {
  return new UserVisibleError(message, 400);
}

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid(`Das Feld "${field}" der Findog-Agent-Konfiguration ist ungültig.`);
  }
  return value as Record<string, unknown>;
}

function assertKnownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw invalid(
        `Das Feld "${key}" in "${field}" ist unbekannt und die Konfiguration ist damit ungültig.`,
      );
    }
  }
}

function readString(
  value: unknown,
  field: string,
  options: { max: number; min?: number; pattern?: RegExp } = { max: 200 },
): string {
  if (typeof value !== "string") {
    throw invalid(`Das Feld "${field}" der Findog-Agent-Konfiguration ist ungültig.`);
  }
  const trimmed = value.trim();
  if (trimmed.length < (options.min ?? 1) || trimmed.length > options.max) {
    throw invalid(`Das Feld "${field}" der Findog-Agent-Konfiguration ist ungültig.`);
  }
  if (options.pattern && !options.pattern.test(trimmed)) {
    throw invalid(`Das Feld "${field}" der Findog-Agent-Konfiguration ist ungültig.`);
  }
  return trimmed;
}

function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw invalid(`Das Feld "${field}" der Findog-Agent-Konfiguration ist ungültig.`);
  }
  return value;
}

function readInteger(
  value: unknown,
  field: string,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw invalid(`Das Feld "${field}" der Findog-Agent-Konfiguration ist ungültig.`);
  }
  return value;
}

function readEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw invalid(`Das Feld "${field}" der Findog-Agent-Konfiguration ist ungültig.`);
  }
  return value as T;
}

function readArray(value: unknown, field: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) {
    throw invalid(`Das Feld "${field}" der Findog-Agent-Konfiguration ist ungültig.`);
  }
  return value;
}

function readEndpointUrl(value: unknown, field: string, options: NormalizeOptions): string {
  if (typeof value !== "string") {
    throw invalid(`Die Endpunkt-URL in "${field}" ist ungültig.`);
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > FINDOG_AGENT_LIMITS.maxUrlCharacters) {
    throw invalid(`Die Endpunkt-URL in "${field}" ist ungültig.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw invalid(`Die Endpunkt-URL in "${field}" ist ungültig.`);
  }

  const secure = parsed.protocol === "https:";
  const insecureAllowed = parsed.protocol === "http:" && options.allowInsecureHttp === true;
  if (!secure && !insecureAllowed) {
    throw invalid(`Die Endpunkt-URL in "${field}" ist ungültig.`);
  }
  if (parsed.username || parsed.password) {
    throw invalid(`Die Endpunkt-URL in "${field}" ist ungültig (Zugangsdaten in der URL).`);
  }
  if (parsed.search || parsed.hash) {
    throw invalid(`Die Endpunkt-URL in "${field}" ist ungültig (Parameter oder Fragment).`);
  }
  if (!parsed.hostname) {
    throw invalid(`Die Endpunkt-URL in "${field}" ist ungültig.`);
  }

  return trimmed.replace(/\/+$/, "");
}

function readStringList(
  value: unknown,
  field: string,
  options: { max: number; maxLength: number; pattern?: RegExp },
): string[] {
  const items = readArray(value, field, options.max);
  const result = items.map((item) => {
    const text = readString(item, field, { max: options.maxLength, pattern: options.pattern });
    return text;
  });
  return result;
}

export function createDefaultFindogAgentSettings(): FindogAgentSettings {
  return {
    schemaVersion: FINDOG_AGENT_SCHEMA_VERSION,
    agentName: "Findog Agent (Preview)",
    systemPrompt: "Recherchiere gründlich und belege jede Aussage mit Quellen.",
    enabled: false,
    activeModelId: null,
    connections: [],
    models: [],
    knowledge: {
      enabled: false,
      baseUrl: null,
      knowledgeBaseIds: [],
    },
    web: {
      mode: "off",
      allowedDomains: [],
      maxResults: 5,
      maxTextCharacters: 20000,
    },
    mcp: {
      servers: [],
    },
    limits: {
      requestTimeoutSeconds: 120,
      deadlineSeconds: 600,
      maxSteps: 12,
      maxToolCalls: 24,
      maxOutputTokens: 8192,
      estimatedCostLimitUsd: null,
    },
  };
}

/**
 * Strictly validates an incoming settings document. Unknown fields (for example
 * a hypothetical `apiKeyEnv` that could read arbitrary server environment secrets)
 * are rejected instead of being silently dropped.
 */
export function normalizeFindogAgentSettings(
  input: unknown,
  options: NormalizeOptions = {},
): FindogAgentSettings {
  const root = asObject(input, "settings");
  assertKnownKeys(
    root,
    [
      "schemaVersion",
      "agentName",
      "systemPrompt",
      "enabled",
      "activeModelId",
      "connections",
      "models",
      "knowledge",
      "web",
      "mcp",
      "limits",
    ],
    "settings",
  );

  if (root.schemaVersion !== FINDOG_AGENT_SCHEMA_VERSION) {
    throw invalid("Die Version der Findog-Agent-Konfiguration ist ungültig.");
  }

  const agentName = readString(root.agentName, "agentName", {
    max: FINDOG_AGENT_LIMITS.maxNameCharacters,
  });

  const rawPrompt = root.systemPrompt;
  if (typeof rawPrompt !== "string" || rawPrompt.length > FINDOG_AGENT_LIMITS.maxSystemPromptCharacters) {
    throw invalid("Das Feld \"systemPrompt\" der Findog-Agent-Konfiguration ist ungültig.");
  }

  const enabled = readBoolean(root.enabled, "enabled");

  const connections = readArray(root.connections, "connections", 20).map((entry, index) => {
    const connection = asObject(entry, `connections[${index}]`);
    assertKnownKeys(connection, ["id", "name", "provider", "baseUrl"], `connections[${index}]`);
    return {
      id: readString(connection.id, `connections[${index}].id`, { max: 64, pattern: ID_PATTERN }),
      name: readString(connection.name, `connections[${index}].name`, { max: 120 }),
      provider: readEnum<FindogAgentProvider>(
        connection.provider,
        `connections[${index}].provider`,
        FINDOG_AGENT_PROVIDERS,
      ),
      baseUrl: readEndpointUrl(connection.baseUrl, `connections[${index}].baseUrl`, options),
    };
  });
  assertUniqueIds(connections.map((connection) => connection.id), "Verbindungs-IDs", "Verbindungs-IDs sind doppelt vergeben.");

  const models = readArray(root.models, "models", 50).map((entry, index) => {
    const model = asObject(entry, `models[${index}]`);
    assertKnownKeys(
      model,
      [
        "id",
        "label",
        "connectionId",
        "model",
        "reasoningEffort",
        "capabilities",
        "maxOutputTokens",
        "contextTokens",
        "inputCostPerMillionUsd",
        "outputCostPerMillionUsd",
      ],
      `models[${index}]`,
    );

    const capabilities = readArray(model.capabilities, `models[${index}].capabilities`, 3)
      .map((capability, capabilityIndex) => readEnum<FindogAgentModelCapability>(
        capability,
        `models[${index}].capabilities[${capabilityIndex}]`,
        FINDOG_AGENT_MODEL_CAPABILITIES,
      ));

    return {
      id: readString(model.id, `models[${index}].id`, { max: 64, pattern: ID_PATTERN }),
      label: readString(model.label, `models[${index}].label`, {
        max: FINDOG_AGENT_LIMITS.maxModelLabelCharacters,
      }),
      connectionId: readString(model.connectionId, `models[${index}].connectionId`, {
        max: 64,
        pattern: ID_PATTERN,
      }),
      model: readString(model.model, `models[${index}].model`, {
        max: FINDOG_AGENT_LIMITS.maxModelIdCharacters,
      }),
      reasoningEffort: model.reasoningEffort === null
        ? null
        : readEnum<FindogAgentReasoningEffort>(
          model.reasoningEffort,
          `models[${index}].reasoningEffort`,
          FINDOG_AGENT_REASONING_EFFORTS,
        ),
      capabilities,
      maxOutputTokens: model.maxOutputTokens === null
        ? null
        : readInteger(model.maxOutputTokens, `models[${index}].maxOutputTokens`, 1, 200000),
      contextTokens: model.contextTokens === null
        ? null
        : readInteger(model.contextTokens, `models[${index}].contextTokens`, 1000, 2000000),
      inputCostPerMillionUsd: readOptionalRate(
        model.inputCostPerMillionUsd,
        `models[${index}].inputCostPerMillionUsd`,
      ),
      outputCostPerMillionUsd: readOptionalRate(
        model.outputCostPerMillionUsd,
        `models[${index}].outputCostPerMillionUsd`,
      ),
    };
  });
  assertUniqueIds(models.map((model) => model.id), "Modell-IDs", "Modell-IDs sind doppelt vergeben.");

  for (const model of models) {
    if (!connections.some((connection) => connection.id === model.connectionId)) {
      throw invalid(`Das Modell "${model.id}" ist nicht mit einer konfigurierten Verbindung verbunden.`);
    }
  }

  const activeModelId = root.activeModelId === null
    ? null
    : readString(root.activeModelId, "activeModelId", { max: 64, pattern: ID_PATTERN });
  if (activeModelId !== null && !models.some((model) => model.id === activeModelId)) {
    throw invalid("Das aktive Modell ist nicht Teil des konfigurierten Katalogs.");
  }

  const knowledge = asObject(root.knowledge, "knowledge");
  assertKnownKeys(knowledge, ["enabled", "baseUrl", "knowledgeBaseIds"], "knowledge");
  const knowledgeEnabled = readBoolean(knowledge.enabled, "knowledge.enabled");
  const knowledgeBaseUrl = knowledge.baseUrl === null
    ? null
    : readEndpointUrl(knowledge.baseUrl, "knowledge.baseUrl", options);
  if (knowledgeEnabled && !knowledgeBaseUrl) {
    throw invalid("Die Wissensdatenbank benötigt eine Endpunkt-URL und ist damit ungültig.");
  }

  const web = asObject(root.web, "web");
  assertKnownKeys(web, ["mode", "allowedDomains", "maxResults", "maxTextCharacters"], "web");

  const mcp = asObject(root.mcp, "mcp");
  assertKnownKeys(mcp, ["servers"], "mcp");
  const servers = readArray(mcp.servers, "mcp.servers", FINDOG_AGENT_LIMITS.maxMcpServers)
    .map((entry, index) => {
      const server = asObject(entry, `mcp.servers[${index}]`);
      assertKnownKeys(server, ["id", "name", "url", "allowedTools"], `mcp.servers[${index}]`);
      return {
        id: readString(server.id, `mcp.servers[${index}].id`, { max: 64, pattern: ID_PATTERN }),
        name: readString(server.name, `mcp.servers[${index}].name`, { max: 120 }),
        url: readEndpointUrl(server.url, `mcp.servers[${index}].url`, options),
        allowedTools: readStringList(server.allowedTools, `mcp.servers[${index}].allowedTools`, {
          max: FINDOG_AGENT_LIMITS.maxMcpAllowedTools,
          maxLength: 200,
        }),
      };
    });
  assertUniqueIds(servers.map((server) => server.id), "MCP-IDs", "MCP-IDs sind doppelt vergeben.");

  const limits = asObject(root.limits, "limits");
  assertKnownKeys(
    limits,
    [
      "requestTimeoutSeconds",
      "deadlineSeconds",
      "maxSteps",
      "maxToolCalls",
      "maxOutputTokens",
      "estimatedCostLimitUsd",
    ],
    "limits",
  );
  const estimatedCostLimitUsd = limits.estimatedCostLimitUsd === null
    ? null
    : readNumber(limits.estimatedCostLimitUsd, "limits.estimatedCostLimitUsd", 0.01, 10000);

  return {
    schemaVersion: FINDOG_AGENT_SCHEMA_VERSION,
    agentName,
    systemPrompt: rawPrompt,
    enabled,
    activeModelId,
    connections,
    models,
    knowledge: {
      enabled: knowledgeEnabled,
      baseUrl: knowledgeBaseUrl,
      knowledgeBaseIds: readStringList(knowledge.knowledgeBaseIds, "knowledge.knowledgeBaseIds", {
        max: FINDOG_AGENT_LIMITS.maxKnowledgeBaseIds,
        maxLength: 200,
      }),
    },
    web: {
      mode: readEnum<FindogAgentWebMode>(web.mode, "web.mode", FINDOG_AGENT_WEB_MODES),
      allowedDomains: readStringList(web.allowedDomains, "web.allowedDomains", {
        max: FINDOG_AGENT_LIMITS.maxAllowedDomains,
        maxLength: 253,
        pattern: DOMAIN_PATTERN,
      }),
      maxResults: readInteger(web.maxResults, "web.maxResults", 1, 20),
      maxTextCharacters: readInteger(web.maxTextCharacters, "web.maxTextCharacters", 500, 100000),
    },
    mcp: { servers },
    limits: {
      requestTimeoutSeconds: readInteger(limits.requestTimeoutSeconds, "limits.requestTimeoutSeconds", 5, 600),
      deadlineSeconds: readInteger(limits.deadlineSeconds, "limits.deadlineSeconds", 10, 3600),
      maxSteps: readInteger(limits.maxSteps, "limits.maxSteps", 1, 100),
      maxToolCalls: readInteger(limits.maxToolCalls, "limits.maxToolCalls", 1, 200),
      maxOutputTokens: readInteger(limits.maxOutputTokens, "limits.maxOutputTokens", 1, 200000),
      estimatedCostLimitUsd,
    },
  };
}

function readNumber(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw invalid(`Das Feld "${field}" der Findog-Agent-Konfiguration ist ungültig.`);
  }
  return value;
}

/**
 * Optional model price in USD per one million tokens. Missing (`undefined`) and
 * `null` both mean "no explicit rate configured"; the value is never defaulted
 * to a hardcoded model price.
 */
function readOptionalRate(value: unknown, field: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  return readNumber(value, field, 0, 100000);
}

function assertUniqueIds(ids: string[], label: string, message: string): void {
  if (new Set(ids).size !== ids.length) {
    throw invalid(`${label}: ${message}`);
  }
}

/** Secret names derived from the catalog; nothing outside this set may be stored. */
export function listFindogAgentSecretNames(settings: FindogAgentSettings): string[] {
  return [
    ...settings.connections.map((connection) => findogAgentConnectionSecretName(connection.id)),
    FINDOG_AGENT_KNOWLEDGE_SECRET_NAME,
    FINDOG_AGENT_EXA_SECRET_NAME,
    ...settings.mcp.servers.map((server) => findogAgentMcpSecretName(server.id)),
  ];
}

/**
 * Builds the administrator-facing DTO. It carries presence flags only: neither the
 * plaintext secret nor the stored ciphertext ever leaves the server.
 */
export function toRedactedFindogAgentSettings(
  settings: FindogAgentSettings,
  encryptedCredentials: Record<string, string> | null | undefined,
): FindogAgentRedactedSettings {
  const stored = encryptedCredentials ?? {};
  const configured = (name: string) => typeof stored[name] === "string" && stored[name].length > 0;

  return {
    schemaVersion: settings.schemaVersion,
    agentName: settings.agentName,
    systemPrompt: settings.systemPrompt,
    enabled: settings.enabled,
    activeModelId: settings.activeModelId,
    connections: settings.connections.map((connection) => ({
      ...connection,
      apiKeyConfigured: configured(findogAgentConnectionSecretName(connection.id)),
    })),
    models: settings.models.map((model) => ({ ...model, capabilities: [...model.capabilities] })),
    knowledge: {
      ...settings.knowledge,
      knowledgeBaseIds: [...settings.knowledge.knowledgeBaseIds],
      apiKeyConfigured: configured(FINDOG_AGENT_KNOWLEDGE_SECRET_NAME),
    },
    web: {
      ...settings.web,
      allowedDomains: [...settings.web.allowedDomains],
      exaApiKeyConfigured: configured(FINDOG_AGENT_EXA_SECRET_NAME),
    },
    mcp: {
      servers: settings.mcp.servers.map((server) => ({
        ...server,
        allowedTools: [...server.allowedTools],
        bearerConfigured: configured(findogAgentMcpSecretName(server.id)),
      })),
    },
    limits: { ...settings.limits },
  };
}
