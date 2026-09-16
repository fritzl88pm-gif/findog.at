import { describe, expect, it } from "vitest";
import { encodeFredNativeStreamEvent, parseFredNativeStreamLine, parseStoredFredArtifacts } from "./fred-native-stream";
import { normalizeGeneratedArtifactLinks, parseGeneratedArtifacts } from "./fred-generated-artifacts";

const upstreamFrame = {
  data: { artifacts: [
    { index: 3, file_name: "notiz.txt", file_size: 12, file_type: ".txt", handle: "resource://notiz" },
    { index: 7, file_name: "bericht.pdf", file_size: 4, file_type: ".pdf", handle: "resource://bericht" },
    { index: 8, file_name: "fake.bin", file_size: 4, file_type: "application/octet-stream", handle: "resource://fake" },
    { index: 9, file_name: "word.docx", file_size: 4, file_type: ".docx", url: "resource://word" },
  ] },
};
const withoutSourceUri = (artifact: { sourceUri: string; id: string; fileName: string; fileSize: number; fileType: string; upstreamIndex: number }) => {
  const { sourceUri, ...stored } = artifact;
  void sourceUri;
  return stored;
};

describe("generated artifact completion pipeline", () => {
  it("keeps genuine extension artifacts from completion frame through persistence, final, and history", () => {
    const parsed = parseGeneratedArtifacts(upstreamFrame);
    expect(parsed.map(({ upstreamIndex, fileType }) => ({ upstreamIndex, fileType }))).toEqual([
      { upstreamIndex: 3, fileType: ".txt" }, { upstreamIndex: 7, fileType: ".pdf" }, { upstreamIndex: 9, fileType: ".docx" },
    ]);
    const persisted = parsed.map((artifact, n) => ({ ...artifact, id: `artifact-${n}` }));
    const final = parseFredNativeStreamLine(encodeFredNativeStreamEvent({
      type: "final", answer: "Fertig", assistantMessageId: 42,
      conversation: { id: "c", title: "Test", createdAt: "2026-01-01", updatedAt: "2026-01-01", agentKey: "fred" },
      artifacts: persisted,
    }));
    expect(final?.type === "final" && final.artifacts).toEqual(persisted.map(withoutSourceUri));
    expect(parseStoredFredArtifacts(persisted)).toEqual(persisted.map(withoutSourceUri));
  });

  it("rejects invalid or duplicate supplied indexes without renumbering valid sparse entries", () => {
    const result = parseGeneratedArtifacts({ data: { artifacts: [
      { index: 4, file_name: "a.md", file_size: 1, file_type: ".md", handle: "resource://a" },
      { index: 4, file_name: "b.pdf", file_size: 1, file_type: ".pdf", handle: "resource://b" },
      { index: "bad", file_name: "c.txt", file_size: 1, file_type: ".txt", handle: "resource://c" },
    ] } });
    expect(result.map((item) => item.upstreamIndex)).toEqual([4]);
  });

  it("keeps delivered office files and drops lock files and code artifacts", () => {
    const parsed = parseGeneratedArtifacts({ data: { artifacts: [
      { index: 1, file_name: "AVAB_2025_Uebersicht.pptx", file_size: 5, file_type: ".pptx", handle: "resource://avab" },
      { index: 2, file_name: "Betragstabellen.xlsx", file_size: 5, file_type: ".xlsx", handle: "resource://xlsx" },
      { index: 3, file_name: "Liste.csv", file_size: 5, file_type: ".csv", handle: "resource://csv" },
      { index: 4, file_name: ".~lock.AVAB_2025_Uebersicht.pptx#", file_size: 5, file_type: ".pptx#", handle: "resource://lock" },
      { index: 5, file_name: "create_avab.js", file_size: 5, file_type: ".js", handle: "resource://js" },
    ] } });
    expect(parsed.map(({ upstreamIndex, fileType }) => ({ upstreamIndex, fileType }))).toEqual([
      { upstreamIndex: 1, fileType: ".pptx" },
      { upstreamIndex: 2, fileType: ".xlsx" },
      { upstreamIndex: 3, fileType: ".csv" },
    ]);
  });

  it("turns only genuine-card pseudo-links into plain filenames", () => {
    const artifacts = parseGeneratedArtifacts(upstreamFrame);
    expect(normalizeGeneratedArtifactLinks(
      "[notiz.txt](sandbox:/mnt/data/notiz.txt) [fake](sandbox:/tmp/fake.bin)", artifacts,
    )).toBe("notiz.txt [fake](sandbox:/tmp/fake.bin)");
    expect(normalizeGeneratedArtifactLinks(
      "[Download](sandbox:notiz.txt) [PDF](resource://bericht) [Unknown](resource://untrusted)", artifacts,
    )).toBe("Download PDF [Unknown](resource://untrusted)");
  });
});
