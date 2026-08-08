import type { SupabaseClient } from "@supabase/supabase-js";

import { UserVisibleError } from "./errors";

export const DOWNLOAD_BUCKET = "downloads";
export const DOWNLOAD_PAGE_SIZE = 7;

export type DownloadCategory = {
  id: string;
  name: string;
  description: string;
  sortOrder: number;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
};

export type DownloadDocument = {
  id: string;
  categoryId: string;
  title: string;
  description: string;
  originalFilename: string;
  mimeType: string;
  fileExtension: string;
  fileSize: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type DownloadCatalog = {
  categories: DownloadCategory[];
  documents: DownloadDocument[];
};

type CategoryRow = {
  id: string;
  name: string;
  description: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type DocumentRow = {
  id: string;
  category_id: string;
  title: string;
  description: string;
  original_filename: string;
  mime_type: string;
  file_extension: string;
  file_size: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;

function normalizeSingleLine(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || CONTROL_PATTERN.test(value)) {
    throw new UserVisibleError(`${label} ist ungültig.`, 400);
  }
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!normalized || [...normalized].length > maxLength) {
    throw new UserVisibleError(`${label} ist ungültig.`, 400);
  }
  return normalized;
}

function normalizeOptionalSingleLine(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (typeof value !== "string" || CONTROL_PATTERN.test(value)) {
    throw new UserVisibleError(`${label} ist ungültig.`, 400);
  }
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if ([...normalized].length > maxLength) {
    throw new UserVisibleError(`${label} ist ungültig.`, 400);
  }
  return normalized;
}

export function requireDownloadUuid(value: unknown, label = "ID"): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    throw new UserVisibleError(`${label} ist ungültig.`, 400);
  }
  return value.trim().toLowerCase();
}

export function parseDownloadSortOrder(value: unknown): number {
  const number = typeof value === "string" && value.trim() ? Number(value) : value;
  if (!Number.isInteger(number) || Number(number) < 0 || Number(number) > 1_000_000) {
    throw new UserVisibleError("Die Reihenfolge ist ungültig.", 400);
  }
  return Number(number);
}

export function parseDownloadCategoryInput(value: unknown): {
  name: string;
  description: string;
  sortOrder: number;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UserVisibleError("Die Kategorieangaben sind ungültig.", 400);
  }
  const fields = value as Record<string, unknown>;
  const keys = Object.keys(fields).sort();
  if (keys.join(",") !== "description,name,sortOrder") {
    throw new UserVisibleError("Die Kategorieangaben enthalten ungültige Felder.", 400);
  }
  return {
    name: normalizeSingleLine(fields.name, "Der Kategoriename", 80),
    description: normalizeOptionalSingleLine(fields.description, "Die Kategoriebeschreibung", 240),
    sortOrder: parseDownloadSortOrder(fields.sortOrder),
  };
}

export function parseDownloadDocumentInput(value: unknown): {
  categoryId: string;
  title: string;
  description: string;
  sortOrder: number;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UserVisibleError("Die Dokumentangaben sind ungültig.", 400);
  }
  const fields = value as Record<string, unknown>;
  const keys = Object.keys(fields).sort();
  if (keys.join(",") !== "categoryId,description,sortOrder,title") {
    throw new UserVisibleError("Die Dokumentangaben enthalten ungültige Felder.", 400);
  }
  return {
    categoryId: requireDownloadUuid(fields.categoryId, "Die Kategorie-ID"),
    title: normalizeSingleLine(fields.title, "Der Dokumentname", 160),
    description: normalizeOptionalSingleLine(fields.description, "Die Dokumentbeschreibung", 500),
    sortOrder: parseDownloadSortOrder(fields.sortOrder),
  };
}

export function parseDownloadDeleteInput(value: unknown, label: string): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UserVisibleError(`${label} ist ungültig.`, 400);
  }
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).length !== 1 || !("id" in fields)) {
    throw new UserVisibleError(`${label} ist ungültig.`, 400);
  }
  return requireDownloadUuid(fields.id, label);
}

export function mapDownloadCategory(row: CategoryRow, documentCount = 0): DownloadCategory {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sortOrder: row.sort_order,
    documentCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapDownloadDocument(row: DocumentRow): DownloadDocument {
  return {
    id: row.id,
    categoryId: row.category_id,
    title: row.title,
    description: row.description,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    fileExtension: row.file_extension,
    fileSize: Number(row.file_size),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getDownloadCatalog(supabase: SupabaseClient): Promise<DownloadCatalog> {
  const [categoryResult, documentResult] = await Promise.all([
    supabase
      .from("download_categories")
      .select("id,name,description,sort_order,created_at,updated_at")
      .is("deleted_at", null)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
      .order("id", { ascending: true }),
    supabase
      .from("download_documents")
      .select("id,category_id,title,description,original_filename,mime_type,file_extension,file_size,sort_order,created_at,updated_at")
      .is("deleted_at", null)
      .order("category_id", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("title", { ascending: true })
      .order("id", { ascending: true }),
  ]);

  if (categoryResult.error || documentResult.error) {
    throw new UserVisibleError("Downloads konnten nicht geladen werden.", 503);
  }

  const documents = (documentResult.data ?? []).map((row) => mapDownloadDocument(row as DocumentRow));
  const counts = new Map<string, number>();
  for (const document of documents) {
    counts.set(document.categoryId, (counts.get(document.categoryId) ?? 0) + 1);
  }

  return {
    categories: (categoryResult.data ?? []).map((row) => {
      const categoryRow = row as CategoryRow;
      return mapDownloadCategory(categoryRow, counts.get(categoryRow.id) ?? 0);
    }),
    documents,
  };
}

export function downloadDisplayFilename(title: string, extension: string): string {
  const safeTitle = title
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/gu, "_")
    .trim()
    .slice(0, 180) || "download";
  const suffix = `.${extension.toLowerCase()}`;
  return safeTitle.toLowerCase().endsWith(suffix) ? safeTitle : `${safeTitle}${suffix}`;
}

export function downloadContentDisposition(filename: string): string {
  const ascii = filename
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\x20-\x7e]/gu, "_")
    .replace(/["\\]/gu, "_")
    .slice(0, 200) || "download";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
