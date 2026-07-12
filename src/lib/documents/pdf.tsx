import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

export type PdfContentBlock =
  | { type: "heading"; text: string; level: number }
  | { type: "paragraph"; text: string }
  | { type: "bullet"; text: string; ordered: boolean; marker?: string }
  | {
      type: "table";
      headers: string[];
      alignments: Array<"left" | "center" | "right">;
      rows: string[][];
    };

export type ChatPdfPayload = {
  title: string;
  content: string;
  date: string;
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 46,
    paddingRight: 52,
    paddingBottom: 54,
    paddingLeft: 52,
    color: "#1f2933",
    fontFamily: "Helvetica",
    fontSize: 10.5,
    lineHeight: 1.55,
  },
  title: {
    marginBottom: 7,
    color: "#334155",
    fontSize: 20,
    fontWeight: 700,
    lineHeight: 1.25,
  },
  date: {
    marginBottom: 22,
    color: "#64748b",
    fontSize: 9.5,
  },
  heading2: {
    marginTop: 13,
    marginBottom: 5,
    color: "#334155",
    fontSize: 14,
    fontWeight: 700,
    lineHeight: 1.3,
  },
  heading3: {
    marginTop: 10,
    marginBottom: 4,
    color: "#334155",
    fontSize: 11.5,
    fontWeight: 700,
    lineHeight: 1.35,
  },
  paragraph: {
    marginBottom: 8,
    textAlign: "left",
  },
  bulletRow: {
    flexDirection: "row",
    marginBottom: 4,
    paddingLeft: 7,
  },
  bulletMarker: {
    width: 20,
    color: "#475569",
    fontWeight: 700,
  },
  bulletText: {
    flex: 1,
  },
  table: {
    marginTop: 2,
    marginBottom: 10,
    borderTopWidth: 0.5,
    borderRightWidth: 0.5,
    borderColor: "#94a3b8",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderColor: "#94a3b8",
  },
  tableAlternateRow: {
    backgroundColor: "#f8fafc",
  },
  tableHeaderRow: {
    backgroundColor: "#e2e8f0",
  },
  tableCellContainer: {
    borderLeftWidth: 0.5,
    borderColor: "#94a3b8",
  },
  tableCell: {
    paddingTop: 5,
    paddingRight: 6,
    paddingBottom: 5,
    paddingLeft: 6,
    color: "#334155",
    fontSize: 8.5,
    lineHeight: 1.35,
  },
  tableHeaderCell: {
    color: "#1e293b",
    fontWeight: 700,
  },
  footer: {
    position: "absolute",
    right: 52,
    bottom: 24,
    left: 52,
    borderTopWidth: 0.5,
    borderTopColor: "#cbd5e1",
    paddingTop: 7,
    color: "#718096",
    fontSize: 8,
    textAlign: "center",
  },
});

function plainText(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/(?:\*\*|__)(.+?)(?:\*\*|__)/g, "$1")
    .replace(/(?:\*|_)(.+?)(?:\*|_)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^>\s?/, "")
    .trim();
}

