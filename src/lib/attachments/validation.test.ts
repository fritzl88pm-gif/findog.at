import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MAX_FILE_BYTES,
  MAX_IMAGE_BYTES,
  attachmentKindFromMime,
  attachmentMetadata,
  attachmentTypeCategory,
  fileMimeByExtension,
  hasExpectedSignature,
  imageMimeTypes,
  mimeToAttachmentKind,
  sanitizedFilename,
  validateAttachmentBytes,
} from "./validation";

describe("sanitizedFilename", () => {
  it("normalizes NFKC and removes control chars and path separators", () => {
    expect(sanitizedFilename("test\x00file\u0001.pdf")).toBe("testfile.pdf");
    expect(sanitizedFilename("path/to/file.pdf")).toBe("path_to_file.pdf");
    expect(sanitizedFilename("path\\file.pdf")).toBe("path_file.pdf");
  });

  it("truncates to 255 characters", () => {
    const long = "a".repeat(300) + ".pdf";
    expect(sanitizedFilename(long).length).toBeLessThanOrEqual(255);
  });

  it("falls back to 'datei' for empty input", () => {
    expect(sanitizedFilename("   ")).toBe("datei");
  });

  it("preserves Unicode letters and German umlauts", () => {
    expect(sanitizedFilename("München-Überblick.pdf")).toBe("München-Überblick.pdf");
  });
});

describe("fileMimeByExtension", () => {
  it("maps .pdf to application/pdf", () => {
    expect(fileMimeByExtension[".pdf"]).toBe("application/pdf");
  });

  it("maps .xlsx to OOXML spreadsheet MIME", () => {
    expect(fileMimeByExtension[".xlsx"]).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });

  it("returns undefined for unknown extensions", () => {
    expect(fileMimeByExtension[".xyz"]).toBeUndefined();
  });
});

describe("mimeToAttachmentKind", () => {
  it("maps application/pdf to 'pdf'", () => {
    expect(mimeToAttachmentKind["application/pdf"]).toBe("pdf");
  });

  it("maps image/png to 'png'", () => {
    expect(mimeToAttachmentKind["image/png"]).toBe("png");
  });
});

describe("imageMimeTypes", () => {
  it("contains the four supported image MIME types", () => {
    expect(imageMimeTypes.has("image/jpeg")).toBe(true);
    expect(imageMimeTypes.has("image/png")).toBe(true);
    expect(imageMimeTypes.has("image/gif")).toBe(true);
    expect(imageMimeTypes.has("image/webp")).toBe(true);
  });
});

describe("hasExpectedSignature", () => {
  it("validates PDF signature", () => {
    expect(hasExpectedSignature(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), "application/pdf")).toBe(true);
    expect(hasExpectedSignature(new Uint8Array([0x00, 0x00, 0x00, 0x00]), "application/pdf")).toBe(false);
  });

  it("validates PNG signature", () => {
    expect(hasExpectedSignature(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png")).toBe(true);
  });

  it("validates JPEG signature", () => {
    expect(hasExpectedSignature(new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg")).toBe(true);
  });

  it("validates OOXML signature (PK)", () => {
    expect(hasExpectedSignature(
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )).toBe(true);
  });

  it("validates OLE2 signature for legacy Office", () => {
    expect(hasExpectedSignature(
      new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      "application/msword",
    )).toBe(true);
  });

  it("rejects text types containing null bytes", () => {
    const withNull = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00]); // "Hello\0"
    expect(hasExpectedSignature(withNull, "text/plain")).toBe(false);
  });

  it("accepts clean text types without null bytes", () => {
    expect(hasExpectedSignature(new TextEncoder().encode("hello"), "text/plain")).toBe(true);
  });
});

describe("validateAttachmentBytes", () => {
  it("does not mutate caller-provided metadata", () => {
    const input = {
      kind: "image" as const,
      name: "scan.png",
      mimeType: "IMAGE/PNG",
      sizeBytes: 8,
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    };

    expect(validateAttachmentBytes(input).mimeType).toBe("image/png");
    expect(input.mimeType).toBe("IMAGE/PNG");
  });

  it("rejects empty files", () => {
    expect(() =>
      validateAttachmentBytes({ kind: "image", name: "a.png", mimeType: "image/png", sizeBytes: 0, bytes: new Uint8Array(0) }),
    ).toThrow(/Leer/);
  });

  it("rejects oversized images", () => {
    const bytes = new Uint8Array(MAX_IMAGE_BYTES + 1).fill(0x41);
    expect(() =>
      validateAttachmentBytes({ kind: "image", name: "big.jpg", mimeType: "image/jpeg", sizeBytes: bytes.length, bytes }),
    ).toThrow(/10 MB/);
  });

  it("rejects oversized files", () => {
    const bytes = new Uint8Array(MAX_FILE_BYTES + 1).fill(0x41);
    expect(() =>
      validateAttachmentBytes({ kind: "file", name: "big.pdf", mimeType: "application/pdf", sizeBytes: bytes.length, bytes }),
    ).toThrow(/20 MB/);
  });

  it("rejects signature mismatch", () => {
    const bytes = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
    expect(() =>
      validateAttachmentBytes({ kind: "file", name: "fake.pdf", mimeType: "application/pdf", sizeBytes: 4, bytes }),
    ).toThrow(/entspricht nicht/);
  });

  it("returns validated metadata for a valid PDF", () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x0a]);
    const result = validateAttachmentBytes({
      kind: "file",
      name: "test.pdf",
      mimeType: "application/pdf",
      sizeBytes: 6,
      bytes,
    });
    expect(result.kind).toBe("file");
    expect(result.name).toBe("test.pdf");
    expect(result.mimeType).toBe("application/pdf");
    expect(result.sizeBytes).toBe(6);
    expect(result.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("rejects unsupported image MIME for image kind", () => {
    const bytes = new Uint8Array([0x00]);
    expect(() =>
      validateAttachmentBytes({ kind: "image", name: "a.svg", mimeType: "image/svg+xml", sizeBytes: 1, bytes }),
    ).toThrow(/Erlaubt sind/);
  });
});

describe("attachmentKindFromMime", () => {
  it("throws for unknown MIME types", () => {
    expect(() => attachmentKindFromMime("application/octet-stream")).toThrow(/Nicht unterstützter/);
  });

  it("returns the correct attachment input kind for PDF", () => {
    expect(attachmentKindFromMime("application/pdf")).toBe("pdf");
  });
});

describe("attachmentMetadata", () => {
  it("builds metadata with kind, name, mime_type, size_bytes, sha256", () => {
    const meta = attachmentMetadata({
      kind: "file",
      name: "test.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      sha256: "abc123",
    });
    expect(meta).toEqual({
      kind: "file",
      name: "test.pdf",
      mime_type: "application/pdf",
      size_bytes: 100,
      sha256: "abc123",
    });
  });
});

describe("attachmentTypeCategory", () => {
  it("returns 'PDF' for application/pdf", () => {
    expect(attachmentTypeCategory("application/pdf")).toBe("PDF");
  });

  it("returns 'Datei' for unknown MIME", () => {
    expect(attachmentTypeCategory("application/x-unknown")).toBe("Datei");
  });
});
