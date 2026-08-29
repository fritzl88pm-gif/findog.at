import { UserVisibleError } from "./errors";

export type DashboardNewsKind = "product" | "legal";
export type DashboardNewsStatus = "draft" | "published" | "archived";
export type DashboardNewsSourceSystem = "ris" | "evi";
export type DashboardLegalDocumentKind = "norm" | "rechtssatz" | "entscheidungsdokument";
export type DashboardKnowledgeState = "current" | "processing" | "stale" | "unavailable";

export type DashboardNewsItem = {
  id: string;
  kind: DashboardNewsKind;
  title: string;
  summary: string;
  status: DashboardNewsStatus;
  pinned: boolean;
  publishedAt: string | null;
  sourceSystem: DashboardNewsSourceSystem | null;
  documentKind: DashboardLegalDocumentKind | null;
  sourceIdentifier: string | null;
  sourceUrl: string | null;
  documentDate: string | null;
  asOfDate: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DashboardKnowledgeStatus = {
  status: DashboardKnowledgeState;
  fetchedAt: string | null;
};

export type DashboardPayload = {
  counts: {
    reasonings: number;
    downloads: number;
  };
  knowledge: DashboardKnowledgeStatus;
  news: {
    product: DashboardNewsItem[];
    legal: DashboardNewsItem[];
  };
  sectionErrors?: Partial<Record<
    "reasonings" | "downloads" | "knowledge" | "productNews" | "legalNews",
    string
  >>;
};

export type DashboardNewsInput = Omit<
  DashboardNewsItem,
  "id" | "createdAt" | "updatedAt"
>;

export type DashboardNewsRow = {
  id: string;
  kind: string;
  title: string;
  summary: string;
  status: string;
  pinned: boolean;
  published_at: string | null;
  source_system: string | null;
  document_kind: string | null;
  source_identifier: string | null;
  source_url: string | null;
  document_date: string | null;
  as_of_date: string | null;
  created_at: string;
  updated_at: string;
};

export const DASHBOARD_NEWS_SELECT = [
  "id",
  "kind",
  "title",
  "summary",
  "status",
  "pinned",
  "published_at",
  "source_system",
  "document_kind",
  "source_identifier",
  "source_url",
  "document_date",
  "as_of_date",
  "created_at",
  "updated_at",
].join(",");

const NEWS_INPUT_KEYS = [
  "asOfDate",
  "documentDate",
  "documentKind",
  "kind",
  "pinned",
  "publishedAt",
  "sourceIdentifier",
  "sourceSystem",
  "sourceUrl",
  "status",
  "summary",
  "title",
] as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const FORBIDDEN_TEXT_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

function requiredString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new UserVisibleError(`${label} ist ungültig.`, 400);
  }
  const normalized = value.replace(/\r\n?/gu, "\n").trim();
  if (!normalized || normalized.length > maxLength || FORBIDDEN_TEXT_CONTROLS.test(normalized)) {
    throw new UserVisibleError(`${label} muss zwischen 1 und ${maxLength} Zeichen lang sein.`, 400);
  }
  return normalized;
}

function nullableString(value: unknown, label: string, maxLength: number): string | null {
  if (value === null) {
    return null;
  }
  return requiredString(value, label, maxLength);
}

function parseDate(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    throw new UserVisibleError(`${label} muss ein gültiges Datum sein.`, 400);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new UserVisibleError(`${label} muss ein gültiges Datum sein.`, 400);
  }
  return value;
}

function parsePublishedAt(value: unknown, status: DashboardNewsStatus): string | null {
  if (status === "draft") {
    if (value !== null) {
      throw new UserVisibleError("Entwürfe dürfen keinen Veröffentlichungszeitpunkt haben.", 400);
    }
    return null;
  }
  if (typeof value !== "string") {
    throw new UserVisibleError("Für veröffentlichte oder archivierte Meldungen ist ein Veröffentlichungszeitpunkt erforderlich.", 400);
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new UserVisibleError("Der Veröffentlichungszeitpunkt ist ungültig.", 400);
  }
  return timestamp.toISOString();
}

function parseSourceUrl(
  value: unknown,
  sourceSystem: DashboardNewsSourceSystem | null,
): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || !sourceSystem) {
    throw new UserVisibleError("Der Quellenlink ist ungültig.", 400);
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new UserVisibleError("Der Quellenlink ist ungültig.", 400);
  }
  const allowedHosts = sourceSystem === "ris"
    ? new Set(["ris.bka.gv.at", "www.ris.bka.gv.at"])
    : new Set(["evi.gv.at", "www.evi.gv.at"]);
  if (
    url.protocol !== "https:"
    || !allowedHosts.has(url.hostname.toLowerCase())
    || url.port
    || url.username
    || url.password
  ) {
    throw new UserVisibleError("Der Quellenlink muss auf den gewählten RIS- oder EVI-HTTPS-Host verweisen.", 400);
  }
  return url.toString();
}

