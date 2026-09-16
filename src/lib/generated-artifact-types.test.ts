import { describe, expect, it } from "vitest";
import {
  GENERATED_ARTIFACT_EXTENSIONS,
  GENERATED_ARTIFACT_FILE_TYPE,
  generatedArtifactKind,
  isGeneratedArtifactFileType,
} from "./generated-artifact-types";

describe("generated artifact allowlist", () => {
  it("accepts every documented deliverable extension", () => {
    for (const extension of GENERATED_ARTIFACT_EXTENSIONS) {
      expect(isGeneratedArtifactFileType(extension)).toBe(true);
      expect(GENERATED_ARTIFACT_FILE_TYPE.test(extension)).toBe(true);
    }
    expect(GENERATED_ARTIFACT_EXTENSIONS).toEqual(
      expect.arrayContaining([".pptx", ".ppt", ".xlsx", ".xls", ".csv"]),
    );
  });

  it("normalizes case and surrounding whitespace", () => {
    expect(isGeneratedArtifactFileType("  .PPTX  ")).toBe(true);
    expect(isGeneratedArtifactFileType(".DoCx")).toBe(true);
  });

  it("rejects lock files, editor temporaries and code artifacts", () => {
    for (const value of [
      ".pptx#",
      ".~lock.AVAB_2025_Uebersicht.pptx#",
      ".lock.pptx",
      ".js",
      ".py",
      ".exe",
      ".bin",
      "application/octet-stream",
      "pptx",
      "",
    ]) {
      expect(isGeneratedArtifactFileType(value)).toBe(false);
    }
    expect(isGeneratedArtifactFileType(undefined)).toBe(false);
    expect(isGeneratedArtifactFileType(7)).toBe(false);
  });

  it("labels known types with a kind icon and falls back for the rest", () => {
    expect(generatedArtifactKind("AVAB_2025_Uebersicht.pptx", ".pptx")).toEqual({ label: "PowerPoint", icon: "P" });
    expect(generatedArtifactKind("liste.xlsx", ".xlsx")).toEqual({ label: "Excel", icon: "X" });
    expect(generatedArtifactKind("export.csv", ".csv")).toEqual({ label: "CSV", icon: "CSV" });
    expect(generatedArtifactKind("gutachten.docx", ".docx")).toEqual({ label: "Word", icon: "W" });
    expect(generatedArtifactKind("bericht.unknown", ".unknown")).toEqual({ label: "Datei", icon: "FILE" });
  });
});
