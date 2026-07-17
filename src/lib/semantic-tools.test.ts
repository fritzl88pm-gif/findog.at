import { describe, expect, it } from "vitest";

import { SemanticToolRegistry } from "./semantic-tools";
import type { McpTool } from "./mcp/tools";
import { RESEARCH_SOURCES } from "./research-sources";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function rawTool(name: string, properties?: Record<string, unknown>): McpTool {
  return {
    name,
    description: `Raw ${name}`,
    inputSchema: properties
      ? {
          type: "object",
          properties: properties as Record<string, unknown>,
        }
      : undefined,
  };
}

/** All raw tools that the production MCP server is expected to expose. */
function allProductionRawTools(): McpTool[] {
  return [
    rawTool("hybrid_search", {
      kb_id: { type: "string" },
      query: { type: "string" },
    }),
    rawTool("faq_search", {
      kb_id: { type: "string" },
      query: { type: "string" },
      only_recommended: { type: "boolean" },
      first_priority_tag_ids: { type: "array", items: { type: "string" } },
      second_priority_tag_ids: { type: "array", items: { type: "string" } },
    }),
    rawTool("faq_entries_search", {
      kb_id: { type: "string" },
      keyword: { type: "string" },
    }),
    rawTool("wiki_search", {
      kb_id: { type: "string" },
      query: { type: "string" },
    }),
    rawTool("wiki_read_page", {
      kb_id: { type: "string" },
      slug: { type: "string" },
    }),
    rawTool("wiki_index_view", {
      kb_id: { type: "string" },
    }),
    rawTool("list_knowledge_bases"),
    rawTool("get_knowledge_base", {
      kb_id: { type: "string" },
    }),
    rawTool("list_knowledge", {
      kb_id: { type: "string" },
    }),
    rawTool("get_knowledge", {
      kb_id: { type: "string" },
      knowledge_id: { type: "string" },
    }),
    rawTool("list_chunks", {
      kb_id: { type: "string" },
      knowledge_id: { type: "string" },
    }),
  ];
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe("SemanticToolRegistry", () => {
  describe("(a) raw MCP -> semantic tools with kb ids absent from public schemas", () => {
    it("exposes source-specific search tools without kb_id in public schemas", () => {
      const registry = new SemanticToolRegistry(allProductionRawTools());
      const modelTools = registry.getModelTools();

      // Every tool must have a public schema — none should expose kb_id
      for (const tool of modelTools) {
        const params = tool.function.parameters as Record<string, unknown>;
        const props = params.properties as Record<string, unknown> | undefined;

        // schema-level forbidden keys
        expect(tool.function.name).not.toContain("kb_id");
        if (props) {
          const propKeys = Object.keys(props);
          expect(propKeys).not.toContain("kb_id");
          expect(propKeys).not.toContain("knowledge_base_id");
          expect(propKeys).not.toContain("vector_threshold");
          expect(propKeys).not.toContain("keyword_threshold");
          expect(propKeys).not.toContain("match_count");
          expect(propKeys).not.toContain("only_recommended");
          expect(propKeys).not.toContain("first_priority_tag_ids");
          expect(propKeys).not.toContain("second_priority_tag_ids");
        }
      }
    });

    it("keeps optional raw FAQ ranking parameters out of the model schema and routed calls", () => {
      const registry = new SemanticToolRegistry(allProductionRawTools());
      const faqTools = registry.getModelTools().filter((tool) =>
        ["search_win_anv", "search_amount_table"].includes(tool.function.name),
      );

      expect(faqTools).toHaveLength(2);
      for (const tool of faqTools) {
        const parameters = tool.function.parameters as {
          properties?: Record<string, unknown>;
        };
        expect(Object.keys(parameters.properties ?? {})).toEqual(["query"]);
      }

      const routed = registry.routeToolCall("search_amount_table", {
        query: "Unterhaltsabsetzbetrag 2024",
      });
      expect(routed?.arguments).not.toHaveProperty("only_recommended");
      expect(routed?.arguments).not.toHaveProperty("first_priority_tag_ids");
      expect(routed?.arguments).not.toHaveProperty("second_priority_tag_ids");
    });

    it("exposes expected semantic tools for all configured sources when raw tools are available", () => {
      const registry = new SemanticToolRegistry(allProductionRawTools());
      const names = registry.getPublicToolNames();

      // Source-specific search tools
      expect(names).toContain("search_laws");
      expect(names).toContain("search_bfg");
      expect(names).toContain("search_fexklusiv");
      expect(names).toContain("search_work_aids");
      expect(names).toContain("search_win_anv");
      expect(names).toContain("search_amount_table");
      expect(names).toContain("search_win_anv_exact");
      expect(names).toContain("search_amount_table_exact");

      // Wiki tools
      expect(names).toContain("search_wiki");
      expect(names).toContain("read_wiki_page");
      expect(names).toContain("browse_wiki_index");

      // Discovery
      expect(names).toContain("list_research_sources");
      expect(names).toContain("inspect_research_source");

      expect(names).not.toContain("list_knowledge");
      expect(names).not.toContain("get_knowledge");
      expect(names).not.toContain("list_chunks");
      expect(names).not.toContain("hybrid_search");
      expect(names).not.toContain("faq_search");
      expect(names).not.toContain("wiki_search");
    });
  });

  describe("(b) semantic tool call routing", () => {
    it("resolves only the human-readable source name for fixed and source-key calls", () => {
      const registry = new SemanticToolRegistry(allProductionRawTools());

      expect(registry.getResearchSourceName("search_laws", { query: "EStG" }))
        .toBe(RESEARCH_SOURCES.GESETZE.name);
      expect(registry.getResearchSourceName("inspect_research_document", {
        source_key: "BFG",
        knowledge_id: "doc-123",
      })).toBe(RESEARCH_SOURCES.BFG.name);
      expect(registry.getResearchSourceName("inspect_research_source", {
        source_key: RESEARCH_SOURCES.WIKI.kbId,
      })).toBe(RESEARCH_SOURCES.WIKI.name);
      expect(registry.getResearchSourceName("list_research_sources", {})).toBeUndefined();
      expect(registry.getResearchSourceName("unknown_tool", {})).toBeUndefined();
      expect(registry.getResearchSourceName("inspect_research_source", {
        source_key: "UNKNOWN",
      })).toBeUndefined();

      expect(registry.getResearchSourceName("search_laws", { query: "EStG" }))
        .not.toContain(RESEARCH_SOURCES.GESETZE.kbId);
    });

    it("routes search_laws to hybrid_search with correct Gesetze kb_id", () => {
      const registry = new SemanticToolRegistry(allProductionRawTools());
      const routed = registry.routeToolCall("search_laws", { query: "EStG § 33" });

      expect(routed).toBeDefined();
      expect(routed!.name).toBe("hybrid_search");
      expect(routed!.arguments.kb_id).toBe(RESEARCH_SOURCES.GESETZE.kbId);
      expect(routed!.arguments.query).toBe("EStG § 33");
      // No raw thresholds leaked
      expect(routed!.arguments).not.toHaveProperty("vector_threshold");
      expect(routed!.arguments).not.toHaveProperty("keyword_threshold");
      expect(routed!.arguments).not.toHaveProperty("match_count");
    });

    it("routes search_bfg to hybrid_search with correct BFG kb_id", () => {
      const registry = new SemanticToolRegistry(allProductionRawTools());
      const routed = registry.routeToolCall("search_bfg", { query: "Pendlerpauschale" });

      expect(routed).toBeDefined();
      expect(routed!.name).toBe("hybrid_search");
      expect(routed!.arguments.kb_id).toBe(RESEARCH_SOURCES.BFG.kbId);
      expect(routed!.arguments.query).toBe("Pendlerpauschale");
    });

    it("routes search_win_anv to faq_search with correct Win ANV kb_id", () => {
      const registry = new SemanticToolRegistry(allProductionRawTools());
      const routed = registry.routeToolCall("search_win_anv", { query: "Pendlerpauschale Höhe" });

      expect(routed).toBeDefined();
      expect(routed!.name).toBe("faq_search");
      expect(routed!.arguments.kb_id).toBe(RESEARCH_SOURCES.WIN_ANV.kbId);
    });

    it("routes search_win_anv_exact to faq_entries_search with correct Win ANV kb_id", () => {
      const registry = new SemanticToolRegistry(allProductionRawTools());
      const routed = registry.routeToolCall("search_win_anv_exact", { keyword: "UAB" });

      expect(routed).toBeDefined();
      expect(routed!.name).toBe("faq_entries_search");
      expect(routed!.arguments.kb_id).toBe(RESEARCH_SOURCES.WIN_ANV.kbId);
      expect(routed!.arguments.keyword).toBe("UAB");
    });

    it("routes search_amount_table to faq_search with correct Betragstabelle kb_id", () => {
      const registry = new SemanticToolRegistry(allProductionRawTools());
      const routed = registry.routeToolCall("search_amount_table", { query: "Alleinverdienerabsetzbetrag 2025" });

      expect(routed).toBeDefined();
      expect(routed!.name).toBe("faq_search");
      expect(routed!.arguments.kb_id).toBe(RESEARCH_SOURCES.BETRAGSTABELLE.kbId);
    });

    it("routes search_amount_table_exact to faq_entries_search with correct Betragstabelle kb_id", () => {
      const registry = new SemanticToolRegistry(allProductionRawTools());
      const routed = registry.routeToolCall("search_amount_table_exact", { keyword: "AVAB 2025" });

      expect(routed).toBeDefined();
      expect(routed!.name).toBe("faq_entries_search");
      expect(routed!.arguments.kb_id).toBe(RESEARCH_SOURCES.BETRAGSTABELLE.kbId);
    });

    it("routes wiki tools to correct raw names with Wiki kb_id", () => {
      const registry = new SemanticToolRegistry(allProductionRawTools());

      const searchRouted = registry.routeToolCall("search_wiki", { query: "Familienbonus" });
      expect(searchRouted!.name).toBe("wiki_search");
      expect(searchRouted!.arguments.kb_id).toBe(RESEARCH_SOURCES.WIKI.kbId);

      const readRouted = registry.routeToolCall("read_wiki_page", { slug: "concept/Familienbonus" });
      expect(readRouted!.name).toBe("wiki_read_page");
      expect(readRouted!.arguments.kb_id).toBe(RESEARCH_SOURCES.WIKI.kbId);

      const indexRouted = registry.routeToolCall("browse_wiki_index", {});
      expect(indexRouted!.name).toBe("wiki_index_view");
      expect(indexRouted!.arguments.kb_id).toBe(RESEARCH_SOURCES.WIKI.kbId);
    });

    it("routes list_research_sources correctly", () => {
      const registry = new SemanticToolRegistry(allProductionRawTools());
      const routed = registry.routeToolCall("list_research_sources", {});
      expect(routed!.name).toBe("list_knowledge_bases");
    });

    it("routes inspect_research_source to get_knowledge_base with resolved kb_id via source_key", () => {
      const registry = new SemanticToolRegistry(allProductionRawTools());
      const routed = registry.routeToolCall("inspect_research_source", {
        source_key: "GESETZE",
      });
      expect(routed!.name).toBe("get_knowledge_base");
      expect(routed!.arguments.kb_id).toBe(RESEARCH_SOURCES.GESETZE.kbId);
    });

    it("accepts a known KB id when the model supplies it as source_key", () => {
      const registry = new SemanticToolRegistry(allProductionRawTools());
      const routed = registry.routeToolCall("inspect_research_source", {
        source_key: RESEARCH_SOURCES.ARBEITSBEHELFE.kbId,
      });
      expect(routed!.name).toBe("get_knowledge_base");
      expect(routed!.arguments.kb_id).toBe(RESEARCH_SOURCES.ARBEITSBEHELFE.kbId);
    });

    it("returns undefined for unknown public tool names", () => {
      const registry = new SemanticToolRegistry(allProductionRawTools());
      expect(registry.routeToolCall("nonexistent_tool", {})).toBeUndefined();
      expect(registry.routeToolCall("hybrid_search", {})).toBeUndefined();
    });
  });

  describe("(c) unavailable raw capabilities are not model-visible", () => {
    it("excludes wiki tools when wiki raw tools are missing", () => {
      const tools = [
        rawTool("hybrid_search"),
        rawTool("faq_search"),
        rawTool("faq_entries_search"),
        rawTool("list_knowledge_bases"),
        rawTool("get_knowledge_base"),
      ];
      const registry = new SemanticToolRegistry(tools);
      const names = registry.getPublicToolNames();

      expect(names).toContain("search_laws");
      expect(names).toContain("search_bfg");
      expect(names).toContain("search_win_anv");
      expect(names).toContain("search_amount_table");
      expect(names).toContain("list_research_sources");
      expect(names).toContain("inspect_research_source");

      // Wiki tools excluded
      expect(names).not.toContain("search_wiki");
      expect(names).not.toContain("read_wiki_page");
      expect(names).not.toContain("browse_wiki_index");
    });

    it("excludes FAQ exact tools when faq_entries_search is missing", () => {
      const tools = [
        rawTool("hybrid_search"),
        rawTool("faq_search"),
      ];
      const registry = new SemanticToolRegistry(tools);
      const names = registry.getPublicToolNames();

      expect(names).toContain("search_win_anv");
      expect(names).not.toContain("search_win_anv_exact");
      expect(names).not.toContain("search_amount_table_exact");
    });

    it("excludes all FAQ tools when faq_search is missing", () => {
      const tools = [
        rawTool("hybrid_search"),
        rawTool("list_knowledge_bases"),
      ];
      const registry = new SemanticToolRegistry(tools);
      const names = registry.getPublicToolNames();

      expect(names).not.toContain("search_win_anv");
      expect(names).not.toContain("search_amount_table");
    });

    it("excludes all source-specific tools when only discovery tools are available", () => {
      const tools = [rawTool("list_knowledge_bases")];
      const registry = new SemanticToolRegistry(tools);
      const names = registry.getPublicToolNames();

      // Only list_research_sources should be visible
      expect(names).toEqual(["list_research_sources"]);

      // No source-specific tools
      expect(names).not.toContain("search_laws");
      expect(names).not.toContain("search_bfg");
      expect(names).not.toContain("search_wiki");
    });

    it("exposes no tools when the server provides no tools", () => {
      const registry = new SemanticToolRegistry([]);
      expect(registry.getPublicToolNames()).toEqual([]);
      expect(registry.getModelTools()).toEqual([]);
    });
  });

  describe("(d) source-document list/inspect/chunks wrappers", () => {
    it("exposes list_research_documents only when list_knowledge raw tool is present", () => {
      const registry = new SemanticToolRegistry(allProductionRawTools());
      const names = registry.getPublicToolNames();
      expect(names).toContain("list_research_documents");
    });

    it("exposes inspect_research_document only when get_knowledge raw tool is present", () => {
      const registry = new SemanticToolRegistry(allProductionRawTools());
      const names = registry.getPublicToolNames();
      expect(names).toContain("inspect_research_document");
    });

    it("exposes inspect_research_document_chunks only when list_chunks raw tool is present", () => {
      const registry = new SemanticToolRegistry(allProductionRawTools());
      const names = registry.getPublicToolNames();
      expect(names).toContain("inspect_research_document_chunks");
    });

    it("hides source-document tools when raw tools are absent", () => {
      const tools = [
        rawTool("hybrid_search"),
        rawTool("list_knowledge_bases"),
      ];
      const registry = new SemanticToolRegistry(tools);
      const names = registry.getPublicToolNames();
      expect(names).not.toContain("list_research_documents");
      expect(names).not.toContain("inspect_research_document");
      expect(names).not.toContain("inspect_research_document_chunks");
    });

    it("routes list_research_documents with schema-aware kb_id for GESETZE", () => {
      const registry = new SemanticToolRegistry(allProductionRawTools());
      const routed = registry.routeToolCall("list_research_documents", {
        source_key: "GESETZE",
      });
      expect(routed).toBeDefined();
      expect(routed!.name).toBe("list_knowledge");
      expect(routed!.arguments.kb_id).toBe(RESEARCH_SOURCES.GESETZE.kbId);
      // No threshold or raw keys leaked
      expect(routed!.arguments).not.toHaveProperty("vector_threshold");
      expect(routed!.arguments).not.toHaveProperty("keyword_threshold");
    });

    it("routes inspect_research_document with source_key and knowledge_id", () => {
      const registry = new SemanticToolRegistry(allProductionRawTools());
      const routed = registry.routeToolCall("inspect_research_document", {
        source_key: "BFG",
        knowledge_id: "doc-123",
      });
      expect(routed).toBeDefined();
      expect(routed!.name).toBe("get_knowledge");
      expect(routed!.arguments.kb_id).toBe(RESEARCH_SOURCES.BFG.kbId);
      expect(routed!.arguments.knowledge_id).toBe("doc-123");
    });

    it("routes inspect_research_document_chunks with source_key and knowledge_id", () => {
      const registry = new SemanticToolRegistry(allProductionRawTools());
      const routed = registry.routeToolCall("inspect_research_document_chunks", {
        source_key: "WIKI",
        knowledge_id: "wiki-doc-456",
      });
      expect(routed).toBeDefined();
      expect(routed!.name).toBe("list_chunks");
      expect(routed!.arguments.kb_id).toBe(RESEARCH_SOURCES.WIKI.kbId);
      expect(routed!.arguments.knowledge_id).toBe("wiki-doc-456");
    });

    it("returns argumentError for unknown source_key in list_research_documents instead of throwing", () => {
      const registry = new SemanticToolRegistry(allProductionRawTools());
      const result = registry.routeToolCall("list_research_documents", {
        source_key: "UNKNOWN_SOURCE",
      });
      expect(result).toBeDefined();
      expect(result).toHaveProperty("error");
      expect(result!.error).toMatch(/Unbekannter Quellenschlüssel/);
    });

    it("returns argumentError for unknown source_key in inspect_research_document instead of throwing", () => {
      const registry = new SemanticToolRegistry(allProductionRawTools());
      const result = registry.routeToolCall("inspect_research_document", {
        source_key: "NONEXISTENT",
        knowledge_id: "x",
      });
      expect(result).toBeDefined();
      expect(result).toHaveProperty("error");
      expect(result!.error).toMatch(/Unbekannter Quellenschlüssel/);
    });

    it("returns argumentError for unknown source_key in inspect_research_document_chunks instead of throwing", () => {
      const registry = new SemanticToolRegistry(allProductionRawTools());
      const result = registry.routeToolCall("inspect_research_document_chunks", {
        source_key: "INVALID",
        knowledge_id: "x",
      });
      expect(result).toBeDefined();
      expect(result).toHaveProperty("error");
      expect(result!.error).toMatch(/Unbekannter Quellenschlüssel/);
    });

    it("returns argumentError for unknown source_key in inspect_research_source instead of throwing", () => {
      const registry = new SemanticToolRegistry(allProductionRawTools());
      const result = registry.routeToolCall("inspect_research_source", {
        source_key: "NONEXISTENT",
      });
      expect(result).toBeDefined();
      expect(result).toHaveProperty("error");
      expect(result!.error).toMatch(/Unbekannter Quellenschlüssel/);
    });

    it("adds an enum constraint with exactly the canonical keys to all four source_key schemas", () => {
      const registry = new SemanticToolRegistry(allProductionRawTools());
      const modelTools = registry.getModelTools();
      const sourceKeyTools = [
        "list_research_documents",
        "inspect_research_document",
        "inspect_research_document_chunks",
        "inspect_research_source",
      ];
      const expectedKeys = Object.keys(RESEARCH_SOURCES);
      for (const toolName of sourceKeyTools) {
        const tool = modelTools.find((t) => t.function.name === toolName);
        expect(tool, `tool ${toolName} not found`).toBeDefined();
        const props = (tool!.function.parameters as Record<string, unknown>).properties as Record<string, unknown>;
        const sourceKeySchema = props.source_key as Record<string, unknown>;
        expect(sourceKeySchema, `source_key schema for ${toolName}`).toBeDefined();
        expect(sourceKeySchema.enum, `enum for ${toolName}`).toBeDefined();
        const enumValues = sourceKeySchema.enum as string[];
        expect([...enumValues].sort()).toEqual([...expectedKeys].sort());
      }
    });
  });

  describe("(e) wiki document search via hybrid_search", () => {
    it("exposes search_wiki_documents when hybrid_search is present", () => {
      const registry = new SemanticToolRegistry(allProductionRawTools());
      const names = registry.getPublicToolNames();
      expect(names).toContain("search_wiki_documents");
    });

    it("hides search_wiki_documents when hybrid_search is absent", () => {
      const registry = new SemanticToolRegistry([
        rawTool("wiki_search"),
        rawTool("list_knowledge_bases"),
      ]);
      const names = registry.getPublicToolNames();
      expect(names).not.toContain("search_wiki_documents");
    });

    it("routes search_wiki_documents to hybrid_search with Wiki kb_id and query", () => {
      const registry = new SemanticToolRegistry(allProductionRawTools());
      const routed = registry.routeToolCall("search_wiki_documents", {
        query: "Familienbonus Broschüre",
      });
      expect(routed).toBeDefined();
      expect(routed!.name).toBe("hybrid_search");
      expect(routed!.arguments.kb_id).toBe(RESEARCH_SOURCES.WIKI.kbId);
      expect(routed!.arguments.query).toBe("Familienbonus Broschüre");
    });
  });

  describe("(f) schema-aware alias mapping", () => {
    it("injects kb_name when raw schema declares kb_name instead of kb_id", () => {
      const tools = [
        rawTool("hybrid_search", {
          kb_name: { type: "string" },
          query: { type: "string" },
        }),
      ];
      const registry = new SemanticToolRegistry(tools);
      const routed = registry.routeToolCall("search_laws", { query: "EStG" });
      expect(routed).toBeDefined();
      expect(routed!.arguments).not.toHaveProperty("kb_id");
      expect(routed!.arguments.kb_name).toBe(RESEARCH_SOURCES.GESETZE.name);
      expect(routed!.arguments.query).toBe("EStG");
    });

    it("injects knowledge_base_id alias when schema declares that variant", () => {
      const tools = [
        rawTool("hybrid_search", {
          knowledge_base_id: { type: "string" },
          query: { type: "string" },
        }),
      ];
      const registry = new SemanticToolRegistry(tools);
      const routed = registry.routeToolCall("search_laws", { query: "EStG" });
      expect(routed).toBeDefined();
      expect(routed!.arguments).not.toHaveProperty("kb_id");
      expect(routed!.arguments.knowledge_base_id).toBe(RESEARCH_SOURCES.GESETZE.kbId);
      expect(routed!.arguments.query).toBe("EStG");
    });

    it("injects knowledgeBaseId alias when schema declares camelCase variant", () => {
      const tools = [
        rawTool("hybrid_search", {
          knowledgeBaseId: { type: "string" },
          query: { type: "string" },
        }),
      ];
      const registry = new SemanticToolRegistry(tools);
      const routed = registry.routeToolCall("search_laws", { query: "EStG" });
      expect(routed).toBeDefined();
      expect(routed!.arguments).not.toHaveProperty("kb_id");
      expect(routed!.arguments.knowledgeBaseId).toBe(RESEARCH_SOURCES.GESETZE.kbId);
    });

    it("maps document_id when raw schema uses documentId instead of knowledge_id", () => {
      const tools = [
        rawTool("get_knowledge", {
          kb_id: { type: "string" },
          documentId: { type: "string" },
        }),
      ];
      const registry = new SemanticToolRegistry(tools);
      const routed = registry.routeToolCall("inspect_research_document", {
        source_key: "GESETZE",
        knowledge_id: "doc-789",
      });
      expect(routed).toBeDefined();
      expect(routed!.arguments.kb_id).toBe(RESEARCH_SOURCES.GESETZE.kbId);
      expect(routed!.arguments).not.toHaveProperty("knowledge_id");
      expect(routed!.arguments.documentId).toBe("doc-789");
    });

    it("does not send unsupported args to the raw schema", () => {
      // Raw schema lacks a "slug" property
      const tools = [
        rawTool("hybrid_search", {
          kb_id: { type: "string" },
        }),
      ];
      const registry = new SemanticToolRegistry(tools);
      // browse_wiki_index depends on wiki_index_view, not hybrid_search
      // Instead test that search_laws with extra args filters them out
      const routed = registry.routeToolCall("search_laws", {
        query: "test",
        slug: "should-not-appear",
      });
      expect(routed).toBeDefined();
      expect(routed!.arguments).toHaveProperty("kb_id");
      expect(routed!.arguments).not.toHaveProperty("slug");
      // query is not in the schema either so it should be filtered
      expect(routed!.arguments).not.toHaveProperty("query");
    });

    it("does not add an application limit to search_laws when the raw schema has one", () => {
      const tools = [
        rawTool("hybrid_search", {
          kb_id: { type: "string" },
          query: { type: "string" },
          limit: { type: "number" },
        }),
      ];
      const registry = new SemanticToolRegistry(tools);
      const routed = registry.routeToolCall("search_laws", { query: "EStG" });
      expect(routed).toBeDefined();
      expect(routed!.arguments).not.toHaveProperty("limit");
    });

    it("keeps the existing default limit for search_bfg", () => {
      const tools = [
        rawTool("hybrid_search", {
          kb_id: { type: "string" },
          query: { type: "string" },
          limit: { type: "number" },
        }),
      ];
      const registry = new SemanticToolRegistry(tools);
      const routed = registry.routeToolCall("search_bfg", { query: "Pendlerpauschale" });
      expect(routed).toBeDefined();
      expect(routed!.arguments.limit).toBe(5);
    });

    it("does not override a user-supplied document_id override with default limit", () => {
      const tools = [
        rawTool("get_knowledge", {
          kb_id: { type: "string" },
          knowledge_id: { type: "string" },
          limit: { type: "number" },
        }),
      ];
      const registry = new SemanticToolRegistry(tools);
      const routed = registry.routeToolCall("inspect_research_document", {
        source_key: "BFG",
        knowledge_id: "custom-id",
      });
      expect(routed).toBeDefined();
      expect(routed!.arguments.knowledge_id).toBe("custom-id");
    });
  });
});
