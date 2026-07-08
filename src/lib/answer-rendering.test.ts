import { describe, expect, it } from "vitest";

import { parseRichAnswer } from "./answer-rendering";

describe("parseRichAnswer", () => {
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
});
