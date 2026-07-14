/**
 * Semantic tool adapter for Findog.
 *
 * The DeepSeek model never receives raw MCP function names, raw kb_id
 * parameters, raw schema variants, thresholds, or direct generic MCP tool
 * schemas.  Instead it receives clear domain functions with only safe
 * semantic inputs.
 *
 * Public names/descriptions use English identifiers but German descriptions.
 * Server mappings own reasonable defaults/clamps; raw MCP schemas determine
 * available mappings and unavailable tools are not exposed.
 */

import type { DeepSeekTool, JsonObject, McpTool } from "./mcp/tools";
import {
  RESEARCH_SOURCES,
  type ResearchSource,
  getSourceByKey,
} from "./research-sources";

/* ------------------------------------------------------------------ */
/*  Schema-aware argument helpers                                     */
/* ------------------------------------------------------------------ */

const KB_ID_ALIASES = [
  "kb_id",
  "knowledge_base_id",
  "knowledgeBaseId",
] as const;
const KB_NAME_ALIASES = [
  "kb_name",
  "knowledge_base_name",
  "knowledgeBaseName",
] as const;
const ALL_KB_ALIASES = [...KB_ID_ALIASES, ...KB_NAME_ALIASES] as const;

const DEFAULT_RESULT_LIMIT = 5;
const YEAR_ALIASES = ["year", "tax_year", "reference_year"] as const;
const DATE_ALIASES = ["as_of", "stichtag", "effective_at", "valid_at"] as const;
const LIMIT_ALIASES = [
  "limit",
  "count",
  "max_results",
  "maxResults",
  "match_count",
  "top_k",
  "max_chunks",
] as const;

export type TrustedSemanticScope = {
  referenceYear?: string;
  referenceDate?: string;
  limit?: number;
};

/** Find which KB-parameter alias the raw schema declares, if any. */
function findKbParamAlias(
  schemaProps: Record<string, unknown> | undefined,
): string | undefined {
  if (!schemaProps) return undefined;
  for (const alias of ALL_KB_ALIASES) {
    if (alias in schemaProps) return alias;
  }
  return undefined;
}

/** Find the first schema-supported name among candidate aliases. */
function findParamAlias(
  schemaProps: Record<string, unknown> | undefined,
  ...candidates: string[]
): string | undefined {
  if (!schemaProps) return undefined;
  for (const candidate of candidates) {
    if (candidate in schemaProps) return candidate;
  }
  return undefined;
}

/** Resolve a source_key to a ResearchSource; throw on unknown. */
function resolveSourceKey(key: string): ResearchSource {
  const source = getSourceByKey(key.toUpperCase());
  if (!source) {
    throw new Error(
      `Unbekannter Quellenschlüssel: „${key}“. Verwende list_research_sources, um verfügbare Quellen zu ermitteln.`,
    );
  }
  return source;
}

/**
 * Build raw MCP arguments from semantic args respecting the raw tool's
 * declared schema.  Injects the KB id/name using whichever alias the
 * schema declares.  Maps query, keyword, document_id, slug, and limit
 * only when the raw schema supports them.  Adds a small default limit
 * if a count/limit property exists.  Never sends unsupported keys.
 */
