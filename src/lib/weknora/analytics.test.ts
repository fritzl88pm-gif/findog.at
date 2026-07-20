import { describe, expect, it } from "vitest";

import type { WeKnoraKnowledgeBase } from "./dashboard-types";
import {
  calculateGroupSubtotal,
  getDominantKnowledgeBase,
  getRankedKnowledgeBases,
} from "./analytics";

const mockKnowledgeBases: WeKnoraKnowledgeBase[] = [
  {
    id: "wiki-id",
    name: "Allgemeine Informationen Wiki",
    kind: "document",
    count: 129,
    isProcessing: false,
    processingCount: 0,
  },
  {
    id: "bfg-id",
    name: "BFG Entscheidungen Findok",
    kind: "document",
    count: 9583,
    isProcessing: false,
    processingCount: 0,
  },
  {
    id: "faq-id",
    name: "Win ANV",
    kind: "faq",
    count: 1276,
    isProcessing: false,
    processingCount: 0,
  },
];

describe("WeKnora dashboard analytics", () => {
  it("identifies the dominant knowledge base with maximum count and percentage share", () => {
    const dominant = getDominantKnowledgeBase(mockKnowledgeBases, 10988);
    expect(dominant).not.toBeNull();
    expect(dominant?.name).toBe("BFG Entscheidungen Findok");
    expect(dominant?.count).toBe(9583);
    expect(dominant?.percentage).toBeCloseTo(87.21, 1);
  });

  it("returns null for dominant source if knowledge bases list is empty or total count is 0", () => {
    expect(getDominantKnowledgeBase([], 0)).toBeNull();
    expect(getDominantKnowledgeBase([{ ...mockKnowledgeBases[0], count: 0 }], 0)).toBeNull();
  });

  it("ranks knowledge bases descending by count and attaches rank and percentage", () => {
    const ranked = getRankedKnowledgeBases(mockKnowledgeBases, 10988);
    expect(ranked).toHaveLength(3);
    expect(ranked[0]).toMatchObject({
      name: "BFG Entscheidungen Findok",
      rank: 1,
      count: 9583,
    });
    expect(ranked[1]).toMatchObject({
      name: "Win ANV",
      rank: 2,
      count: 1276,
    });
    expect(ranked[2]).toMatchObject({
      name: "Allgemeine Informationen Wiki",
      rank: 3,
      count: 129,
    });
    expect(ranked[0].percentage).toBeCloseTo(87.21, 1);
  });

  it("calculates accurate group subtotals and group percentages", () => {
    const docSubtotal = calculateGroupSubtotal(mockKnowledgeBases, "document", 10988);
    expect(docSubtotal.totalCount).toBe(9712);
    expect(docSubtotal.kbCount).toBe(2);
    expect(docSubtotal.percentage).toBeCloseTo(88.39, 1);

    const faqSubtotal = calculateGroupSubtotal(mockKnowledgeBases, "faq", 10988);
    expect(faqSubtotal.totalCount).toBe(1276);
    expect(faqSubtotal.kbCount).toBe(1);
    expect(faqSubtotal.percentage).toBeCloseTo(11.61, 1);
  });
});
