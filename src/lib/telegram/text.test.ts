import { describe, expect, it } from "vitest";

import { chunkTelegramMessage, hasGfmTable, normalizeFredMarkdown } from "./text";


describe("hasGfmTable", () => {
  it.each([
    ["with body rows", "| A | B |\n|---|:---:|\n| 1 | 2 |"],
    ["with only a header and separator", "A | B\n-|-:"],
  ])("detects a valid GFM pipe table %s", (_name, input) => {
    expect(hasGfmTable(input)).toBe(true);
  });

  it.each([
    ["table-looking text without separator", "| A | B |\n| 1 | 2 |"],
    ["table inside a fenced code block", "```markdown\n| A | B |\n|---|---|\n| 1 | 2 |\n```"],
  ])("ignores %s", (_name, input) => {
    expect(hasGfmTable(input)).toBe(false);
  });
});

describe("normalizeFredMarkdown", () => {
  it("escapes HTML special characters in plain text", () => {
    expect(normalizeFredMarkdown("Umsatz < 35.000 € und > 5.000 €")).toBe(
      "Umsatz &lt; 35.000 € und &gt; 5.000 €",
    );
  });

  it("escapes ampersands", () => {
    expect(normalizeFredMarkdown("A & B")).toBe("A &amp; B");
  });

  it("converts Markdown bold to HTML bold", () => {
    expect(normalizeFredMarkdown("**bold** text")).toBe("<b>bold</b> text");
  });

  it("converts inline code to HTML code", () => {
    expect(normalizeFredMarkdown("use `code` here")).toBe("use <code>code</code> here");
  });

  it("converts Markdown links to HTML links", () => {
    expect(normalizeFredMarkdown("[text](https://example.com)")).toBe(
      '<a href="https://example.com">text</a>',
    );
  });

  it("converts Markdown headings to HTML bold", () => {
    expect(normalizeFredMarkdown("### Title")).toBe("<b>Title</b>");
  });

  it("preserves ordered lists", () => {
    expect(normalizeFredMarkdown("1. First\n2. Second")).toBe("1. First\n2. Second");
  });

  it("preserves unordered lists", () => {
    expect(normalizeFredMarkdown("- Item A\n- Item B")).toBe("- Item A\n- Item B");
  });

  it("preserves bare URLs", () => {
    expect(normalizeFredMarkdown("See https://example.com/page")).toBe(
      "See https://example.com/page",
    );
  });

  it("preserves BFG citation links", () => {
    const input = "[RV/1100290/2023](https://findok.bmf.gv.at/...)";
    expect(normalizeFredMarkdown(input)).toBe(
      '<a href="https://findok.bmf.gv.at/...">RV/1100290/2023</a>',
    );
  });

  it("converts <br> to newline", () => {
    expect(normalizeFredMarkdown("Line1<br>Line2")).toBe("Line1\nLine2");
    expect(normalizeFredMarkdown("Line1<br/>Line2")).toBe("Line1\nLine2");
  });

  it("replaces HTML headings with bold", () => {
    expect(normalizeFredMarkdown("<h3>Title</h3>")).toBe("<b>Title</b>");
    expect(normalizeFredMarkdown("<h2>Big</h2>")).toBe("<b>Big</b>");
  });

  it("strips supported HTML wrappers", () => {
    expect(normalizeFredMarkdown('<div class="x">text</div>')).toBe("text");
    expect(normalizeFredMarkdown('<span style="color:red">red</span>')).toBe("red");
  });

  // ── Table rendering ───────────────────────────────────────────────────────

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
  ])(`renders GFM table with %s as aligned <pre>`, (_name, input) => {
    const output = normalizeFredMarkdown(input);
    expect(output).toContain("<pre>");
    expect(output).toContain("</pre>");
    // Header and data visible
    expect(output).toContain("Jahr");
    expect(output).toContain("Betrag");
    expect(output).toContain("1.200 €");
    expect(output).toContain("2.100 €");
    // Separator line exists
    expect(output).toContain("\u2500");
    // No raw pipes inside pre
    const preContent = output.match(/<pre>([\s\S]*?)<\/pre>/)![1];
    expect(preContent).not.toContain("|");
  });

  it("renders a two-column table as <pre>", () => {
    const input = [
      "| Jahr | Betrag |",
      "|---|---:|",
      "| 2025 | 1.200 € |",
      "| 2026 | 1.300 € |",
    ].join("\n");
    const output = normalizeFredMarkdown(input);
    expect(output).toContain("<pre>");
    const preContent = output.match(/<pre>([\s\S]*?)<\/pre>/)![1];
    expect(preContent).toContain("Jahr");
    expect(preContent).toContain("Betrag");
    expect(preContent).toContain("1.200 €");
    expect(preContent).toContain("1.300 €");
  });

  it("escapes HTML special chars inside table cells", () => {
    const input = [
      "| A & B | C < D |",
      "|---|---|",
      "| x > 0 | y & z |",
    ].join("\n");
    const output = normalizeFredMarkdown(input);
    const preContent = output.match(/<pre>([\s\S]*?)<\/pre>/)![1];
    expect(preContent).toContain("&amp;");
    expect(preContent).toContain("&lt;");
    expect(preContent).toContain("&gt;");
  });

  it("strips Markdown formatting inside table cells", () => {
    const input = [
      "| Quelle | Text |",
      "|---|---|",
      "| **bold** | `code` |",
    ].join("\n");
    const output = normalizeFredMarkdown(input);
    const preContent = output.match(/<pre>([\s\S]*?)<\/pre>/)![1];
    expect(preContent).not.toContain("**");
    expect(preContent).not.toContain("`");
    expect(preContent).toContain("bold");
    expect(preContent).toContain("code");
  });

  it("strips Markdown links inside table cells, keeps label", () => {
    const input = [
      "| Quelle | Wert |",
      "|---|---|",
      "| [RV \\| 123](https://example.com) | 100 |",
    ].join("\n");
    const output = normalizeFredMarkdown(input);
    const preContent = output.match(/<pre>([\s\S]*?)<\/pre>/)![1];
    expect(preContent).toContain("RV | 123");
    expect(preContent).not.toContain("https://");
  });

  it("renders — for empty cells", () => {
    const input = [
      "| A | B |",
      "|---|---|",
      "| 1 |  |",
    ].join("\n");
    const output = normalizeFredMarkdown(input);
    const preContent = output.match(/<pre>([\s\S]*?)<\/pre>/)![1];
    expect(preContent).toContain("—");
  });

  it.each([
    ["single pipe line", "Umsatz | Gewinn ist nicht tabellarisch"],
    ["missing separator", "| A | B |\n| 1 | 2 |\n| 3 | 4 |"],
  ])(`leaves malformed table text as-is: %s`, (_name, input) => {
    // Malformed tables should still get HTML-escaped but no <pre>
    const output = normalizeFredMarkdown(input);
    expect(output).not.toContain("<pre>");
  });

  it("stops a valid table before unrelated pipe text", () => {
    const input = "| A | B |\n|---|---|\n| 1 | 2 |\nNot | part | of the table";
    const output = normalizeFredMarkdown(input);
    expect(output).toContain("<pre>");
    expect(output).toContain("Not");
    expect(output).toContain("part");
  });

  // ── Code fences ───────────────────────────────────────────────────────────

  it("preserves code blocks as <pre>", () => {
    const input = "```\nconst x = 1;\n```";
    expect(normalizeFredMarkdown(input)).toBe("<pre>const x = 1;</pre>");
  });

  it("escapes HTML inside code blocks", () => {
    const input = "```\nif (a < b && c > d) {}\n```";
    const output = normalizeFredMarkdown(input);
    expect(output).toContain("&lt;");
    expect(output).toContain("&gt;");
    expect(output).toContain("&amp;");
  });

  it("leaves tables inside code blocks untouched", () => {
    const input = [
      "```",
      "| A | B |",
      "|---|---|",
      "| 1 | 2 |",
      "```",
    ].join("\n");
    const output = normalizeFredMarkdown(input);
    expect(output).toContain("<pre>");
    const preContent = output.match(/<pre>([\s\S]*?)<\/pre>/)![1];
    expect(preContent).toContain("| A | B |");
    expect(preContent).not.toContain("\u2500");
  });

  it("converts tables around a fenced block", () => {
    const table = "| A | B |\n|---|---|\n| 1 | 2 |";
    const code = "```\nraw code\n```";
    const output = normalizeFredMarkdown(`${table}\n\n${code}\n\n${table}`);
    // Should have two <pre> table blocks and one code <pre>
    const preCount = (output.match(/<pre>/g) || []).length;
    expect(preCount).toBe(3);
  });

  // ── HTML tables ───────────────────────────────────────────────────────────

  it("converts simple HTML tables", () => {
    const input = [
      '<table class="result">',
      "<thead><tr><th>Quelle</th><th>Wert</th></tr></thead>",
      "<tbody><tr><td>BMF</td><td>100</td></tr></tbody>",
      "</table>",
    ].join("\n");
    const output = normalizeFredMarkdown(input);
    expect(output).toContain("<pre>");
    const preContent = output.match(/<pre>([\s\S]*?)<\/pre>/)![1];
    expect(preContent).toContain("Quelle");
    expect(preContent).toContain("Wert");
    expect(preContent).toContain("BMF");
    expect(preContent).toContain("100");
  });

  it("handles HTML table with empty cells", () => {
    const input = "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td></td></tr></table>";
    const output = normalizeFredMarkdown(input);
    const preContent = output.match(/<pre>([\s\S]*?)<\/pre>/)![1];
    expect(preContent).toContain("—");
  });

  it("keeps HTML table line breaks readable within a cell", () => {
    const input = "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>x<br>y</td></tr></table>";
    const output = normalizeFredMarkdown(input);
    const preContent = output.match(/<pre>([\s\S]*?)<\/pre>/)![1];
    expect(preContent).toContain("x / y");
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
    const codeBlock = "<pre>" + "x".repeat(3000) + "</pre>";
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