function buildSchemaAwareArgs(
  rawTool: McpTool,
  semanticArgs: JsonObject,
  source: ResearchSource,
): JsonObject {
  const schema = rawTool.inputSchema as Record<string, unknown> | undefined;
  const props =
    (schema?.properties as Record<string, unknown> | undefined) ?? {};
  const rawArgs: JsonObject = {};

  // Inject KB identifier using the alias the raw schema declares
  const kbParam = findKbParamAlias(props);
  if (kbParam) {
    const isNameAlias = KB_NAME_ALIASES.includes(kbParam as never);
    rawArgs[kbParam] = isNameAlias ? source.name : source.kbId;
  }

  // Map query (document search, FAQ search, wiki search)
  const queryParam = findParamAlias(props, "query");
  if (queryParam && semanticArgs.query !== undefined) {
    rawArgs[queryParam] = String(semanticArgs.query);
  }

  // Map exact keyword
  const keywordParam = findParamAlias(props, "keyword", "exact_keyword");
  if (keywordParam && semanticArgs.keyword !== undefined) {
    rawArgs[keywordParam] = String(semanticArgs.keyword);
  }

  // Map document / knowledge identifier
  const docIdParam = findParamAlias(
    props,
    "document_id",
    "knowledge_id",
    "documentId",
    "knowledgeId",
  );
  if (docIdParam) {
    const docValue =
      semanticArgs.document_id ?? semanticArgs.knowledge_id;
    if (docValue !== undefined) {
      rawArgs[docIdParam] = String(docValue);
    }
  }

  // Map wiki slug
  const slugParam = findParamAlias(props, "slug");
  if (slugParam && semanticArgs.slug !== undefined) {
    rawArgs[slugParam] = String(semanticArgs.slug);
  }

  // Inject default result limit (never exposed publicly)
  const limitParam = findParamAlias(
    props,
    "limit",
    "count",
    "max_results",
    "maxResults",
  );
  if (limitParam && !(limitParam in semanticArgs)) {
    rawArgs[limitParam] = DEFAULT_RESULT_LIMIT;
  }

  return rawArgs;
}

function addTrustedScope(
  rawTool: McpTool,
  rawArgs: JsonObject,
  trustedScope: TrustedSemanticScope,
): JsonObject {
  const schema = rawTool.inputSchema as Record<string, unknown> | undefined;
  const props = (schema?.properties as Record<string, unknown> | undefined) ?? {};
  const scopedArgs: JsonObject = { ...rawArgs };

  const yearParam = findParamAlias(props, ...YEAR_ALIASES);
  if (yearParam && trustedScope.referenceYear) {
    const property = props[yearParam];
    const propertyType = property && typeof property === "object" && !Array.isArray(property)
      ? (property as Record<string, unknown>).type
      : undefined;
    scopedArgs[yearParam] = propertyType === "number" || propertyType === "integer"
      ? Number(trustedScope.referenceYear)
      : trustedScope.referenceYear;
  }

  const dateParam = findParamAlias(props, ...DATE_ALIASES);
  if (dateParam && trustedScope.referenceDate) {
    scopedArgs[dateParam] = trustedScope.referenceDate;
  }

  const limitParam = findParamAlias(props, ...LIMIT_ALIASES);
  if (limitParam && trustedScope.limit !== undefined) {
    scopedArgs[limitParam] = Math.max(1, Math.min(DEFAULT_RESULT_LIMIT, Math.trunc(trustedScope.limit)));
  }

  return scopedArgs;
}

/* ------------------------------------------------------------------ */
/*  Helper types & utilities                                          */
/* ------------------------------------------------------------------ */

/** Describes one semantic tool and how to map it to a raw MCP call. */
interface SemanticToolDef {
  /** Public (model-visible) name — English identifier. */
  publicName: string;
  /** Public description — German, concise. */
  publicDescription: string;
  /** JSON Schema for public parameters — NO kb_id, thresholds, etc. */
  publicParameters: JsonObject;
  /** Raw MCP tool name to invoke. */
  rawName: string;
  /**
   * Build the raw MCP arguments from the public (semantic) arguments.
   * Receives the raw McpTool object for schema-aware mapping and the
   * resolved ResearchSource for KB-id injection.
   */
  buildRawArgs: (
    semanticArgs: JsonObject,
    rawTool: McpTool,
    source?: ResearchSource,
  ) => JsonObject;
  /** Names of required raw MCP tools (must all be present to expose). */
  requiredRawToolNames: readonly string[];
  /** Fixed ResearchSource to inject, or a resolver from semantic args. */
  resolveSource?: (args: JsonObject) => ResearchSource;
}

/* ------------------------------------------------------------------ */
/*  Tool definitions — one per source-specific capability              */
/* ------------------------------------------------------------------ */

