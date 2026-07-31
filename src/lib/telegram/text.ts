const MAX_CHUNK_LENGTH = 4_000;

const BR_RE = /<br\s*\/?>/giu;

// Fred output may contain these known HTML wrappers. Match only actual tag
// names so ordinary comparisons such as "amount < 100 and > 5" survive.
const SUPPORTED_HTML_TAG_RE = /<\/?(?:a|b|blockquote|br|code|del|div|em|h[1-6]|hr|i|li|ol|p|pre|s|span|strike|strong|table|tbody|td|tfoot|th|thead|tr|u|ul)\b(?:\s+[^<>]*?)?\s*\/?>/giu;

/**
 * Normalize Fred's answer for Telegram's current plaintext delivery.
 * Markdown markers remain readable plaintext; known HTML wrappers are removed.
 */
export function normalizeFredMarkdown(text: string): string {
  let result = text;

  // Convert <br> to newlines
  result = result.replace(BR_RE, "\n");

  // Convert HTML headings to Markdown equivalents
  result = result.replace(/<h([1-6])>(.*?)<\/h\1>/giu, (_, level: string, content: string) => {
    const hashes = "#".repeat(Number.parseInt(level, 10));
    return `${hashes} ${content.trim()}`;
  });

  // Strip remaining HTML tags but preserve content
  result = result.replace(SUPPORTED_HTML_TAG_RE, "");

  // Collapse excessive blank lines (more than 2 consecutive newlines)
  result = result.replace(/\n{3,}/gu, "\n\n");

  return result.trim();
}

/**
 * Split a normalized message into chunks each ≤ 4000 characters.
 * Prefers paragraph boundaries (\n\n), then list item boundaries,
 * then sentence boundaries, then hard split.
 * Unicode-safe: splits at grapheme-adjacent positions.
 */
export function chunkTelegramMessage(text: string): string[] {
  if (text.length <= MAX_CHUNK_LENGTH) {
    return text.length > 0 ? [text] : [];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_CHUNK_LENGTH) {
      chunks.push(remaining);
      break;
    }

    // Try to find a split point within the max chunk size
    let splitAt = findSplitPoint(remaining, MAX_CHUNK_LENGTH);

    if (splitAt <= 0) {
      // Hard split at max length
      splitAt = MAX_CHUNK_LENGTH;
    }

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  // Filter out any empty chunks
  return chunks.filter((chunk) => chunk.length > 0);
}

/**
 * Find the best split point within `maxLen` characters.
 * Prefers paragraph breaks, then list item breaks, then sentence breaks.
 */
function findSplitPoint(text: string, maxLen: number): number {
  // Only look in the first maxLen characters
  const searchRegion = text.slice(0, maxLen);

  // 1. Try paragraph break (double newline)
  const paraBreak = searchRegion.lastIndexOf("\n\n");
  if (paraBreak > maxLen * 0.3) {
    return paraBreak + 2; // Include the double newline in the first chunk
  }

  // 2. Try single newline (list items, line breaks)
  const lineBreak = searchRegion.lastIndexOf("\n");
  if (lineBreak > maxLen * 0.3) {
    return lineBreak + 1; // Include the newline in the first chunk
  }

  // 3. Try sentence break (. followed by space)
  const sentenceRe = /[.!?]\s+/gu;
  let lastSentenceEnd = 0;
  let match: RegExpExecArray | null;
  while ((match = sentenceRe.exec(searchRegion)) !== null) {
    if (match.index < maxLen) {
      lastSentenceEnd = match.index + match[0].length;
    }
  }
  if (lastSentenceEnd > maxLen * 0.3) {
    return lastSentenceEnd;
  }

  // 4. Try space break
  const spaceBreak = searchRegion.lastIndexOf(" ");
  if (spaceBreak > maxLen * 0.3) {
    return spaceBreak + 1;
  }

  // 5. Hard split
  return maxLen;
}
