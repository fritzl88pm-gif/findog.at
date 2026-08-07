import { describe, expect, it } from "vitest";

import {
  normalizeTitle,
  normalizePromptText,
  validatePostBody,
  validatePutBody,
  generateProfileId,
} from "./personality-profiles";

// ── normalizeTitle ────────────────────────────────────────────────────────

describe("normalizeTitle", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeTitle("  Hello   World  ")).toBe("Hello World");
  });

  it("returns null for empty string", () => {
    expect(normalizeTitle("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(normalizeTitle("   \t  \n  ")).toBeNull();
  });

  it("returns null for string exceeding 80 Unicode code points", () => {
    expect(normalizeTitle("x".repeat(81))).toBeNull();
  });

  it("accepts exactly 80 code points", () => {
    const t = "x".repeat(80);
    expect(normalizeTitle(t)).toBe(t);
  });

  it("rejects control characters (U+0000–U+001F, U+007F–U+009F)", () => {
    expect(normalizeTitle("Hello\u0000World")).toBeNull();
    expect(normalizeTitle("Hello\u001FWorld")).toBeNull();
    expect(normalizeTitle("Hello\u007FWorld")).toBeNull();
    expect(normalizeTitle("Hello\u009FWorld")).toBeNull();
    // Tab and newline are also in the control range — they are rejected
    expect(normalizeTitle("Hello\tWorld")).toBeNull();
    expect(normalizeTitle("Hello\nWorld")).toBeNull();
  });

  it("rejects control characters even at leading/trailing edges before trim", () => {
    // Tab at start/end — must be rejected (control char), not stripped by trim
    expect(normalizeTitle("\tHello")).toBeNull();
    expect(normalizeTitle("Hello\t")).toBeNull();
    expect(normalizeTitle("\t")).toBeNull();
    // Newline at edges
    expect(normalizeTitle("\nHello")).toBeNull();
    expect(normalizeTitle("Hello\n")).toBeNull();
    // CR at edges
    expect(normalizeTitle("\rHello")).toBeNull();
    expect(normalizeTitle("Hello\r")).toBeNull();
  });

  it("handles Unicode (astral plane, combining marks)", () => {
    // "🎉" is 1 code point
    expect(normalizeTitle("Party 🎉")).toBe("Party 🎉");
    // É with combining acute — 2 code points
    expect(normalizeTitle("Zo\u0301e")).toBe("Zo\u0301e");
    // 80 astral characters should be fine
    const astral = "🎉".repeat(80);
    expect(normalizeTitle(astral)).toBe(astral);
  });

  it("accepts a single-character title", () => {
    expect(normalizeTitle("A")).toBe("A");
  });

  it("accepts German umlauts and ß", () => {
    expect(normalizeTitle("Übermäßig freundlich")).toBe("Übermäßig freundlich");
  });

  it("collapses consecutive ordinary Unicode whitespace within the title", () => {
    expect(normalizeTitle("Hello    World")).toBe("Hello World");
  });
});

// ── normalizePromptText ────────────────────────────────────────────────────

describe("normalizePromptText", () => {
  it("trims outer whitespace", () => {
    expect(normalizePromptText("  hello  ")).toBe("hello");
  });

  it("normalizes CRLF to LF", () => {
    expect(normalizePromptText("line1\r\nline2")).toBe("line1\nline2");
  });

  it("normalizes bare CR to LF", () => {
    expect(normalizePromptText("line1\rline2")).toBe("line1\nline2");
  });

  it("returns empty string for empty input", () => {
    expect(normalizePromptText("")).toBe("");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(normalizePromptText("   \t  \n  ")).toBe("");
  });

  it("rejects NUL character (U+0000)", () => {
    expect(normalizePromptText("Hello\u0000World")).toBeNull();
  });

  it("rejects disallowed control characters (U+0001–U+0008, U+000B–U+000C, U+000E–U+001F, U+007F–U+009F)", () => {
    expect(normalizePromptText("Hello\u0001World")).toBeNull();
    expect(normalizePromptText("Hello\u0008World")).toBeNull();
    expect(normalizePromptText("Hello\u000BWorld")).toBeNull();
    expect(normalizePromptText("Hello\u001FWorld")).toBeNull();
    expect(normalizePromptText("Hello\u007FWorld")).toBeNull();
    expect(normalizePromptText("Hello\u009FWorld")).toBeNull();
  });

  it("rejects disallowed controls even at outer edges before trim", () => {
    // DEL (U+007F) at edges must be rejected, not stripped by trim
    expect(normalizePromptText("\u007Fhello")).toBeNull();
    expect(normalizePromptText("hello\u007F")).toBeNull();
    // Form feed (U+000C) at edges
    expect(normalizePromptText("\u000Chello")).toBeNull();
    expect(normalizePromptText("hello\u000C")).toBeNull();
  });

  it("allows newline (U+000A) and tab (U+0009)", () => {
    expect(normalizePromptText("Hello\nWorld")).toBe("Hello\nWorld");
    expect(normalizePromptText("Hello\tWorld")).toBe("Hello\tWorld");
  });

  it("allows newline and tab at outer edges (trim strips them, they are allowed)", () => {
    expect(normalizePromptText("\n  line1\nline2  \n")).toBe("line1\nline2");
    expect(normalizePromptText("\t  hello  \t")).toBe("hello");
  });

  it("rejects strings exceeding 4000 Unicode code points", () => {
    expect(normalizePromptText("x".repeat(4001))).toBeNull();
  });

  it("accepts exactly 4000 code points", () => {
    const p = "x".repeat(4000);
    expect(normalizePromptText(p)).toBe(p);
  });

  it("preserves internal newlines while trimming outer", () => {
    expect(normalizePromptText("  \n  line1\nline2  \n  ")).toBe("line1\nline2");
  });

  it("handles Unicode multi-byte characters correctly", () => {
    // Each 🎉 is 1 code point
    const p = "🎉".repeat(4000);
    expect(normalizePromptText(p)).toBe(p);
  });
});

