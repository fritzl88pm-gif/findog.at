export const RESEARCH_SOURCE_NAMES = {
  GESETZE: "Gesetze und Verordnungen",
  BFG: "BFG Entscheidungen Findok",
  FEXKLUSIV: "FEXklusiv",
  WIN_ANV: "Win ANV",
  ARBEITSBEHELFE: "Arbeitsbehelfe und interne Dokumente",
  BETRAGSTABELLE: "Betragstabelle FAQ",
  WIKI: "Allgemeine Informationen Wiki",
} as const;

export type ResearchSourceKey = keyof typeof RESEARCH_SOURCE_NAMES;
export type ResearchSourceName = (typeof RESEARCH_SOURCE_NAMES)[ResearchSourceKey];

const RESEARCH_SOURCE_NAME_SET = new Set<string>(Object.values(RESEARCH_SOURCE_NAMES));

export function isResearchSourceName(value: unknown): value is ResearchSourceName {
  return typeof value === "string" && RESEARCH_SOURCE_NAME_SET.has(value);
}

export function researchSourceCallTitle(sourceName: ResearchSourceName): string {
  return `Suche in „${sourceName}“`;
}

export function researchSourceResultTitle(
  sourceName: ResearchSourceName,
  success: boolean,
): string {
  return success
    ? `Treffer aus „${sourceName}“ werden ausgewertet`
    : `Abfrage von „${sourceName}“ fehlgeschlagen`;
}

export function safeResearchSourceStepTitle(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  for (const sourceName of Object.values(RESEARCH_SOURCE_NAMES)) {
    if (
      value === researchSourceCallTitle(sourceName)
      || value === researchSourceResultTitle(sourceName, true)
      || value === researchSourceResultTitle(sourceName, false)
    ) {
      return value;
    }
  }

  return undefined;
}
