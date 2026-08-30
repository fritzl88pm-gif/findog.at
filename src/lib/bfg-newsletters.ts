import { UserVisibleError } from "./errors";

export const BFG_NEWSLETTER_MAX_CONTENT_CHARS = 100_000;

export type BfgNewsletterItem = {
  id: string;
  publicationDate: string;
  contentMarkdown: string;
  createdAt: string;
  updatedAt: string;
};

export type BfgNewsletterInput = Pick<
  BfgNewsletterItem,
  "publicationDate" | "contentMarkdown"
>;

export type BfgNewsletterRow = {
  id: string;
  publication_date: string;
  content_markdown: string;
  created_at: string;
  updated_at: string;
};

export const BFG_NEWSLETTER_SELECT = [
  "id",
  "publication_date",
  "content_markdown",
  "created_at",
  "updated_at",
].join(",");

const INPUT_KEYS = ["contentMarkdown", "publicationDate"] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const FORBIDDEN_TEXT_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

function parsePublicationDate(value: unknown): string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    throw new UserVisibleError("Das Newsletterdatum muss ein gültiges Datum sein.", 400);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new UserVisibleError("Das Newsletterdatum muss ein gültiges Datum sein.", 400);
  }
  return value;
}

function parseContentMarkdown(value: unknown): string {
  if (typeof value !== "string") {
    throw new UserVisibleError("Der Newsletterinhalt ist ungültig.", 400);
  }
  const normalized = value.replace(/\r\n?/gu, "\n").trim();
  if (
    !normalized
    || normalized.length > BFG_NEWSLETTER_MAX_CONTENT_CHARS
    || FORBIDDEN_TEXT_CONTROLS.test(normalized)
  ) {
    throw new UserVisibleError(
      `Der Newsletterinhalt muss zwischen 1 und ${BFG_NEWSLETTER_MAX_CONTENT_CHARS} Zeichen lang sein.`,
      400,
    );
  }
  return normalized;
}

export function parseBfgNewsletterInput(body: unknown): BfgNewsletterInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new UserVisibleError("Die Newsletterangaben sind ungültig.", 400);
  }
  const record = body as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== [...INPUT_KEYS].sort().join(",")) {
    throw new UserVisibleError("Die Newsletterangaben enthalten ungültige Felder.", 400);
  }
  return {
    publicationDate: parsePublicationDate(record.publicationDate),
    contentMarkdown: parseContentMarkdown(record.contentMarkdown),
  };
}

export function requireBfgNewsletterId(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    throw new UserVisibleError("Die Newsletter-ID ist ungültig.", 400);
  }
  return value.trim();
}

export function mapBfgNewsletterItem(row: BfgNewsletterRow): BfgNewsletterItem {
  return {
    id: row.id,
    publicationDate: row.publication_date,
    contentMarkdown: row.content_markdown,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function bfgNewsletterInputToRow(input: BfgNewsletterInput): Record<string, unknown> {
  return {
    publication_date: input.publicationDate,
    content_markdown: input.contentMarkdown,
  };
}

export function sortBfgNewsletters(items: BfgNewsletterItem[]): BfgNewsletterItem[] {
  return [...items].sort((left, right) => (
    right.publicationDate.localeCompare(left.publicationDate)
    || right.createdAt.localeCompare(left.createdAt)
    || right.id.localeCompare(left.id)
  ));
}
