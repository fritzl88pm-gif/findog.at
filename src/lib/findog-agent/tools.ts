/**
 * Tool registry for the Findog Agent.
 *
 * The registry is the only place that may construct tools. It is derived from
 * the captured settings revision, so prompt text, history or retrieved content
 * can never add a tool, widen a scope or change a domain allowlist. Every tool
 * is read-only and there is deliberately no shell, eval, HTTP or write tool.
 *
 * Tool arguments come from an untrusted model: they are JSON-parsed and
 * validated against the exact schema that was advertised before any adapter or
 * network call runs. Only successful tool results register evidence.
 */

import { FindogAgentAdapterError, FindogAgentNetworkError, findogAgentErrorMessage } from "./errors";
import {
  evaluateFindogAgentExpression,
  FindogAgentCalculationError,
} from "./calculator";
import type {
  FindogAgentEvidenceRegistry,
  FindogAgentSourceCandidate,
  FindogAgentSourceRecord,
} from "./evidence";
import {
  validateFindogAgentArguments,
  type FindogAgentJsonSchema,
} from "./jsonschema";
import { boundFindogAgentText } from "./text";
import type { FindogAgentKnowledgeAdapter } from "./adapters/weknora";
import type { FindogAgentExaAdapter } from "./adapters/exa";
import type { FindogAgentMcpClient } from "./adapters/mcp";
import type { FindogAgentProviderToolDefinition } from "./provider";

export type FindogAgentRuntimeNotice = {
  code: string;
  message: string;
  detail?: Record<string, unknown>;
};

export type FindogAgentToolCategory =
  | "plan"
  | "calculator"
  | "knowledge"
  | "wiki"
  | "web"
  | "mcp"
  | "unknown";

export type FindogAgentToolDefinition = {
  name: string;
  description: string;
  parameters: FindogAgentJsonSchema;
  category: FindogAgentToolCategory;
  readOnly: true;
};

export type FindogAgentToolOutcome = {
  ok: boolean;
  tool: string;
  category: FindogAgentToolCategory;
  /** One-line summary for run events. */
  summary: string;
  /** Bounded text handed back to the model. */
  content: string;
  sources: FindogAgentSourceRecord[];
  errorCode: string | null;
  meta: Record<string, unknown>;
};

export type FindogAgentToolExecutionContext = {
  signal: AbortSignal;
};

type ToolHandler = (
  args: Record<string, unknown>,
  context: FindogAgentToolExecutionContext,
) => Promise<{
  content: string;
  ok?: boolean;
  errorCode?: string;
  sources?: FindogAgentSourceRecord[];
  summary?: string;
  meta?: Record<string, unknown>;
}>;

type RegisteredTool = FindogAgentToolDefinition & { handler: ToolHandler };

export type FindogAgentToolRegistryOptions = {
  knowledge: FindogAgentKnowledgeAdapter | null;
  web: FindogAgentExaAdapter | null;
  mcpClients: FindogAgentMcpClient[];
  evidence: FindogAgentEvidenceRegistry;
  limits: {
    maxToolCalls: number;
    maxToolResultCharacters: number;
  };
};

export type FindogAgentToolRegistry = {
  definitions(): FindogAgentToolDefinition[];
  providerTools(): FindogAgentProviderToolDefinition[];
  has(name: string): boolean;
  callsUsed(): number;
  prepare(context: FindogAgentToolExecutionContext): Promise<FindogAgentRuntimeNotice[]>;
  execute(
    name: string,
    argumentsJson: string,
    context: FindogAgentToolExecutionContext,
  ): Promise<FindogAgentToolOutcome>;
};

export const FINDOG_AGENT_MAX_MODEL_TOOL_NAME = 64;

/** Maps arbitrary discoverable MCP tool names onto OpenAI-safe function names. */
export function sanitizeFindogAgentMcpToolName(serverId: string, toolName: string): string {
  const prefix = `mcp__${serverId.replace(/[^a-zA-Z0-9_-]/g, "_")}__`;
  const safeTool = toolName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const available = Math.max(1, FINDOG_AGENT_MAX_MODEL_TOOL_NAME - prefix.length);
  return `${prefix}${safeTool.slice(0, available)}`;
}

function sourceLine(record: FindogAgentSourceRecord): string {
  return `[${record.id}] ${record.title}${record.url ? ` – ${record.url}` : ""}`;
}

function truncationNote(record: FindogAgentSourceRecord): string {
  return record.truncated ? " (Auszug gekürzt)" : "";
}

