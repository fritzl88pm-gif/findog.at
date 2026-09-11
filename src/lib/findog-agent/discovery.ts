/**
 * Deliberate connection tests and discovery for the Findog Agent admin UI.
 *
 * A test always runs against one *explicitly named* entry of one *saved*
 * settings revision. The destination, headers and body are derived exclusively
 * from that revision: an administrator can never direct a test at an arbitrary
 * URL, header or payload, and no test runs on save or on a GET.
 *
 * Results and errors are projected into a closed allowlist of fields. Raw
 * provider responses, secret material and upstream error payloads are never
 * serialized.
 */

import { boundFindogAgentText } from "./text";
import { createFindogAgentProvider } from "./provider";
import { createFindogAgentKnowledgeAdapter } from "./adapters/weknora";
import { createFindogAgentExaAdapter } from "./adapters/exa";
import { createFindogAgentMcpClient } from "./adapters/mcp";
import {
  FindogAgentAdapterError,
  FindogAgentEngineError,
  FindogAgentNetworkError,
  FindogAgentProviderError,
} from "./errors";
import type { FindogAgentTransport } from "./network";
import {
  FINDOG_AGENT_EXA_SECRET_NAME,
  FINDOG_AGENT_KNOWLEDGE_SECRET_NAME,
  findogAgentConnectionSecretName,
  findogAgentMcpSecretName,
} from "./types";
import type { FindogAgentSettingsSnapshot } from "./types";
import type { FindogAgentConnectionTestKind } from "./api";

export type FindogAgentConnectionTestResult = {
  ok: boolean;
  kind: FindogAgentConnectionTestKind;
  id: string | null;
  summary: string;
  latencyMs: number;
  code: string | null;
  detail: Record<string, unknown> | null;
};

export type FindogAgentDiscoveryDeps = {
  transport: FindogAgentTransport;
  /** Decrypts one stored secret in server memory; never returned to the client. */
  decryptSecret: (ciphertext: string) => string;
  now?: () => number;
  /** Hard upper bound for the whole test, regardless of the configured timeout. */
  maxTestMs?: number;
};

const ABSOLUTE_MAX_TEST_MS = 30_000;
const MAX_LISTED_ITEMS = 50;
const MAX_DETAIL_TEXT_CHARACTERS = 300;

/** Fixed message per error class: no upstream body, no path, no secret. */
function describeTestError(error: unknown): { code: string; message: string } {
  if (
    error instanceof FindogAgentAdapterError
    || error instanceof FindogAgentNetworkError
    || error instanceof FindogAgentProviderError
    || error instanceof FindogAgentEngineError
  ) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "internal_error",
    message: "Der Verbindungstest ist fehlgeschlagen.",
  };
}

function boundedText(value: unknown, max = MAX_DETAIL_TEXT_CHARACTERS): string {
  return boundFindogAgentText(value, max).text;
}

export class FindogAgentDiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FindogAgentDiscoveryError";
  }
}

