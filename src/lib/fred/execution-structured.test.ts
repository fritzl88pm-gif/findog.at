import { describe, expect, it } from "vitest";

import {
  classifySource,
  cleanSourceText,
  dedupeSources,
  extractSourcesFromPayload,
  highlightSegments,
  parseFaq,
  prettifySourceTitle,
  splitFaq,
  toolVariant,
} from "./execution-structured";

describe("prettifySourceTitle", () => {
  it.each([
    ["EStG_1988_Einkommensteuergesetz_1988_RIS_Fassung_2026-07-12_verified.md", "EStG 1988 · Einkommensteuergesetz 1988 · RIS-Fassung 12.07.2026"],
    ["LStR_2002_idF_2025-12-18_full_verified.md", "LStR 2002 · idF 18.12.2025"],
    ["Betragstabelle", "Betragstabelle"],
    ["Pendler FAQ.pdf", "Pendler FAQ"],
    ["UStG_1994_full_verified.md", "UStG 1994"],
    ["/pfad/zu/Datei_verified.txt", "Datei"],
  ])("%s → %s", (raw, pretty) => {
    expect(prettifySourceTitle(raw)).toBe(pretty);
  });
});

describe("classifySource", () => {
  it("derives badges from title, content and knowledge-base type", () => {
    expect(classifySource({ title: "EStG_1988_Einkommensteuergesetz_1988_RIS_Fassung_2026-07-12_verified.md" })).toBe("law");
    expect(classifySource({ title: "LStR_2002_idF_2025-12-18_full_verified.md" })).toBe("guideline");
    expect(classifySource({ title: "BFG Entscheidung RV/7100123/2020" })).toBe("bfg");
    expect(classifySource({ title: "Betragstabelle" })).toBe("document");
    expect(classifySource({ title: "Irgendwas", knowledgeBaseType: "faq" })).toBe("faq");
    expect(classifySource({ title: "Irgendwas", content: "Q: Frage? | A: Antwort" })).toBe("faq");
    expect(classifySource({ title: "RIS", url: "https://ris.bka.gv.at" })).toBe("web");
  });
});

describe("splitFaq / highlightSegments", () => {
  it("splits FAQ rows", () => {
    expect(splitFaq("Q: Wann? | A: Jetzt | und später")).toEqual({ question: "Wann?", answer: "Jetzt | und später" });
    expect(splitFaq("Kein FAQ")).toBeNull();
  });

  it("marks search terms case-insensitively and ignores stop words", () => {
    const segments = highlightSegments("Das Pendlerpauschale steht für Pendler zu.", ["Pendlerpauschale für die Pendler"]);
    expect(segments.filter((segment) => segment.match).map((segment) => segment.text)).toEqual(["Pendlerpauschale", "Pendler"]);
    expect(segments.map((segment) => segment.text).join("")).toBe("Das Pendlerpauschale steht für Pendler zu.");
    expect(highlightSegments("Text", [])).toEqual([{ text: "Text", match: false }]);
    expect(highlightSegments("a (b) [c]", ["(b) [c]"]).map((segment) => segment.text).join("")).toBe("a (b) [c]");
  });
});

describe("source extraction", () => {
  it("reads rows from wrapped, stringified and nested payloads", () => {
    const row = { knowledge_title: "Betragstabelle", match_snippet: "696 Euro", score: 0.5 };
    expect(extractSourcesFromPayload([{ results: [row], display_type: "search_results" }]).sources).toHaveLength(1);
    expect(extractSourcesFromPayload([JSON.stringify([row])]).sources).toHaveLength(1);
    expect(extractSourcesFromPayload([{ data: { result: { results: [row] } } }]).sources).toHaveLength(1);
    expect(extractSourcesFromPayload(["no json"]).sources).toEqual([]);
  });

  it("dedupes identical hits and keeps the better score", () => {
    const deduped = dedupeSources([
      { title: "A_verified.md", snippet: "x", score: 0.4 },
      { title: "A.md", snippet: "x", score: 0.9 },
      { title: "A.md", snippet: "y" },
    ]);
    expect(deduped).toHaveLength(2);
    expect(deduped[0].score).toBe(0.9);
  });
});

describe("toolVariant", () => {
  it("classifies tools", () => {
    expect(toolVariant("search_knowledge")).toBe("search");
    expect(toolVariant("grep_chunks")).toBe("search");
    expect(toolVariant("read_document")).toBe("read");
    expect(toolVariant("web_search")).toBe("web");
    expect(toolVariant("shell_exec")).toBe("shell");
    expect(toolVariant("spawn_agent")).toBe("agent");
    expect(toolVariant("todo_write")).toBe("planning");
    expect(toolVariant("thinking")).toBe("thinking");
    expect(toolVariant("calculate_tax")).toBe("generic");
  });
});

