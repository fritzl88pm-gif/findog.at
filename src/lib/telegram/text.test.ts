import { describe, expect, it } from "vitest";

import { chunkTelegramMessage, normalizeFredMarkdown } from "./text";

describe("normalizeFredMarkdown", () => {
  it.each([
    ["bold", "**bold** text"],
    ["italic", "*italic* text"],
    ["inline code", "use `code` here"],
    ["markdown link", "[text](https://example.com)"],
    ["bare URL", "See https://example.com/page"],
    ["BFG citation", "[RV/1100290/2023](https://findok.bmf.gv.at/...)"],
    ["ordered list", "1. First\n2. Second\n3. Third"],
    ["unordered list", "- Item A\n- Item B"],
  ])("preserves %s", (_name, input) => {
    expect(normalizeFredMarkdown(input)).toBe(input);
  });

  it("preserves code blocks", () => {
    const input = "```\nconst x = 1;\n```";
    expect(normalizeFredMarkdown(input)).toBe(input);
  });

  it("replaces HTML headings with markdown equivalents", () => {
    expect(normalizeFredMarkdown("<h3>Title</h3>")).toBe("### Title");
    expect(normalizeFredMarkdown("<h2>Big</h2>")).toBe("## Big");
  });

  it("strips supported HTML wrappers", () => {
    expect(normalizeFredMarkdown('<div class="x">text</div>')).toBe("text");
    expect(normalizeFredMarkdown('<span style="color:red">red</span>')).toBe("red");
  });

  it("preserves ordinary comparison operators and the text between them", () => {
    const input = "Umsatz < 35.000 € und > 5.000 €";
    expect(normalizeFredMarkdown(input)).toBe(input);
  });

  it("converts <br> to newline", () => {
    expect(normalizeFredMarkdown("Line1<br>Line2")).toBe("Line1\nLine2");
    expect(normalizeFredMarkdown("Line1<br/>Line2")).toBe("Line1\nLine2");
  });

  const labeled = [
    "▌ Jahr: 2025",
    "  Betrag: 1.200 €",
    "  Grenze: 2.000 €",
    "",
    "▌ Jahr: 2026",
    "  Betrag: 1.300 €",
    "  Grenze: 2.100 €",
  ].join("\n");

  it.each([
    ["outer pipes", [
      "| Jahr | Betrag | Grenze |",
      "|---|---:|---:|",
      "| 2025 | 1.200 € | 2.000 € |",
      "| 2026 | 1.300 € | 2.100 € |",
    ].join("\n")],
    ["no outer pipes", [
      "Jahr | Betrag | Grenze",
      ":---|:---:|---:",
      "2025 | 1.200 € | 2.000 €",
      "2026 | 1.300 € | 2.100 €",
    ].join("\n")],
  ])("converts GFM table with %s", (_name, input) => {
    expect(normalizeFredMarkdown(input)).toBe(labeled);
  });

  it("uses the compact layout for two columns", () => {
    const input = [
      "| Jahr | Betrag |",
      "|---|---:|",
      "| 2025 | 1.200 € |",
      "| 2026 | 1.300 € |",
    ].join("\n");
    expect(normalizeFredMarkdown(input)).toBe([
      "Jahr · Betrag",
      "• 2025 — 1.200 €",
      "• 2026 — 1.300 €",
    ].join("\n"));
  });

  it("preserves escaped pipes and inline Markdown, and labels empty cells", () => {
    const input = [
      "| Quelle | Text | Notiz |",
      "|---|---|---|",
      "| [RV \\| 123](https://example.com) | **wichtig** | |",
      "| *Siehe* oben | `code` | Ende |",
    ].join("\n");
    expect(normalizeFredMarkdown(input)).toBe([
      "▌ Quelle: [RV | 123](https://example.com)",
      "  Text: **wichtig**",
      "  Notiz: —",
      "",
      "▌ Quelle: *Siehe* oben",
      "  Text: `code`",
      "  Notiz: Ende",
    ].join("\n"));
  });

  it.each([
    ["single pipe line", "Umsatz | Gewinn ist nicht tabellarisch"],
    ["missing separator", "| A | B |\n| 1 | 2 |\n| 3 | 4 |"],
    ["uneven columns", "| A | B | C |\n|---|---|\n| 1 | 2 |"],
  ])("leaves malformed table text unchanged: %s", (_name, input) => {
    expect(normalizeFredMarkdown(input)).toBe(input);
  });

  it("stops a valid table before unrelated pipe text", () => {
    const input = "| A | B |\n|---|---|\n| 1 | 2 |\nNot | part | of the table";
    expect(normalizeFredMarkdown(input)).toBe("A · B\n• 1 — 2\nNot | part | of the table");
  });

  it.each([
    ["backticks with longer closing fence", [
      "```",
      "| A | B |",
      "|---|---|",
      "| 1 | 2 |",
      "<table><tr><th>X</th><th>Y</th></tr><tr><td>a</td><td>b</td></tr></table>",
      "````",
    ].join("\n")],
    ["tildes", [
      "~~~",
      "| X | Y |",
      "|---|---|",
      "| a | b |",
      "~~~",
    ].join("\n")],
  ])("leaves tables inside %s untouched", (_name, input) => {
    expect(normalizeFredMarkdown(input)).toBe(input);
  });

  it("converts tables around a fenced block", () => {
    const table = "| A | B |\n|---|---|\n| 1 | 2 |";
    const code = "```\n| X | Y |\n|---|---|\n| a | b |\n```";
    expect(normalizeFredMarkdown(`${table}\n\n${code}\n\n${table}`)).toBe(
      `A · B\n• 1 — 2\n\n${code}\n\nA · B\n• 1 — 2`,
    );
  });

  it("converts simple HTML tables before generic tag stripping", () => {
    const input = [
      '<table class="result">',
      "<thead><tr><th>Quelle</th><th>Wert</th><th>Notiz</th></tr></thead>",
      "<tbody><tr><td>[BMF](https://example.com)</td><td>**100**</td><td></td></tr></tbody>",
      "</table>",
    ].join("\n");
    expect(normalizeFredMarkdown(input)).toBe([
      "▌ Quelle: [BMF](https://example.com)",
      "  Wert: **100**",
      "  Notiz: —",
    ].join("\n"));
  });

  it("uses the compact layout for a two-column HTML table", () => {
    const input = "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>";
    expect(normalizeFredMarkdown(input)).toBe("A · B\n• 1 — 2");
  });

  it("keeps HTML table line breaks readable within a cell", () => {
    const input = "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>x<br>y</td></tr></table>";
    expect(normalizeFredMarkdown(input)).toBe("A · B\n• 1 — x / y");
  });
});

