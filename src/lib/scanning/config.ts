export const SCANNING_MODEL = "google/gemini-3.5-flash" as const;
export const MAX_SCANNING_IMAGES = 5;
export const MAX_SCANNING_PDFS = 5;
export const MAX_SCANNING_IMAGE_BYTES = 5 * 1_024 * 1_024;
export const MAX_SCANNING_PDF_BYTES = 10 * 1_024 * 1_024;
export const MAX_SCANNING_MULTIPART_BYTES =
  MAX_SCANNING_IMAGES * MAX_SCANNING_IMAGE_BYTES
  + MAX_SCANNING_PDFS * MAX_SCANNING_PDF_BYTES
  + 1_024 * 1_024;
export const MAX_SCANNING_REPORT_CHARS = 58_000;
export const MAX_SCANNING_INSTRUCTIONS_CHARS = 1_000;
export const SCANNING_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1_000;
export const SCANNING_RATE_LIMIT_REQUESTS = 5;

export const SCANNING_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export function sanitizeScanningFilename(value: string): string {
  return value
    .replace(/[\\/\0<>:"|?*\u0001-\u001f\u007f]+/gu, "_")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 255) || "Dokument";
}

function beginsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

export function matchesScanningFileSignature(mimeType: string, bytes: Uint8Array): boolean {
  if (mimeType === "application/pdf") {
    return beginsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  }
  if (mimeType === "image/jpeg") {
    return beginsWith(bytes, [0xff, 0xd8, 0xff]);
  }
  if (mimeType === "image/png") {
    return beginsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (mimeType === "image/gif") {
    const header = new TextDecoder("ascii").decode(bytes.slice(0, 6));
    return header === "GIF87a" || header === "GIF89a";
  }
  if (mimeType === "image/webp") {
    return new TextDecoder("ascii").decode(bytes.slice(0, 4)) === "RIFF"
      && new TextDecoder("ascii").decode(bytes.slice(8, 12)) === "WEBP";
  }
  return false;
}