export async function runFindogAgentConnectionTest(input: {
  snapshot: FindogAgentSettingsSnapshot;
  kind: FindogAgentConnectionTestKind;
  id: string | null;
  deps: FindogAgentDiscoveryDeps;
}): Promise<FindogAgentConnectionTestResult> {
  const now = input.deps.now ?? (() => Date.now());
  const startedAt = now();
  const settings = input.snapshot.settings;
  const stored = input.snapshot.encryptedCredentials;

  const configuredSecret = (name: string): string | null => {
    const ciphertext = stored[name];
    if (typeof ciphertext !== "string" || !ciphertext) {
      return null;
    }
    return input.deps.decryptSecret(ciphertext);
  };

  const requestTimeoutMs = Math.max(1_000, settings.limits.requestTimeoutSeconds * 1000);
  const hardLimitMs = Math.min(
    requestTimeoutMs,
    input.deps.maxTestMs ?? ABSOLUTE_MAX_TEST_MS,
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), hardLimitMs);
  timer.unref?.();

  const fail = (
    code: string,
    message: string,
    detail: Record<string, unknown> | null = null,
  ): FindogAgentConnectionTestResult => ({
    ok: false,
    kind: input.kind,
    id: input.id,
    summary: message,
    latencyMs: now() - startedAt,
    code,
    detail,
  });

  try {
    if (input.kind === "model") {
      const model = settings.models.find((entry) => entry.id === input.id) ?? null;
      if (!model) {
        throw new FindogAgentDiscoveryError("Dieses Modell gehört nicht zur Revision.");
      }
      const connection = settings.connections.find((entry) => entry.id === model.connectionId) ?? null;
      if (!connection) {
        throw new FindogAgentDiscoveryError("Die Modellverbindung gehört nicht zur Revision.");
      }
      const apiKey = configuredSecret(findogAgentConnectionSecretName(connection.id));
      if (!apiKey) {
        return fail("credentials_missing", "Für dieses Modell ist kein Zugangsschlüssel hinterlegt.");
      }

      const provider = createFindogAgentProvider({
        provider: connection.provider,
        baseUrl: connection.baseUrl,
        apiKey,
        model: model.model,
        capabilities: model.capabilities,
        reasoningEffort: model.reasoningEffort,
        transport: input.deps.transport,
        timeoutMs: requestTimeoutMs,
      });
      const response = await provider.complete({
        messages: [
          { role: "system", content: "Dies ist ein Verbindungstest. Antworte sehr kurz." },
          { role: "user", content: "Antworte mit OK." },
        ],
        tools: null,
        toolChoice: "none",
        maxOutputTokens: 64,
        signal: controller.signal,
        timeoutMs: requestTimeoutMs,
      });

      // Only a non-empty answer that terminated normally proves the model is
      // usable. An empty body or a `length` finish (a reasoning model can spend
      // the whole 64-token skeleton budget on thinking) is reported honestly
      // instead of being sold as a successful connection test.
      const answered = response.content.trim().length > 0;
      const finishReason = boundedText(response.finishReason, 64);
      const diagnostics = {
        finishReason,
        answered,
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
      };
      if (response.finishReason === "length") {
        return fail(
          "incomplete_output",
          "Der Verbindungstest wurde vom 64-Token-Limit abgeschnitten. Das ist kein Modellfehler.",
          diagnostics,
        );
      }
      if (!answered) {
        return fail("empty_output", "Das Modell hat keine Antwort geliefert.", diagnostics);
      }
      if (response.finishReason !== "stop") {
        return fail(
          "incomplete_output",
          "Das Modell hat die Antwort nicht regulär beendet.",
          diagnostics,
        );
      }

      return {
        ok: true,
        kind: input.kind,
        id: input.id,
        summary: "Das Modell hat geantwortet.",
        latencyMs: now() - startedAt,
        code: null,
        detail: diagnostics,
      };
    }

    if (input.kind === "weknora") {
      const apiKey = configuredSecret(FINDOG_AGENT_KNOWLEDGE_SECRET_NAME);
      if (!apiKey) {
        return fail("credentials_missing", "Für WeKnora ist kein Zugangsschlüssel hinterlegt.");
      }
      if (!settings.knowledge.baseUrl) {
        return fail("not_configured", "Für WeKnora ist keine Basis-URL konfiguriert.");
      }

      const adapter = createFindogAgentKnowledgeAdapter({
        baseUrl: settings.knowledge.baseUrl,
        apiKey,
        knowledgeBaseIds: settings.knowledge.knowledgeBaseIds,
        transport: input.deps.transport,
        timeoutMs: requestTimeoutMs,
        maxTextCharacters: 2_000,
      });
      const bases = await adapter.listKnowledgeBases({ signal: controller.signal });

      return {
        ok: true,
        kind: input.kind,
        id: input.id,
        summary: `${bases.length} Wissensbasis(en) gefunden.`,
        latencyMs: now() - startedAt,
        code: null,
        detail: {
          knowledgeBases: bases.slice(0, MAX_LISTED_ITEMS).map((base) => ({
            id: boundedText(base.id, 200),
            name: boundedText(base.name, 200),
            configured: base.configured,
          })),
          listed: Math.min(bases.length, MAX_LISTED_ITEMS),
          total: bases.length,
        },
      };
    }

    if (input.kind === "exa") {
      const apiKey = configuredSecret(FINDOG_AGENT_EXA_SECRET_NAME);
      if (!apiKey) {
        return fail("credentials_missing", "Für Exa ist kein Zugangsschlüssel hinterlegt.");
      }

      const adapter = createFindogAgentExaAdapter({
        apiKey,
        transport: input.deps.transport,
        timeoutMs: requestTimeoutMs,
        maxTextCharacters: 2_000,
        allowedDomains: settings.web.allowedDomains,
      });
      const result = await adapter.search({
        query: "Findog",
        numResults: Math.max(1, Math.min(3, settings.web.maxResults)),
        signal: controller.signal,
      });

      return {
        ok: true,
        kind: input.kind,
        id: input.id,
        summary: "Die Websuche hat geantwortet.",
        latencyMs: now() - startedAt,
        code: null,
        detail: {
          hits: result.hits.length,
          filtered: result.filtered,
          estimatedCostUsd: result.costUsd,
          sampleUrls: result.hits
            .slice(0, 3)
            .map((hit) => boundedText(hit.url, 300)),
        },
      };
    }

    const server = settings.mcp.servers.find((entry) => entry.id === input.id) ?? null;
    if (!server) {
      throw new FindogAgentDiscoveryError("Dieser MCP-Server gehört nicht zur Revision.");
    }
    // Discovery must authenticate before any tool is allowlisted: onboarding
    // lists the tools first, then the administrator approves a subset. An empty
    // allowlist never disables the configured bearer, and discovery itself never
    // approves or calls a discovered tool.
    const bearer = configuredSecret(findogAgentMcpSecretName(server.id));

    const client = createFindogAgentMcpClient({
      server: {
        id: server.id,
        name: server.name,
        url: server.url,
        allowedTools: server.allowedTools,
        bearer,
      },
      transport: input.deps.transport,
      timeoutMs: requestTimeoutMs,
    });
    const tools = await client.listTools({ signal: controller.signal });

    return {
      ok: true,
      kind: input.kind,
      id: input.id,
      summary: `${tools.length} MCP-Werkzeug(e) gefunden.`,
      latencyMs: now() - startedAt,
      code: null,
      detail: {
        tools: tools.slice(0, MAX_LISTED_ITEMS).map((tool) => ({
          name: boundedText(tool.name, 200),
          description: boundedText(tool.description),
          approved: tool.approved,
          // Display-only hint; the explicit allowlist remains authoritative.
          readOnlyHint: tool.readOnlyHint,
        })),
        listed: Math.min(tools.length, MAX_LISTED_ITEMS),
        total: tools.length,
      },
    };
  } catch (error) {
    if (error instanceof FindogAgentDiscoveryError) {
      return fail("invalid_request", error.message);
    }
    if (controller.signal.aborted && !(error instanceof FindogAgentAdapterError)) {
      return fail("timeout", "Der Verbindungstest hat das Zeitlimit überschritten.");
    }
    const described = describeTestError(error);
    return fail(described.code, described.message);
  } finally {
    clearTimeout(timer);
  }
}
