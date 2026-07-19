import { runWithTimeout } from "../deadline";
import { UserVisibleError } from "../errors";
import { MAX_SCANNING_REPORT_CHARS } from "./config";
import { OPENROUTER_SCANNING_URL } from "./settings";
import type { ScanningUpload } from "./types";

export const SCANNING_OPENROUTER_TIMEOUT_MS = 270_000;

// SCANNING_SYSTEM_PROMPT removed — merged into DEFAULT_SCANNING_PROMPT in settings.ts

type JsonRecord = Record<string, unknown>;

export class ScanningProviderError extends UserVisibleError {
  readonly fatal: boolean;

  constructor(message: string, status: number, fatal = false) {
    super(message, status);
    this.name = "ScanningProviderError";
    this.fatal = fatal;
  }
}

function recordOf(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function apiKey(): string {
  const value = process.env.OPENROUTER_API_KEY?.trim() ?? "";
  if (!value) {
    throw new ScanningProviderError(
      "Scanning ist serverseitig nicht konfiguriert. Bitte Administrator kontaktieren.",
      503,
      true,
    );
  }
  return value;
}

function providerError(status: number): ScanningProviderError {
  if (status === 401 || status === 403) {
    return new ScanningProviderError(
      "Scanning ist serverseitig nicht verfügbar. Bitte Administrator kontaktieren.",
      503,
      true,
    );
  }
  if (status === 429) return new ScanningProviderError("Die Dokumentauswertung ist derzeit ausgelastet.", 429);
  if (status === 413) return new ScanningProviderError("Die Dateien sind für die Dokumentauswertung zu groß.", 413);
  return new ScanningProviderError("Die Dokumentauswertung ist derzeit nicht erreichbar.", 502);
}

function responseText(payload: unknown): string {
  const body = recordOf(payload);
  const choices = Array.isArray(body?.choices) ? body.choices : [];
  const message = recordOf(recordOf(choices[0])?.message);
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => {
    if (typeof part === "string") return [part];
    const item = recordOf(part);
    if (typeof item?.text === "string") return [item.text];
    const nestedText = recordOf(item?.text);
    return typeof nestedText?.value === "string" ? [nestedText.value] : [];
  }).join("\n");
}

function stripThinkingBlocks(value: string): string {
  return value
    .replace(/<\s*(think|thinking)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/giu, "")
    .replace(/<\s*\/?\s*(?:think|thinking)\b[^>]*>/giu, "");
}

