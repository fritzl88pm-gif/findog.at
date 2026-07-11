import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

type PdfBlock =
  | { type: "heading"; text: string; level: number }
  | { type: "paragraph"; text: string }
  | { type: "bullet"; text: string; ordered: boolean; marker?: string };

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
  brand: {
    marginBottom: 24,
    borderBottomWidth: 2,
    borderBottomColor: "#ffd400",
    paddingBottom: 9,
    color: "#174f74",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 1.2,
  },
  title: {
    marginBottom: 7,
    color: "#174f74",
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
    color: "#174f74",
    fontSize: 14,
    fontWeight: 700,
    lineHeight: 1.3,
  },
  heading3: {
    marginTop: 10,
    marginBottom: 4,
    color: "#174f74",
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
    color: "#286f9c",
    fontWeight: 700,
  },
  bulletText: {
    flex: 1,
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

function parseBlocks(content: string): PdfBlock[] {
  const blocks: PdfBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    const text = plainText(paragraph.join(" "));
    if (text) {
      blocks.push({ type: "paragraph", text });
    }
    paragraph = [];
  };

  for (const rawLine of content.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
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

function ChatPdfDocument({ title, content, date }: ChatPdfPayload) {
  const blocks = parseBlocks(content);

  return (
    <Document title={title} author="Findog">
      <Page size="A4" style={styles.page}>
        <Text style={styles.brand}>FINDOG · DIGITALER STEUERASSISTENT</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.date}>Wien, {date}</Text>
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
          return <Text key={index} style={styles.paragraph}>{block.text}</Text>;
        })}
        <Text
          fixed
          style={styles.footer}
          render={({ pageNumber, totalPages }) => `findog.at · Seite ${pageNumber} von ${totalPages}`}
        />
      </Page>
    </Document>
  );
}

export async function renderChatPdf(payload: ChatPdfPayload): Promise<Uint8Array> {
  const buffer = await renderToBuffer(<ChatPdfDocument {...payload} />);
  return new Uint8Array(buffer);
}