describe("chunkTelegramMessage", () => {
  it("returns single chunk for short text", () => {
    expect(chunkTelegramMessage("Hello world")).toEqual(["Hello world"]);
  });

  it("splits at paragraph boundaries", () => {
    const paragraphs = Array.from({ length: 50 }, (_, i) => `Paragraph ${i + 1}: ${"word ".repeat(40)}`);
    const result = chunkTelegramMessage(paragraphs.join("\n\n"));
    expect(result.length).toBeGreaterThan(1);
    expect(result.every((chunk) => chunk.length <= 4000)).toBe(true);
  });

  it("splits at list item boundaries", () => {
    const items = Array.from({ length: 50 }, (_, i) => `- Item ${i + 1}: Some longer description text here.`);
    const result = chunkTelegramMessage(items.join("\n"));
    expect(result.every((chunk) => chunk.length > 0 && chunk.length <= 4000)).toBe(true);
  });

  it("splits long text without a preferred boundary", () => {
    const result = chunkTelegramMessage("A".repeat(5000));
    expect(result.length).toBeGreaterThan(1);
    expect(result.every((chunk) => chunk.length > 0 && chunk.length <= 4000)).toBe(true);
  });

  it("preserves code blocks intact within chunks", () => {
    const codeBlock = "```\n" + "x".repeat(3000) + "\n```";
    const result = chunkTelegramMessage("Before\n\n" + codeBlock + "\n\nAfter");
    expect(result.some((chunk) => chunk.includes(codeBlock))).toBe(true);
  });

  it("returns no empty chunks", () => {
    expect(chunkTelegramMessage("Hello").every((chunk) => chunk.length > 0)).toBe(true);
  });

  it("handles Unicode text including emoji", () => {
    const text = "Hello 🌍 world! Café résumé";
    expect(chunkTelegramMessage(text)).toEqual([text]);
  });

  it("preserves exact content across chunks", () => {
    const text = "Line 1\n\nLine 2\n\nLine 3\n\nLine 4\n\nLine 5";
    expect(chunkTelegramMessage(text).join("")).toBe(text);
  });

  it("all chunks are <= 4000 characters", () => {
    const text = Array.from({ length: 100 }, (_, i) => {
      return `Paragraph ${i + 1}: ${"word ".repeat(50)}`;
    }).join("\n\n");
    expect(chunkTelegramMessage(text).every((chunk) => chunk.length <= 4000)).toBe(true);
  });

  it("emits non-empty chunks after converting a long table", () => {
    const rows = Array.from({ length: 200 }, (_, i) => `| Row${i} | ${"x".repeat(80)} | value${i} |`);
    const normalized = normalizeFredMarkdown(["| A | B | C |", "|---|---|---|", ...rows].join("\n"));
    const chunks = chunkTelegramMessage(normalized);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length > 0 && chunk.length <= 4000)).toBe(true);
  });
});
