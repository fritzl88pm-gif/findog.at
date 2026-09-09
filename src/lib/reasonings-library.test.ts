import { describe, expect, it } from "vitest";
import {
  filterAndSortReasonings,
  getReasoningPreview,
  ReasoningLibraryItem,
  resolveSelectedReasoningId,
  sortReasonings,
} from "./reasonings-library";

const sampleItems: ReasoningLibraryItem[] = [
  {
    id: "snip-1",
    title: "Vorsteuerabzug bei Kleinunternehmern",
    content: "Gemäß § 6 Abs. 1 Z 27 UStG ist der Vorsteuerabzug ausgeschlossen.",
    categoryIds: ["cat-ust"],
    createdAt: "2026-01-01T10:00:00Z",
    updatedAt: "2026-01-02T12:00:00Z",
  },
  {
    id: "snip-2",
    title: "Änderung des Betriebsvermögens",
    content: "Die Pauschalierung der Betriebsausgaben richtet sich nach dem EStG.",
    categoryIds: ["cat-est"],
    createdAt: "2026-01-03T10:00:00Z",
    updatedAt: "2026-01-04T15:00:00Z",
  },
  {
    id: "snip-3",
    title: "Betriebsausgabenpauschale für Freie Berufe",
    content: "Umsatzgrenzen und Voraussetzungen für die Inanspruchnahme.",
    categoryIds: ["cat-est"],
    createdAt: "2026-01-05T10:00:00Z",
    updatedAt: "2026-01-01T08:00:00Z",
  },
  {
    id: "snip-4",
    title: "Zwangsstrafen nach der Bundesabgabenordnung",
    content: "Festsetzung von Zwangsstrafen gemäß § 111 BAO zur Erzwingung von Pflichten.",
    categoryIds: ["cat-bao"],
    createdAt: "2026-01-06T10:00:00Z",
    updatedAt: "invalid-date",
  },
];

const childIdsByParent = new Map<string, string[]>([
  ["cat-steuern", ["cat-ust", "cat-est"]],
]);

describe("reasonings-library pure functions", () => {
  describe("filterAndSortReasonings", () => {
    it("filters by query matching title case-insensitively and trimmed", () => {
      const result = filterAndSortReasonings(sampleItems, {
        query: "  vorsteuer  ",
        childIdsByParent,
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("snip-1");
    });

    it("filters by query matching content case-insensitively", () => {
      const result = filterAndSortReasonings(sampleItems, {
        query: "inanspruchnahme",
        childIdsByParent,
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("snip-3");
    });

    it("combines category filter and search query", () => {
      // Both snip-2 and snip-3 are in cat-est, but only snip-2 mentions "Pauschalierung" in content
      const result = filterAndSortReasonings(sampleItems, {
        categoryId: "cat-est",
        query: "pauschalierung",
        childIdsByParent,
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("snip-2");
    });

    it("includes child categories when parent category is selected", () => {
      const result = filterAndSortReasonings(sampleItems, {
        categoryId: "cat-steuern",
        childIdsByParent,
      });
      // cat-steuern parent contains cat-ust (snip-1) and cat-est (snip-2, snip-3)
      expect(result.map((r) => r.id)).toEqual(
        expect.arrayContaining(["snip-1", "snip-2", "snip-3"]),
      );
      expect(result.map((r) => r.id)).not.toContain("snip-4");
    });

    it("returns empty array when no items match search", () => {
      const result = filterAndSortReasonings(sampleItems, {
        query: "nicht-vorhandener-begriff",
        childIdsByParent,
      });
      expect(result).toHaveLength(0);
    });
  });

  describe("sorting", () => {
    it("sorts by recently updated descending by default", () => {
      const result = sortReasonings(sampleItems, "updated");
      // snip-2 (2026-01-04), snip-1 (2026-01-02), snip-3 (2026-01-01), snip-4 (invalid-date placed deterministically at end)
      expect(result[0].id).toBe("snip-2");
      expect(result[1].id).toBe("snip-1");
      expect(result[2].id).toBe("snip-3");
      expect(result[3].id).toBe("snip-4");
    });

    it("sorts alphabetically A–Z with German locale awareness", () => {
      const result = sortReasonings(sampleItems, "alpha");
      // In German locale: "Änderung" collates near "A" / before "Betriebsausgaben"
      // Expected order:
      // 1. Änderung des Betriebsvermögens
      // 2. Betriebsausgabenpauschale für Freie Berufe
      // 3. Vorsteuerabzug bei Kleinunternehmern
      // 4. Zwangsstrafen nach der Bundesabgabenordnung
      expect(result.map((r) => r.title)).toEqual([
        "Änderung des Betriebsvermögens",
        "Betriebsausgabenpauschale für Freie Berufe",
        "Vorsteuerabzug bei Kleinunternehmern",
        "Zwangsstrafen nach der Bundesabgabenordnung",
      ]);
    });

    it("handles ties deterministically by ID", () => {
      const tieItems: ReasoningLibraryItem[] = [
        { ...sampleItems[0], id: "item-b", title: "Gleicher Titel", updatedAt: "2026-01-01T00:00:00Z" },
        { ...sampleItems[1], id: "item-a", title: "Gleicher Titel", updatedAt: "2026-01-01T00:00:00Z" },
      ];
      const result = sortReasonings(tieItems, "alpha");
      expect(result[0].id).toBe("item-a");
      expect(result[1].id).toBe("item-b");
    });
  });

  describe("resolveSelectedReasoningId", () => {
    it("returns currentSelectedId if it exists in filtered items", () => {
      expect(resolveSelectedReasoningId("snip-2", sampleItems)).toBe("snip-2");
    });

    it("falls back to first filtered item if current selection is filtered out", () => {
      const filtered = [sampleItems[1], sampleItems[2]];
      expect(resolveSelectedReasoningId("snip-1", filtered)).toBe("snip-2");
    });

    it("returns null if filtered items are empty", () => {
      expect(resolveSelectedReasoningId("snip-1", [])).toBeNull();
    });
  });

  describe("getReasoningPreview", () => {
    it("collapses multi-whitespace and clamps to maximum characters with ellipsis", () => {
      const text = "Erste Zeile\n\nZweite   Zeile   mit viel  Abstand.";
      expect(getReasoningPreview(text, 18)).toBe("Erste Zeile Zweite…");
    });

    it("returns entire text if shorter than max length", () => {
      const text = "Kurzer Text";
      expect(getReasoningPreview(text, 50)).toBe("Kurzer Text");
    });
  });
});
