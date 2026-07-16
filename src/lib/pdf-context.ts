import { type Deadline, runWithTimeout } from "./deadline";
import { UserVisibleError } from "./errors";

export const OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";
export const OPENROUTER_GEMINI_CONTEXT_MODEL = "google/gemini-3.5-flash";
export const OPENROUTER_GEMINI_PDF_MODEL = OPENROUTER_GEMINI_CONTEXT_MODEL;
export const MAX_PDF_CONTEXT_CHARS = 120_000;
export const OPENROUTER_CONTEXT_TIMEOUT_MS = 270_000;

type ExtractPdfContextOptions = {
  filename: string;
  mimeType: "application/pdf";
  bytes: Uint8Array;
  deadline?: Deadline;
  signal?: AbortSignal;
};

type ExtractImageContextOptions = {
  filename: string;
  mimeType: `image/${string}`;
  bytes: Uint8Array;
  deadline?: Deadline;
  signal?: AbortSignal;
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

function imageExtractionPrompt(filename: string): string {
  return [
    "Extrahiere den vollständigen Kontext aus dem hochgeladenen Bild für eine spätere steuerrechtliche Chat-Antwort.",
    `Dateiname: ${filename}`,
    "",
    "Liefer das Ergebnis in gut lesbarem, deutschfreundlichem Markdown.",
    "Erfasse sichtbaren Text per OCR, inklusive Beträgen, Datumsangaben, Namen, Aktenzeichen und Tabellen.",
    "Beschreibe Dokumenttyp, Layout, Stempel, Unterschriftenfelder, Markierungen und andere fachlich relevante sichtbare Merkmale.",
    "Markiere unlesbare, abgeschnittene oder leere Bereiche ausdrücklich.",
    "Beantworte keine rechtliche Frage und ziehe keine rechtlichen Schlüsse. Extrahiere nur Bildinhalt und Kontext.",
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

function openRouterError(status: number, body: string, label: "PDF" | "Bild"): UserVisibleError {
  const apiMessage = safeApiMessage(body);

  if (status === 401) {
    return new UserVisibleError(
      `${label}-Zugang wurde abgelehnt. Bitte serverseitige OpenRouter-Konfiguration prüfen.`,
      401,
    );
  }
  if (status === 413) {
    return new UserVisibleError(`${label === "PDF" ? "Das PDF ist" : "Das Bild ist"} für die Auswertung zu groß.`, 413);
  }
  if (status === 429) {
    return new UserVisibleError(`${label}-Auswertung ist derzeit ausgelastet. Bitte später erneut versuchen.`, 429);
  }
  if (status >= 500) {
    return new UserVisibleError(`${label}-Auswertung ist derzeit nicht erreichbar. Bitte später erneut versuchen.`, 502);
  }

  return new UserVisibleError(
    `${label}-Auswertung Fehler HTTP ${status}${apiMessage ? `: ${apiMessage}` : ""}`,
    status,
  );
}

async function extractOpenRouterContext(options: {
  prompt: string;
  title: string;
  label: "PDF" | "Bild";
  deadline?: Deadline;
  signal?: AbortSignal;
  contentPart:
    | {
        type: "file";
        file: {
          filename: string;
          file_data: string;
        };
      }
    | {
        type: "image_url";
        image_url: {
          url: string;
        };
      };
}): Promise<string> {
  const apiKey = getOpenRouterApiKey();

  const { response, body } = await runWithTimeout(
    (signal) =>
      fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "X-Title": options.title,
        },
        body: JSON.stringify({
          model: OPENROUTER_GEMINI_CONTEXT_MODEL,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: options.prompt,
                },
                options.contentPart,
              ],
            },
          ],
          temperature: 0.1,
        }),
        cache: "no-store",
        signal,
      }).then(async (response) => ({
        response,
        body: await response.text(),
      })),
    {
      deadline: options.deadline,
      signal: options.signal,
      timeoutMs: OPENROUTER_CONTEXT_TIMEOUT_MS,
      timeoutMessage: `${options.label}-Auswertung hat nicht rechtzeitig geantwortet. Bitte erneut versuchen.`,
    },
  );

  if (!response.ok) {
    throw openRouterError(response.status, body, options.label);
  }

  let parsed: JsonRecord;
  try {
    parsed = JSON.parse(body) as JsonRecord;
  } catch {
    throw new UserVisibleError(`${options.label}-Auswertung lieferte keine gültige Antwort.`, 502);
  }

  const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
  const firstChoice = choices[0] as JsonRecord | undefined;
  const message = firstChoice?.message as JsonRecord | undefined;
  const text = contentText(message?.content);
  if (!text) {
    throw new UserVisibleError(`Aus dem ${options.label === "PDF" ? "PDF" : "Bild"} konnte kein Kontext extrahiert werden.`, 502);
  }

  return boundedContext(text);
}

export async function extractPdfContext(options: ExtractPdfContextOptions): Promise<string> {
  const fileData = `data:${options.mimeType};base64,${Buffer.from(options.bytes).toString("base64")}`;

  return extractOpenRouterContext({
    prompt: extractionPrompt(options.filename),
    title: "findog.at PDF context extraction",
    label: "PDF",
    deadline: options.deadline,
    signal: options.signal,
    contentPart: {
      type: "file",
      file: {
        filename: options.filename,
        file_data: fileData,
      },
    },
  });
}

export async function extractImageContext(options: ExtractImageContextOptions): Promise<string> {
  const fileData = `data:${options.mimeType};base64,${Buffer.from(options.bytes).toString("base64")}`;

  return extractOpenRouterContext({
    prompt: imageExtractionPrompt(options.filename),
    title: "findog.at image context extraction",
    label: "Bild",
    deadline: options.deadline,
    signal: options.signal,
    contentPart: {
      type: "image_url",
      image_url: {
        url: fileData,
      },
    },
  });
}