export function parseDashboardNewsInput(body: unknown): DashboardNewsInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new UserVisibleError("Die Meldungsangaben sind ungültig.", 400);
  }
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join(",") !== [...NEWS_INPUT_KEYS].sort().join(",")) {
    throw new UserVisibleError("Die Meldungsangaben enthalten ungültige Felder.", 400);
  }
  if (record.kind !== "product" && record.kind !== "legal") {
    throw new UserVisibleError("Der Meldungstyp ist ungültig.", 400);
  }
  if (record.status !== "draft" && record.status !== "published" && record.status !== "archived") {
    throw new UserVisibleError("Der Status ist ungültig.", 400);
  }
  if (typeof record.pinned !== "boolean") {
    throw new UserVisibleError("Die Pin-Markierung ist ungültig.", 400);
  }

  const kind = record.kind;
  const status = record.status;
  const sourceSystem = record.sourceSystem === null
    ? null
    : record.sourceSystem === "ris" || record.sourceSystem === "evi"
      ? record.sourceSystem
      : (() => { throw new UserVisibleError("Das Quellsystem ist ungültig.", 400); })();
  const documentKind = record.documentKind === null
    ? null
    : record.documentKind === "norm"
      || record.documentKind === "rechtssatz"
      || record.documentKind === "entscheidungsdokument"
      ? record.documentKind
      : (() => { throw new UserVisibleError("Der Rechtsdokumenttyp ist ungültig.", 400); })();

  const sourceIdentifier = nullableString(record.sourceIdentifier, "Die amtliche Kennung", 200);
  const sourceUrl = parseSourceUrl(record.sourceUrl, sourceSystem);
  const documentDate = parseDate(record.documentDate, "Das Dokument- oder Entscheidungsdatum");
  const asOfDate = parseDate(record.asOfDate, "Der rechtliche Stichtag");

  if (kind === "product") {
    if (sourceSystem || documentKind || sourceIdentifier || sourceUrl || documentDate || asOfDate) {
      throw new UserVisibleError("Produktmeldungen dürfen keine Rechtsquellenfelder enthalten.", 400);
    }
  } else if (!sourceSystem || !documentKind || !sourceIdentifier || !sourceUrl || !documentDate || !asOfDate) {
    throw new UserVisibleError(
      "Rechtsmeldungen benötigen Quellsystem, Dokumenttyp, amtliche Kennung, HTTPS-Quellenlink, Dokumentdatum und rechtlichen Stichtag.",
      400,
    );
  }

  return {
    kind,
    title: requiredString(record.title, "Der Titel", 160),
    summary: requiredString(record.summary, "Der Kurztext", 600),
    status,
    pinned: record.pinned,
    publishedAt: parsePublishedAt(record.publishedAt, status),
    sourceSystem,
    documentKind,
    sourceIdentifier,
    sourceUrl,
    documentDate,
    asOfDate,
  };
}

export function assertDashboardNewsStatusTransition(
  previous: DashboardNewsStatus | null,
  next: DashboardNewsStatus,
): void {
  const allowed: Record<DashboardNewsStatus, readonly DashboardNewsStatus[]> = {
    draft: ["draft", "published"],
    published: ["published", "archived"],
    archived: ["archived", "published"],
  };
  if (previous === null) {
    if (next === "archived") {
      throw new UserVisibleError("Eine neue Meldung kann nicht direkt archiviert werden.", 409);
    }
    return;
  }
  if (!allowed[previous].includes(next)) {
    throw new UserVisibleError(`Der Statuswechsel von ${previous} zu ${next} ist nicht zulässig.`, 409);
  }
}

export function requireDashboardNewsId(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    throw new UserVisibleError("Die Meldungs-ID ist ungültig.", 400);
  }
  return value.trim();
}

export function mapDashboardNewsItem(row: DashboardNewsRow): DashboardNewsItem {
  return {
    id: row.id,
    kind: row.kind as DashboardNewsKind,
    title: row.title,
    summary: row.summary,
    status: row.status as DashboardNewsStatus,
    pinned: row.pinned,
    publishedAt: row.published_at,
    sourceSystem: row.source_system as DashboardNewsSourceSystem | null,
    documentKind: row.document_kind as DashboardLegalDocumentKind | null,
    sourceIdentifier: row.source_identifier,
    sourceUrl: row.source_url,
    documentDate: row.document_date,
    asOfDate: row.as_of_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function dashboardNewsInputToRow(input: DashboardNewsInput): Record<string, unknown> {
  return {
    kind: input.kind,
    title: input.title,
    summary: input.summary,
    status: input.status,
    pinned: input.pinned,
    published_at: input.publishedAt,
    source_system: input.sourceSystem,
    document_kind: input.documentKind,
    source_identifier: input.sourceIdentifier,
    source_url: input.sourceUrl,
    document_date: input.documentDate,
    as_of_date: input.asOfDate,
  };
}

export function getDashboardGreeting(date = new Date()): string {
  const hourPart = new Intl.DateTimeFormat("de-AT", {
    timeZone: "Europe/Vienna",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).find((part) => part.type === "hour")?.value;
  const hour = Number(hourPart ?? 0);
  if (hour >= 5 && hour < 11) {
    return "Guten Morgen";
  }
  if (hour >= 11 && hour < 18) {
    return "Guten Tag";
  }
  if (hour >= 18 && hour < 22) {
    return "Guten Abend";
  }
  return "Willkommen";
}

export function formatDashboardDate(date = new Date()): string {
  return new Intl.DateTimeFormat("de-AT", {
    timeZone: "Europe/Vienna",
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}
