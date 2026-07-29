import { describe, expect, it } from "vitest";

import {
  extractClipboardFiles,
  type ClipboardItemEntry,
} from "./clipboard-files";

function item(
  kind: string,
  file: File | null,
): ClipboardItemEntry {
  return { kind, getAsFile: () => file };
}

describe("extractClipboardFiles", () => {
  it("returns files from the top-level files list when non-empty", () => {
    const png = new File(["png"], "scan.png", { type: "image/png" });
    const pdf = new File(["pdf"], "receipt.pdf", { type: "application/pdf" });

    const result = extractClipboardFiles(
      [png, pdf],
      [item("file", png), item("file", pdf)],
    );

    expect(result).toEqual([png, pdf]);
  });

  it("prefers files list and does not double-count items", () => {
    const png = new File(["png"], "scan.png", { type: "image/png" });
    const pdf = new File(["pdf"], "receipt.pdf", { type: "application/pdf" });

    // files list has 1 entry; items have 2 – only the files list is used
    const result = extractClipboardFiles(
      [png],
      [item("file", png), item("file", pdf)],
    );

    expect(result).toEqual([png]);
  });

  it("falls back to items when files list is empty", () => {
    const png = new File(["png"], "scan.png", { type: "image/png" });

    const result = extractClipboardFiles(
      [] as File[],
      [
        item("string", null),
        item("file", png),
        item("file", null), // getAsFile returns null → skipped
      ],
    );

    expect(result).toEqual([png]);
  });

  it("returns empty array for text-only clipboard", () => {
    const result = extractClipboardFiles(
      [] as File[],
      [item("string", null), item("string", null)],
    );

    expect(result).toEqual([]);
  });

  it("returns empty array when items has file-kind entries but all getAsFile return null", () => {
    const result = extractClipboardFiles(
      [] as File[],
      [item("file", null), item("file", null)],
    );

    expect(result).toEqual([]);
  });

  it("returns empty array when both files and items are empty", () => {
    const result = extractClipboardFiles([] as File[], [] as ClipboardItemEntry[]);

    expect(result).toEqual([]);
  });

  it("assigns a filename to unnamed clipboard images so multipart keeps them as files", async () => {
    const unnamed = new File(["png"], "", { type: "image/png" });
    const [result] = extractClipboardFiles([unnamed], [], 1_721_000_000_000);
    if (!result) throw new Error("Expected one clipboard file");

    expect(result.name).toBe("Zwischenablage-1721000000000-1.png");
    expect(result.type).toBe("image/png");
    expect(result.lastModified).toBe(1_721_000_000_000);

    const formData = new FormData();
    formData.append("image", result, result.name);
    const parsed = await new Request("http://localhost", { method: "POST", body: formData }).formData();
    expect(parsed.get("image")).toBeInstanceOf(File);
  });

  it("assigns the pdf extension to unnamed clipboard PDFs from the items fallback", () => {
    const unnamed = new File(["pdf"], "", { type: "application/pdf" });

    const [result] = extractClipboardFiles([], [item("file", unnamed)], 1_721_000_000_000);

    expect(result?.name).toBe("Zwischenablage-1721000000000-1.pdf");
  });
});
