import { describe, expect, it } from "vitest";
import {
  TOOL_RESULT_CONTEXT_CHAR_LIMIT,
  TOOL_LOG_SYNTHESIS_CHAR_BUDGET,
  TOOL_LOG_MIN_ENTRY_CHARS,
  TOOL_LOOP_CONTEXT_CHAR_BUDGET,
  truncateToolResultForContext,
  applyToolLogBudget,
  applyToolLoopContextBudget,
} from "./agent-context-budget";

describe("context budget constants", () => {
  it("TOOL_RESULT_CONTEXT_CHAR_LIMIT is 12_000", () => {
    expect(TOOL_RESULT_CONTEXT_CHAR_LIMIT).toBe(12_000);
  });

  it("TOOL_LOG_SYNTHESIS_CHAR_BUDGET is 60_000", () => {
    expect(TOOL_LOG_SYNTHESIS_CHAR_BUDGET).toBe(60_000);
  });

  it("TOOL_LOG_MIN_ENTRY_CHARS is 400", () => {
    expect(TOOL_LOG_MIN_ENTRY_CHARS).toBe(400);
  });

  it("TOOL_LOOP_CONTEXT_CHAR_BUDGET is 60_000", () => {
    expect(TOOL_LOOP_CONTEXT_CHAR_BUDGET).toBe(60_000);
  });
});

describe("truncateToolResultForContext", () => {
  const suffix =
    "\n… [gekürzt – vollständige Fundstelle in der gespeicherten Evidenz]";

  it("returns text as-is when within limit", () => {
    const text = "a".repeat(TOOL_RESULT_CONTEXT_CHAR_LIMIT);
    expect(truncateToolResultForContext(text)).toBe(text);
  });

  it("returns short text as-is", () => {
    const text = "Kurzer Text";
    expect(truncateToolResultForContext(text)).toBe(text);
  });

  it("appends suffix and truncates prefix when one char over limit", () => {
    const text = "a".repeat(TOOL_RESULT_CONTEXT_CHAR_LIMIT + 1);
    const result = truncateToolResultForContext(text);
    expect(result.length).toBe(TOOL_RESULT_CONTEXT_CHAR_LIMIT);
    expect(result.endsWith(suffix)).toBe(true);
    expect(result).toBe(
      "a".repeat(TOOL_RESULT_CONTEXT_CHAR_LIMIT - suffix.length) + suffix,
    );
  });

  it("does not split a UTF-16 surrogate pair", () => {
    const emoji = "😀";
    const prefixLen = TOOL_RESULT_CONTEXT_CHAR_LIMIT - suffix.length;
    const baseLen = prefixLen - 1;
    // Text where cut point falls in middle of surrogate pair
    const text = "a".repeat(baseLen) + emoji + "x".repeat(70);
    const result = truncateToolResultForContext(text);
    expect(result.endsWith(suffix)).toBe(true);
    // The surrogate pair was not split → both code units removed
    expect(result).toBe("a".repeat(baseLen) + suffix);
  });

  it("correctly truncates at surrogate pair boundary", () => {
    const prefixLen = TOOL_RESULT_CONTEXT_CHAR_LIMIT - suffix.length;
    const baseLen = prefixLen - 1;
    const emoji = "😀";
    const text = "a".repeat(baseLen) + emoji + "x".repeat(70);
    const result = truncateToolResultForContext(text);
    expect(result.length).toBe(baseLen + suffix.length);
    expect(result.endsWith(suffix)).toBe(true);
    expect(result).toBe("a".repeat(baseLen) + suffix);
  });

  it("preserves text under limit unchanged", () => {
    const text = "Kurzes Ergebnis.";
    expect(truncateToolResultForContext(text)).toBe(text);
  });

  it("produces exactly limit-length string when truncating", () => {
    const text = "x".repeat(TOOL_RESULT_CONTEXT_CHAR_LIMIT * 2);
    const result = truncateToolResultForContext(text);
    expect(result.length).toBe(TOOL_RESULT_CONTEXT_CHAR_LIMIT);
  });
});

