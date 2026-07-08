export type RichInline =
  | { type: "text"; text: string }
  | { type: "strong"; children: RichInline[] }
  | { type: "code"; text: string }
  | { type: "highlight"; children: RichInline[] };

export type RichBlock =
  | { type: "paragraph"; children: RichInline[] }
  | { type: "heading"; level: 2 | 3 | 4; children: RichInline[] }
  | { type: "unordered-list"; items: RichInline[][] }
  | { type: "ordered-list"; items: RichInline[][] }
  | { type: "table"; headers: RichInline[][]; rows: RichInline[][][] }
  | { type: "blockquote"; children: RichInline[] };

const headingPattern = /^(#{1,3})\s+(.+)$/;
const unorderedListPattern = /^\s*[-*+]\s+(.+)$/;
const orderedListPattern = /^\s*\d+[.)]\s+(.+)$/;
const blockquotePattern = /^\s*>\s?(.*)$/;

function pushText(nodes: RichInline[], text: string): void {
  if (!text) {
    return;
  }

  const previous = nodes.at(-1);
  if (previous?.type === "text") {
    previous.text += text;
    return;
  }

  nodes.push({ type: "text", text });
}

function findNextToken(text: string, start: number): { marker: "`" | "**" | "__" | "=="; index: number } | null {
  const candidates = (["`", "**", "__", "=="] as const)
    .map((marker) => ({ marker, index: text.indexOf(marker, start) }))
    .filter((candidate) => candidate.index >= 0)
    .sort((left, right) => left.index - right.index || right.marker.length - left.marker.length);

  return candidates[0] ?? null;
}

export function parseInline(text: string): RichInline[] {
  const nodes: RichInline[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const token = findNextToken(text, cursor);
    if (!token) {
      pushText(nodes, text.slice(cursor));
      break;
    }

    if (token.index > cursor) {
      pushText(nodes, text.slice(cursor, token.index));
    }

    const contentStart = token.index + token.marker.length;
    const contentEnd = text.indexOf(token.marker, contentStart);
    if (contentEnd < 0) {
      pushText(nodes, text.slice(token.index));
      break;
    }

    const content = text.slice(contentStart, contentEnd);
    if (!content) {
      pushText(nodes, text.slice(token.index, contentEnd + token.marker.length));
      cursor = contentEnd + token.marker.length;
      continue;
    }

    if (token.marker === "`") {
      nodes.push({ type: "code", text: content });
    } else if (token.marker === "==") {
      nodes.push({ type: "highlight", children: parseInline(content) });
    } else {
      nodes.push({ type: "strong", children: parseInline(content) });
    }
    cursor = contentEnd + token.marker.length;
  }

  return nodes;
}

function splitTableRow(line: string): string[] | null {
  if (!line.includes("|")) {
    return null;
  }

  let trimmed = line.trim();
  if (trimmed.startsWith("|")) {
    trimmed = trimmed.slice(1);
  }
  if (trimmed.endsWith("|")) {
    trimmed = trimmed.slice(0, -1);
  }

  const cells = trimmed.split("|").map((cell) => cell.trim());
  return cells.length > 1 ? cells : null;
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  return Boolean(
    cells?.length &&
      cells.every((cell) => {
        const normalized = cell.replace(/\s/g, "");
        return /^:?-{3,}:?$/.test(normalized);
      }),
  );
}

function isTableStart(lines: string[], index: number): boolean {
  return Boolean(splitTableRow(lines[index] ?? "") && isTableSeparator(lines[index + 1] ?? ""));
}

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index] ?? "";
  return (
    headingPattern.test(line) ||
    unorderedListPattern.test(line) ||
    orderedListPattern.test(line) ||
    blockquotePattern.test(line) ||
    isTableStart(lines, index)
  );
}

function parseTable(lines: string[], index: number): { block: RichBlock; nextIndex: number } {
  const headers = splitTableRow(lines[index] ?? "") ?? [];
  const rows: string[][] = [];
  let cursor = index + 2;

  while (cursor < lines.length) {
    const cells = splitTableRow(lines[cursor] ?? "");
    if (!cells) {
      break;
    }
    rows.push(cells);
    cursor += 1;
  }

  return {
    block: {
      type: "table",
      headers: headers.map(parseInline),
      rows: rows.map((row) =>
        headers.map((_, cellIndex) => parseInline(row[cellIndex] ?? "")),
      ),
    },
    nextIndex: cursor,
  };
}

export function parseRichAnswer(content: string): RichBlock[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: RichBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const heading = headingPattern.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        level: Math.min(4, heading[1].length + 1) as 2 | 3 | 4,
        children: parseInline(heading[2].trim()),
      });
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const table = parseTable(lines, index);
      blocks.push(table.block);
      index = table.nextIndex;
      continue;
    }

    const unorderedItem = unorderedListPattern.exec(line);
    if (unorderedItem) {
      const items: RichInline[][] = [];
      while (index < lines.length) {
        const match = unorderedListPattern.exec(lines[index] ?? "");
        if (!match) {
          break;
        }
        items.push(parseInline(match[1].trim()));
        index += 1;
      }
      blocks.push({ type: "unordered-list", items });
      continue;
    }

    const orderedItem = orderedListPattern.exec(line);
    if (orderedItem) {
      const items: RichInline[][] = [];
      while (index < lines.length) {
        const match = orderedListPattern.exec(lines[index] ?? "");
        if (!match) {
          break;
        }
        items.push(parseInline(match[1].trim()));
        index += 1;
      }
      blocks.push({ type: "ordered-list", items });
      continue;
    }

    const quote = blockquotePattern.exec(line);
    if (quote) {
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const match = blockquotePattern.exec(lines[index] ?? "");
        if (!match) {
          break;
        }
        const value = match[1].trim();
        if (!/^\[![A-Z]+\]$/.test(value)) {
          quoteLines.push(value);
        }
        index += 1;
      }
      blocks.push({ type: "blockquote", children: parseInline(quoteLines.join("\n").trim()) });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && lines[index]?.trim() && !isBlockStart(lines, index)) {
      paragraphLines.push((lines[index] ?? "").trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", children: parseInline(paragraphLines.join(" ")) });
  }

  return blocks;
}
