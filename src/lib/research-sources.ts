/**
 * Central server-only research-source configuration.
 *
 * Owns source names, stable KB ids, source types, and the mapping
 * to raw MCP capabilities.  No UUID or source name is duplicated
 * in agent.ts or the system prompt.
 */

import {
  RESEARCH_SOURCE_NAMES,
  type ResearchSourceKey,
  type ResearchSourceName,
} from "./research-source-display";

export type SourceType = "document" | "faq" | "document_wiki";

export interface ResearchSource {
  /** Human-readable display name (German). */
  name: ResearchSourceName;
  /** Stable knowledge-base id. */
  kbId: string;
  /** Content / indexing type. */
  type: SourceType;
  /** Raw MCP tool names required to query this source (discovery tools excluded). */
  requiresRawTools: readonly string[];
}

export const RESEARCH_SOURCES: Record<string, ResearchSource> = {
  GESETZE: {
    name: RESEARCH_SOURCE_NAMES.GESETZE,
    kbId: "e0282ab8-b94f-4553-962e-68705201cf9a",
    type: "document",
    requiresRawTools: ["hybrid_search"],
  },
  BFG: {
    name: RESEARCH_SOURCE_NAMES.BFG,
    kbId: "7e203a75-9e51-4839-afd4-7d24d2e5b033",
    type: "document",
    requiresRawTools: ["hybrid_search"],
  },
  FEXKLUSIV: {
    name: RESEARCH_SOURCE_NAMES.FEXKLUSIV,
    kbId: "7eac30a9-3add-4f84-bac2-4a3ae3c7c2c2",
    type: "document",
    requiresRawTools: ["hybrid_search"],
  },
  WIN_ANV: {
    name: RESEARCH_SOURCE_NAMES.WIN_ANV,
    kbId: "952bd9ad-59a5-4ca4-ad28-3c945dab9515",
    type: "faq",
    requiresRawTools: ["faq_search", "faq_entries_search"],
  },
  ARBEITSBEHELFE: {
    name: RESEARCH_SOURCE_NAMES.ARBEITSBEHELFE,
    kbId: "22dee3ae-2c61-438e-8609-f9e12144157e",
    type: "document",
    requiresRawTools: ["hybrid_search"],
  },
  BETRAGSTABELLE: {
    name: RESEARCH_SOURCE_NAMES.BETRAGSTABELLE,
    kbId: "442ad2e8-c69f-4cb5-985c-f3afadeb8645",
    type: "faq",
    requiresRawTools: ["faq_search", "faq_entries_search"],
  },
  WIKI: {
    name: RESEARCH_SOURCE_NAMES.WIKI,
    kbId: "582f577a-ee1b-462d-ac55-636749320ae7",
    type: "document_wiki",
    requiresRawTools: ["hybrid_search", "wiki_search", "wiki_read_page", "wiki_index_view"],
  },
} as const;

export const BFG_SOURCE_KEY = "BFG" as const;
export const BFG_KB_ID: string = RESEARCH_SOURCES.BFG.kbId;
export const BFG_KB_NAME: string = RESEARCH_SOURCES.BFG.name;

export function getSourceByKbId(kbId: string): ResearchSource | undefined {
  return Object.values(RESEARCH_SOURCES).find((source) => source.kbId === kbId);
}

export function getSourceKeyByKbId(kbId: string): ResearchSourceKey | undefined {
  return (Object.entries(RESEARCH_SOURCES) as Array<[ResearchSourceKey, ResearchSource]>)
    .find(([, source]) => source.kbId === kbId)?.[0];
}

export function getSourceByKey(key: string): ResearchSource | undefined {
  return RESEARCH_SOURCES[key as keyof typeof RESEARCH_SOURCES];
}

export function supportedRawToolNames(): string[] {
  const toolSet = new Set<string>();
  for (const source of Object.values(RESEARCH_SOURCES)) {
    for (const tool of source.requiresRawTools) {
      toolSet.add(tool);
    }
  }
  return [...toolSet];
}
