import { readFile } from "node:fs/promises";

import { expect, it } from "vitest";

import { parsePdfContentBlocks, renderChatPdf } from "./pdf";

it("uses a neutral PDF palette", async () => {
  const source = await readFile(new URL("./pdf.tsx", import.meta.url), "utf8");

  expect(source).not.toMatch(/#174f74|#286f9c/i);
});

it("parses a Markdown pipe table as a table block", () => {
  expect(
    parsePdfContentBlocks([
      "## Berechnungsgrundlagen",
      "",
      "| Position | Wert |",
      "| --- | ---: |",
      "| Veranlagungsjahr | 2025 |",
      "| KV-Beitragssatz | 5,61395 % |",
    ].join("\n")),
  ).toEqual([
    { type: "heading", level: 2, text: "Berechnungsgrundlagen" },
    {
      type: "table",
      headers: ["Position", "Wert"],
      alignments: ["left", "right"],
      rows: [
        ["Veranlagungsjahr", "2025"],
        ["KV-Beitragssatz", "5,61395 %"],
      ],
    },
  ]);
});

it("renders a Markdown table as a valid neutral PDF with the real renderer", async () => {
  const bytes = await renderChatPdf({
    title: "Neutrales Berechnungsblatt",
    content: [
      "## Berechnungsgrundlagen",
      "",
      "| Position | Wert |",
      "| --- | ---: |",
      "| Veranlagungsjahr | 2025 |",
      "| KV-Beitragssatz | 5,61395 % |",
    ].join("\n"),
    date: "11.07.2026",
  });

  expect(bytes.byteLength).toBeGreaterThan(0);
  expect(new TextDecoder().decode(bytes.subarray(0, 8))).toMatch(/^%PDF/);

  const pdfSource = new TextDecoder("latin1").decode(bytes);
  expect(pdfSource).not.toMatch(/Findog|FINDOG|findog\.at|Fred|Wien/);
});
