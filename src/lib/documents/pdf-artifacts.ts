import { createHash, randomUUID } from "node:crypto";

import type { AppChatMessage, DeepSeekToolCall } from "../deepseek";
import type { PdfArtifactDraft } from "../agent-steps";
import type { DeepSeekTool } from "../mcp/tools";

export const CREATE_PDF_DOCUMENT_TOOL_NAME = "create_pdf_document";
export const MAX_PDF_ARTIFACTS_PER_TURN = 3;
export const MAX_PDF_ARTIFACT_TITLE_CHARS = 160;
export const MAX_PDF_ARTIFACT_CONTENT_CHARS = 60_000;

export const CREATE_PDF_DOCUMENT_TOOL: DeepSeekTool = {
  type: "function",
  function: {
    name: CREATE_PDF_DOCUMENT_TOOL_NAME,
    description: [
      "Erstellt auf ausdrücklichen Nutzerwunsch ein eigenständiges, vollständiges PDF-Dokument.",
      "Der Dokumentinhalt darf den Gesprächskontext und die belegte aktuelle Antwort verwenden, ist aber vom sichtbaren Chattext getrennt.",
      "Bei neuen Rechtsaussagen dürfen ausschließlich die im aktuellen Lauf recherchierten und belegten Inhalte verwendet werden.",
    ].join(" "),
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["title", "content_markdown"],
      properties: {
        title: {
          type: "string",
          minLength: 1,
          maxLength: MAX_PDF_ARTIFACT_TITLE_CHARS,
          description: "Präziser Dokumenttitel ohne Dateiendung.",
        },
        content_markdown: {
          type: "string",
          minLength: 1,
          maxLength: MAX_PDF_ARTIFACT_CONTENT_CHARS,
          description: "Vollständiger druckfertiger Dokumentinhalt in Markdown, nicht bloß eine Zusage oder Zusammenfassung.",
        },
        stichtag: {
          type: ["string", "null"],
          description: "Maßgeblicher Stichtag im Format YYYY-MM-DD, sonst null.",
        },
      },
    },
  },
};

type ParsedPdfArtifact = {
  title: string;
  contentMarkdown: string;
  stichtag: string | null;
};

function cleanTitle(value: string): string {
  return value.replace(/\s+/gu, " ").trim().slice(0, MAX_PDF_ARTIFACT_TITLE_CHARS);
}

function safeFilename(title: string): string {
  const stem = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^A-Za-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 80) || "Findog_Dokument";
  return `${stem}.pdf`;
}

function validStichtag(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error("Der PDF-Stichtag ist ungültig.");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("Der PDF-Stichtag ist ungültig.");
  }
  return value;
}

function parseToolArguments(raw: string): ParsedPdfArtifact {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Die PDF-Funktion erhielt ungültiges JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Die PDF-Funktion erhielt ungültige Argumente.");
  }
  const input = value as Record<string, unknown>;
  if (
    !Object.keys(input).every((key) => ["title", "content_markdown", "stichtag"].includes(key))
    || typeof input.title !== "string"
    || typeof input.content_markdown !== "string"
  ) {
    throw new Error("Die PDF-Funktion erhielt ungültige Argumente.");
  }
  const title = cleanTitle(input.title);
  const contentMarkdown = input.content_markdown.replace(/\r\n?/gu, "\n").trim();
  if (!title || !contentMarkdown) {
    throw new Error("PDF-Titel und Dokumentinhalt dürfen nicht leer sein.");
  }
  if (input.title.length > MAX_PDF_ARTIFACT_TITLE_CHARS) {
    throw new Error("Der PDF-Titel ist zu lang.");
  }
  if (contentMarkdown.length > MAX_PDF_ARTIFACT_CONTENT_CHARS) {
    throw new Error("Der PDF-Dokumentinhalt ist zu lang.");
  }
  return { title, contentMarkdown, stichtag: validStichtag(input.stichtag) };
}

function contextProvenance(messages: readonly AppChatMessage[]) {
  return messages.map((message, ordinal) => ({
    ordinal,
    role: message.role,
    sha256: createHash("sha256").update(message.content, "utf8").digest("hex"),
  }));
}

export function createPdfArtifactDrafts(options: {
  toolCalls: readonly DeepSeekToolCall[];
  conversation: readonly AppChatMessage[];
  researchTools: readonly string[];
  createdAt?: string;
}): { drafts: PdfArtifactDraft[]; errors: string[] } {
  const drafts: PdfArtifactDraft[] = [];
  const errors: string[] = [];
  const createdAt = options.createdAt ?? new Date().toISOString();
  for (const call of options.toolCalls) {
    if (call.name !== CREATE_PDF_DOCUMENT_TOOL_NAME) continue;
    if (drafts.length >= MAX_PDF_ARTIFACTS_PER_TURN) {
      errors.push(`Pro Antwort sind höchstens ${MAX_PDF_ARTIFACTS_PER_TURN} PDF-Dokumente möglich.`);
      break;
    }
    try {
      const parsed = parseToolArguments(call.arguments);
      const contentSha256 = createHash("sha256")
        .update(parsed.contentMarkdown, "utf8")
        .digest("hex");
      drafts.push({
        id: randomUUID(),
        title: parsed.title,
        filename: safeFilename(parsed.title),
        contentMarkdown: parsed.contentMarkdown,
        contentSha256,
        stichtag: parsed.stichtag,
        provenance: {
          version: 1,
          createdAt,
          basis: options.researchTools.length > 0 ? "mixed" : "conversation",
          contextMessages: contextProvenance(options.conversation),
          researchTools: [...options.researchTools],
        },
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Das PDF-Dokument ist ungültig.");
    }
  }
  return { drafts, errors };
}
