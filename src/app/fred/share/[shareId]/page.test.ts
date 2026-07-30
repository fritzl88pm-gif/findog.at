import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);
const notFoundSource = readFileSync(
  fileURLToPath(new URL("./not-found.tsx", import.meta.url)),
  "utf8",
);
const helpersSource = readFileSync(
  fileURLToPath(new URL("../../../../lib/fred-public-share.ts", import.meta.url)),
  "utf8",
);
const layoutSource = readFileSync(
  fileURLToPath(new URL("../../../layout.tsx", import.meta.url)),
  "utf8",
);

describe("Fred public share page", () => {
  it("is dynamic and never statically cached", () => {
    expect(pageSource).toContain('export const dynamic = "force-dynamic"');
    expect(pageSource).toContain("export const revalidate = 0");
  });

  it("renders only Anfrage and Freds Antwort sections", () => {
    expect(pageSource).toContain("Anfrage");
    expect(pageSource).toContain("Freds Antwort");
    expect(pageSource).toContain('id="shared-question-heading"');
    expect(pageSource).toContain('id="shared-answer-heading"');
  });

  it("renders question_content directly as a React text child with no manual escape", () => {
    expect(pageSource).toContain("{share.question_content}");
    // No escapeHtml function or manual escaping
    expect(pageSource).not.toContain("escapeHtml");
    expect(pageSource).not.toContain("dangerouslySetInnerHTML");
    expect(pageSource).not.toContain("replace(/&/gu");
    expect(pageSource).not.toContain("replace(/</gu");
    expect(pageSource).not.toContain("replace(/>/gu");
  });

  it("calls notFound() when the loader throws (all missing/malformed/deleted cases)", () => {
    expect(pageSource).toContain("notFound()");
    expect(pageSource).toContain('import { notFound } from "next/navigation"');
    // The catch covers all loader errors including UserVisibleError
    expect(pageSource).toMatch(/catch\s*\{[\s\S]*?notFound\(\)/);
  });

  it("transforms stored answer with transformWeKnoraAnswer before rendering", () => {
    expect(pageSource).toContain("transformWeKnoraAnswer(share.answer_content)");
  });

  it("disables table copy actions in the public rendering", () => {
    expect(pageSource).toContain("showTableCopyActions={false}");
  });

  it("sets generic metadata with noindex, nofollow, noarchive", () => {
    expect(pageSource).toContain('title: "Geteilte Fred-Antwort"');
    expect(pageSource).toContain("index: false");
    expect(pageSource).toContain("follow: false");
    // noarchive via other.archive
    expect(pageSource).toContain("noarchive: true");
  });

  it("has no question/answer excerpt in metadata description", () => {
    expect(pageSource).toMatch(/description:\s*"Geteilte Fred-Antwort"/);
  });

  it("excludes sidebar, app navigation, composer, and identity elements", () => {
    expect(pageSource).not.toContain("FredNativeChatView");
    expect(pageSource).not.toContain("conversation-list");
    expect(pageSource).not.toContain("composer");
    expect(pageSource).not.toContain("sidebar");
  });

  it("not-found page shows the generic unavailable message", () => {
    expect(notFoundSource).toContain(
      "Diese geteilte Fred-Antwort ist nicht mehr verfügbar.",
    );
    expect(notFoundSource).toContain('export const dynamic = "force-dynamic"');
  });

  it("not-found page is also dynamic and noindex", () => {
    expect(notFoundSource).toContain("index: false");
    expect(notFoundSource).toContain("follow: false");
  });

  it("root layout has no sidebar and can host a standalone route", () => {
    expect(layoutSource).not.toContain("sidebar");
    expect(layoutSource).not.toContain("Sidebar");
    expect(layoutSource).not.toContain("AppShell");
    expect(layoutSource).toContain("<body>{children}</body>");
  });

  it("validates UUID strictly in the loader", () => {
    expect(helpersSource).toContain("FRED_PUBLIC_SHARE_UUID_PATTERN");
    expect(helpersSource).toContain("validateShareId");
  });

  it("selects only question_content and answer_content from the share row", () => {
    expect(helpersSource).toContain('select("question_content,answer_content")');
  });

  it("returns the expected unavailable message for missing/deleted IDs", () => {
    expect(helpersSource).toContain("Diese geteilte Fred-Antwort ist nicht mehr verfügbar.");
  });
});
