import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  downloadContentDisposition,
  downloadDisplayFilename,
  getDownloadCatalog,
  parseDownloadCategoryInput,
  parseDownloadDeleteInput,
  parseDownloadDocumentInput,
  requireDownloadUuid,
} from "./downloads";

const CATEGORY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("download library input validation", () => {
  it("normalizes category and document metadata", () => {
    expect(parseDownloadCategoryInput({
      name: "  Einkommensteuer   2026 ",
      description: " Amtliche   Formulare ",
      sortOrder: 10,
    })).toEqual({
      name: "Einkommensteuer 2026",
      description: "Amtliche Formulare",
      sortOrder: 10,
    });

    expect(parseDownloadDocumentInput({
      categoryId: CATEGORY_ID,
      title: "  E 1 – Erklärung  ",
      description: " Ausfüllbar   am Bildschirm ",
      sortOrder: "20",
    })).toEqual({
      categoryId: CATEGORY_ID,
      title: "E 1 – Erklärung",
      description: "Ausfüllbar am Bildschirm",
      sortOrder: 20,
    });
  });

  it("rejects unknown fields, invalid UUIDs, control characters and sort bounds", () => {
    expect(() => parseDownloadCategoryInput({
      name: "Steuer",
      description: "",
      sortOrder: 0,
      isAdmin: true,
    })).toThrow(/ungültige Felder/u);
    expect(() => requireDownloadUuid("not-an-id", "Die Dokument-ID")).toThrow(/Dokument-ID/u);
    expect(() => parseDownloadDocumentInput({
      categoryId: CATEGORY_ID,
      title: "Datei\u0000",
      description: "",
      sortOrder: 0,
    })).toThrow(/Dokumentname/u);
    expect(() => parseDownloadCategoryInput({
      name: "Steuer",
      description: "",
      sortOrder: -1,
    })).toThrow(/Reihenfolge/u);
  });

  it("requires delete requests to contain only a UUID", () => {
    expect(parseDownloadDeleteInput({ id: CATEGORY_ID }, "Die Kategorie-ID")).toBe(CATEGORY_ID);
    expect(() => parseDownloadDeleteInput({ id: CATEGORY_ID, force: true }, "Die Kategorie-ID"))
      .toThrow(/Kategorie-ID/u);
  });
});

describe("download filenames", () => {
  it("creates a safe display filename without duplicating the extension", () => {
    expect(downloadDisplayFilename("E 1: Erklärung", "pdf")).toBe("E 1_ Erklärung.pdf");
    expect(downloadDisplayFilename("Vorlage.xlsx", "xlsx")).toBe("Vorlage.xlsx");
  });

  it("never splits a surrogate pair when shortening long titles", () => {
    for (const rawTitle of ["a" + "📄".repeat(100), "📄".repeat(100)]) {
      const { title } = parseDownloadDocumentInput({
        categoryId: CATEGORY_ID,
        title: rawTitle,
        description: "",
        sortOrder: 0,
      });
      const filename = downloadDisplayFilename(title, "pdf");

      expect(filename).toBe(`${rawTitle}.pdf`);
      // With the u flag this only matches lone surrogates.
      expect(filename).not.toMatch(/[\uD800-\uDFFF]/u);
      expect(() => downloadContentDisposition(filename)).not.toThrow();
    }
  });

  it("creates an attachment header with ASCII fallback and UTF-8 filename", () => {
    const header = downloadContentDisposition("Einkommensteuererklärung.pdf");
    expect(header).toContain('attachment; filename="Einkommensteuererklarung.pdf"');
    expect(header).toContain("filename*=UTF-8''Einkommensteuererkl%C3%A4rung.pdf");
    expect(header).not.toContain("\r");
    expect(header).not.toContain("\n");
  });
});

// Hosted Supabase PostgREST returns at most this many rows per response.
const POSTGREST_MAX_ROWS = 1_000;

function cappedQuery(rows: unknown[]) {
  let from = 0;
  let to = Number.POSITIVE_INFINITY;
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.is = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.range = vi.fn((rangeFrom: number, rangeTo: number) => {
    from = rangeFrom;
    to = rangeTo;
    return builder;
  });
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve({
      data: rows.slice(from, Math.min(to + 1, from + POSTGREST_MAX_ROWS)),
      error: null,
    }).then(resolve, reject);
  return builder;
}

function uuid(prefix: string, index: number): string {
  return `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

describe("download catalog", () => {
  it("loads every category and document past the 1000-row response cap", async () => {
    const timestamp = "2026-09-27T08:00:00.000Z";
    const categories = Array.from({ length: 1_050 }, (_, index) => ({
      id: uuid("cccccccc", index),
      name: `Kategorie ${index}`,
      description: "",
      sort_order: index,
      created_at: timestamp,
      updated_at: timestamp,
    }));
    // 1200 documents in the first category and one in the last, which is past both caps.
    const documents = [
      ...Array.from({ length: 1_200 }, (_, index) => ({ categoryIndex: 0, index })),
      { categoryIndex: 1_049, index: 1_200 },
    ].map(({ categoryIndex, index }) => ({
      id: uuid("dddddddd", index),
      category_id: uuid("cccccccc", categoryIndex),
      title: `Dokument ${index}`,
      description: "",
      original_filename: `dokument-${index}.pdf`,
      mime_type: "application/pdf",
      file_extension: "pdf",
      file_size: 100,
      sort_order: index,
      created_at: timestamp,
      updated_at: timestamp,
    }));
    const queries: Record<string, ReturnType<typeof cappedQuery>> = {
      download_categories: cappedQuery(categories),
      download_documents: cappedQuery(documents),
    };
    const supabase = { from: vi.fn((table: string) => queries[table]) } as unknown as SupabaseClient;

    const catalog = await getDownloadCatalog(supabase);

    expect(catalog.categories).toHaveLength(1_050);
    expect(catalog.documents).toHaveLength(1_201);
    expect(catalog.categories[0]).toMatchObject({ id: uuid("cccccccc", 0), documentCount: 1_200 });
    expect(catalog.categories[1_049]).toMatchObject({ id: uuid("cccccccc", 1_049), documentCount: 1 });
    for (const query of Object.values(queries)) {
      expect(query.order).toHaveBeenLastCalledWith("id", { ascending: true });
      expect(query.range).toHaveBeenCalledWith(0, 999);
      expect(query.range).toHaveBeenCalledWith(1_000, 1_999);
    }
  });

  it("reports an unavailable catalog when a later page fails", async () => {
    // A full first page, then a failure: the catalog must not come back cut off.
    const documents = cappedQuery(Array.from({ length: 1_000 }, (_, index) => ({
      id: uuid("dddddddd", index),
      category_id: uuid("cccccccc", 0),
    })));
    const firstPageThen = documents.then as (...args: unknown[]) => unknown;
    documents.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
      const from = (documents.range as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] ?? 0;
      return from === 0
        ? firstPageThen(resolve, reject)
        : Promise.resolve({ data: null, error: { message: "timeout" } }).then(resolve, reject);
    };
    const supabase = {
      from: vi.fn((table: string) => (table === "download_documents" ? documents : cappedQuery([]))),
    } as unknown as SupabaseClient;

    await expect(getDownloadCatalog(supabase)).rejects.toMatchObject({
      message: "Downloads konnten nicht geladen werden.",
      status: 503,
    });
  });
});