describe("applyToolLogBudget", () => {
  it("returns empty array for empty input", () => {
    expect(applyToolLogBudget([])).toEqual([]);
  });

  it("returns non-mutated copies when within budget", () => {
    const entries = [
      { result: "a".repeat(100), success: true },
      { result: "b".repeat(200), success: false },
    ];
    const result = applyToolLogBudget(entries);
    expect(result).toEqual(entries);
    expect(result).not.toBe(entries);
    expect(result[0]).not.toBe(entries[0]);
  });

  it("does not mutate the original entries", () => {
    const entries: Array<{ result: string; success: boolean }> = [
      { result: "a".repeat(1000), success: true },
    ];
    const originalResult = entries[0].result;
    applyToolLogBudget(entries);
    expect(entries[0].result).toBe(originalResult);
  });

  it("shrinks failed entries oldest-first when over budget", () => {
    const failedOldest = "f".repeat(30_000);
    const failedNewer = "g".repeat(20_000);
    const successful = "s".repeat(20_000);
    const entries = [
      { result: failedOldest, success: false },
      { result: failedNewer, success: false },
      { result: successful, success: true },
    ];
    const result = applyToolLogBudget(entries);
    const totalChars = result.reduce((sum, e) => sum + e.result.length, 0);
    expect(totalChars).toBe(TOOL_LOG_SYNTHESIS_CHAR_BUDGET);
    expect(result[0].result.length).toBe(20_000);
    expect(result[1].result).toBe(failedNewer);
    expect(result[2].result).toBe(successful);
  });

  it("finishes failed entries before reducing successful entries", () => {
    const entries = [
      { result: "s".repeat(30_000), success: true },
      { result: "f".repeat(10_000), success: false },
      { result: "t".repeat(30_000), success: true },
    ];

    const result = applyToolLogBudget(entries);

    expect(result[0].result.length).toBe(29_600);
    expect(result[1].result.length).toBe(TOOL_LOG_MIN_ENTRY_CHARS);
    expect(result[2].result).toBe(entries[2].result);
  });

  it("keeps a truncation marker and valid Unicode when a partial reduction is enough", () => {
    const suffix =
      "\n… [gekürzt – vollständige Fundstelle in der gespeicherten Evidenz]";
    const entries = [
      {
        result: "a".repeat(50_000) + "😀" + "b".repeat(10_000),
        success: false,
      },
      { result: "c".repeat(1_000), success: true },
    ];

    const result = applyToolLogBudget(entries);

    expect(result[0].result.endsWith(suffix)).toBe(true);
    expect(result[0].result).not.toContain("\ud800");
    expect(
      result.reduce((sum, entry) => sum + entry.result.length, 0),
    ).toBeLessThanOrEqual(TOOL_LOG_SYNTHESIS_CHAR_BUDGET);
  });

  it("dynamically lowers floor when count * 400 > budget", () => {
    const count = 200;
    const entries = Array.from({ length: count }, (_, i) => ({
      result: "x".repeat(TOOL_LOG_MIN_ENTRY_CHARS),
      success: i % 2 === 0,
    }));
    const result = applyToolLogBudget(entries);
    expect(result.length).toBe(count);
    const totalChars = result.reduce((sum, e) => sum + e.result.length, 0);
    expect(totalChars).toBeLessThanOrEqual(TOOL_LOG_SYNTHESIS_CHAR_BUDGET);
    const effectiveFloor = Math.floor(TOOL_LOG_SYNTHESIS_CHAR_BUDGET / count);
    for (const entry of result) {
      expect(entry.result.length).toBeLessThanOrEqual(effectiveFloor);
    }
  });

  it("maintains entry order after budget application", () => {
    const entries = [
      { result: "a".repeat(TOOL_LOG_SYNTHESIS_CHAR_BUDGET), success: true },
      { result: "b".repeat(TOOL_LOG_SYNTHESIS_CHAR_BUDGET), success: false },
      { result: "c".repeat(TOOL_LOG_SYNTHESIS_CHAR_BUDGET), success: true },
    ];
    const result = applyToolLogBudget(entries);
    expect(result[0].result.startsWith("a")).toBe(true);
    expect(result[1].result.startsWith("b")).toBe(true);
    expect(result[2].result.startsWith("c")).toBe(true);
  });

  it("preserves all entries (no removal)", () => {
    const entries = Array.from({ length: 151 }, (_, i) => ({
      result: "x".repeat(1000),
      success: i % 3 === 0,
    }));
    const result = applyToolLogBudget(entries);
    expect(result.length).toBe(151);
    const totalChars = result.reduce((sum, e) => sum + e.result.length, 0);
    expect(totalChars).toBeLessThanOrEqual(TOOL_LOG_SYNTHESIS_CHAR_BUDGET);
  });

  it("does nothing when entries are already within budget", () => {
    const entries = [
      { result: "short", success: true },
      { result: "also short", success: false },
    ];
    const result = applyToolLogBudget(entries);
    expect(result[0].result).toBe("short");
    expect(result[1].result).toBe("also short");
  });
});

