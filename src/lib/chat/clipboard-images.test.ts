import { describe, expect, it } from "vitest";

import {
  clipboardImageFiles,
  type ClipboardFileItem,
} from "./clipboard-images";

function clipboardItem(
  kind: string,
  type: string,
  file: File | null,
): ClipboardFileItem {
  return {
    kind,
    type,
    getAsFile: () => file,
  } as ClipboardFileItem;
}

describe("clipboardImageFiles", () => {
  it("returns image files and ignores text, non-images, and empty file items", () => {
    const png = new File(["png"], "Screenshot.png", { type: "image/png" });
    const pdf = new File(["pdf"], "Dokument.pdf", { type: "application/pdf" });

    expect(clipboardImageFiles([
      clipboardItem("string", "text/plain", null),
      clipboardItem("file", "application/pdf", pdf),
      clipboardItem("file", "image/png", null),
      clipboardItem("file", "image/png", png),
    ])).toEqual([png]);
  });

  it("gives unnamed clipboard images a deterministic MIME-based filename", () => {
    const unnamed = new File(["image"], "", { type: "image/jpeg" });

    const [file] = clipboardImageFiles([
      clipboardItem("file", "image/jpeg", unnamed),
    ], 1_721_000_000_000);

    expect(file?.name).toBe("Zwischenablage-1721000000000-1.jpeg");
    expect(file?.type).toBe("image/jpeg");
    expect(file?.lastModified).toBe(1_721_000_000_000);
  });

  it("preserves existing clipboard filenames", () => {
    const named = new File(["image"], "beleg.webp", { type: "image/webp" });
    expect(clipboardImageFiles([
      clipboardItem("file", "image/webp", named),
    ])[0]).toBe(named);
  });
});
