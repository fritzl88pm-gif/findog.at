const MAX_CHUNK_LENGTH = 4_000;

const BR_RE = /<br\s*\/?>/giu;
const SUPPORTED_HTML_TAG_RE = /<\/?(?:a|b|blockquote|br|code|del|div|em|h[1-6]|hr|i|li|ol|p|pre|s|span|strike|strong|table|tbody|td|tfoot|th|thead|tr|u|ul)\b(?:\s+[^<>]*?)?\s*\/?>/giu;
const HTML_TABLE_RE = /<table\b[^>]*>([\s\S]*?)<\/table>/giu;
const HTML_ROW_RE = /<tr\b[^>]*>([\s\S]*?)<\/tr>/giu;
const HTML_CELL_RE = /<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/giu;
const PRE_PLACEHOLDER = /\u0000PRE(\d+)\u0000/gu;

/**
 * Normalize Fred's answer for Telegram HTML delivery.
 * Converts Markdown tables to aligned <pre> blocks, escapes all HTML
 * special characters, and converts basic Markdown to Telegram HTML tags.
 */
export function normalizeFredMarkdown(text: string): string {
  return transformOutsideFences(text, (outside) => {
    // 1. Convert tables while HTML structure is still present
    let result = convertHtmlTables(outside);
    result = convertGfmTables(result);

    // 2. Misc HTML cleanup
    result = result.replace(BR_RE, "\n");
    result = result.replace(/<h([1-6])>(.*?)<\/h\1>/giu, (_m, level: string, content: string) => {
      return `${"#".repeat(Number.parseInt(level, 10))} ${stripTags(content).trim()}`;
    });

    // 3. Protect our generated <pre> blocks before stripping model HTML
    const preBlocks: string[] = [];
    result = result.replace(/<pre>[\s\S]*?<\/pre>/giu, (m) => {
      const i = preBlocks.length;
      preBlocks.push(m);
      return `\u0000PRE${i}\u0000`;
    });

    // 4. Strip remaining model HTML tags
    result = result.replace(SUPPORTED_HTML_TAG_RE, "");

    // 5. Restore <pre> blocks
    result = result.replace(PRE_PLACEHOLDER, (_m, i: string) => preBlocks[Number(i)] ?? "");

    // 6. Escape HTML inside <pre>, convert Markdown to HTML outside
    result = processPreSections(result);

    return result.replace(/\n{3,}/gu, "\n\n");
  }).trim();
}

export function hasGfmTable(text: string): boolean {
  const lines = text.split("\n");
  let fence: { char: string; length: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!fence) {
      const opening = line.match(/^ {0,3}(`{3,}|~{3,})/u);
      if (opening) {
        fence = { char: opening[1][0], length: opening[1].length };
        continue;
      }

      const headers = splitRow(line);
      const divider = i + 1 < lines.length ? splitRow(lines[i + 1]) : [];
      const validHeader = headers.length >= 2 && headers.length === divider.length
        && divider.every((cell) => /^:?-+:?$/u.test(cell));
      if (validHeader) return true;
      continue;
    }

    const closing = line.match(/^ {0,3}(`+|~+)[ \t]*$/u);
    if (closing && closing[1][0] === fence.char && closing[1].length >= fence.length) {
      fence = null;
    }
  }

  return false;
}

// ── HTML helpers ────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

function stripTags(text: string): string {
  return text.replace(SUPPORTED_HTML_TAG_RE, "");
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/gu, "$1")
    .replace(/`(.+?)`/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/\*([^*]+?)\*/gu, "$1")
    .trim();
}

function cleanTableCell(value: string): string {
  return stripMarkdown(stripTags(value)) || "—";
}

/** Escape HTML outside <pre> blocks and convert Markdown to HTML tags. */
function processPreSections(text: string): string {
  const parts = text.split(/(<pre>[\s\S]*?<\/pre>)/giu);
  return parts
    .map((part) => {
      if (part.toLowerCase().startsWith("<pre>") && part.toLowerCase().endsWith("</pre>")) {
        const inner = part.slice(5, -6);
        return `<pre>${escapeHtml(inner)}</pre>`;
      }
      return convertMarkdownToHtml(escapeHtml(part));
    })
    .join("");
}

function convertMarkdownToHtml(text: string): string {
  let result = text;
  result = result.replace(/^#{1,6}\s+(.+)$/gmu, "<b>$1</b>");
  result = result.replace(/\*\*(.+?)\*\*/gu, "<b>$1</b>");
  result = result.replace(/`(.+?)`/gu, "<code>$1</code>");
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/gu, (_m, label: string, url: string) => {
    return `<a href="${url}">${label}</a>`;
  });
  return result;
}

