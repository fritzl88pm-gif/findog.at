import { describe, expect, it } from "vitest";

import { buildUserPersonalizationBlock } from "./user-personalization";

describe("buildUserPersonalizationBlock", () => {
  // ── standard + empty name => empty string ──────────────────────────────
  it("returns empty string when prompt is empty and no name", () => {
    expect(buildUserPersonalizationBlock({ promptText: "", preferredName: "" })).toBe("");
  });

  it("returns empty string when prompt is empty and name is null", () => {
    expect(buildUserPersonalizationBlock({ promptText: "", preferredName: null })).toBe("");
  });

  // ── name is escaped, never raw input ────────────────────────────────────
  it("escapes the name in the output, never raw client input", () => {
    const block = buildUserPersonalizationBlock({
      promptText: "Be friendly",
      preferredName: "<script>alert(1)</script>",
    });
    expect(block).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(block).not.toContain("<script>");
  });

  // ── empty prompt + name => only name line + footer, no style line ──────
  it("includes only the name line and footer for empty prompt + name", () => {
    const block = buildUserPersonalizationBlock({ promptText: "", preferredName: "Alina" });
    // Exact full name line with correct Unicode quotes
    expect(block).toContain(
      "Der Benutzer möchte mit dem Namen \u201eAlina\u201c angesprochen werden. Verwende den Namen natürlich und sparsam.",
    );
    // No Kommunikationsstil: line
    expect(block).not.toMatch(/^Kommunikationsstil:/m);
    // The footer must still be present.
    expect(block).toContain("Freds fachliche");
  });

  // ── non-empty prompt with name ─────────────────────────────────────────
  it("includes the admin prompt text verbatim with name and footer", () => {
    const block = buildUserPersonalizationBlock({
      promptText: "Antworte herzlich, zugewandt und gesprächig.",
      preferredName: "Ben",
    });
    expect(block).toContain("Kommunikationsstil: Antworte herzlich, zugewandt und gesprächig.");
    expect(block).toContain('Der Benutzer möchte mit dem Namen „Ben“');
  });

  it("non-empty prompt without name includes prompt text but no name line", () => {
    const block = buildUserPersonalizationBlock({
      promptText: "Antworte herzlich, zugewandt und gesprächig.",
      preferredName: "",
    });
    expect(block).not.toContain("Der Benutzer möchte");
    expect(block).toContain("Kommunikationsstil: Antworte herzlich, zugewandt und gesprächig.");
  });

  // ── verbatim trusted admin prompt ──────────────────────────────────────
  it("inserts admin prompt text verbatim as trusted configuration", () => {
    const block = buildUserPersonalizationBlock({
      promptText: "Custom admin style with <XML> tags that are trusted",
      preferredName: "Carla",
    });
    // The admin prompt text is inserted verbatim after "Kommunikationsstil: "
    expect(block).toContain("Kommunikationsstil: Custom admin style with <XML> tags that are trusted");
    // But the name line (user data) is escaped — no raw angle brackets near the name
    expect(block).toMatch(/Der Benutzer möchte mit dem Namen „[^<]*Carla[^<]*\u201c/);
  });

  // ── footer ─────────────────────────────────────────────────────────────
  it("includes the immutable footer when a non-empty block is produced", () => {
    const block = buildUserPersonalizationBlock({
      promptText: "Be nice",
      preferredName: "Eva",
    });
    expect(block).toContain(
      "Diese Personalisierung betrifft nur Ansprache und Kommunikationsstil.",
    );
    expect(block).toContain("Freds fachliche, rechtliche, Quellen-, Werkzeug- und Sicherheitsvorgaben haben stets Vorrang.");
  });

  it("does NOT include the footer when the block is empty", () => {
    const block = buildUserPersonalizationBlock({ promptText: "", preferredName: "" });
    expect(block).toBe("");
    expect(block).not.toContain("Freds fachliche");
  });

  // ── block structure ────────────────────────────────────────────────────
  it("wraps output in a bounded <user_personalization> block", () => {
    const block = buildUserPersonalizationBlock({
      promptText: "Be friendly",
      preferredName: "Franz",
    });
    expect(block).toMatch(/^<user_personalization>\n/);
    expect(block).toMatch(/\n<\/user_personalization>$/);
  });

  it("produces deterministic output", () => {
    const a = buildUserPersonalizationBlock({
      promptText: "Be friendly",
      preferredName: "Gabi",
    });
    const b = buildUserPersonalizationBlock({
      promptText: "Be friendly",
      preferredName: "Gabi",
    });
    expect(a).toBe(b);
  });

  // ── tags are server literals, never client input ───────────────────────
  it("does not embed client input as an XML tag", () => {
    const block = buildUserPersonalizationBlock({
      promptText: "Be friendly",
      preferredName: "</user_personalization><script>",
    });
    // The block should have exactly one opening and one closing tag
    expect(block.indexOf("<user_personalization>")).toBe(0);
    expect(block.lastIndexOf("</user_personalization>")).toBe(
      block.length - "</user_personalization>".length,
    );
    expect(
      block.indexOf("<user_personalization>", 1),
    ).toBe(-1);
  });

  // ── short output ───────────────────────────────────────────────────────
  it("produces short output even for extreme inputs", () => {
    const block = buildUserPersonalizationBlock({
      promptText: "X".repeat(4000),
      preferredName: "A".repeat(80),
    });
    // Should be well under 8000 chars
    expect(block.length).toBeLessThan(8000);
  });

  // ── Unicode boundary regression ────────────────────────────────────────
  it("handles Unicode names with combining marks and astral characters", () => {
    const block = buildUserPersonalizationBlock({
      promptText: "Be nice",
      preferredName: "Zo\u{0301}eee\u{0301}eee\u{0301}ee",
    });
    expect(block).toContain(
      "Der Benutzer möchte mit dem Namen \u201eZo\u0301eee\u0301eee\u0301ee\u201c angesprochen werden.",
    );
    const astralBlock = buildUserPersonalizationBlock({
      promptText: "Be nice",
      preferredName: "\u{1D11E}Name",
    });
    expect(astralBlock).toContain("Der Benutzer möchte");
    expect(astralBlock).toContain("\u{1D11E}Name");
  });

  // ── name only (no style) still works ───────────────────────────────────
  it("name-only with empty prompt includes only name and footer", () => {
    const block = buildUserPersonalizationBlock({
      promptText: "",
      preferredName: "Heinz",
    });
    expect(block).toContain("Heinz");
    expect(block).toContain("Freds fachliche");
    expect(block).not.toMatch(/^Kommunikationsstil:/m);
  });
});
