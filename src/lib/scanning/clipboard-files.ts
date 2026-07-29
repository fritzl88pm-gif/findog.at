/** Minimal interface for the parts of DataTransferItemList we need for extraction. */
export interface ClipboardItemEntry {
  kind: string;
  getAsFile(): File | null;
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType.toLowerCase() === "application/pdf") return "pdf";
  const subtype = mimeType.toLowerCase().split("/")[1]?.split("+")[0] ?? "bin";
  return subtype.replace(/[^a-z0-9-]/gu, "") || "bin";
}

function ensureClipboardFilename(file: File, index: number, timestamp: number): File {
  if (file.name.trim()) return file;
  return new File(
    [file],
    `Zwischenablage-${timestamp}-${index + 1}.${extensionForMimeType(file.type)}`,
    { type: file.type, lastModified: timestamp },
  );
}

/**
 * Extract files from a clipboard data-transfer payload.
 *
 * Prefers the top-level `files` list when it is non-empty (browsers populate it
 * for file-copy paste).  Falls back to iterating `items` and returning every
 * non-null file-kind entry, which covers image blobs pasted from screenshot
 * tools.
 *
 * Returns an empty array when the clipboard carries only text or no files.
 */
export function extractClipboardFiles(
  files: ArrayLike<File>,
  items: ArrayLike<ClipboardItemEntry>,
  timestamp = Date.now(),
): File[] {
  // Preferred path – browsers set clipboardData.files for actual file copies.
  if (files.length > 0) {
    return Array.from(files, (file, index) => ensureClipboardFilename(file, index, timestamp));
  }

  // Fallback – screenshot / image-blob paste populates items but not files.
  const result: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file) result.push(ensureClipboardFilename(file, result.length, timestamp));
  }
  return result;
}
