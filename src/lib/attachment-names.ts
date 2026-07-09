export function ellipsizeFilename(filename: string, maxLength = 56): string {
  if (filename.length <= maxLength) {
    return filename;
  }

  const ellipsis = "...";
  if (maxLength <= ellipsis.length + 2) {
    return `${filename.slice(0, Math.max(1, maxLength - ellipsis.length))}${ellipsis}`;
  }

  const extensionMatch = filename.match(/(\.[^.\s]{1,12})$/);
  const extension = extensionMatch?.[1] ?? "";
  const stem = extension ? filename.slice(0, -extension.length) : filename;
  const availableStemChars = maxLength - ellipsis.length - extension.length;

  if (availableStemChars < 8) {
    return `${filename.slice(0, maxLength - ellipsis.length)}${ellipsis}`;
  }

  const headLength = Math.ceil(availableStemChars * 0.58);
  const tailLength = availableStemChars - headLength;

  return `${stem.slice(0, headLength)}${ellipsis}${stem.slice(-tailLength)}${extension}`;
}
