import { describe, expect, it } from "vitest";

import { normalizeAgentRun } from "./agent-run";

describe("normalizeAgentRun", () => {
  it("retains the small normalized metadata returned with an assistant response", () => {
    expect(normalizeAgentRun({
      model: "deepseek-v4-flash",
      status: "completed",
      startedAt: "2026-07-09T09:01:10.000Z",
      completedAt: "2026-07-09T09:02:00.000Z",
      internalDiagnostics: "must not survive",
    })).toEqual({
      model: "deepseek-v4-flash",
      status: "completed",
      startedAt: "2026-07-09T09:01:10.000Z",
      completedAt: "2026-07-09T09:02:00.000Z",
    });
  });

  it("rejects malformed or unsupported metadata", () => {
    expect(normalizeAgentRun({ model: "deepseek-chat", status: "completed" })).toBeUndefined();
    expect(normalizeAgentRun({ model: "deepseek-v4-pro", status: "running" })).toBeUndefined();
    expect(normalizeAgentRun(null)).toBeUndefined();
  });
});
