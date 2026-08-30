import { describe, expect, it } from "vitest";

import { UserVisibleError } from "./errors";
import {
  BFG_NEWSLETTER_MAX_CONTENT_CHARS,
  parseBfgNewsletterInput,
  requireBfgNewsletterId,
  sortBfgNewsletters,
  type BfgNewsletterItem,
} from "./bfg-newsletters";

function item(id: string, publicationDate: string, createdAt: string): BfgNewsletterItem {
  return {
    id,
    publicationDate,
    contentMarkdown: `# Ausgabe ${publicationDate}`,
    createdAt,
    updatedAt: createdAt,
  };
}

describe("BFG newsletter validation", () => {
  it("accepts only date and normalized text or Markdown", () => {
    expect(parseBfgNewsletterInput({
      publicationDate: "2026-08-30",
      contentMarkdown: "  # Titel\r\n\r\nText  ",
    })).toEqual({
      publicationDate: "2026-08-30",
      contentMarkdown: "# Titel\n\nText",
    });
    expect(() => parseBfgNewsletterInput({
      publicationDate: "2026-08-30",
      contentMarkdown: "Text",
      title: "Nicht erlaubt",
    })).toThrow(UserVisibleError);
  });

  it("rejects invalid dates, empty content, control characters and oversized content", () => {
    for (const candidate of [
      { publicationDate: "2026-02-30", contentMarkdown: "Text" },
      { publicationDate: "2026-08-30", contentMarkdown: "   " },
      { publicationDate: "2026-08-30", contentMarkdown: "Text\u0000" },
      { publicationDate: "2026-08-30", contentMarkdown: "x".repeat(BFG_NEWSLETTER_MAX_CONTENT_CHARS + 1) },
    ]) expect(() => parseBfgNewsletterInput(candidate)).toThrow(UserVisibleError);
  });

  it("validates UUIDs and sorts the newest newsletter first with stable tie-breakers", () => {
    const olderId = "10000000-0000-4000-8000-000000000001";
    const newerId = "10000000-0000-4000-8000-000000000002";
    expect(requireBfgNewsletterId(newerId)).toBe(newerId);
    expect(() => requireBfgNewsletterId("newsletter-1")).toThrow(UserVisibleError);

    expect(sortBfgNewsletters([
      item(olderId, "2026-08-01", "2026-08-01T10:00:00.000Z"),
      item(newerId, "2026-08-30", "2026-08-30T10:00:00.000Z"),
    ]).map((entry) => entry.id)).toEqual([newerId, olderId]);
  });
});
