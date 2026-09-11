import { describe, expect, it } from "vitest";

import {
  evaluateFindogAgentExpression,
  FindogAgentCalculationError,
} from "./calculator";

describe("findog agent calculator", () => {
  it("computes decimal arithmetic exactly", () => {
    expect(evaluateFindogAgentExpression("0.1 + 0.2")).toEqual({ value: "0.3", approximate: false });
    expect(evaluateFindogAgentExpression("(1 + 2) * 3 - 4 / 8")).toEqual({
      value: "8.5",
      approximate: false,
    });
    expect(evaluateFindogAgentExpression("-(2 + 3) * (-2)")).toEqual({
      value: "10",
      approximate: false,
    });
    expect(evaluateFindogAgentExpression(".5 + .5")).toEqual({ value: "1", approximate: false });
    expect(evaluateFindogAgentExpression("1000000000000000000000 * 3")).toEqual({
      value: "3000000000000000000000",
      approximate: false,
    });
  });

  it("marks non-terminating divisions as approximations instead of lying", () => {
    const result = evaluateFindogAgentExpression("1 / 3");
    expect(result.approximate).toBe(true);
    expect(result.value.startsWith("0.333")).toBe(true);
  });

  it("rejects division by zero", () => {
    expect(() => evaluateFindogAgentExpression("1 / 0")).toThrowError(FindogAgentCalculationError);
    try {
      evaluateFindogAgentExpression("1 / (2 - 2)");
      throw new Error("expected failure");
    } catch (error) {
      expect((error as FindogAgentCalculationError).code).toBe("division_by_zero");
    }
  });

  it("rejects malformed expressions instead of executing code", () => {
    for (const expression of [
      "",
      "1 +",
      "2 * * 3",
      "abc",
      "1..2",
      "1e5",
      "process.exit(1)",
      "require('fs')",
      "1; 2",
      "((1 + 2)",
      "1 ) 2",
    ]) {
      expect(() => evaluateFindogAgentExpression(expression)).toThrowError(FindogAgentCalculationError);
    }
  });

  it("bounds expression length and nesting depth", () => {
    try {
      evaluateFindogAgentExpression("1".repeat(501));
      throw new Error("expected failure");
    } catch (error) {
      expect((error as FindogAgentCalculationError).code).toBe("expression_too_long");
    }

    const deep = `${"(".repeat(40)}1${")".repeat(40)}`;
    try {
      evaluateFindogAgentExpression(deep);
      throw new Error("expected failure");
    } catch (error) {
      expect((error as FindogAgentCalculationError).code).toBe("expression_too_deep");
    }
  });
});
