export type ClipboardFileItem = Pick<
  DataTransferItem,
  "kind" | "type" | "getAsFile"
>;

function extensionForImageMimeType(mimeType: string): string {
  const subtype = mimeType.toLowerCase().split("/")[1]?.split("+")[0] ?? "png";
  return subtype.replace(/[^a-z0-9-]/g, "") || "png";
}

function ensureClipboardFilename(file: File, index: number, timestamp: number): File {
  if (file.name.trim()) {
    return file;
  }

  const extension = extensionForImageMimeType(file.type);
  return new File(
    [file],
    `Zwischenablage-${timestamp}-${index + 1}.${extension}`,
    {
      type: file.type,
      lastModified: timestamp,
    },
  );
}

export function clipboardImageFiles(
  items: ArrayLike<ClipboardFileItem>,
  timestamp = Date.now(),
): File[] {
  const images: File[] = [];

  for (const item of Array.from(items)) {
    if (item.kind !== "file") {
      continue;
    }

    const file = item.getAsFile();
    if (!file || !file.type.toLowerCase().startsWith("image/")) {
      continue;
    }

    images.push(ensureClipboardFilename(file, images.length, timestamp));
  }

  return images;
}
