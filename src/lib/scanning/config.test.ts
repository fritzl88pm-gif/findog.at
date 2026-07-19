import { describe, expect, it } from "vitest";

import {
  matchesScanningFileSignature,
  MAX_SCANNING_IMAGE_BYTES,
  MAX_SCANNING_IMAGES,
  MAX_SCANNING_PDF_BYTES,
  MAX_SCANNING_PDFS,
  sanitizeScanningFilename,
} from "./config";

describe("scanning upload configuration", () => {
  it("keeps the agreed count and byte limits", () => {
    expect(MAX_SCANNING_IMAGES).toBe(5);
    expect(MAX_SCANNING_PDFS).toBe(5);
    expect(MAX_SCANNING_IMAGE_BYTES).toBe(5 * 1_024 * 1_024);
    expect(MAX_SCANNING_PDF_BYTES).toBe(10 * 1_024 * 1_024);
  });

  it.each([
    ["application/pdf", [0x25, 0x50, 0x44, 0x46, 0x2d]],
    ["image/jpeg", [0xff, 0xd8, 0xff]],
    ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ["image/gif", [...new TextEncoder().encode("GIF89a")]],
    ["image/webp", [...new TextEncoder().encode("RIFF0000WEBP")]],
  ])("accepts a valid %s signature", (mimeType, signature) => {
    expect(matchesScanningFileSignature(mimeType, new Uint8Array(signature))).toBe(true);
  });

  it("rejects a manipulated signature and sanitizes filenames", () => {
    expect(matchesScanningFileSignature("application/pdf", new TextEncoder().encode("not-a-pdf"))).toBe(false);
    expect(sanitizeScanningFilename('../Beleg\u0000:  1.pdf')).toBe(".._Beleg_ 1.pdf");
  });
});