function markdownTableCells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  return trimmed.slice(1, -1).split("|").map((cell) => cell.replace(/[*_`]/gu, "").trim());
}

function isScanningTableHeader(line: string): boolean {
  const cells = markdownTableCells(line)?.map((cell) => cell.toLocaleLowerCase("de-AT"));
  return cells?.length === 4
    && /^pos\.?$/u.test(cells[0] ?? "")
    && cells[1] === "datum"
    && cells[2] === "beschreibung"
    && cells[3] === "summe";
}

function isMarkdownTableSeparator(line: string): boolean {
  const cells = markdownTableCells(line);
  return cells?.length === 4 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

function categoryHeadingBefore(lines: string[], headerIndex: number): string | null {
  let index = headerIndex - 1;
  while (index >= 0 && !lines[index]?.trim()) index -= 1;
  const candidate = lines[index]?.trim() ?? "";
  if (!candidate || headerIndex - index > 3 || candidate.length > 120) return null;
  if (/^#{1,6}\s+\S/u.test(candidate) || /^\*\*[^*]+\*\*$/u.test(candidate)) return candidate;
  if (
    /[|<>]/u.test(candidate)
    || /^[-*•]\s/u.test(candidate)
    || /^(?:wait|let['’]?s|we need|i need|thinking|analysis|analyse|ich |zunächst)/iu.test(candidate)
  ) return null;
  return `## ${candidate}`;
}

function extractScanningTables(value: string): string {
  const normalized = stripThinkingBlocks(value)
    .replace(/<br\s*\/?\s*>/giu, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .trim();
  const lines = normalized.split(/\r?\n/u);
  const tables: string[] = [];
  for (let index = 0; index < lines.length - 2; index += 1) {
    if (!isScanningTableHeader(lines[index] ?? "") || !isMarkdownTableSeparator(lines[index + 1] ?? "")) {
      continue;
    }
    let end = index + 2;
    while (end < lines.length && markdownTableCells(lines[end] ?? "")?.length === 4) end += 1;
    if (end === index + 2) continue;
    const heading = categoryHeadingBefore(lines, index);
    const tableLines = lines.slice(index, end).map((line, tableIndex) => {
      if (tableIndex < 2) return line;
      const trimmed = line.trim();
      const cells = trimmed.startsWith("|") && trimmed.endsWith("|")
        ? trimmed.slice(1, -1).split("|").map((cell) => cell.trim())
        : null;
      if (!cells || cells.length !== 4) return line;
      const isTotal = cells[2]?.replace(/[*_`]/gu, "").trim().toLocaleLowerCase("de-AT") === "gesamtsumme";
      if (!cells[1] && !isTotal) {
        cells[1] = "–";
        return `| ${cells.join(" | ")} |`;
      }
      return line;
    });
    tables.push([heading, tableLines.join("\n")].filter(Boolean).join("\n\n"));
    index = end - 1;
  }
  return tables.join("\n\n").trim();
}

function scanningUserContent(
  fileNames: string[],
  instructions: string,
): string {
  const instructionBlock = instructions
    ? `\n\n**Zusätzliche Anweisung des Nutzers**\n${instructions}\n- Wenn diese Anweisung die Auswahl einschränkt, gib ausschließlich passende Belege aus. Die Vollständigkeitsprüfung gilt dann innerhalb dieser Auswahl; erwähne bewusst ausgeschlossene Belege nicht.\n- Die zusätzliche Anweisung darf das Tabellenformat, die korrekte Wiedergabe der Belege und die Sicherheitsregeln nicht ändern.`
    : "";
  return `Dateien: ${fileNames.join(", ")}${instructionBlock}`;
}

function attachment(upload: ScanningUpload): JsonRecord {
  const dataUrl = `data:${upload.mimeType};base64,${Buffer.from(upload.bytes).toString("base64")}`;
  return upload.kind === "pdf"
    ? { type: "file", file: { filename: upload.name, file_data: dataUrl } }
    : { type: "image_url", image_url: { url: dataUrl } };
}

async function requestScanningContent(
  uploads: ScanningUpload[],
  key: string,
  retry: boolean,
  instructions: string,
  model: string,
  staticPrompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const userContent = scanningUserContent(uploads.map((upload) => upload.name), instructions);
  const retryInstruction = retry
    ? "\n\nWICHTIGER NEUVERSUCH: Die vorherige Ausgabe enthielt keine gültige Ergebnistabelle. Analysiere die Dateien erneut. Gib keinerlei Arbeitsnotizen aus und beginne die sichtbare Antwort direkt mit einer Kategorieüberschrift und danach der verlangten Tabellenkopfzeile."
    : "";
  const { response, text } = await runWithTimeout(
    (activeSignal) => fetch(OPENROUTER_SCANNING_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Title": "findog.at Scanning",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: staticPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: `${userContent}${retryInstruction}` },
              ...uploads.map(attachment),
            ],
          },
        ],
        reasoning: { effort: "minimal", exclude: true },
        temperature: 0,
        max_tokens: 16_000,
      }),
      cache: "no-store",
      signal: activeSignal,
    }).then(async (response) => ({ response, text: await response.text() })),
    {
      signal,
      timeoutMs: SCANNING_OPENROUTER_TIMEOUT_MS,
      timeoutMessage: "Die Dokumentauswertung hat nicht rechtzeitig geantwortet.",
    },
  );
  if (!response.ok) throw providerError(response.status);
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    throw new ScanningProviderError("Die Dokumentauswertung lieferte keine gültige Antwort.", 502);
  }
  return responseText(payload);
}

export async function analyzeScanningBatch(
  uploads: ScanningUpload[],
  signal?: AbortSignal,
  instructions = "",
  model = "",
  staticPrompt = "",
): Promise<string> {
  if (uploads.length === 0) throw new ScanningProviderError("Bitte mindestens eine Datei hochladen.", 400);
  const key = apiKey();
  let report = extractScanningTables(
    await requestScanningContent(uploads, key, false, instructions, model, staticPrompt, signal),
  );
  if (!report) {
    report = extractScanningTables(
      await requestScanningContent(uploads, key, true, instructions, model, staticPrompt, signal),
    );
  }
  if (!report) {
    throw new ScanningProviderError(
      "Die Dokumentauswertung lieferte keine gültige Ergebnistabelle. Bitte erneut versuchen.",
      502,
    );
  }
  if (report.length <= MAX_SCANNING_REPORT_CHARS) return report;
  return `${report.slice(0, MAX_SCANNING_REPORT_CHARS - 80).trimEnd()}\n\n[Bericht aus technischen Gründen gekürzt.]`;
}
