import {
  fredAgentName,
  type FredAgentKey,
} from "../weknora/fred-agent";

export const MAX_FRED_PDF_EXPORT_CHARS = 500_000;

export type FredActionMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  agentKey?: FredAgentKey;
  attachments?: ReadonlyArray<{ name: string }>;
  webSearchEnabled?: boolean;
  proModeEnabled?: boolean;
};

function viennaTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("de-AT", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Vienna",
  }).format(date);
}

function safeAttachmentName(value: string): string {
  return value.replace(/[\t\r\n]+/gu, " ").trim();
}

export function precedingUserMessage(
  messages: ReadonlyArray<FredActionMessage>,
  assistantIndex: number,
): FredActionMessage | undefined {
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return messages[index];
  }
  return undefined;
}

export function buildFredConversationPdfContent(
  messages: ReadonlyArray<FredActionMessage>,
): string {
  return messages.flatMap((message) => {
    const content = message.content.trim();
    if (!content) return [];
    const timestamp = viennaTimestamp(message.createdAt);
    const agentKey = message.agentKey ?? "fred";
    const heading = `## ${message.role === "user" ? "Du" : fredAgentName(agentKey)}${timestamp ? ` · ${timestamp}` : ""}`;
    const metadata: string[] = [];
    if (message.role === "user") {
      metadata.push(`Agent: ${fredAgentName(agentKey)}`);
    }
    if (message.role === "user" && message.webSearchEnabled) {
      metadata.push("Websuche: aktiviert");
    }
    if (message.role === "user" && message.proModeEnabled) {
      metadata.push("Pro-Modus: aktiviert");
    }
    const attachmentNames = message.attachments
      ?.map((attachment) => safeAttachmentName(attachment.name))
      .filter(Boolean) ?? [];
    if (message.role === "user" && attachmentNames.length > 0) {
      metadata.push(`Anhänge: ${attachmentNames.join(", ")}`);
    }
    return [[heading, content, ...metadata].join("\n\n")];
  }).join("\n\n");
}

export function pdfFilenameFromHeader(
  contentDisposition: string | null,
  fallback: string,
): string {
  const filename = /filename="([A-Za-z0-9_.-]+)"/u.exec(contentDisposition ?? "")?.[1];
  return filename || fallback;
}