describe("applyToolLoopContextBudget", () => {
  it("reduces failed tool messages first and stops at the hard budget", () => {
    const messages = [
      { role: "system" as const, content: "system" },
      {
        role: "tool" as const,
        tool_call_id: "success-old",
        content: "s".repeat(30_000),
      },
      {
        role: "tool" as const,
        tool_call_id: "failed-old",
        content: "f".repeat(20_000),
      },
      {
        role: "tool" as const,
        tool_call_id: "failed-new",
        content: "g".repeat(20_000),
      },
    ];
    const successByToolCallId = new Map([
      ["success-old", true],
      ["failed-old", false],
      ["failed-new", false],
    ]);

    const result = applyToolLoopContextBudget(messages, successByToolCallId);

    expect(result.map((message) => message.tool_call_id)).toEqual(
      messages.map((message) => message.tool_call_id),
    );
    expect(result[1]).toBe(messages[1]);
    expect(result[2]).not.toBe(messages[2]);
    expect(result[2].content?.length).toBe(10_000);
    expect(result[2].content?.endsWith("\n… [gekürzt – vollständige Fundstelle in der gespeicherten Evidenz]")).toBe(true);
    expect(result[3]).toBe(messages[3]);
    expect(messages[2].content?.length).toBe(20_000);
  });

  it("uses the dynamic floor while preserving every tool protocol message", () => {
    const messages = Array.from({ length: 200 }, (_, index) => ({
      role: "tool" as const,
      tool_call_id: `call-${index}`,
      content: `${index}:` + "😀".repeat(250),
    }));
    const successByToolCallId = new Map(
      messages.map((message, index) => [message.tool_call_id, index % 2 === 0]),
    );

    const result = applyToolLoopContextBudget(messages, successByToolCallId);

    expect(result).toHaveLength(messages.length);
    expect(result.map((message) => message.tool_call_id)).toEqual(
      messages.map((message) => message.tool_call_id),
    );
    expect(
      result.reduce((sum, message) => sum + (message.content?.length ?? 0), 0),
    ).toBeLessThanOrEqual(TOOL_LOOP_CONTEXT_CHAR_BUDGET);
    for (const message of result) {
      expect(message.content).not.toMatch(/[\uD800-\uDBFF]$/u);
    }
  });
});

describe("raw evidence preserves original text", () => {
  it("truncateToolResultForContext preserves original short text semantics", () => {
    const text = "Wichtiges rechtliches Ergebnis für die Evidenz.";
    expect(truncateToolResultForContext(text)).toBe(text);
  });

  it("truncated text still contains the essential prefix", () => {
    const prefix = "Wichtiges rechtliches Ergebnis:";
    const text = prefix + "x".repeat(TOOL_RESULT_CONTEXT_CHAR_LIMIT);
    const result = truncateToolResultForContext(text);
    expect(result.startsWith(prefix)).toBe(true);
    expect(result.length).toBe(TOOL_RESULT_CONTEXT_CHAR_LIMIT);
  });
});