const DOCUMENT_SEARCH_PROPERTIES: JsonObject = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Suchbegriff oder natürlichsprachliche Frage.",
    },
  },
  required: ["query"],
  additionalProperties: false,
};

const FAQ_SEARCH_PROPERTIES: JsonObject = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Suchbegriff oder natürlichsprachliche Frage.",
    },
  },
  required: ["query"],
  additionalProperties: false,
};

const FAQ_EXACT_PROPERTIES: JsonObject = {
  type: "object",
  properties: {
    keyword: {
      type: "string",
      description:
        "Exakter Suchbegriff (Abkürzung, Paragraf, Betrag, Jahr).",
    },
  },
  required: ["keyword"],
  additionalProperties: false,
};

const WIKI_SEARCH_PROPERTIES: JsonObject = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Suchbegriff für die Wiki-Volltextsuche.",
    },
  },
  required: ["query"],
  additionalProperties: false,
};

const WIKI_READ_PROPERTIES: JsonObject = {
  type: "object",
  properties: {
    slug: {
      type: "string",
      description:
        "Wiki-Seitenpfad (z. B. „summary/Familienbonus Plus - alle Informationen - Summary“ oder „concept/Familienleistungen/Familienbeihilfe“). Aus wiki_search- oder wiki_index_view-Treffern übernehmen.",
    },
  },
  required: ["slug"],
  additionalProperties: false,
};

const WIKI_INDEX_PROPERTIES: JsonObject = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

/** Public schema for source-key + document-id tools. */
function sourceDocIdProperties(
  extraProps?: JsonObject,
): JsonObject {
  return {
    type: "object",
    properties: {
      source_key: {
        type: "string",
        description:
          "Quellenschlüssel aus der Liste der verfügbaren Forschungsquellen (z. B. „GESETZE“, „BFG“, „WIKI“).",
      },
      knowledge_id: {
        type: "string",
        description:
          "Dokumentkennung (knowledge_id) aus einem vorherigen Suchergebnis.",
      },
      ...(extraProps?.properties as Record<string, unknown> ?? {}),
    },
    required: ["source_key", "knowledge_id"],
    additionalProperties: false,
  };
}

function documentSearchTool(
  publicName: string,
  source: ResearchSource,
  description: string,
): SemanticToolDef {
  return {
    publicName,
    publicDescription: description,
    publicParameters: DOCUMENT_SEARCH_PROPERTIES,
    rawName: "hybrid_search",
    buildRawArgs: (args, rawTool) =>
      buildSchemaAwareArgs(rawTool, args, source),
    requiredRawToolNames: source.requiresRawTools,
    resolveSource: () => source,
  };
}

function faqSemanticTool(
  publicName: string,
  source: ResearchSource,
  description: string,
): SemanticToolDef {
  return {
    publicName,
    publicDescription: description,
    publicParameters: FAQ_SEARCH_PROPERTIES,
    rawName: "faq_search",
    buildRawArgs: (args, rawTool) =>
      buildSchemaAwareArgs(rawTool, args, source),
    requiredRawToolNames: ["faq_search"] as const,
    resolveSource: () => source,
  };
}

function faqExactTool(
  publicName: string,
  source: ResearchSource,
  description: string,
): SemanticToolDef {
  return {
    publicName,
    publicDescription: description,
    publicParameters: FAQ_EXACT_PROPERTIES,
    rawName: "faq_entries_search",
    buildRawArgs: (args, rawTool) =>
      buildSchemaAwareArgs(rawTool, args, source),
    requiredRawToolNames: ["faq_entries_search"] as const,
    resolveSource: () => source,
  };
}

/** Build raw args for a source-key-based tool (list/inspect/chunks). */
function sourceKeyToolArgs(
  semanticArgs: JsonObject,
  rawTool: McpTool,
): JsonObject {
  const source = resolveSourceKey(
    String(semanticArgs.source_key ?? ""),
  );
  return buildSchemaAwareArgs(rawTool, semanticArgs, source);
}

