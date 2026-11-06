import { describe, expect, it } from "vitest";

import {
  answerWithPlainCitations,
  citationMarkersToBrackets,
  citedSourceLines,
  createCitationStreamFilter,
  findCitedIndex,
  mapOutsideCitationTags,
  parseCitedSources,
  publicCitedSources,
  renderCitedAnswer,
  stripCitationTags,
} from "./citations";

const KB = "e0282ab8-b94f-4553-962e-68705201cf9a";
const CHUNK_A = "2d9470d0-2723-444a-8bfa-fcced491c15d";
const CHUNK_B = "3e9470d0-2723-444a-8bfa-fcced491c15e";

function kb(doc: string, chunk: string): string {
  return `<kb doc="${doc}" chunk_id="${chunk}" kb_id="${KB}" />`;
}

const DOC_DBA = "DBA_Deutschland_Fassung_2026-07-13.md";
const DOC_EST = "EStG_1988_Einkommensteuergesetz_1988.md";

describe("createCitationStreamFilter", () => {
  function run(chunks: string[]): string {
    const filter = createCitationStreamFilter();
    return chunks.map((chunk) => filter.push(chunk)).join("");
  }

  it("drops complete tags inside one chunk", () => {
    expect(run([`Satz eins ${kb(DOC_DBA, CHUNK_A)}. Satz zwei.`])).toBe("Satz eins. Satz zwei.");
  });

  it("never emits a tag that is split across chunks", () => {
    const tag = kb(DOC_DBA, CHUNK_A);
    for (let cut = 1; cut < tag.length; cut += 1) {
      const filter = createCitationStreamFilter();
      const first = filter.push(`Text ${tag.slice(0, cut)}`);
      const second = filter.push(`${tag.slice(cut)} weiter`);
      expect(first + second, `cut at ${cut}`).not.toContain("<");
      expect(first + second, `cut at ${cut}`).not.toContain("kb");
      expect(first + second).toContain("Text");
      expect(first + second).toContain("weiter");
    }
  });

  it("splits a tag over many tiny chunks", () => {
    const text = `A ${kb(DOC_DBA, CHUNK_A)} B <web url="https://example.test/x" title="X" /> C <ref id="1"/> D`;
    const chunks = [...text];
    const output = run(chunks);
    expect(output).not.toMatch(/[<>]|doc=|url=|ref/u);
    expect(output.replace(/\s+/gu, " ")).toBe("A B C D");
  });

  it("keeps ordinary angle brackets and holds back only real tag starts", () => {
    const filter = createCitationStreamFilter();
    expect(filter.push("Wenn a < b und c > d")).toBe("Wenn a < b und c > d");
    expect(filter.push("Ende <")).toBe("Ende ");
    expect(filter.push("5 Euro")).toBe("<5 Euro");
    expect(filter.push("<k")).toBe("");
    expect(filter.push("x>")).toBe("<kx>");
  });

  it("forgets a held-back tag start on reset", () => {
    const filter = createCitationStreamFilter();
    expect(filter.push("Vorspann <kb doc=")).toBe("Vorspann ");
    filter.reset();
    expect(filter.push("Neu")).toBe("Neu");
  });
});

describe("stripCitationTags", () => {
  it("removes kb, web and stray ref tags together with the blank before them", () => {
    const text = `Betrag ${kb(DOC_DBA, CHUNK_A)}. Quelle <web url="https://example.test/a" title="A"/> und <ref x="1"/> Ende`;
    expect(stripCitationTags(text)).toBe("Betrag. Quelle und Ende");
  });

  it("drops a dangling incomplete tag at the end", () => {
    expect(stripCitationTags('Text <kb doc="abc')).toBe("Text ");
  });
});