describe("highlightSegments: whole words, capped", () => {
  const marked = (text: string, queries: string[]) =>
    highlightSegments(text, queries).filter((segment) => segment.match).map((segment) => segment.text);

  it("matches whole words only, never parts of German compounds", () => {
    expect(marked("Der Monatsbetrag und der Betrag sowie Betragstabellen", ["Betrag"])).toEqual(["Betrag"]);
    expect(marked("Unterhaltsabsetzbetrag", ["absetzbetrag"])).toEqual([]);
    expect(marked("Der Betrag, (Betrag) und Betrag-Tabelle", ["betrag"])).toEqual(["Betrag", "Betrag"]);
  });

  it("ignores short terms and stopwords", () => {
    expect(marked("Der Wert für das Kind gilt wenn es so ist", ["der für das gilt wenn ab es"])).toEqual([]);
    expect(marked("Ein Kind", ["ab Kind"])).toEqual(["Kind"]);
  });

  it("highlights at most the first two occurrences per term", () => {
    const segments = highlightSegments("Kind Kind Kind Kind", ["Kind"]);
    expect(segments.filter((segment) => segment.match)).toHaveLength(2);
    expect(segments.map((segment) => segment.text).join("")).toBe("Kind Kind Kind Kind");
  });

  it("keeps the text intact around matches", () => {
    const text = "Wann gilt das Pendlerpauschale für Pendler?";
    expect(highlightSegments(text, ["Pendlerpauschale"]).map((segment) => segment.text).join("")).toBe(text);
  });
});

describe("cleanSourceText / parseFaq", () => {
  it("strips a duplicated statutory breadcrumb and derives a locator", () => {
    const cleaned = cleanSourceText(
      "... lit. c > EStG 1988 | § 33 | Abs. 4 | Z 3 | lit. c | Stichtag: 2026-07-12 | RIS: 10004570 > EStG 1988 | § 33 | Abs. 4 | Z 3 | lit. c | Stichtag: 2026-07-12 | RIS: 10004570 c) Erfüllen mehrere Personen ...",
    );
    expect(cleaned.text).toBe("c) Erfüllen mehrere Personen ...");
    expect(cleaned.locator).toBe("§ 33 Abs. 4 Z 3 lit. c");
  });

  it("strips a guideline breadcrumb (Rz, Teil, PDF page, GZ) and keeps Rz + page", () => {
    const cleaned = cleanSourceText(
      "... > LStR 2002 · Rz 795a · Teil 1 · Stichtag: 2025-12-18 · PDF S. 479 · BMF GZ 2025-0.951.634 Der monatliche Unterhaltsabsetzbetrag beträgt: 35 Euro",
    );
    expect(cleaned.text).toBe("Der monatliche Unterhaltsabsetzbetrag beträgt: 35 Euro");
    expect(cleaned.locator).toBe("Rz 795a · S. 479");
  });

  it("strips breadcrumb lines of excerpts, including the cut heading fragment", () => {
    const cleaned = cleanSourceText("Z 3\n> EStG 1988 | § 33 | Abs. 4 | Z 3 | Stichtag: 2026-07-12 | RIS: 10004570\n\n> EStG 1988 | § 33 | Abs. 4 | Z 3 | Stichtag: 2026-07-12 | RIS: 10004570\n3. Steuerpflichtigen steht ein Betrag zu.");
    expect(cleaned.text).toBe("3. Steuerpflichtigen steht ein Betrag zu.");
    expect(cleaned.locator).toBe("§ 33 Abs. 4 Z 3");
    expect(cleaned.text).not.toMatch(/RIS|Stichtag|EStG 1988 \|/u);
  });

  it("removes a breadcrumb that the snippet cut off inside its metadata", () => {
    const cleaned = cleanSourceText("... 29 Euro monatlich > EStG 1988 | § 124b | Z 395 | lit. a | Stichtag: 2026- ...");
    expect(cleaned.text).toBe("29 Euro monatlich ...");
    expect(cleaned.locator).toBeUndefined();
  });

  it("leaves ordinary text and tables alone but converts ISO dates", () => {
    expect(cleanSourceText("| Kalenderjahr | für ein Kind |\n| 2024 | 35 Euro |").text).toBe("| Kalenderjahr | für ein Kind |\n| 2024 | 35 Euro |");
    expect(cleanSourceText("Fassung vom 2025-12-18 gilt, GZ 2025-0.951.634.").text).toBe("Fassung vom 18.12.2025 gilt, GZ 2025-0.951.634.");
  });

  it("parses Q: … | A: … rows and the indexed excerpt form without English metadata", () => {
    expect(parseFaq("Q: Wie hoch? | A: 35 Euro.")).toEqual({ question: "Wie hoch?", answer: "35 Euro." });
    const indexed = parseFaq("Q: Welche Beträge gelten?\nSimilar Questions:\n- UAB 2024?\n- Wie hoch?\nAnswers:\n- 35 Euro pro Monat.\n\nWeitere Hinweise.");
    expect(indexed).toEqual({ question: "Welche Beträge gelten?", answer: "35 Euro pro Monat.\n\nWeitere Hinweise." });
    expect(JSON.stringify(indexed)).not.toContain("Similar Questions");
    expect(parseFaq("Kein FAQ-Text")).toBeNull();
  });
});
