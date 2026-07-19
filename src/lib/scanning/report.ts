import { MAX_SCANNING_REPORT_CHARS } from "./config";
import type { ScanningDocument, ScanningFileStatus } from "./types";

type AmountField = "net" | "tax" | "gross";

function safeCell(value: string): string {
  return value.replace(/\|/gu, "\\|").replace(/\s+/gu, " ").trim() || "–";
}

function categoryOf(document: ScanningDocument): string {
  return document.category.trim() || "Sonstiges";
}

function parseCents(value: string | null): bigint | null {
  if (!value || !/^-?\d{1,15}(?:\.\d{1,2})?$/u.test(value)) return null;
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, decimals = ""] = unsigned.split(".");
  const cents = BigInt(whole) * 100n + BigInt(decimals.padEnd(2, "0"));
  return negative ? -cents : cents;
}

function formatCents(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / 100n;
  const cents = (absolute % 100n).toString().padStart(2, "0");
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/gu, ".");
  return `${negative ? "-" : ""}${grouped},${cents}`;
}

function displayAmount(value: string | null): string {
  const cents = parseCents(value);
  return cents === null ? "–" : formatCents(cents);
}

function totalsFor(documents: ScanningDocument[]): Map<string, Record<AmountField, bigint | null>> {
  const totals = new Map<string, Record<AmountField, bigint | null>>();
  for (const document of documents) {
    const currency = document.currency?.toUpperCase().trim();
    if (!currency || !/^[A-Z]{3}$/u.test(currency)) continue;
    const parsed = {
      net: parseCents(document.net),
      tax: parseCents(document.tax),
      gross: parseCents(document.gross),
    };
    if (parsed.net === null && parsed.tax === null && parsed.gross === null) continue;
    const current = totals.get(currency) ?? { net: null, tax: null, gross: null };
    for (const field of ["net", "tax", "gross"] as const) {
      const cents = parsed[field];
      if (cents !== null) current[field] = (current[field] ?? 0n) + cents;
    }
    totals.set(currency, current);
  }
  return totals;
}

function totalLines(documents: ScanningDocument[]): string[] {
  const totals = totalsFor(documents);
  if (totals.size === 0) return ["Keine eindeutig summierbaren Beträge erkannt."];
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "de"))
    .map(([currency, values]) => (
      `- **${currency}:** Netto ${values.net === null ? "–" : formatCents(values.net)}, USt ${values.tax === null ? "–" : formatCents(values.tax)}, Brutto ${values.gross === null ? "–" : formatCents(values.gross)}`
    ));
}

function sortDocuments(documents: ScanningDocument[]): ScanningDocument[] {
  return [...documents].sort((left, right) => {
    if (left.date && right.date) return left.date.localeCompare(right.date) || left.fileName.localeCompare(right.fileName, "de");
    if (left.date) return -1;
    if (right.date) return 1;
    return left.fileName.localeCompare(right.fileName, "de");
  });
}

export function buildScanningReport(options: {
  documents: ScanningDocument[];
  files: ScanningFileStatus[];
  summary?: string;
}): string {
  const successful = options.files.filter((file) => file.status === "completed").length;
  const failed = options.files.filter((file) => file.status === "failed");
  const duplicates = options.files.filter((file) => file.status === "duplicate");
  const lines = [
    "# Scanning-Auswertung",
    "",
    "## Übersicht",
    "",
    safeCell(options.summary?.trim() || `${successful} Dokument${successful === 1 ? "" : "e"} wurden ausgewertet und nach Kategorien geordnet.`),
    "",
  ];

  const groups = new Map<string, ScanningDocument[]>();
  for (const document of options.documents) {
    const category = categoryOf(document);
    groups.set(category, [...(groups.get(category) ?? []), document]);
  }

  for (const [category, documents] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right, "de"))) {
    const ordered = sortDocuments(documents);
    lines.push(
      `## ${safeCell(category)}`,
      "",
      "| Datum | Belegnummer | Aussteller | Beschreibung | Netto | USt | Brutto | Währung |",
      "|---|---|---|---|---:|---:|---:|:---:|",
      ...ordered.map((document) => [
        document.date ?? "–",
        safeCell(document.documentNumber),
        safeCell(document.issuer),
        safeCell(document.description || document.documentType),
        displayAmount(document.net),
        displayAmount(document.tax),
        displayAmount(document.gross),
        safeCell(document.currency?.toUpperCase() ?? ""),
      ].join(" | ").replace(/^/u, "| ").concat(" |")),
      "",
      "### Zwischensummen",
      "",
      ...totalLines(ordered),
      "",
    );
  }

  lines.push("## Gesamtsummen", "", ...totalLines(options.documents), "");

  const warnings = options.documents.flatMap((document) => document.warnings.map((warning) => (
    `- **${safeCell(document.fileName)}:** ${safeCell(warning)}`
  )));
  if (warnings.length > 0) lines.push("## Unklare Angaben", "", ...warnings, "");
  if (failed.length > 0) {
    lines.push(
      "## Nicht ausgewertete Dateien",
      "",
      ...failed.map((file) => `- **${safeCell(file.name)}:** ${safeCell(file.detail ?? "Auswertung fehlgeschlagen")}`),
      "",
    );
  }
  if (duplicates.length > 0) {
    lines.push(
      "## Doppelte Dateien",
      "",
      ...duplicates.map((file) => `- ${safeCell(file.name)} wurde nur einmal berücksichtigt.`),
      "",
    );
  }

  const report = lines.join("\n").trim();
  if (report.length <= MAX_SCANNING_REPORT_CHARS) return report;
  return `${report.slice(0, MAX_SCANNING_REPORT_CHARS - 80).trimEnd()}\n\n[Bericht aus technischen Gründen gekürzt.]`;
}
