import { describe, expect, it } from "vitest";

import {
  downloadContentDisposition,
  downloadDisplayFilename,
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

  it("creates an attachment header with ASCII fallback and UTF-8 filename", () => {
    const header = downloadContentDisposition("Einkommensteuererklärung.pdf");
    expect(header).toContain('attachment; filename="Einkommensteuererklarung.pdf"');
    expect(header).toContain("filename*=UTF-8''Einkommensteuererkl%C3%A4rung.pdf");
    expect(header).not.toContain("\r");
    expect(header).not.toContain("\n");
  });
});
