import type { WeKnoraKnowledgeBase, WeKnoraKnowledgeKind } from "./dashboard-types";

export type DominantKnowledgeBase = WeKnoraKnowledgeBase & {
  percentage: number;
};

export type RankedKnowledgeBase = WeKnoraKnowledgeBase & {
  rank: number;
  percentage: number;
};

export type GroupSubtotal = {
  totalCount: number;
  kbCount: number;
  percentage: number;
};

export function getDominantKnowledgeBase(
  knowledgeBases: WeKnoraKnowledgeBase[],
  totalContents: number,
): DominantKnowledgeBase | null {
  if (knowledgeBases.length === 0 || totalContents <= 0) {
    return null;
  }

  let maxItem: WeKnoraKnowledgeBase | null = null;
  for (const item of knowledgeBases) {
    if (!maxItem || item.count > maxItem.count) {
      maxItem = item;
    }
  }

  if (!maxItem || maxItem.count <= 0) {
    return null;
  }

  const percentage = (maxItem.count / totalContents) * 100;
  return {
    ...maxItem,
    percentage,
  };
}

export function getRankedKnowledgeBases(
  knowledgeBases: WeKnoraKnowledgeBase[],
  totalContents: number,
): RankedKnowledgeBase[] {
  if (knowledgeBases.length === 0) {
    return [];
  }

  const sorted = [...knowledgeBases].sort((a, b) => b.count - a.count);
  return sorted.map((item, index) => {
    const percentage = totalContents > 0 ? (item.count / totalContents) * 100 : 0;
    return {
      ...item,
      rank: index + 1,
      percentage,
    };
  });
}

export function calculateGroupSubtotal(
  knowledgeBases: WeKnoraKnowledgeBase[],
  kind: WeKnoraKnowledgeKind,
  totalContents: number,
): GroupSubtotal {
  const filtered = knowledgeBases.filter((item) => item.kind === kind);
  const totalCount = filtered.reduce((sum, item) => sum + item.count, 0);
  const kbCount = filtered.length;
  const percentage = totalContents > 0 ? (totalCount / totalContents) * 100 : 0;

  return {
    totalCount,
    kbCount,
    percentage,
  };
}
