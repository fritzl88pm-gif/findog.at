import { UserVisibleError } from "./errors";

export const OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";
export const OPENROUTER_GEMINI_PDF_MODEL = "google/gemini-3.5-flash";
export const MAX_PDF_CONTEXT_CHARS = 120_000;

type ExtractPdfContextOptions = {
  filename: string;
  mimeType: "application/pdf";
  bytes: Uint8Array;
};

type JsonRecord = Record<string, unknown>;

function getOpenRouterApiKey(): string {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new UserVisibleError(
      "PDF-Auswertung ist serverseitig nicht konfiguriert. Bitte Administrator kontaktieren.",
      503,
    );
  }

  return apiKey;
}

function extractionPrompt(filename: string): string {
  return [
    "Extrahiere den vollständigen Kontext aus dem hochgeladenen PDF für eine spätere steuerrechtliche Chat-Antwort.",
    `Dateiname: ${filename}`,
    "",
    "Liefer das Ergebnis in gut lesbarem, deutschfreundlichem Markdown.",
    "Erfasse den Inhalt seitenweise mit Überschriften wie `## Seite 1`.",
    "Führe OCR für Scans, Fotos und eingebettete Bilder durch, soweit lesbar.",
    "Gib Tabellen als Markdown-Tabellen aus; nutze kompaktes HTML nur, wenn Markdown die Struktur nicht sinnvoll abbildet.",
    "Beschreibe wichtige Fakten aus Bildern, Diagrammen, Stempeln, Unterschriftenfeldern und visuellen Markierungen.",
    "Markiere unlesbare, abgeschnittene oder leere Bereiche ausdrücklich.",
    "Beantworte keine rechtliche Frage und ziehe keine rechtlichen Schlüsse. Extrahiere nur Dokumentinhalt und Kontext.",
  ].join("\n");
}

function contentText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .flatMap((part): string[] => {
      if (typeof part === "string") {
        return [part];
      }
      if (!part || typeof part !== "object" || Array.isArray(part)) {
        return [];
      }
      const item = part as JsonRecord;
      if (typeof item.text === "string") {
        return [item.text];
      }
      if (typeof item.content === "string") {
        return [item.content];
      }
      return [];
    })
    .join("\n\n")
    .trim();
}

function boundedContext(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_PDF_CONTEXT_CHARS) {
    return trimmed;
  }

  return `${trimmed.slice(0, MAX_PDF_CONTEXT_CHARS).trimEnd()}\n\n[PDF-Kontext gekürzt auf ${MAX_PDF_CONTEXT_CHARS} Zeichen.]`;
}

function safeApiMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as JsonRecord;
    const error = parsed.error as JsonRecord | undefined;
    const message = typeof error?.message === "string" ? error.message : "";
    return message.replace(/\s+/g, " ").trim().slice(0, 500);
  } catch {
    return "";
  }
}

function openRouterError(status: number, body: string): UserVisibleError {
  const apiMessage = safeApiMessage(body);

  if (status === 401) {
    return new UserVisibleError(
      "PDF-Zugang wurde abgelehnt. Bitte serverseitige PDF-Konfiguration prüfen.",
      401,
    );
  }
  if (status === 413) {
    return new UserVisibleError("Das PDF ist für die Auswertung zu groß.", 413);
  }
  if (status === 429) {
    return new UserVisibleError("PDF-Auswertung ist derzeit ausgelastet. Bitte später erneut versuchen.", 429);
  }
  if (status >= 500) {
    return new UserVisibleError("PDF-Auswertung ist derzeit nicht erreichbar. Bitte später erneut versuchen.", 502);
  }

  return new UserVisibleError(
    `PDF-Auswertung Fehler HTTP ${status}${apiMessage ? `: ${apiMessage}` : ""}`,
    status,
  );
}

export async function extractPdfContext(options: ExtractPdfContextOptions): Promise<string> {
  const apiKey = getOpenRouterApiKey();
  const fileData = `data:${options.mimeType};base64,${Buffer.from(options.bytes).toString("base64")}`;

  const response = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "findog.at PDF context extraction",
    },
    body: JSON.stringify({
      model: OPENROUTER_GEMINI_PDF_MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: extractionPrompt(options.filename),
            },
            {
              type: "file",
              file: {
                filename: options.filename,
                file_data: fileData,
              },
            },
          ],
        },
      ],
      temperature: 0.1,
    }),
    cache: "no-store",
  });

  const body = await response.text();
  if (!response.ok) {
    throw openRouterError(response.status, body);
  }

  let parsed: JsonRecord;
  try {
    parsed = JSON.parse(body) as JsonRecord;
  } catch {
    throw new UserVisibleError("PDF-Auswertung lieferte keine gültige Antwort.", 502);
  }

  const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
  const firstChoice = choices[0] as JsonRecord | undefined;
  const message = firstChoice?.message as JsonRecord | undefined;
  const text = contentText(message?.content);
  if (!text) {
    throw new UserVisibleError("Aus dem PDF konnte kein Kontext extrahiert werden.", 502);
  }

  return boundedContext(text);
}