describe("renderCitedAnswer", () => {
  it("numbers sources by first occurrence and reuses numbers", () => {
    const { text, cited } = renderCitedAnswer(
      `Erstens ${kb(DOC_DBA, CHUNK_A)}. Zweitens ${kb(DOC_EST, CHUNK_B)}. Wieder erstens ${kb(DOC_DBA, CHUNK_A)}.`,
    );
    expect(text).toBe("Erstens⟦1⟧. Zweitens⟦2⟧. Wieder erstens⟦1⟧.");
    expect(cited).toEqual([
      { kind: "knowledge", doc: DOC_DBA, chunkId: CHUNK_A, knowledgeBaseId: KB },
      { kind: "knowledge", doc: DOC_EST, chunkId: CHUNK_B, knowledgeBaseId: KB },
    ]);
  });

  it("treats other chunks of the same document as other sources", () => {
    const { text, cited } = renderCitedAnswer(`A ${kb(DOC_DBA, CHUNK_A)} B ${kb(DOC_DBA, CHUNK_B)}`);
    expect(text).toBe("A⟦1⟧ B⟦2⟧");
    expect(cited).toHaveLength(2);
  });

  it("collapses adjacent duplicates but keeps distinct neighbours", () => {
    const { text } = renderCitedAnswer(
      `Aussage ${kb(DOC_DBA, CHUNK_A)}${kb(DOC_DBA, CHUNK_A)} ${kb(DOC_DBA, CHUNK_A)}${kb(DOC_EST, CHUNK_B)}.`,
    );
    expect(text).toBe("Aussage⟦1⟧⟦2⟧.");
  });

  it("numbers web sources too and drops stray ref tags", () => {
    const { text, cited } = renderCitedAnswer(
      `Web <web url="https://example.test/a" title="Seite A" /> Ref <ref id="x" /> Ende`,
    );
    expect(text).toBe("Web⟦1⟧ Ref Ende");
    expect(cited).toEqual([{ kind: "web", url: "https://example.test/a", title: "Seite A" }]);
  });

  it("returns plain text unchanged and trimmed", () => {
    expect(renderCitedAnswer("  Nur Text.  \n")).toEqual({ text: "Nur Text.", cited: [] });
  });

  it("cannot collide with marker-like text written by the model", () => {
    const { text, cited } = renderCitedAnswer("Modell schreibt ⟦7⟧ selbst.");
    expect(text).toBe("Modell schreibt [7] selbst.");
    expect(cited).toEqual([]);
  });

  it("never leaves tag text behind, even for tags without a usable source", () => {
    const { text } = renderCitedAnswer('A <kb doc="" /> B <web url="javascript:alert(1)" /> C');
    expect(text).toBe("A B C");
  });

  it("is identical for the live and the reload path (same stored text)", () => {
    const stored = `Antwort ${kb(DOC_DBA, CHUNK_A)} mit [Link](https://example.test) ${kb(DOC_EST, CHUNK_B)}`;
    const live = renderCitedAnswer(mapOutsideCitationTags(stored, (segment) => segment));
    const reload = renderCitedAnswer(stored);
    expect(live).toEqual(reload);
    expect(live.cited.map((source) => source.kind === "knowledge" ? source.chunkId : "")).toEqual([CHUNK_A, CHUNK_B]);
  });
});

describe("mapOutsideCitationTags", () => {
  it("never rewrites tag attributes", () => {
    const tag = kb("RV_7100123_2020.md", CHUNK_A);
    const mapped = mapOutsideCitationTags(`Siehe RV/7100123/2020 ${tag} und RV/7100123/2020`, (segment) =>
      segment.replaceAll("RV/7100123/2020", "[RV/7100123/2020](https://findok.test)"));
    expect(mapped).toContain(tag);
    expect(mapped.match(/\[RV\/7100123\/2020\]/gu)).toHaveLength(2);
  });
});

describe("cited source helpers", () => {
  const cited = renderCitedAnswer(
    `A ${kb(DOC_DBA, CHUNK_A)} B ${kb(DOC_EST, CHUNK_B)} C <web url="https://example.test/a" title="Seite A" />`,
  ).cited;

  it("never exposes ids in the public list", () => {
    const publicList = publicCitedSources(cited);
    expect(JSON.stringify(publicList)).not.toContain(CHUNK_A);
    expect(JSON.stringify(publicList)).not.toContain(KB);
    expect(publicList).toHaveLength(3);
  });

  it("round-trips through parseCitedSources keeping order and duplicates", () => {
    const duplicated = [...publicCitedSources(cited), { kind: "knowledge" as const, doc: DOC_DBA }];
    const parsed = parseCitedSources(JSON.parse(JSON.stringify(duplicated)));
    expect(parsed).toEqual(duplicated);
    expect(parseCitedSources("nope")).toEqual([]);
  });

  it("matches list entries to cited indexes by document name or url", () => {
    const publicList = publicCitedSources(cited);
    expect(findCitedIndex(publicList, { title: "EStG_1988_Einkommensteuergesetz_1988.md" })).toBe(1);
    expect(findCitedIndex(publicList, { doc: "DBA Deutschland Fassung 13.07.2026" })).toBe(0);
    expect(findCitedIndex(publicList, { url: "https://example.test/a" })).toBe(2);
    expect(findCitedIndex(publicList, { title: "Unbekannt.md" })).toBe(-1);
  });
});

describe("plain-text conversion", () => {
  it("turns markers into [n]", () => {
    expect(citationMarkersToBrackets("Satz⟦1⟧ und⟦12⟧.")).toBe("Satz[1] und[12].");
  });

  it("appends a compact Quellen list with prettified names", () => {
    const stored = `A ${kb(DOC_DBA, CHUNK_A)} B ${kb(DOC_EST, CHUNK_B)} C ${kb(DOC_DBA, CHUNK_B)}`;
    const answer = answerWithPlainCitations(stored);
    expect(answer).toBe([
      "A[1] B[2] C[3]",
      "",
      "Quellen:",
      "[1, 3] DBA Deutschland Fassung 13.07.2026",
      "[2] EStG 1988 · Einkommensteuergesetz 1988",
    ].join("\n"));
    expect(answer).not.toMatch(/<|chunk|doc=|\.md/u);
  });

  it("leaves answers without citations alone and caps the list at ten documents", () => {
    expect(answerWithPlainCitations("Nur Text")).toBe("Nur Text");
    const many = Array.from({ length: 14 }, (_, index) => ({
      kind: "knowledge" as const,
      doc: `Dokument_${index + 1}.md`,
    }));
    expect(citedSourceLines(many)).toHaveLength(10);
  });
});
