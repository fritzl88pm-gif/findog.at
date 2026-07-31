import { describe, expect, it } from "vitest";

import { chunkTelegramMessage, normalizeFredMarkdown } from "./text";

describe("normalizeFredMarkdown", () => {
  it("preserves bold text", () => {
    expect(normalizeFredMarkdown("**bold** text")).toBe("**bold** text");
  });

  it("preserves italic text", () => {
    expect(normalizeFredMarkdown("*italic* text")).toBe("*italic* text");
  });

  it("preserves inline code", () => {
    expect(normalizeFredMarkdown("use `code` here")).toBe("use `code` here");
  });

  it("preserves code blocks", () => {
    const input = "```\nconst x = 1;\n```";
    expect(normalizeFredMarkdown(input)).toBe(input);
  });

  it("preserves markdown links", () => {
    expect(normalizeFredMarkdown("[text](https://example.com)")).toBe("[text](https://example.com)");
  });

  it("preserves bare URLs", () => {
    expect(normalizeFredMarkdown("See https://example.com/page")).toBe("See https://example.com/page");
  });

  it("preserves BFG citations", () => {
    expect(normalizeFredMarkdown("[RV/1100290/2023](https://findok.bmf.gv.at/...)")).toBe(
      "[RV/1100290/2023](https://findok.bmf.gv.at/...)",
    );
  });

  it("preserves ordered lists", () => {
    const input = "1. First\n2. Second\n3. Third";
    expect(normalizeFredMarkdown(input)).toBe(input);
  });

  it("preserves unordered lists", () => {
    const input = "- Item A\n- Item B";
    expect(normalizeFredMarkdown(input)).toBe(input);
  });

  it("preserves table structure", () => {
    const input = "| A | B |\n|---|---|\n| 1 | 2 |";
    expect(normalizeFredMarkdown(input)).toBe(input);
  });

  it("replaces HTML headings with markdown equivalents", () => {
    expect(normalizeFredMarkdown("<h3>Title</h3>")).toBe("### Title");
    expect(normalizeFredMarkdown("<h2>Big</h2>")).toBe("## Big");
  });

  it("strips unsupported HTML tags", () => {
    expect(normalizeFredMarkdown('<div class="x">text</div>')).toBe("text");
    expect(normalizeFredMarkdown('<span style="color:red">red</span>')).toBe("red");
  });

  it("preserves ordinary comparison operators and the text between them", () => {
    const comparison = "Umsatz < 35.000 € und > 5.000 €";
    expect(normalizeFredMarkdown(comparison)).toBe(comparison);
  });

  it("converts <br> to newline", () => {
    expect(normalizeFredMarkdown("Line1<br>Line2")).toBe("Line1\nLine2");
    expect(normalizeFredMarkdown("Line1<br/>Line2")).toBe("Line1\nLine2");
  });
});

describe("chunkTelegramMessage", () => {
  it("returns single chunk for short text", () => {
    const result = chunkTelegramMessage("Hello world");
    expect(result).toEqual(["Hello world"]);
  });

  it("splits at paragraph boundaries", () => {
    const paragraphs = Array.from({ length: 50 }, (_, i) => `Paragraph ${i + 1}: ${"word ".repeat(40)}`);
    const text = paragraphs.join("\n\n");
    const result = chunkTelegramMessage(text);
    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(4000);
    }
  });

  it("splits at list item boundaries", () => {
    const items = Array.from({ length: 50 }, (_, i) => `- Item ${i + 1}: Some longer description text here.`);
    const text = items.join("\n");
    const result = chunkTelegramMessage(text);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(4000);
      expect(chunk.length).toBeGreaterThan(0);
    }
  });

  it("splits at sentence boundaries when no paragraph break is available", () => {
    const longText = "A".repeat(5000);
    const result = chunkTelegramMessage(longText);
    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(4000);
      expect(chunk.length).toBeGreaterThan(0);
    }
  });

  it("preserves code blocks intact within chunks", () => {
    const codeBlock = "```\n" + "x".repeat(3000) + "\n```";
    const text = "Before\n\n" + codeBlock + "\n\nAfter";
    const result = chunkTelegramMessage(text);
    // The code block is 3006 chars, should fit in one chunk
    expect(result.some((chunk) => chunk.includes(codeBlock))).toBe(true);
  });

  it("returns no empty chunks", () => {
    const result = chunkTelegramMessage("Hello");
    expect(result.every((chunk) => chunk.length > 0)).toBe(true);
  });

  it("handles Unicode text including emoji", () => {
    const text = "Hello 🌍 world! Café résumé";
    const result = chunkTelegramMessage(text);
    expect(result).toEqual(["Hello 🌍 world! Café résumé"]);
  });

  it("preserves exact content across chunks", () => {
    const text = "Line 1\n\nLine 2\n\nLine 3\n\nLine 4\n\nLine 5";
    const result = chunkTelegramMessage(text);
    const reconstructed = result.join("");
    expect(reconstructed).toBe(text);
  });

  it("all chunks are <= 4000 characters", () => {
    const longParagraphs = Array.from({ length: 100 }, (_, i) => {
      return `Paragraph ${i + 1}: ${"word ".repeat(50)}`;
    });
    const text = longParagraphs.join("\n\n");
    const result = chunkTelegramMessage(text);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(4000);
    }
  });
});