function adapterErrorCode(error: unknown): string {
  if (error instanceof FindogAgentAdapterError) {
    return error.code;
  }
  if (error instanceof FindogAgentNetworkError) {
    return error.code;
  }
  if (error instanceof FindogAgentCalculationError) {
    return error.code;
  }
  return "tool_error";
}

export function createFindogAgentToolRegistry(
  options: FindogAgentToolRegistryOptions,
): FindogAgentToolRegistry {
  const { knowledge, web, evidence } = options;
  const tools = new Map<string, RegisteredTool>();
  const mcpBindings = new Map<string, { client: FindogAgentMcpClient; toolName: string }>();
  let usedToolCalls = 0;

  const toSources = (candidates: FindogAgentSourceCandidate[]) => {
    const records: FindogAgentSourceRecord[] = [];
    for (const candidate of candidates) {
      records.push(evidence.register(candidate).record);
    }
    return records;
  };

  function registerTool(tool: RegisteredTool) {
    tools.set(tool.name, tool);
  }

  const boundedResult = (text: string): string => {
    const bounded = boundFindogAgentText(text, options.limits.maxToolResultCharacters);
    return bounded.truncated
      ? `${bounded.text}\n\n[Werkzeugergebnis gekürzt]`
      : bounded.text;
  };

  registerTool({
    name: "update_plan",
    description:
      "Legt einen kurzen Arbeitsplan für die laufende Recherche fest oder aktualisiert ihn.",
    category: "plan",
    readOnly: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["steps"],
      properties: {
        steps: {
          type: "array",
          minItems: 1,
          maxItems: 10,
          items: { type: "string", minLength: 1, maxLength: 200 },
        },
        notes: { type: "string", maxLength: 1000 },
      },
    },
    async handler(args) {
      const steps = (args.steps as unknown[]).map((step) => String(step).trim()).filter(Boolean);
      const notes = typeof args.notes === "string" ? args.notes.trim() : null;
      return {
        summary: `Plan mit ${steps.length} Schritten gespeichert.`,
        content: `Plan gespeichert:\n${steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`,
        meta: { plan: { steps, notes } },
      };
    },
  });

  registerTool({
    name: "calculator",
    description:
      "Berechnet einen exakten Dezimalausdruck mit + - * / und Klammern. Keine Variablen, keine Funktionen.",
    category: "calculator",
    readOnly: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["expression"],
      properties: {
        expression: { type: "string", minLength: 1, maxLength: 500 },
      },
    },
    async handler(args) {
      const result = evaluateFindogAgentExpression(args.expression);
      return {
        summary: `Ergebnis ${result.value}${result.approximate ? " (gerundet)" : " (exakt)"}`,
        content: result.approximate
          ? `Ergebnis: ${result.value} (Näherung, nicht exakt darstellbar)`
          : `Ergebnis: ${result.value} (exakt)`,
        meta: { value: result.value, approximate: result.approximate },
      };
    },
  });

  if (knowledge) {
    registerTool({
      name: "knowledge_search",
      description:
        "Durchsucht die freigegebenen Wissensdatenbanken und liefert Textabschnitte mit Quellen-IDs.",
      category: "knowledge",
      readOnly: true,
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: { type: "string", minLength: 1, maxLength: 500 },
          limit: { type: "integer", minimum: 1, maximum: 10 },
        },
      },
      async handler(args, context) {
        const result = await knowledge.search({
          query: String(args.query),
          limit: typeof args.limit === "number" ? args.limit : 5,
          signal: context.signal,
        });
        const records = toSources(result.hits.map((hit) => ({
          kind: "knowledge",
          provider: "weknora",
          title: hit.title,
          text: hit.text,
          truncated: hit.truncated,
          url: hit.sourceUrl,
          provenance: {
            knowledgeBaseId: hit.knowledgeBaseId,
            knowledgeId: hit.knowledgeId,
            chunkId: hit.chunkId ?? "",
          },
        })));
        const body = records.length === 0
          ? "Keine Treffer in den freigegebenen Wissensdatenbanken."
          : records
            .map((record, index) => `${sourceLine(record)}${truncationNote(record)}\n${record.text}\nPassende Abschnitts-ID: ${result.hits[index]?.chunkId ?? "-"}`)
            .join("\n\n");
        return {
          summary: `${records.length} Wissensabschnitte gefunden.`,
          content: body,
          sources: records,
          meta: { filtered: result.filtered, notes: result.notes },
        };
      },
    });

    registerTool({
      name: "knowledge_read",
      description:
        "Liest ein Wissensdokument in gebundenen Seiten aus den freigegebenen Wissensdatenbanken. "
        + "Ist das Ergebnis gekürzt, gibt die Antwort den nächsten startChunk für die Fortsetzung an.",
      category: "knowledge",
      readOnly: true,
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["knowledgeId"],
        properties: {
          knowledgeId: { type: "string", minLength: 1, maxLength: 200 },
          startChunk: { type: "integer", minimum: 0, maximum: 1000000 },
        },
      },
      async handler(args, context) {
        const result = await knowledge.readKnowledge({
          knowledgeId: String(args.knowledgeId),
          startChunk: typeof args.startChunk === "number" ? args.startChunk : undefined,
          signal: context.signal,
        });
        const records = toSources([{
          kind: "knowledge",
          provider: "weknora",
          title: result.title,
          text: result.text,
          truncated: result.truncated,
          url: result.sourceUrl,
          provenance: {
            knowledgeBaseId: result.knowledgeBaseId,
            knowledgeId: result.knowledgeId,
            chunkId: "",
          },
        }]);
        const record = records[0];
        const total = result.totalChunks === null ? "?" : String(result.totalChunks);
        const continuation = result.truncated
          ? result.nextChunk === null
            ? `\n\n[Hinweis: Das Dokument ist gekürzt; weitere Abschnitte sind nicht abrufbar.]`
            : `\n\n[Hinweis: Das Dokument ist unvollständig gelesen (${result.chunksRead} von ${total} Abschnitten). Für die Fortsetzung knowledge_read mit startChunk=${result.nextChunk} aufrufen.]`
          : "";
        const summary = result.truncated
          ? `Wissensdokument mit ${result.chunksRead} von ${total} Abschnitten gelesen (gekürzt).`
          : `Wissensdokument mit ${result.chunksRead} Abschnitten gelesen.`;
        return {
          summary,
          // The continuation hint is placed before the (possibly bounded) text so
          // it survives result truncation and the model can act on it.
          content: `${sourceLine(record)}${truncationNote(record)}${continuation}\n${record.text}`,
          sources: records,
          meta: {
            chunksRead: result.chunksRead,
            totalChunks: result.totalChunks,
            nextChunk: result.nextChunk,
            truncated: result.truncated,
          },
        };
      },
    });

    registerTool({
      name: "knowledge_wiki_search",
      description: "Durchsucht die Wiki-Seiten einer freigegebenen Wissensbasis.",
      category: "wiki",
      readOnly: true,
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["knowledgeBaseId", "query"],
        properties: {
          knowledgeBaseId: { type: "string", minLength: 1, maxLength: 200 },
          query: { type: "string", minLength: 1, maxLength: 500 },
          limit: { type: "integer", minimum: 1, maximum: 20 },
        },
      },
      async handler(args, context) {
        const pages = await knowledge.wikiSearch({
          knowledgeBaseId: String(args.knowledgeBaseId),
          query: String(args.query),
          limit: typeof args.limit === "number" ? args.limit : 10,
          signal: context.signal,
        });
        if (pages.length === 0) {
          return {
            summary: "Keine Wiki-Seiten gefunden.",
            content: "Keine passenden Wiki-Seiten gefunden.",
          };
        }
        const records = toSources(pages.map((page) => ({
          kind: "wiki",
          provider: "weknora",
          title: page.title,
          text: page.summary,
          truncated: false,
          url: null,
          provenance: {
            knowledgeBaseId: String(args.knowledgeBaseId),
            slug: page.slug,
            via: "search",
          },
        })));
        return {
          summary: `${records.length} Wiki-Seiten gefunden.`,
          content: records
            .map((record, index) => `${sourceLine(record)}\n${record.text}\nWiki-Slug: ${pages[index]?.slug ?? "-"}`)
            .join("\n\n"),
          sources: records,
        };
      },
    });

    registerTool({
      name: "knowledge_wiki_read",
      description: "Liest eine Wiki-Seite einer freigegebenen Wissensbasis über ihren Slug.",
      category: "wiki",
      readOnly: true,
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["knowledgeBaseId", "slug"],
        properties: {
          knowledgeBaseId: { type: "string", minLength: 1, maxLength: 200 },
          slug: { type: "string", minLength: 1, maxLength: 200 },
        },
      },
      async handler(args, context) {
        const page = await knowledge.wikiRead({
          knowledgeBaseId: String(args.knowledgeBaseId),
          slug: String(args.slug),
          signal: context.signal,
        });
        const records = toSources([{
          kind: "wiki",
          provider: "weknora",
          title: page.title,
          text: page.text,
          truncated: page.truncated,
          url: null,
          provenance: {
            knowledgeBaseId: String(args.knowledgeBaseId),
            slug: page.slug,
            via: "read",
          },
        }]);
        const record = records[0];
        return {
          summary: `Wiki-Seite "${page.title}" gelesen.`,
          content: `${sourceLine(record)}${truncationNote(record)}\n${record.text}`,
          sources: records,
          meta: { pageType: page.pageType },
        };
      },
    });
  }

  if (web) {
    registerTool({
      name: "web_search",
      description: "Sucht öffentliche Webseiten über Exa und liefert Textauszüge mit Quellen-IDs.",
      category: "web",
      readOnly: true,
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: { type: "string", minLength: 1, maxLength: 500 },
          numResults: { type: "integer", minimum: 1, maximum: 20 },
        },
      },
      async handler(args, context) {
        const result = await web.search({
          query: String(args.query),
          numResults: typeof args.numResults === "number" ? args.numResults : 5,
          signal: context.signal,
        });
        const records = toSources(result.hits.map((hit) => ({
          kind: "web",
          provider: "exa",
          title: hit.title,
          text: hit.text,
          truncated: hit.truncated,
          url: hit.url,
          provenance: { url: hit.url },
        })));
        return {
          summary: `${records.length} Webtreffer gefunden.`,
          content: records.length === 0
            ? "Keine Webtreffer gefunden."
            : records
              .map((record) => `${sourceLine(record)}${truncationNote(record)}\n${record.text}`)
              .join("\n\n"),
          sources: records,
          meta: { filtered: result.filtered, costUsd: result.costUsd },
        };
      },
    });

    registerTool({
      name: "web_fetch",
      description: "Liest den Inhalt öffentlicher Webseiten über Exa anhand ihrer URLs.",
      category: "web",
      readOnly: true,
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["urls"],
        properties: {
          urls: {
            type: "array",
            minItems: 1,
            maxItems: 5,
            items: { type: "string", minLength: 4, maxLength: 2000 },
          },
        },
      },
      async handler(args, context) {
        const result = await web.read({
          urls: (args.urls as unknown[]).map((url) => String(url)),
          signal: context.signal,
        });
        const records = toSources(result.pages.map((page) => ({
          kind: "web",
          provider: "exa",
          title: page.title,
          text: page.text,
          truncated: page.truncated,
          url: page.url,
          provenance: { url: page.url },
        })));
        const parts: string[] = [];
        if (records.length > 0) {
          parts.push(records
            .map((record) => `${sourceLine(record)}${truncationNote(record)}\n${record.text}`)
            .join("\n\n"));
        }
        if (result.errors.length > 0) {
          parts.push([
            "Nicht abrufbare Quellen:",
            ...result.errors.map((error) => `- ${error.url}: ${error.reason}`),
          ].join("\n"));
        }
        return {
          summary: `${records.length} Webseiten gelesen, ${result.errors.length} nicht abrufbar.`,
          content: parts.join("\n\n") || "Es konnte keine Webseite gelesen werden.",
          sources: records,
          meta: { errors: result.errors, costUsd: result.costUsd },
        };
      },
    });
  }

  return {
    definitions() {
      return [...tools.values()].map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        category: tool.category,
        readOnly: tool.readOnly,
      }));
    },

    providerTools() {
      return [...tools.values()].map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
    },

    has(name: string) {
      return tools.has(name);
    },

    callsUsed() {
      return usedToolCalls;
    },

    async prepare(context) {
      const notices: FindogAgentRuntimeNotice[] = [];
      for (const client of options.mcpClients) {
        if (client.server.allowedTools.length === 0) {
          continue;
        }
        let discovered;
        try {
          discovered = await client.listTools({ signal: context.signal });
        } catch (error) {
          notices.push({
            code: "mcp_unavailable",
            message: `Der MCP-Server "${client.server.name}" ist nicht erreichbar: ${findogAgentErrorMessage(error)}`,
            detail: { serverId: client.server.id },
          });
          continue;
        }

        for (const tool of discovered) {
          if (!tool.approved) {
            continue;
          }
          const modelName = sanitizeFindogAgentMcpToolName(client.server.id, tool.name);
          if (tools.has(modelName)) {
            notices.push({
              code: "mcp_tool_name_collision",
              message: `Das MCP-Werkzeug "${tool.name}" konnte wegen eines Namenskonflikts nicht registriert werden.`,
              detail: { serverId: client.server.id, tool: tool.name },
            });
            continue;
          }
          mcpBindings.set(modelName, { client, toolName: tool.name });
          const schema: FindogAgentJsonSchema = {
            ...tool.inputSchema,
            type: tool.inputSchema.type ?? "object",
          };
          registerTool({
            name: modelName,
            description: tool.description
              || `Freigegebenes MCP-Werkzeug "${tool.name}" von "${client.server.name}".`,
            category: "mcp",
            readOnly: true,
            parameters: schema,
            async handler(args, context2) {
              const binding = mcpBindings.get(modelName);
              if (!binding) {
                throw new FindogAgentAdapterError(
                  "unknown_tool",
                  "Dieses MCP-Werkzeug ist nicht mehr verfügbar.",
                );
              }
              const result = await binding.client.callTool(binding.toolName, args, {
                signal: context2.signal,
              });
              if (result.isError) {
                return {
                  ok: false,
                  errorCode: "mcp_tool_error",
                  summary: `MCP-Werkzeug "${binding.toolName}" meldete einen Fehler.`,
                  content: `Das MCP-Werkzeug "${binding.toolName}" ist fehlgeschlagen:\n${result.text || "(keine Fehlermeldung)"}`,
                  meta: { isError: true },
                };
              }
              const structuredText = result.structuredContent === null
                ? ""
                : `\n\nStrukturierte Daten:\n${JSON.stringify(result.structuredContent)}`;
              const text = `${result.text || "(kein Textinhalt)"}${structuredText}`;
              const record = evidence.register({
                kind: "mcp",
                provider: `mcp:${binding.client.server.id}`,
                title: `${binding.client.server.name}: ${binding.toolName}`,
                text: boundFindogAgentText(text, options.limits.maxToolResultCharacters).text,
                truncated: result.structuredTruncated,
                url: null,
                provenance: {
                  serverId: binding.client.server.id,
                  tool: binding.toolName,
                },
              }).record;
              return {
                summary: `MCP-Werkzeug "${binding.toolName}" ausgeführt.`,
                content: `${sourceLine(record)}${truncationNote(record)}\n${record.text}`,
                sources: [record],
                meta: { isError: false, structuredTruncated: result.structuredTruncated },
              };
            },
          });
        }
      }
      return notices;
    },

    async execute(name, argumentsJson, context) {
      const base = {
        tool: name,
        category: tools.get(name)?.category ?? ("unknown" as FindogAgentToolCategory),
        sources: [] as FindogAgentSourceRecord[],
        meta: {} as Record<string, unknown>,
      };

      const tool = tools.get(name);
      if (!tool) {
        return {
          ...base,
          ok: false,
          errorCode: "unknown_tool",
          summary: `Unbekanntes Werkzeug "${name}".`,
          content: `Das Werkzeug "${name}" ist nicht verfügbar. Es wurde kein Aufruf ausgeführt.`,
        };
      }

      let parsedArguments: unknown;
      try {
        parsedArguments = argumentsJson.trim() ? JSON.parse(argumentsJson) : {};
      } catch {
        return {
          ...base,
          ok: false,
          errorCode: "invalid_arguments",
          summary: `Die Argumente für "${name}" waren kein gültiges JSON.`,
          content: "Die Werkzeugargumente waren ungültiges JSON. Es wurde kein Aufruf ausgeführt.",
        };
      }

      const validation = validateFindogAgentArguments(tool.parameters, parsedArguments);
      if (!validation.ok) {
        return {
          ...base,
          ok: false,
          errorCode: "invalid_arguments",
          summary: `Die Argumente für "${name}" waren ungültig.`,
          content: `Die Werkzeugargumente waren ungültig: ${validation.message} Es wurde kein Aufruf ausgeführt.`,
        };
      }

      if (usedToolCalls >= options.limits.maxToolCalls) {
        return {
          ...base,
          ok: false,
          errorCode: "tool_call_limit",
          summary: `Das Werkzeuglimit von ${options.limits.maxToolCalls} Aufrufen ist erreicht.`,
          content:
            "Das Werkzeuglimit ist erreicht. Bitte beantworte die Frage mit den vorhandenen Quellen.",
        };
      }

      usedToolCalls += 1;

      try {
        const result = await tool.handler(validation.value, context);
        const content = boundedResult(result.content);
        return {
          ...base,
          ok: result.ok ?? true,
          errorCode: result.errorCode ?? null,
          summary: result.summary ?? `Werkzeug "${name}" ausgeführt.`,
          content,
          sources: result.sources ?? [],
          meta: result.meta ?? {},
        };
      } catch (error) {
        const code = adapterErrorCode(error);
        const message = findogAgentErrorMessage(error);
        return {
          ...base,
          ok: false,
          errorCode: code,
          summary: `Werkzeug "${name}" fehlgeschlagen (${code}).`,
          content: `Das Werkzeug "${name}" ist fehlgeschlagen: ${message}`,
        };
      }
    },
  };
}
