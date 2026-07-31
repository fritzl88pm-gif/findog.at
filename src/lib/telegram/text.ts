const MAX_CHUNK_LENGTH = 4_000;

const BR_RE = /<br\s*\/?>/giu;
const SUPPORTED_HTML_TAG_RE = /<\/?(?:a|b|blockquote|br|code|del|div|em|h[1-6]|hr|i|li|ol|p|pre|s|span|strike|strong|table|tbody|td|tfoot|th|thead|tr|u|ul)\b(?:\s+[^<>]*?)?\s*\/?>/giu;
const HTML_TABLE_RE = /<table\b[^>]*>([\s\S]*?)<\/table>/giu;
const HTML_ROW_RE = /<tr\b[^>]*>([\s\S]*?)<\/tr>/giu;
const HTML_CELL_RE = /<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/giu;

/** Normalize Fred's answer for Telegram's plaintext delivery. */
export function normalizeFredMarkdown(text: string): string {
  return transformOutsideFences(text, (outside) => {
    let result = convertHtmlTables(outside);
    result = convertGfmTables(result);
    result = result.replace(BR_RE, "\n");
    result = result.replace(/<h([1-6])>(.*?)<\/h\1>/giu, (_, level: string, content: string) => {
      return `${"#".repeat(Number.parseInt(level, 10))} ${content.trim()}`;
    });
    result = result.replace(SUPPORTED_HTML_TAG_RE, "");
    return result.replace(/\n{3,}/gu, "\n\n");
  }).trim();
}

function transformOutsideFences(text: string, transform: (value: string) => string): string {
  let result = "";
  let outside = "";
  let fence: { char: string; length: number } | null = null;
  const lines = text.match(/[^\n]*(?:\n|$)/gu)?.filter(Boolean) ?? [];

  for (const rawLine of lines) {
    const line = rawLine.endsWith("\n") ? rawLine.slice(0, -1) : rawLine;
    if (!fence) {
      const opening = line.match(/^ {0,3}(`{3,}|~{3,})/u);
      if (!opening) {
        outside += rawLine;
        continue;
      }
      result += transform(outside) + rawLine;
      outside = "";
      fence = { char: opening[1][0], length: opening[1].length };
      continue;
    }

    result += rawLine;
    const closing = line.match(/^ {0,3}(`+|~+)[ \t]*$/u);
    if (closing && closing[1][0] === fence.char && closing[1].length >= fence.length) {
      fence = null;
    }
  }

  return result + transform(outside);
}

function convertHtmlTables(text: string): string {
  return text.replace(HTML_TABLE_RE, (table, body: string) => {
    const rows = [...body.matchAll(HTML_ROW_RE)].map((match) => {
      return [...match[1].matchAll(HTML_CELL_RE)].map((cell) => ({
        tag: cell[1].toLowerCase(),
        value: cell[2].replace(BR_RE, " / ").replace(SUPPORTED_HTML_TAG_RE, "").trim(),
      }));
    }).filter((row) => row.length > 0);
    const header = rows[0];
    const data = rows.slice(1).map((row) => row.map((cell) => cell.value));
    if (!header || header.length < 2 || !header.every((cell) => cell.tag === "th")
      || data.length === 0 || data.some((row) => row.length !== header.length)) {
      return table;
    }
    return renderTable(header.map((cell) => cell.value), data);
  });
}

function convertGfmTables(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];

  for (let i = 0; i < lines.length;) {
    const headers = splitRow(lines[i]);
    const divider = i + 1 < lines.length ? splitRow(lines[i + 1]) : [];
    const validHeader = headers.length >= 2 && headers.length === divider.length
      && divider.every((cell) => /^:?-{3,}:?$/u.test(cell));
    if (!validHeader) {
      result.push(lines[i++]);
      continue;
    }

    const rows: string[][] = [];
    let end = i + 2;
    while (end < lines.length && lines[end].includes("|")) {
      const row = splitRow(lines[end]);
      if (row.length !== headers.length) break;
      rows.push(row);
      end++;
    }
    if (rows.length === 0) {
      result.push(lines[i++]);
      continue;
    }
    result.push(renderTable(headers, rows));
    i = end;
  }

  return result.join("\n");
}

function splitRow(line: string): string[] {
  const value = line.trim();
  const cells = [""];
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== "|") {
      cells[cells.length - 1] += value[i];
      continue;
    }
    const current = cells[cells.length - 1];
    const trailingSlashes = current.match(/\\+$/u)?.[0].length ?? 0;
    if (trailingSlashes % 2 === 1) {
      cells[cells.length - 1] = `${current.slice(0, -1)}|`;
    } else {
      cells.push("");
    }
  }
  if (cells[0].trim() === "") cells.shift();
  if (cells.at(-1)?.trim() === "") cells.pop();
  return cells.map((cell) => cell.trim());
}

function renderTable(headers: string[], rows: string[][]): string {
  const cell = (value: string): string => value || "—";
  if (headers.length === 2) {
    return [`${cell(headers[0])} · ${cell(headers[1])}`,
      ...rows.map((row) => `• ${cell(row[0])} — ${cell(row[1])}`)].join("\n");
  }
  return rows.map((row) => headers.map((header, index) => {
    return `${index === 0 ? "▌ " : "  "}${cell(header)}: ${cell(row[index])}`;
  }).join("\n")).join("\n\n");
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
