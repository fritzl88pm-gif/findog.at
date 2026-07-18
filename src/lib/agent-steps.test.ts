import { describe, expect, it } from "vitest";

import { summarizeStepText } from "./agent-steps";

describe("summarizeStepText", () => {
  it("keeps exactly 1,200 characters and truncates only above the UI boundary", () => {
    expect(summarizeStepText("a".repeat(1_199))).toHaveLength(1_199);
    expect(summarizeStepText("a".repeat(1_200))).toHaveLength(1_200);
    expect(summarizeStepText("a".repeat(1_201))).toBe(
      `${"a".repeat(1_200)}... [gekürzt]`,
    );
  });
});