// ── validatePostBody ───────────────────────────────────────────────────────

describe("validatePostBody", () => {
  it("accepts a valid {title, promptText} body", () => {
    const result = validatePostBody({ title: "My Style", promptText: "Be nice" });
    expect(result).toEqual({ title: "My Style", promptText: "Be nice" });
  });

  it("accepts empty promptText string", () => {
    const result = validatePostBody({ title: "Minimal", promptText: "" });
    expect(result).toEqual({ title: "Minimal", promptText: "" });
  });

  it("rejects missing promptText", () => {
    expect(() => validatePostBody({ title: "Minimal" })).toThrow("Ungültiger Request-Body.");
  });

  it("rejects missing title", () => {
    expect(() => validatePostBody({ promptText: "Be nice" })).toThrow("Ungültiger Request-Body.");
  });

  it("rejects unknown extra keys", () => {
    expect(() => validatePostBody({ title: "X", promptText: "Y", id: "hacker" })).toThrow(
      "Ungültiger Request-Body.",
    );
  });

  it("rejects non-object body", () => {
    expect(() => validatePostBody(null)).toThrow("Ungültiger Request-Body.");
    expect(() => validatePostBody("string")).toThrow("Ungültiger Request-Body.");
    expect(() => validatePostBody([])).toThrow("Ungültiger Request-Body.");
  });

  it("rejects non-string title", () => {
    expect(() => validatePostBody({ title: 123, promptText: "Y" })).toThrow("Ungültiger Request-Body.");
  });

  it("rejects non-string promptText", () => {
    expect(() => validatePostBody({ title: "X", promptText: 123 })).toThrow("Ungültiger Request-Body.");
  });
});

// ── validatePutBody ────────────────────────────────────────────────────────

describe("validatePutBody", () => {
  it("accepts a valid {id, title, promptText} body", () => {
    const result = validatePutBody({ id: "abc-123", title: "Updated", promptText: "Be nice" });
    expect(result).toEqual({ id: "abc-123", title: "Updated", promptText: "Be nice" });
  });

  it("accepts empty promptText string", () => {
    const result = validatePutBody({ id: "abc-123", title: "Updated", promptText: "" });
    expect(result).toEqual({ id: "abc-123", title: "Updated", promptText: "" });
  });

  it("rejects missing promptText", () => {
    expect(() => validatePutBody({ id: "abc", title: "X" })).toThrow("Ungültiger Request-Body.");
  });

  it("rejects missing id", () => {
    expect(() => validatePutBody({ title: "X", promptText: "Y" })).toThrow("Ungültiger Request-Body.");
  });

  it("rejects missing title", () => {
    expect(() => validatePutBody({ id: "abc", promptText: "Y" })).toThrow("Ungültiger Request-Body.");
  });

  it("rejects unknown extra keys", () => {
    expect(() =>
      validatePutBody({ id: "abc", title: "X", promptText: "Y", extra: true }),
    ).toThrow("Ungültiger Request-Body.");
  });

  it("rejects non-object body", () => {
    expect(() => validatePutBody(null)).toThrow("Ungültiger Request-Body.");
    expect(() => validatePutBody([])).toThrow("Ungültiger Request-Body.");
  });

  it("rejects non-string id", () => {
    expect(() => validatePutBody({ id: 123, title: "X", promptText: "" })).toThrow("Ungültiger Request-Body.");
  });

  it("rejects non-string title", () => {
    expect(() => validatePutBody({ id: "abc", title: 123, promptText: "" })).toThrow("Ungültiger Request-Body.");
  });

  it("rejects non-string promptText", () => {
    expect(() => validatePutBody({ id: "abc", title: "X", promptText: 123 })).toThrow(
      "Ungültiger Request-Body.",
    );
  });
});

// ── generateProfileId ──────────────────────────────────────────────────────

describe("generateProfileId", () => {
  it("generates a valid UUID string", () => {
    const id = generateProfileId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("generates unique IDs on successive calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateProfileId()));
    expect(ids.size).toBe(100);
  });
});
