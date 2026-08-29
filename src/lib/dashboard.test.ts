import { describe, expect, it } from "vitest";

import {
  assertDashboardNewsStatusTransition,
  formatDashboardDate,
  getDashboardGreeting,
  parseDashboardNewsInput,
  type DashboardNewsInput,
} from "./dashboard";

function productInput(overrides: Partial<DashboardNewsInput> = {}): DashboardNewsInput {
  return {
    kind: "product",
    title: "Neue Funktion",
    summary: "Ein administrativ gepflegter Hinweis.",
    status: "draft",
    pinned: false,
    publishedAt: null,
    sourceSystem: null,
    documentKind: null,
    sourceIdentifier: null,
    sourceUrl: null,
    documentDate: null,
    asOfDate: null,
    ...overrides,
  };
}

function legalInput(overrides: Partial<DashboardNewsInput> = {}): DashboardNewsInput {
  return {
    kind: "legal",
    title: "Redaktionelle Rechtsmeldung",
    summary: "Klartext ohne automatisch abgeleitete Rechtsfolge.",
    status: "published",
    pinned: true,
    publishedAt: "2026-08-29T12:00:00.000Z",
    sourceSystem: "ris",
    documentKind: "rechtssatz",
    sourceIdentifier: "RV/7100001/2026",
    sourceUrl: "https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=Gesamtabfrage&Dokumentnummer=TEST",
    documentDate: "2026-08-01",
    asOfDate: "2026-08-29",
    ...overrides,
  };
}

describe("dashboard Vienna greeting", () => {
  it.each([
    ["2026-01-15T04:00:00.000Z", "Guten Morgen"],
    ["2026-01-15T10:00:00.000Z", "Guten Tag"],
    ["2026-01-15T17:00:00.000Z", "Guten Abend"],
    ["2026-01-15T21:00:00.000Z", "Willkommen"],
    ["2026-07-15T03:00:00.000Z", "Guten Morgen"],
  ])("uses Europe/Vienna for %s", (timestamp, expected) => {
    expect(getDashboardGreeting(new Date(timestamp))).toBe(expected);
  });

  it("formats the displayed date in Vienna", () => {
    expect(formatDashboardDate(new Date("2026-08-29T22:30:00.000Z"))).toBe("Sonntag, 30. August 2026");
  });
});

describe("dashboard news validation", () => {
  it("accepts strict product and RIS/EVI legal news", () => {
    expect(parseDashboardNewsInput(productInput())).toEqual(productInput());
    expect(parseDashboardNewsInput(legalInput())).toMatchObject({
      kind: "legal",
      sourceSystem: "ris",
      asOfDate: "2026-08-29",
    });
    expect(parseDashboardNewsInput(legalInput({
      sourceSystem: "evi",
      sourceUrl: "https://evi.gv.at/b/pi/bvbnw-abc",
      documentKind: "entscheidungsdokument",
    }))).toMatchObject({ sourceSystem: "evi" });
  });

  it("requires every legal source field including the explicit Stichtag", () => {
    expect(() => parseDashboardNewsInput(legalInput({ asOfDate: null }))).toThrow(/Stichtag/u);
    expect(() => parseDashboardNewsInput(legalInput({ documentDate: null }))).toThrow(/Rechtsmeldungen benötigen/u);
    expect(() => parseDashboardNewsInput(legalInput({ sourceIdentifier: null }))).toThrow(/Rechtsmeldungen benötigen/u);
  });

  it.each([
    "http://www.ris.bka.gv.at/Dokument.wxe",
    "https://ris.bka.gv.at.evil.example/Dokument.wxe",
    "https://www.evi.gv.at/ris-falsches-system",
    "https://www.ris.bka.gv.at:8443/Dokument.wxe",
  ])("rejects non-allowlisted legal URL %s", (sourceUrl) => {
    expect(() => parseDashboardNewsInput(legalInput({ sourceUrl }))).toThrow(/RIS- oder EVI-HTTPS-Host/u);
  });

  it("prevents legal fields on product news and invalid calendar dates", () => {
    expect(() => parseDashboardNewsInput(productInput({ sourceSystem: "ris" }))).toThrow(/Produktmeldungen/u);
    expect(() => parseDashboardNewsInput(legalInput({ asOfDate: "2026-02-30" }))).toThrow(/gültiges Datum/u);
  });

  it("requires publication timestamps exactly for published and archived items", () => {
    expect(() => parseDashboardNewsInput(productInput({ status: "published" }))).toThrow(/Veröffentlichungszeitpunkt/u);
    expect(() => parseDashboardNewsInput(productInput({ publishedAt: "2026-08-29T12:00:00Z" }))).toThrow(/Entwürfe/u);
  });
});

describe("dashboard news status transitions", () => {
  it("allows draft publication, publication archival and archived republication", () => {
    expect(() => assertDashboardNewsStatusTransition(null, "draft")).not.toThrow();
    expect(() => assertDashboardNewsStatusTransition("draft", "published")).not.toThrow();
    expect(() => assertDashboardNewsStatusTransition("published", "archived")).not.toThrow();
    expect(() => assertDashboardNewsStatusTransition("archived", "published")).not.toThrow();
  });

  it("rejects skipped or backwards transitions", () => {
    expect(() => assertDashboardNewsStatusTransition(null, "archived")).toThrow(/nicht direkt archiviert/u);
    expect(() => assertDashboardNewsStatusTransition("draft", "archived")).toThrow(/nicht zulässig/u);
    expect(() => assertDashboardNewsStatusTransition("published", "draft")).toThrow(/nicht zulässig/u);
  });
});