/* ------------------------------------------------------------------ */
/*  Source/document inspection schemas                                 */
/* ------------------------------------------------------------------ */

const LIST_SOURCE_DOCUMENTS_PROPERTIES: JsonObject = {
  type: "object",
  properties: {
    source_key: {
      type: "string",
      description:
        "Quellenschlüssel aus der Liste der verfügbaren Forschungsquellen (z. B. „GESETZE“, „BFG“, „WIKI“).",
    },
  },
  required: ["source_key"],
  additionalProperties: false,
};

const GET_SOURCE_DOCUMENT_PROPERTIES: JsonObject =
  sourceDocIdProperties();

const GET_SOURCE_DOCUMENT_CHUNKS_PROPERTIES: JsonObject =
  sourceDocIdProperties();

/* ------------------------------------------------------------------ */
/*  All possible semantic tool definitions.                            */
/* ------------------------------------------------------------------ */

const ALL_SEMANTIC_DEFS: SemanticToolDef[] = [
  // ── document sources ──────────────────────────────────────────────
  documentSearchTool(
    "search_laws",
    RESEARCH_SOURCES.GESETZE,
    "Durchsucht Gesetze und Verordnungen (EStG, BAO, UStG, KStG, FLAG, Richtlinien, DBA-Texte) nach einer natürlichsprachlichen Frage oder Stichworten.",
  ),
  documentSearchTool(
    "search_bfg",
    RESEARCH_SOURCES.BFG,
    "Durchsucht BFG-Entscheidungen (Erkenntnisse, Beschlüsse) nach Schlagworten oder natürlichsprachlicher Beschreibung.",
  ),
  documentSearchTool(
    "search_fexklusiv",
    RESEARCH_SOURCES.FEXKLUSIV,
    "Durchsucht FEXklusiv (interne Fortbildungs-/Briefing-Reihe zur Arbeitnehmerveranlagung).",
  ),
  documentSearchTool(
    "search_work_aids",
    RESEARCH_SOURCES.ARBEITSBEHELFE,
    "Durchsucht Arbeitsbehelfe und interne Dokumente zu konkreten ANV-Themen.",
  ),
  // ── wiki ──────────────────────────────────────────────────────────
  {
    publicName: "search_wiki",
    publicDescription:
      "Durchsucht das Allgemeine Informationen Wiki (ABC der Werbungskosten, Familienbeihilfe, DBA-Grundlagen u. a.) nach Begriffen.",
    publicParameters: WIKI_SEARCH_PROPERTIES,
    rawName: "wiki_search",
    buildRawArgs: (args, rawTool) =>
      buildSchemaAwareArgs(rawTool, args, RESEARCH_SOURCES.WIKI),
    requiredRawToolNames: ["wiki_search"] as const,
    resolveSource: () => RESEARCH_SOURCES.WIKI,
  },
  {
    publicName: "read_wiki_page",
    publicDescription:
      "Ruft eine vollständige Wiki-Seite anhand ihres Slugs ab (z. B. „summary/Familienbonus Plus - alle Informationen - Summary“).",
    publicParameters: WIKI_READ_PROPERTIES,
    rawName: "wiki_read_page",
    buildRawArgs: (args, rawTool) =>
      buildSchemaAwareArgs(rawTool, args, RESEARCH_SOURCES.WIKI),
    requiredRawToolNames: ["wiki_read_page"] as const,
    resolveSource: () => RESEARCH_SOURCES.WIKI,
  },
  {
    publicName: "browse_wiki_index",
    publicDescription:
      "Zeigt den strukturierten Index des Allgemeine Informationen Wiki an, gruppiert nach summary/entity/concept.",
    publicParameters: WIKI_INDEX_PROPERTIES,
    rawName: "wiki_index_view",
    buildRawArgs: (_args, rawTool) =>
      buildSchemaAwareArgs(rawTool, {}, RESEARCH_SOURCES.WIKI),
    requiredRawToolNames: ["wiki_index_view"] as const,
    resolveSource: () => RESEARCH_SOURCES.WIKI,
  },
  // ── FAQ sources (semantic) ────────────────────────────────────────
  faqSemanticTool(
    "search_win_anv",
    RESEARCH_SOURCES.WIN_ANV,
    "Durchsucht Win-ANV-Protokolle (interne Verwaltungspraxis) mit einer natürlichsprachlichen Frage.",
  ),
  faqSemanticTool(
    "search_amount_table",
    RESEARCH_SOURCES.BETRAGSTABELLE,
    "Durchsucht Betragstabellen (FAQ) nach Beträgen, Freibeträgen oder Höchstbeträgen mit einer natürlichsprachlichen Frage.",
  ),
  // ── FAQ sources (exact) ───────────────────────────────────────────
  faqExactTool(
    "search_win_anv_exact",
    RESEARCH_SOURCES.WIN_ANV,
    "Sucht in Win-ANV-Protokollen nach einer exakten Abkürzung, Paragrafen oder Jahr.",
  ),
  faqExactTool(
    "search_amount_table_exact",
    RESEARCH_SOURCES.BETRAGSTABELLE,
    "Sucht in Betragstabellen nach einer exakten Abkürzung, Paragrafen, Betrag oder Jahr.",
  ),
  // ── wiki document search (via hybrid_search) ──────────────────────
  {
    publicName: "search_wiki_documents",
    publicDescription:
      "Durchsucht Dokumente im Allgemeine Informationen Wiki (volltext Dokumentensuche, z. B. BMF-Broschüren, AK-Leitfäden, Kanzleiartikel).",
    publicParameters: DOCUMENT_SEARCH_PROPERTIES,
    rawName: "hybrid_search",
    buildRawArgs: (args, rawTool) =>
      buildSchemaAwareArgs(rawTool, args, RESEARCH_SOURCES.WIKI),
    requiredRawToolNames: ["hybrid_search"] as const,
    resolveSource: () => RESEARCH_SOURCES.WIKI,
  },
  // ── source-document inspection ────────────────────────────────────
  {
    publicName: "list_research_documents",
    publicDescription:
      "Listet alle verfügbaren Quelldokumente in einer bestimmten Forschungsquelle auf, nach source_key eingegrenzt.",
    publicParameters: LIST_SOURCE_DOCUMENTS_PROPERTIES,
    rawName: "list_knowledge",
    buildRawArgs: sourceKeyToolArgs,
    requiredRawToolNames: ["list_knowledge"] as const,
  },
  {
    publicName: "inspect_research_document",
    publicDescription:
      "Ruft ein bestimmtes Quelldokument anhand der knowledge_id ab, die von einem vorherigen Suchergebnis zurückgegeben wurde.",
    publicParameters: GET_SOURCE_DOCUMENT_PROPERTIES,
    rawName: "get_knowledge",
    buildRawArgs: sourceKeyToolArgs,
    requiredRawToolNames: ["get_knowledge"] as const,
  },
  {
    publicName: "inspect_research_document_chunks",
    publicDescription:
      "Ruft die Textabschnitte (Chunks) eines bestimmten Quelldokuments anhand der knowledge_id ab.",
    publicParameters: GET_SOURCE_DOCUMENT_CHUNKS_PROPERTIES,
    rawName: "list_chunks",
    buildRawArgs: sourceKeyToolArgs,
    requiredRawToolNames: ["list_chunks"] as const,
  },
  // ── discovery ─────────────────────────────────────────────────────
  {
    publicName: "list_research_sources",
    publicDescription:
      "Listet alle verfügbaren Forschungsquellen mit Typ und Fähigkeiten. Nützlich bei Unsicherheit über verfügbare Quellen.",
    publicParameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    rawName: "list_knowledge_bases",
    buildRawArgs: () => ({}),
    requiredRawToolNames: ["list_knowledge_bases"] as const,
  },
  {
    publicName: "inspect_research_source",
    publicDescription:
      "Ruft Metadaten und Konfiguration einer bestimmten Forschungsquelle ab (Typ, unterstützte Suchmodi).",
    publicParameters: {
      type: "object",
      properties: {
        source_key: {
          type: "string",
          description:
            "Quellenschlüssel aus der Liste der verfügbaren Forschungsquellen (z. B. „GESETZE“, „BFG“, „WIKI“).",
        },
      },
      required: ["source_key"],
      additionalProperties: false,
    },
    rawName: "get_knowledge_base",
    buildRawArgs: (semanticArgs, rawTool) => {
      const source = resolveSourceKey(
        String(semanticArgs.source_key ?? ""),
      );
      return buildSchemaAwareArgs(rawTool, {}, source);
    },
    requiredRawToolNames: ["get_knowledge_base"] as const,
  },
];