// ── Code fence handling ─────────────────────────────────────────────────────

function transformOutsideFences(text: string, transform: (value: string) => string): string {
  let result = "";
  let outside = "";
  let fence: { char: string; length: number } | null = null;
  let fenceContent = "";
  const lines = text.match(/[^\n]*(?:\n|$)/gu)?.filter(Boolean) ?? [];

  for (const rawLine of lines) {
    const line = rawLine.endsWith("\n") ? rawLine.slice(0, -1) : rawLine;
    if (!fence) {
      const opening = line.match(/^ {0,3}(`{3,}|~{3,})/u);
      if (!opening) {
        outside += rawLine;
        continue;
      }
      result += transform(outside);
      outside = "";
      fence = { char: opening[1][0], length: opening[1].length };
      fenceContent = "";
      continue;
    }

    const closing = line.match(/^ {0,3}(`+|~+)[ \t]*$/u);
    if (closing && closing[1][0] === fence.char && closing[1].length >= fence.length) {
      result += `<pre>${escapeHtml(fenceContent)}</pre>`;
      fenceContent = "";
      fence = null;
      continue;
    }
    if (fenceContent) fenceContent += "\n";
    fenceContent += line;
  }

  if (fence) {
    result += `<pre>${escapeHtml(fenceContent)}</pre>`;
  }

  return result + transform(outside);
}

// ── Table conversion ────────────────────────────────────────────────────────

function convertHtmlTables(text: string): string {
  return text.replace(HTML_TABLE_RE, (table, body: string) => {
    const rows = [...body.matchAll(HTML_ROW_RE)].map((match) => {
      return [...match[1].matchAll(HTML_CELL_RE)].map((cell) => ({
        tag: cell[1].toLowerCase(),
        value: cell[2].replace(BR_RE, " / ").trim(),
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
      && divider.every((cell) => /^:?-+:?$/u.test(cell));
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

/**
 * Render a table as an aligned monospace <pre> block.
 * Column widths are calculated from all cells; a dash separator
 * is inserted after the header row.
 */
function renderTable(headers: string[], rows: string[][]): string {
  const cleanedHeaders = headers.map(cleanTableCell);
  const cleanedRows = rows.map((row) => row.map(cleanTableCell));

  const colCount = cleanedHeaders.length;
  const colWidths = new Array(colCount).fill(0);
  for (const row of [cleanedHeaders, ...cleanedRows]) {
    for (let c = 0; c < colCount; c++) {
      const len = (row[c] ?? "").length;
      if (len > colWidths[c]) colWidths[c] = len;
    }
  }

  const pad = (text: string, col: number): string => (text ?? "").padEnd(colWidths[col]);

  const lines: string[] = [];
  lines.push(cleanedHeaders.map((h, c) => pad(h, c)).join("  "));
  lines.push(colWidths.map((w) => "\u2500".repeat(w)).join("  "));
  for (const row of cleanedRows) {
    lines.push(row.map((cell, c) => pad(cell, c)).join("  "));
  }

  return `<pre>${lines.join("\n")}</pre>`;
}

// ── Chunking ────────────────────────────────────────────────────────────────

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

    let splitAt = findSplitPoint(remaining, MAX_CHUNK_LENGTH);
    if (splitAt <= 0) splitAt = MAX_CHUNK_LENGTH;

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks.filter((chunk) => chunk.length > 0);
}

function findSplitPoint(text: string, maxLen: number): number {
  const searchRegion = text.slice(0, maxLen);

  const paraBreak = searchRegion.lastIndexOf("\n\n");
  if (paraBreak > maxLen * 0.3) return paraBreak + 2;

  const lineBreak = searchRegion.lastIndexOf("\n");
  if (lineBreak > maxLen * 0.3) return lineBreak + 1;

  const sentenceRe = /[.!?]\s+/gu;
  let lastSentenceEnd = 0;
  let match: RegExpExecArray | null;
  while ((match = sentenceRe.exec(searchRegion)) !== null) {
    if (match.index < maxLen) lastSentenceEnd = match.index + match[0].length;
  }
  if (lastSentenceEnd > maxLen * 0.3) return lastSentenceEnd;

  const spaceBreak = searchRegion.lastIndexOf(" ");
  if (spaceBreak > maxLen * 0.3) return spaceBreak + 1;

  return maxLen;
}
