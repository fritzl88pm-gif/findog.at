import { describe, expect, it } from "vitest";

import { parseRichAnswer } from "./answer-rendering";

describe("parseRichAnswer", () => {
  it("renders the standardized legal answer sections and their tables as distinct blocks", () => {
    const blocks = parseRichAnswer(`# 📘 Überblick

Ergebnis.

# 📄 Richtlinien / Erlässe

| Richtlinie / Fundstelle | Aussage | Stand / Stichtagsbezug | Relevanz |
| --- | --- | --- | --- |
| LStR Rz 1 | Aussage | 2024 | tragend |

# 🏛️ BFG-Rechtsprechung

| Entscheidung / Fundtyp | Kernaussage | Stichtags- und Sachverhaltsbezug | Relevanz / Verwertung |
| --- | --- | --- | --- |
| BFG, RV/1; Entscheidungschunk | Aussage | vergleichbar | stützend |

# 🗂️ Interne Verwaltungspraxis

Keine Bindungswirkung.

# 🧭 Abgrenzungen / Praxispunkte

- Praxispunkt`);

    expect(blocks.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "heading",
      "table",
      "heading",
      "table",
      "heading",
      "paragraph",
      "heading",
      "unordered-list",
    ]);
    expect(blocks.filter((block) => block.type === "heading")).toHaveLength(5);
    expect(blocks.filter((block) => block.type === "table")).toHaveLength(2);
  });

  it("turns common Markdown-like answer structure into semantic blocks", () => {
    const blocks = parseRichAnswer(`# Überblick

**Wichtig:** ==Pendlerpauschale== mit \`§ 16 EStG\` prüfen.

- Sachverhalt feststellen
- Zeitraum abgrenzen

1. Gesetz lesen
2. BFG-Fundstellen vergleichen

| Punkt | Ergebnis |
| --- | --- |
| Anspruch | Ja |

> Hinweis: Quellenstand offenlegen.`);

    expect(blocks.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "unordered-list",
      "ordered-list",
      "table",
      "blockquote",
    ]);
    expect(blocks[0]).toMatchObject({
      type: "heading",
      level: 2,
      children: [{ type: "text", text: "Überblick" }],
    });
    expect(blocks[1]).toMatchObject({
      type: "paragraph",
      children: [
        { type: "strong", children: [{ type: "text", text: "Wichtig:" }] },
        { type: "text", text: " " },
        { type: "highlight", children: [{ type: "text", text: "Pendlerpauschale" }] },
        { type: "text", text: " mit " },
        { type: "code", text: "§ 16 EStG" },
        { type: "text", text: " prüfen." },
      ],
    });
    expect(blocks[2]).toMatchObject({
      type: "unordered-list",
      items: [
        [{ type: "text", text: "Sachverhalt feststellen" }],
        [{ type: "text", text: "Zeitraum abgrenzen" }],
      ],
    });
    expect(blocks[3]).toMatchObject({
      type: "ordered-list",
      items: [
        [{ type: "text", text: "Gesetz lesen" }],
        [{ type: "text", text: "BFG-Fundstellen vergleichen" }],
      ],
    });
    expect(blocks[4]).toMatchObject({
      type: "table",
      headers: [
        [{ type: "text", text: "Punkt" }],
        [{ type: "text", text: "Ergebnis" }],
      ],
      rows: [
        [
          [{ type: "text", text: "Anspruch" }],
          [{ type: "text", text: "Ja" }],
        ],
      ],
    });
    expect(blocks[5]).toMatchObject({
      type: "blockquote",
      children: [{ type: "text", text: "Hinweis: Quellenstand offenlegen." }],
    });
  });

  it("parses official Findok Markdown links and leaves other links as text", () => {
    const blocks = parseRichAnswer(
      "Siehe [RV/7103053/2014](https://findok.bmf.gv.at/findok/resources/pdf/segment/121623.pdf), [Findok Volltext](https://findok.bmf.gv.at/findok/volltext?gz=RV%2F7103053%2F2014), [unsicher](https://findok.bmf.gv.at/findok/volltext?gz=RV%2F7103053%2F2014&redirect=https%3A%2F%2Fexample.test) und [extern](https://example.test).",
    );

    expect(blocks).toMatchObject([
      {
        type: "paragraph",
        children: [
          { type: "text", text: "Siehe " },
          {
            type: "link",
            href: "https://findok.bmf.gv.at/findok/resources/pdf/segment/121623.pdf",
            children: [{ type: "text", text: "RV/7103053/2014" }],
          },
          { type: "text", text: ", " },
          {
            type: "link",
            href: "https://findok.bmf.gv.at/findok/volltext?gz=RV%2F7103053%2F2014",
            children: [{ type: "text", text: "Findok Volltext" }],
          },
          { type: "text", text: ", [unsicher](https://findok.bmf.gv.at/findok/volltext?gz=RV%2F7103053%2F2014&redirect=https%3A%2F%2Fexample.test) und [extern](https://example.test)." },
        ],
      },
    ]);
  });
});
