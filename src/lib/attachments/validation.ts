import { createHash } from "node:crypto";

import { UserVisibleError } from "@/lib/errors";
import type { AttachmentKind } from "./context";

// ── Constants ────────────────────────────────────────────────────────────────

export const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MiB
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MiB
export const MAX_FILE_UPLOADS = 5;
export const MAX_IMAGE_UPLOADS = 5;

export const FILE_MIME_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export const MIME_TO_ATTACHMENT_KIND: Record<string, AttachmentKind> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/csv": "csv",
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

export const IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

// ── Pure helpers ─────────────────────────────────────────────────────────────

function startsWithBytes(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Normalize a user-supplied filename to a safe form. */
export function sanitizedFilename(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .replace(/[\\/]/gu, "_")
    .trim()
    .slice(0, 255);
  return normalized || "datei";
}

/**
 * Map a file extension (with leading dot) to a MIME type.
 * Re-exported for external use (e.g. web route).
 */
export const fileMimeByExtension = FILE_MIME_BY_EXTENSION;

/**
 * Map a MIME type to an internal attachment kind.
 * Re-exported for external use.
 */
export const mimeToAttachmentKind = MIME_TO_ATTACHMENT_KIND;

/**
 * Set of image MIME types accepted by the platform.
 */
export const imageMimeTypes = IMAGE_MIME_TYPES;

/**
 * Resolve an attachment kind from a known MIME type; throws on unknown.
 */
export function attachmentKindFromMime(mimeType: string): AttachmentKind {
  const kind = MIME_TO_ATTACHMENT_KIND[mimeType];
  if (!kind) {
    throw new UserVisibleError(
      `Nicht unterstützter Dateityp: ${mimeType}.`,
      400,
    );
  }
  return kind;
}

/**
 * Validate file magic bytes / signature against the declared MIME type.
 */
export function hasExpectedSignature(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === "application/pdf") {
    return startsWithBytes(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  }
  if (mimeType === "image/png") {
    return startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (mimeType === "image/jpeg") {
    return startsWithBytes(bytes, [0xff, 0xd8, 0xff]);
  }
  if (mimeType === "image/gif") {
    return startsWithBytes(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61])
      || startsWithBytes(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  }
  if (mimeType === "image/webp") {
    return startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46])
      && startsWithBytes(bytes, [0x57, 0x45, 0x42, 0x50], 8);
  }
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    || mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    || mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04]);
  }
  if (
    mimeType === "application/msword"
    || mimeType === "application/vnd.ms-excel"
    || mimeType === "application/vnd.ms-powerpoint"
  ) {
    return startsWithBytes(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  }
  if (mimeType === "text/plain" || mimeType === "text/markdown" || mimeType === "text/csv") {
    return !bytes.includes(0);
  }
  return false;
}

/**
 * Human-readable category for a MIME type (used in error messages).
 */
export function attachmentTypeCategory(mimeType: string): string {
  const categories: Record<string, string> = {
    "application/pdf": "PDF",
    "application/msword": "DOC",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
    "application/vnd.ms-excel": "XLS",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
    "application/vnd.ms-powerpoint": "PPT",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
    "text/plain": "TXT",
    "text/markdown": "Markdown",
    "text/csv": "CSV",
    "image/jpeg": "JPEG",
    "image/png": "PNG",
    "image/gif": "GIF",
    "image/webp": "WebP",
  };
  return categories[mimeType] ?? "Datei";
}

// ── Composite validation ────────────────────────────────────────────────────

export interface RawAttachmentInput {
  kind: "image" | "file";
  name: string;
  mimeType: string;
  sizeBytes: number;
  bytes: Uint8Array;
}

export interface ValidatedAttachment {
  kind: "image" | "file";
  name: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  bytes: Uint8Array;
}

/**
 * Run the full validation pipeline against raw attachment bytes and metadata.
 * Throws a user-visible German error on any violation.
 */
export function validateAttachmentBytes(input: RawAttachmentInput): ValidatedAttachment {
  const name = sanitizedFilename(input.name);
  let mimeType: string;

  if (input.kind === "image") {
    mimeType = input.mimeType.toLowerCase();
    if (!IMAGE_MIME_TYPES.has(mimeType)) {
      throw new UserVisibleError("Erlaubt sind JPEG-, PNG-, GIF- und WebP-Bilder.", 400);
    }
    if (input.sizeBytes > MAX_IMAGE_BYTES) {
      throw new UserVisibleError("Ein Bild darf maximal 10 MB groß sein.", 413);
    }
  } else {
    const extension = /\.[^.]+$/u.exec(name.toLowerCase())?.[0] ?? "";
    mimeType = FILE_MIME_BY_EXTENSION[extension] ?? "";
    if (!mimeType) {
      throw new UserVisibleError(
        "Erlaubt sind PDF-, Word-, Text-, Markdown-, CSV-, Excel- und PowerPoint-Dateien.",
        400,
      );
    }
    if (input.sizeBytes > MAX_FILE_BYTES) {
      throw new UserVisibleError("Eine Datei darf maximal 20 MB groß sein.", 413);
    }
  }

  if (input.sizeBytes < 1) {
    throw new UserVisibleError("Leere Dateien können nicht hochgeladen werden.", 400);
  }

  if (!hasExpectedSignature(input.bytes, mimeType)) {
    const category = attachmentTypeCategory(mimeType);
    throw new UserVisibleError(
      `${name}: Inhalt entspricht nicht dem erwarteten ${category}-Dateityp.`,
      400,
    );
  }

  return {
    kind: input.kind,
    name,
    mimeType,
    sizeBytes: input.sizeBytes,
    sha256: createHash("sha256").update(input.bytes).digest("hex"),
    bytes: input.bytes,
  };
}

/**
 * Build FredTurnAttachmentMeta from a validated attachment.
 */
export function attachmentMetadata(
  attachment: Pick<ValidatedAttachment, "kind" | "name" | "mimeType" | "sizeBytes" | "sha256">,
): { kind: "image" | "file"; name: string; mime_type: string; size_bytes: number; sha256: string } {
  return {
    kind: attachment.kind,
    name: attachment.name,
    mime_type: attachment.mimeType,
    size_bytes: attachment.sizeBytes,
    sha256: attachment.sha256,
  };
}
