import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";

import { expect, it, vi } from "vitest";

import { parsePdfContentBlocks, renderChatPdf } from "./pdf";

const winAnsiHighCharacters = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";

// Decodes the text operators of the rendered content streams as WinAnsi and
// tracks each text line's offset from the top of its page.
function pdfTextLines(bytes: Uint8Array): Array<{ top: number; text: string; codes: number[] }> {
  const source = Buffer.from(bytes).toString("latin1");
  const lines: Array<{ top: number; text: string; codes: number[] }> = [];
  for (const stream of source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(stream[1] ?? "", "latin1")).toString("latin1");
    } catch {
      continue;
    }
    const stack: number[] = [];
    let top = 0;
    for (const operator of content.split("\n").map((line) => line.trim())) {
      if (operator === "q") {
        stack.push(top);
      } else if (operator === "Q") {
        top = stack.pop() ?? 0;
      }
      const translation = /^1 0 0 1 -?[\d.]+ (-?[\d.]+) cm$/.exec(operator);
      if (translation) {
        top += Number(translation[1]);
      }
      const text = /^\[(.*)\] TJ$/.exec(operator);
      if (text) {
        const codes = [...(text[1] ?? "").matchAll(/<([0-9a-f]*)>/gi)]
          .flatMap((part) => [...Buffer.from(part[1] ?? "", "hex")]);
        lines.push({
          top,
          codes,
          text: codes
            .map((code) => (code >= 0x80 && code <= 0x9f ? winAnsiHighCharacters[code - 0x80] : String.fromCharCode(code)))
            .join(""),
        });
      }
    }
  }
  return lines;
}

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

it("spells out symbols the built-in PDF font cannot encode instead of printing wrong glyphs", () => {
  expect(
    parsePdfContentBlocks([
      "Grenze ≤ 12.000 € → Anspruch ≥ 3 ≈ 10 Ω ✓ „Zitat“ – Test",
      "",
      "- ✗ Δ-Betrag − 5 %, Dvořák, Łukasz, 李",
      "",
      "| Kriterium | erfüllt |",
      "| --- | :---: |",
      "| Entfernung ⇒ Pauschale | ✔️ |",
    ].join("\n")),
  ).toEqual([
    { type: "paragraph", text: "Grenze <= 12.000 € -> Anspruch >= 3 ~ 10 Ohm [x] „Zitat“ – Test" },
    { type: "bullet", ordered: false, text: "[ ] Delta-Betrag - 5 %, Dvorák, Lukasz, ?" },
    {
      type: "table",
      headers: ["Kriterium", "erfüllt"],
      alignments: ["left", "center"],
      rows: [["Entfernung => Pauschale", "[x]"]],
    },
  ]);
});

it("writes only WinAnsi characters to the PDF for symbols outside Helvetica", async () => {
  const bytes = await renderChatPdf({
    title: "Grenzwerte ≤ 3",
    content: "Grenze ≤ 12.000 € → Anspruch ≥ 3 ✓",
    date: "11.07.2026",
  });
  const lines = pdfTextLines(bytes);
  const text = lines.map((line) => line.text).join("\n");
  const undefinedWinAnsiCodes = [0x7f, 0x81, 0x8d, 0x8f, 0x90, 0x9d];

  expect(text).toContain("Grenzwerte <= 3");
  expect(text).toContain("Grenze <= 12.000 € -> Anspruch >= 3 [x]");
  expect(lines.flatMap((line) => line.codes).filter(
    (code) => code < 0x20 || undefinedWinAnsiCodes.includes(code),
  )).toEqual([]);
});

it("keeps single asterisks and underscores in calculations, file names and URLs", () => {
  expect(
    parsePdfContentBlocks([
      "Berechnung: 1.200 * 12 = 14.400; 14.400 * 0,5 = 7.200 und 2*3*4 = 24",
      "",
      "Datei Steuer_Berechnung_2025.xlsx, siehe [Bescheid](https://a.at/a_b_c).",
      "",
      "| Formel | Name |",
      "| --- | --- |",
      "| 100 * 2 * 3 | mein_datei_name |",
      "",
      "Das ist *kursiv* und _auch_ (*hier*), **fett** bleibt fett.",
    ].join("\n")),
  ).toEqual([
    { type: "paragraph", text: "Berechnung: 1.200 * 12 = 14.400; 14.400 * 0,5 = 7.200 und 2*3*4 = 24" },
    { type: "paragraph", text: "Datei Steuer_Berechnung_2025.xlsx, siehe Bescheid (https://a.at/a_b_c)." },
    {
      type: "table",
      headers: ["Formel", "Name"],
      alignments: ["left", "left"],
      rows: [["100 * 2 * 3", "mein_datei_name"]],
    },
    { type: "paragraph", text: "Das ist kursiv und auch (hier), fett bleibt fett." },
  ]);
});

it("wraps bullets and table rows taller than a page instead of clipping them", async () => {
  const words = Array.from({ length: 2_000 }, (_, index) => `W${String(index).padStart(4, "0")}`).join(" ");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    for (const content of [
      `Einleitung\n\n- ${words}\n\nNACHHER`,
      `| Nr. | Beschreibung |\n| --- | --- |\n| 1 | ${words} |\n\nNACHHER`,
    ]) {
      const lines = pdfTextLines(await renderChatPdf({ title: "Lange Zeile", content, date: "11.07.2026" }));
      const wordLines = lines.filter((line) => /W\d{4}/.test(line.text));
      const renderedWords = new Set(wordLines.flatMap((line) => line.text.match(/W\d{4}/g) ?? []));

      expect(renderedWords.size).toBe(2_000);
      // Everything below the footer rule at top 800 lies outside the visible content.
      expect(wordLines.filter((line) => line.top >= 800)).toEqual([]);
      expect(lines.some((line) => line.text === "NACHHER")).toBe(true);
    }
    expect(warn.mock.calls.flat().join("\n")).not.toMatch(/can't wrap between pages/);
  } finally {
    warn.mockRestore();
  }
}, 30_000);

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
