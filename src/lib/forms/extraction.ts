import { runWithTimeout } from "../deadline";
import { UserVisibleError } from "../errors";
import { type FormImageMimeType } from "./config";

export const OPENROUTER_FORM_EXTRACTION_URL = "https://openrouter.ai/api/v1/chat/completions";
export const OPENROUTER_FORM_EXTRACTION_MODEL = "google/gemini-3.5-flash";
const FORM_EXTRACTION_TIMEOUT_MS = 90_000;

const EXTRACTED_FIELD_NAMES = [
  "steuernummer",
  "vorname",
  "nachname",
  "letzteadresse",
  "sterbedatum",
] as const;

export type ExtractedVerf5Fields = Record<(typeof EXTRACTED_FIELD_NAMES)[number], string>;

type JsonRecord = Record<string, unknown>;

function normalizedField(value: unknown, maxLength: number): string {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match?.[1]?.trim() ?? trimmed;
}

export function parseStructuredFormFields(value: unknown): ExtractedVerf5Fields {
  let parsed: unknown = value;

  if (typeof value === "string") {
    try {
      parsed = JSON.parse(stripJsonFence(value)) as unknown;
    } catch {
      throw new UserVisibleError(
        "Die Bildauswertung hat keine gültigen Formulardaten geliefert. Bitte erneut versuchen.",
        502,
      );
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UserVisibleError(
      "Die Bildauswertung hat keine gültigen Formulardaten geliefert. Bitte erneut versuchen.",
      502,
    );
  }

  const record = parsed as JsonRecord;
  return {
    steuernummer: normalizedField(record.steuernummer, 100),
    vorname: normalizedField(record.vorname, 200),
    nachname: normalizedField(record.nachname, 200),
    letzteadresse: normalizedField(record.letzteadresse, 500),
    sterbedatum: normalizedField(record.sterbedatum, 100),
  };
}

function modelContent(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return undefined;
  }
  const choicesValue = (body as JsonRecord).choices;
  const choices: unknown[] = Array.isArray(choicesValue) ? choicesValue : [];
  const choice = choices[0];
  if (!choice || typeof choice !== "object" || Array.isArray(choice)) {
    return undefined;
  }
  const message = (choice as JsonRecord).message;
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return undefined;
  }
  const content = (message as JsonRecord).content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }

  return content
    .flatMap((part): string[] => {
      if (!part || typeof part !== "object" || Array.isArray(part)) {
        return [];
      }
      const text = (part as JsonRecord).text;
      return typeof text === "string" ? [text] : [];
    })
    .join("");
}

export async function extractVerf5ImageFields(options: {
  bytes: Uint8Array;
  mimeType: FormImageMimeType;
}): Promise<ExtractedVerf5Fields> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new UserVisibleError(
      "Die Bildauswertung ist serverseitig nicht konfiguriert. Bitte Administrator kontaktieren.",
      503,
    );
  }

  const imageUrl = `data:${options.mimeType};base64,${Buffer.from(options.bytes).toString("base64")}`;
  const prompt = [
    "Extrahiere ausschließlich die folgenden Werte aus dem abgebildeten Dokument für das österreichische Formular Verf 5:",
    "steuernummer, vorname, nachname, letzteadresse, sterbedatum.",
    "Gib für fehlende, abgeschnittene oder unlesbare Werte eine leere Zeichenkette zurück.",
    "Erfinde und ergänze keine Werte.",
    "Datum der Formularerstellung und Saldo dürfen weder extrahiert noch ausgegeben werden.",
    "Antworte ausschließlich mit dem angeforderten JSON-Objekt.",
  ].join("\n");

  const { response, body } = await runWithTimeout(
    (signal) => fetch(OPENROUTER_FORM_EXTRACTION_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "findog.at Verf 5 extraction",
      },
      body: JSON.stringify({
        model: OPENROUTER_FORM_EXTRACTION_MODEL,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        }],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "verf5_document_fields",
            strict: true,
            schema: {
              type: "object",
              properties: Object.fromEntries(
                EXTRACTED_FIELD_NAMES.map((field) => [field, { type: "string" }]),
              ),
              required: [...EXTRACTED_FIELD_NAMES],
              additionalProperties: false,
            },
          },
        },
        temperature: 0,
        max_tokens: 500,
      }),
      cache: "no-store",
      signal,
    }).then(async (response) => ({ response, body: await response.text() })),
    {
      timeoutMs: FORM_EXTRACTION_TIMEOUT_MS,
      timeoutMessage: "Die Bildauswertung hat nicht rechtzeitig geantwortet. Bitte erneut versuchen.",
    },
  );

  if (!response.ok) {
    if (response.status === 429) {
      throw new UserVisibleError(
        "Die Bildauswertung ist derzeit ausgelastet. Bitte später erneut versuchen.",
        429,
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new UserVisibleError(
        "Die Bildauswertung ist serverseitig nicht verfügbar. Bitte Administrator kontaktieren.",
        503,
      );
    }
    throw new UserVisibleError(
      "Die Bildauswertung ist derzeit nicht erreichbar. Bitte später erneut versuchen.",
      502,
    );
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(body) as unknown;
  } catch {
    throw new UserVisibleError(
      "Die Bildauswertung hat keine gültige Antwort geliefert. Bitte erneut versuchen.",
      502,
    );
  }

  return parseStructuredFormFields(modelContent(parsedBody));
}