/* ------------------------------------------------------------------ */
/*  Registry                                                          */
/* ------------------------------------------------------------------ */

export class SemanticToolRegistry {
  /** Semantic definitions that are available given the raw MCP tools. */
  private readonly available: SemanticToolDef[] = [];
  /** Map: semantic public name → SemanticToolDef */
  private readonly byPublicName = new Map<string, SemanticToolDef>();
  /** Map: raw MCP tool name → McpTool object (for schema-aware routing). */
  private readonly rawToolByName = new Map<string, McpTool>();

  constructor(rawTools: McpTool[]) {
    // Index raw tools by name for schema lookups
    for (const tool of rawTools) {
      this.rawToolByName.set(tool.name, tool);
    }

    // Only include semantic defs whose required raw tools are all present
    for (const def of ALL_SEMANTIC_DEFS) {
      const allPresent = def.requiredRawToolNames.every((name) =>
        this.rawToolByName.has(name),
      );
      if (allPresent) {
        this.available.push(def);
        this.byPublicName.set(def.publicName, def);
      }
    }
  }

  /** Returns the model-visible DeepSeek tool definitions. */
  getModelTools(): DeepSeekTool[] {
    return this.available.map((def) => ({
      type: "function",
      function: {
        name: def.publicName,
        description: def.publicDescription,
        parameters: def.publicParameters,
      },
    }));
  }

