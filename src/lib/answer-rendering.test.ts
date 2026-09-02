import { describe, expect, it } from "vitest";

import { parseRichAnswer, richInlinePlainText, richTableClipboardContent } from "./answer-rendering";

describe("parseRichAnswer", () => {
  it("keeps repeated ordered-list numbers in one block", () => {
    expect(parseRichAnswer("1. A\n1. B\n1. C")).toEqual([{
      type: "ordered-list",
      items: [
        [{ type: "text", text: "A" }],
        [{ type: "text", text: "B" }],
        [{ type: "text", text: "C" }],
      ],
      numbers: [1, 1, 1],
    }]);
  });

  it("preserves continuing ordered-list numbers", () => {
    expect(parseRichAnswer("3. A\n4. B")).toEqual([{
      type: "ordered-list",
      items: [
        [{ type: "text", text: "A" }],
        [{ type: "text", text: "B" }],
      ],
      numbers: [3, 4],
    }]);
  });

  it("merges wrapped ordered-list text into the preceding item", () => {
    expect(parseRichAnswer("1. Erster Punkt der\nüber mehrere Zeilen läuft\n2. Zweiter")).toEqual([{
      type: "ordered-list",
      items: [
        [{ type: "text", text: "Erster Punkt der über mehrere Zeilen läuft" }],
        [{ type: "text", text: "Zweiter" }],
      ],
      numbers: [1, 2],
    }]);
  });

  it("merges wrapped unordered-list text into the preceding item", () => {
    expect(parseRichAnswer("- Erster Punkt der\nüber mehrere Zeilen läuft\n- Zweiter")).toEqual([{
      type: "unordered-list",
      items: [
        [{ type: "text", text: "Erster Punkt der über mehrere Zeilen läuft" }],
        [{ type: "text", text: "Zweiter" }],
      ],
    }]);
  });

  it("keeps indented cross-type sub-items inside the outer list", () => {
    expect(parseRichAnswer("1. Außen\n  - Unterpunkt\n2. Danach")).toEqual([{
      type: "ordered-list",
      items: [
        [{ type: "text", text: "Außen Unterpunkt" }],
        [{ type: "text", text: "Danach" }],
      ],
      numbers: [1, 2],
    }]);
    expect(parseRichAnswer("- Außen\n  1. Unterpunkt\n- Danach")).toEqual([{
      type: "unordered-list",
      items: [
        [{ type: "text", text: "Außen Unterpunkt" }],
        [{ type: "text", text: "Danach" }],
      ],
    }]);
  });

  it("ends a list at an empty line and preserves paragraph flow", () => {
    expect(parseRichAnswer("1. Listenpunkt\n\nAbsatz danach")).toEqual([
      {
        type: "ordered-list",
        items: [[{ type: "text", text: "Listenpunkt" }]],
        numbers: [1],
      },
      {
        type: "paragraph",
        children: [{ type: "text", text: "Absatz danach" }],
      },
    ]);
  });

  it("ends a list at a heading and resumes block parsing", () => {
    expect(parseRichAnswer("1. Vorher\n# Überschrift\n2. Nachher")).toEqual([
      {
        type: "ordered-list",
        items: [[{ type: "text", text: "Vorher" }]],
        numbers: [1],
      },
      {
        type: "heading",
        level: 2,
        children: [{ type: "text", text: "Überschrift" }],
      },
      {
        type: "ordered-list",
        items: [[{ type: "text", text: "Nachher" }]],
        numbers: [2],
      },
    ]);
  });

  it("renders fenced calculations as code blocks without exposing the language tag", () => {
    const blocks = parseRichAnswer([
      "Vereinfacht:",
      "",
      "```text",
      "Bruttobezüge 7.500 €",
      "− Sozialversicherung 1.050 €",
      "= maßgebliche Einkünfte 6.450 €",
      "```",
      "",
      "Danach ist der Grenzbetrag zu prüfen.",
    ].join("\n"));

    expect(blocks).toEqual([
      {
        type: "paragraph",
        children: [{ type: "text", text: "Vereinfacht:" }],
      },
      {
        type: "code-block",
        language: "text",
        text: "Bruttobezüge 7.500 €\n− Sozialversicherung 1.050 €\n= maßgebliche Einkünfte 6.450 €",
      },
      {
        type: "paragraph",
        children: [{ type: "text", text: "Danach ist der Grenzbetrag zu prüfen." }],
      },
    ]);
  });

  it("keeps Markdown structure inside fenced code literal and accepts a longer closing fence", () => {
    const blocks = parseRichAnswer("~~~markdown\n# Keine Überschrift\n| keine | Tabelle |\n~~~~");

    expect(blocks).toEqual([{
      type: "code-block",
      language: "markdown",
      text: "# Keine Überschrift\n| keine | Tabelle |",
    }]);
  });

  it("discards every untrusted image reference and keeps exact artifact markers", () => {
    const artifactId = "44444444-4444-4444-8444-444444444444";
    const blocks = parseRichAnswer([
      "Vor dem Bild.",
      "",
      "![](/images/generated-calculation.png)",
      "",
      "![](images/generated-calculation.png)",
      "",
      "![Webbild](https://example.com/generated.png)",
      "",
      "![Providerbild](minio://bucket/generated.png)",
      "",
      "![Erfundenes Artefakt](findog-artifact://not-a-uuid)",
      "",
      `![Berechnung](findog-artifact://${artifactId})`,
      "",
      "Nach dem Bild.",
    ].join("\n"));

    expect(blocks).toEqual([
      {
        type: "paragraph",
        children: [{ type: "text", text: "Vor dem Bild." }],
      },
      {
        type: "paragraph",
        children: [{ type: "text", text: "Webbild" }],
      },
      {
        type: "paragraph",
        children: [{ type: "text", text: "Providerbild" }],
      },
      {
        type: "paragraph",
        children: [{ type: "text", text: "Erfundenes Artefakt" }],
      },
      {
        type: "paragraph",
        children: [{ type: "image", artifactId, alt: "Berechnung" }],
      },
      {
        type: "paragraph",
        children: [{ type: "text", text: "Nach dem Bild." }],
      },
    ]);
  });

  it("serializes an individual rich table as spreadsheet text and safe HTML", () => {
    const table = parseRichAnswer(`| Punkt | Ergebnis |
| --- | --- |
| **Betrag** | <1 & \`2\` |`)[0];
    expect(table.type).toBe("table");
    if (table.type !== "table") return;

    expect(richTableClipboardContent(table)).toEqual({
      text: "Punkt\tErgebnis\nBetrag\t<1 & 2",
      html: "<table><thead><tr><th>Punkt</th><th>Ergebnis</th></tr></thead><tbody><tr><td>Betrag</td><td>&lt;1 &amp; 2</td></tr></tbody></table>",
    });
  });

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

  it("parses exact findog-artifact image markers and reduces arbitrary images to alt text", () => {
    const artifactId = "33333333-3333-4333-8333-333333333333";
    const blocks = parseRichAnswer(
      `Dokument: ![Beleg 1](findog-artifact://${artifactId}) und ![Web](https://example.com/pic.jpg) und ![Minio](minio://bucket/img.png) und ![Bad](findog-artifact://not-a-uuid).`,
    );

    expect(blocks).toMatchObject([
      {
        type: "paragraph",
        children: [
          { type: "text", text: "Dokument: " },
          {
            type: "image",
            artifactId,
            alt: "Beleg 1",
          },
          {
            type: "text",
            text: " und Web und Minio und Bad.",
          },
        ],
      },
    ]);
  });

  it("leaves image-looking Markdown literal inside fenced code blocks", () => {
    const blocks = parseRichAnswer("```markdown\n![](/images/example.png)\n```");

    expect(blocks).toEqual([{
      type: "code-block",
      language: "markdown",
      text: "![](/images/example.png)",
    }]);
  });

  it("parses the reported Fred calculation as a display-math block", () => {
    const blocks = parseRichAnswer(
      "Daher:\n\n\\[ 150\\,€ + 150\\,€ + 300\\,€ + 132\\,€ = \\boxed{732\\,€} \\]",
    );

    expect(blocks).toEqual([
      { type: "paragraph", children: [{ type: "text", text: "Daher:" }] },
      {
        type: "math-block",
        expression: "150\\,€ + 150\\,€ + 300\\,€ + 132\\,€ = \\boxed{732\\,€}",
      },
    ]);
  });

  it("parses multiline bracket and dollar display math", () => {
    expect(parseRichAnswer("\\[\na+b\n= c\n\\]")).toEqual([
      { type: "math-block", expression: "a+b\n= c" },
    ]);
    expect(parseRichAnswer("$$\nx^2 + y^2\n$$")).toEqual([
      { type: "math-block", expression: "x^2 + y^2" },
    ]);
  });

  it("parses inline bracket and strict dollar math", () => {
    const blocks = parseRichAnswer("Mit \\(x^2\\) und $y_1 + 2$ weiter.");
    expect(blocks).toEqual([{
      type: "paragraph",
      children: [
        { type: "text", text: "Mit " },
        { type: "math-inline", expression: "x^2" },
        { type: "text", text: " und " },
        { type: "math-inline", expression: "y_1 + 2" },
        { type: "text", text: " weiter." },
      ],
    }]);
    if (blocks[0]?.type === "paragraph") {
      expect(richInlinePlainText(blocks[0].children)).toBe("Mit x^2 und y_1 + 2 weiter.");
    }
  });

  it("keeps currency-like dollars and code delimiters literal", () => {
    const text = "150 €; $100; $100$; $1.234,56$; Preis $100 und $200; `\\(x^2\\)`; `$y^2$`.";
    expect(parseRichAnswer(text)).toEqual([{
      type: "paragraph",
      children: [
        { type: "text", text: "150 €; $100; $100$; $1.234,56$; Preis $100 und $200; " },
        { type: "code", text: "\\(x^2\\)" },
        { type: "text", text: "; " },
        { type: "code", text: "$y^2$" },
        { type: "text", text: "." },
      ],
    }]);
  });

  it("keeps malformed, empty, and oversized math delimiters as text", () => {
    expect(parseRichAnswer("Vorher \\(x^2 nachher")).toEqual([
      { type: "paragraph", children: [{ type: "text", text: "Vorher \\(x^2 nachher" }] },
    ]);
    expect(parseRichAnswer("\\[ \\]\n\nDanach")).toEqual([
      { type: "paragraph", children: [{ type: "text", text: "\\[ \\]" }] },
      { type: "paragraph", children: [{ type: "text", text: "Danach" }] },
    ]);
    const oversized = `\\(${"x".repeat(2_001)}\\)`;
    expect(parseRichAnswer(oversized)).toEqual([
      { type: "paragraph", children: [{ type: "text", text: oversized }] },
    ]);
  });

  it("leaves math-looking delimiters literal inside fenced code", () => {
    expect(parseRichAnswer("```latex\n\\[x^2\\]\n$$y^2$$\n```")).toEqual([{
      type: "code-block",
      language: "latex",
      text: "\\[x^2\\]\n$$y^2$$",
    }]);
  });
});
