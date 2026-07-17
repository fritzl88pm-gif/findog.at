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

it("removes decorative emoji without losing Austrian legal symbols", () => {
  expect(
    parsePdfContentBlocks([
      "# 📘 Überblick",
      "",
      "⚖️ § 16 EStG und € 100 bleiben lesbar.",
      "",
      "- 📎 Begründung",
    ].join("\n")),
  ).toEqual([
    { type: "heading", level: 1, text: "Überblick" },
    { type: "paragraph", text: "§ 16 EStG und € 100 bleiben lesbar." },
    { type: "bullet", ordered: false, text: "Begründung" },
  ]);
});

it("repeats table headers when a table spans multiple pages", async () => {
  const source = await readFile(new URL("./pdf.tsx", import.meta.url), "utf8");

  expect(source).toMatch(/<View\s+fixed\s+style=\{\[styles\.tableRow, styles\.tableHeaderRow\]\}/);
});

it("anchors the fixed footer inside the A4 page for long documents", async () => {
  const source = await readFile(new URL("./pdf.tsx", import.meta.url), "utf8");

  expect(source).toMatch(/footer:\s*\{[\s\S]*?position:\s*"absolute",[\s\S]*?top:\s*800,/);
  expect(source).toMatch(/<View\s+fixed\s+style=\{styles\.footer\}/);
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

it("renders emoji-rich multi-page content with page dictionaries and a fixed footer", async () => {
  const firstTableRows = Array.from(
    { length: 52 },
    (_, index) => `| ${index + 1} | 📎 Begründung zu § ${index + 1} | € ${(index + 1) * 10} |`,
  );
  const narrative = Array.from(
    { length: 80 },
    (_, index) => `- Praxispunkt ${index + 1}: Die Begründung bleibt als Fließtext lesbar.`,
  );
  const secondTableRows = Array.from(
    { length: 24 },
    (_, index) => `| P-${index + 1} | Zweite Tabelle, Zeile ${index + 1} |`,
  );
  const bytes = await renderChatPdf({
    title: "📘 Aufstellung mit Begründungen",
    content: [
      "# ⚖️ Überblick",
      "",
      "| Nr. | Begründung | Betrag |",
      "| ---: | --- | ---: |",
      ...firstTableRows,
      "",
      "## 📎 Erläuterungen nach der ersten Tabelle",
      "",
      ...narrative,
      "",
      "## Zweite Tabelle",
      "",
      "| Code | Erläuterung |",
      "| --- | --- |",
      ...secondTableRows,
    ].join("\n"),
    date: "17.07.2026 📎",
  });

  const pdfSource = new TextDecoder("latin1").decode(bytes);
  const pageDictionaries = pdfSource.match(/\/Type\s*\/Page\b/g) ?? [];

  expect(new TextDecoder().decode(bytes.subarray(0, 8))).toMatch(/^%PDF/);
  expect(pageDictionaries.length).toBeGreaterThan(1);
});