  /**
   * Routes a model-selected semantic tool call to the corresponding raw
   * MCP tool name and arguments (with kb_id and defaults injected).
   * Uses schema-aware argument mapping based on the raw tool's schema.
   *
   * @returns The raw MCP `{ name, arguments }` or `undefined` if the
   *          public tool name is unknown / unavailable.
   */
  routeToolCall(
    publicName: string,
    semanticArgs: JsonObject,
  ): { name: string; arguments: JsonObject } | undefined {
    const def = this.byPublicName.get(publicName);
    if (!def) return undefined;

    const rawMcpTool = this.rawToolByName.get(def.rawName);
    if (!rawMcpTool) return undefined;

    return {
      name: def.rawName,
      arguments: def.buildRawArgs(semanticArgs, rawMcpTool),
    };
  }

  /**
   * Routes a server-selected call and adds trusted temporal filters only
   * when the raw MCP schema declares them. Model-provided arguments never
   * reach these fields.
   */
  routeDeterministicToolCall(
    publicName: string,
    publicArgs: JsonObject,
    trustedScope: TrustedSemanticScope,
  ): { name: string; arguments: JsonObject } | undefined {
    const def = this.byPublicName.get(publicName);
    if (!def) return undefined;

    const rawMcpTool = this.rawToolByName.get(def.rawName);
    if (!rawMcpTool) return undefined;

    const source = def.resolveSource?.(publicArgs);
    const baseArgs = def.buildRawArgs(publicArgs, rawMcpTool, source);
    return {
      name: def.rawName,
      arguments: addTrustedScope(rawMcpTool, baseArgs, trustedScope),
    };
  }

  /** Returns the list of public (semantic) tool names. */
  getPublicToolNames(): string[] {
    return this.available.map((d) => d.publicName);
  }
}
