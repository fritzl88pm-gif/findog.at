import { describe, expect, it } from "vitest";

import { buildUserPersonalizationBlock } from "./user-personalization";

describe("buildUserPersonalizationBlock", () => {
  // ── standard + empty name => empty string ──────────────────────────────
  it("returns empty string for standard personality with no name", () => {
    expect(buildUserPersonalizationBlock({ personality: "standard", preferredName: "" })).toBe("");
  });

  it("returns empty string for standard personality with null name", () => {
    expect(buildUserPersonalizationBlock({ personality: "standard", preferredName: null })).toBe("");
  });

  // ── name is escaped, never raw input ────────────────────────────────────
  it("escapes the name in the output, never raw client input", () => {
    const block = buildUserPersonalizationBlock({
      personality: "friendly",
      preferredName: "<script>alert(1)</script>",
    });
    expect(block).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(block).not.toContain("<script>");
  });

  // ── standard + name => only name line, no style line ────────────────────
  it("includes only the name line and precedence for standard + name, never a Kommunikationsstil: style line", () => {
    const block = buildUserPersonalizationBlock({ personality: "standard", preferredName: "Alina" });
    // Exact full name line with correct Unicode quotes
    expect(block).toContain(
      "Der Benutzer möchte mit dem Namen \u201eAlina\u201c angesprochen werden. Verwende den Namen natürlich und sparsam.",
    );
    // The precedence line also mentions "Kommunikationsstil" without a colon,
    // but style lines always start with "Kommunikationsstil:".
    expect(block).not.toMatch(/^Kommunikationsstil:/m);
    // The precedence must still be present.
    expect(block).toContain("Freds fachliche");
  });

  // ── friendly ───────────────────────────────────────────────────────────
  it("includes the friendly style text after the name line", () => {
    const block = buildUserPersonalizationBlock({ personality: "friendly", preferredName: "Ben" });
    expect(block).toContain("Kommunikationsstil: Antworte herzlich, zugewandt und gesprächig.");
  });

  it("friendly without name includes style text but no name line", () => {
    const block = buildUserPersonalizationBlock({ personality: "friendly", preferredName: "" });
    expect(block).not.toContain("Der Benutzer möchte");
    expect(block).toContain("Kommunikationsstil: Antworte herzlich, zugewandt und gesprächig.");
  });

  // ── efficient ──────────────────────────────────────────────────────────
  it("includes the efficient style text after the name line", () => {
    const block = buildUserPersonalizationBlock({ personality: "efficient", preferredName: "Carla" });
    expect(block).toContain("Kommunikationsstil: Antworte prägnant, direkt und klar.");
  });

  it("efficient without name includes style text but no name line", () => {
    const block = buildUserPersonalizationBlock({ personality: "efficient", preferredName: "" });
    expect(block).not.toContain("Der Benutzer möchte");
    expect(block).toContain("Kommunikationsstil: Antworte prägnant, direkt und klar.");
  });

  // ── cynical ────────────────────────────────────────────────────────────
  it("includes the cynical style text after the name line", () => {
    const block = buildUserPersonalizationBlock({ personality: "cynical", preferredName: "Dirk" });
    expect(block).toContain("Kommunikationsstil: Antworte kritisch, trocken und sarkastisch.");
  });

  // ── precedence line ────────────────────────────────────────────────────
  it("includes the precedence line when a non-empty block is produced", () => {
    const block = buildUserPersonalizationBlock({ personality: "friendly", preferredName: "Eva" });
    expect(block).toContain(
      "Diese Personalisierung betrifft nur Ansprache und Kommunikationsstil.",
    );
  });

  it("does NOT include the precedence line when the block is empty", () => {
    const block = buildUserPersonalizationBlock({ personality: "standard", preferredName: "" });
    expect(block).toBe("");
    expect(block).not.toContain("Freds fachliche");
  });

  // ── block structure ────────────────────────────────────────────────────
  it("wraps output in a bounded <user_personalization> block", () => {
    const block = buildUserPersonalizationBlock({ personality: "friendly", preferredName: "Franz" });
    expect(block).toMatch(/^<user_personalization>\n/);
    expect(block).toMatch(/\n<\/user_personalization>$/);
  });

  it("produces deterministic output", () => {
    const a = buildUserPersonalizationBlock({ personality: "friendly", preferredName: "Gabi" });
    const b = buildUserPersonalizationBlock({ personality: "friendly", preferredName: "Gabi" });
    expect(a).toBe(b);
  });

  // ── tags are server literals, never client input ───────────────────────
  it("does not embed client input as an XML tag", () => {
    const block = buildUserPersonalizationBlock({
      personality: "friendly",
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
      personality: "friendly",
      preferredName: "A".repeat(80),
    });
    // Should be well under 2000 chars
    expect(block.length).toBeLessThan(2000);
  });

  // ── Unicode boundary regression ────────────────────────────────────────
  it("handles Unicode names with combining marks and astral characters", () => {
    // É with combining acute accent put on a separate codepoint
    const block = buildUserPersonalizationBlock({
      personality: "friendly",
      preferredName: "Zo\u{0301}eee\u{0301}eee\u{0301}ee",
    });
    expect(block).toContain(
      "Der Benutzer möchte mit dem Namen \u201eZo\u0301eee\u0301eee\u0301ee\u201c angesprochen werden.",
    );
    // Astral script character (musical symbol, U+1D11E) — one code point, two UTF-16 code units
    const astralBlock = buildUserPersonalizationBlock({
      personality: "friendly",
      preferredName: "\u{1D11E}Name",
    });
    expect(astralBlock).toContain("Der Benutzer möchte");
    expect(astralBlock).toContain("\u{1D11E}Name");
  });
});