function parseTableRow(line: string): string[] | null {
  if (!line.includes("|")) {
    return null;
  }

  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cell = "";

  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (character === "\\" && trimmed[index + 1] === "|") {
      cell += "|";
      index += 1;
    } else if (character === "|") {
      cells.push(plainText(cell));
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(plainText(cell));
  return cells;
}

function parseTableDelimiter(line: string): Array<"left" | "center" | "right"> | null {
  const cells = parseTableRow(line);
  if (!cells || cells.length === 0 || cells.some((cell) => !/^:?-{3,}:?$/.test(cell))) {
    return null;
  }

  return cells.map((cell) => {
    if (cell.startsWith(":") && cell.endsWith(":")) {
      return "center";
    }
    return cell.endsWith(":") ? "right" : "left";
  });
}

export function parsePdfContentBlocks(content: string): PdfContentBlock[] {
  const blocks: PdfContentBlock[] = [];
  let paragraph: string[] = [];
  const lines = content.replace(/\r\n?/g, "\n").split("\n");

  const flushParagraph = () => {
    const text = plainText(paragraph.join(" "));
    if (text) {
      blocks.push({ type: "paragraph", text });
    }
    paragraph = [];
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex] ?? "";
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      continue;
    }

    const headers = parseTableRow(line);
    const alignments = parseTableDelimiter(lines[lineIndex + 1]?.trim() ?? "");
    if (headers && alignments && headers.length === alignments.length) {
      flushParagraph();
      const rows: string[][] = [];
      lineIndex += 2;
      while (lineIndex < lines.length) {
        const rowLine = lines[lineIndex]?.trim() ?? "";
        if (!rowLine) {
          break;
        }
        const row = parseTableRow(rowLine);
        if (!row) {
          lineIndex -= 1;
          break;
        }
        rows.push(headers.map((_, cellIndex) => row[cellIndex] ?? ""));
        lineIndex += 1;
      }
      blocks.push({ type: "table", headers, alignments, rows });
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ type: "heading", level: heading[1]?.length ?? 2, text: plainText(heading[2] ?? "") });
      continue;
    }

    const unorderedBullet = /^[-*+]\s+(.+)$/.exec(line);
    if (unorderedBullet) {
      flushParagraph();
      blocks.push({ type: "bullet", ordered: false, text: plainText(unorderedBullet[1] ?? "") });
      continue;
    }

    const orderedBullet = /^(\d+)[.)]\s+(.+)$/.exec(line);
    if (orderedBullet) {
      flushParagraph();
      blocks.push({
        type: "bullet",
        ordered: true,
        marker: orderedBullet[1],
        text: plainText(orderedBullet[2] ?? ""),
      });
      continue;
    }

    paragraph.push(line);
  }
  flushParagraph();
  return blocks;
}

function getColumnWeights(headers: string[], rows: string[][]): number[] {
  return headers.map((header, columnIndex) => {
    const longestCell = Math.max(
      header.length,
      ...rows.map((row) => row[columnIndex]?.length ?? 0),
    );
    return Math.max(8, Math.min(36, longestCell));
  });
}

function ChatPdfDocument({ title, content, date }: ChatPdfPayload) {
  const blocks = parsePdfContentBlocks(content);

  return (
    <Document title={title}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.date}>{date}</Text>
        {blocks.map((block, index) => {
          if (block.type === "heading") {
            return (
              <Text key={index} style={block.level <= 2 ? styles.heading2 : styles.heading3}>
                {block.text}
              </Text>
            );
          }
          if (block.type === "bullet") {
            return (
              <View key={index} style={styles.bulletRow} wrap={false}>
                <Text style={styles.bulletMarker}>{block.ordered ? `${block.marker}.` : "•"}</Text>
                <Text style={styles.bulletText}>{block.text}</Text>
              </View>
            );
          }
          if (block.type === "table") {
            const columnWeights = getColumnWeights(block.headers, block.rows);
            const renderCell = (text: string, cellIndex: number, header = false) => (
              <View
                key={cellIndex}
                style={[
                  styles.tableCellContainer,
                  { flexBasis: 0, flexGrow: columnWeights[cellIndex] ?? 1 },
                ]}
              >
                <Text
                  style={[
                    styles.tableCell,
                    { textAlign: block.alignments[cellIndex] ?? "left" },
                    ...(header ? [styles.tableHeaderCell] : []),
                  ]}
                >
                  {text}
                </Text>
              </View>
            );

            return (
              <View key={index} style={styles.table}>
                <View style={[styles.tableRow, styles.tableHeaderRow]} wrap={false}>
                  {block.headers.map((header, cellIndex) => renderCell(header, cellIndex, true))}
                </View>
                {block.rows.map((row, rowIndex) => (
                  <View
                    key={rowIndex}
                    style={[styles.tableRow, ...(rowIndex % 2 === 1 ? [styles.tableAlternateRow] : [])]}
                    wrap={false}
                  >
                    {row.map((cell, cellIndex) => renderCell(cell, cellIndex))}
                  </View>
                ))}
              </View>
            );
          }
          return <Text key={index} style={styles.paragraph}>{block.text}</Text>;
        })}
        <Text
          fixed
          style={styles.footer}
          render={({ pageNumber, totalPages }) => `Seite ${pageNumber} von ${totalPages}`}
        />
      </Page>
    </Document>
  );
}

export async function renderChatPdf(payload: ChatPdfPayload): Promise<Uint8Array> {
  const buffer = await renderToBuffer(<ChatPdfDocument {...payload} />);
  return new Uint8Array(buffer);
}
