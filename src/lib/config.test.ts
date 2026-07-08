import { describe, expect, it } from "vitest";

import { DEFAULT_SYSTEM_PROMPT, MAX_REQUEST_BYTES, MAX_SYSTEM_PROMPT_CHARS } from "./config";

describe("DEFAULT_SYSTEM_PROMPT", () => {
  it("contains the full Fred prompt and fits within the accepted request bounds", () => {
    expect(DEFAULT_SYSTEM_PROMPT.length).toBeGreaterThan(24_000);
    expect(MAX_SYSTEM_PROMPT_CHARS).toBeGreaterThanOrEqual(DEFAULT_SYSTEM_PROMPT.length);
    expect(MAX_REQUEST_BYTES).toBeGreaterThanOrEqual(MAX_SYSTEM_PROMPT_CHARS * 2);
  });
});
