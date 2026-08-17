import { describe, expect, it } from "vitest";

import {
  FREDRUN_ACCESS_BLOCK_CODE,
  FredRunAccessBlockedError,
  normalizeFredRunAccessMessage,
  parseFredRunAccessBlockedResponse,
} from "./fredrun-access";

describe("FredRun access blocks", () => {
  it("parses a bounded server block response", () => {
    const message = "bitte noch 1432 VKs erledigen um weiter zu spielen...";
    expect(parseFredRunAccessBlockedResponse({
      code: FREDRUN_ACCESS_BLOCK_CODE,
      error: message,
    })).toBe(message);
  });

  it("rejects malformed, padded, and control-character messages", () => {
    expect(normalizeFredRunAccessMessage(" message ")).toBeNull();
    expect(normalizeFredRunAccessMessage("message\nnext")).toBeNull();
    expect(parseFredRunAccessBlockedResponse({ code: "other", error: "message" })).toBeNull();
    expect(parseFredRunAccessBlockedResponse({
      code: FREDRUN_ACCESS_BLOCK_CODE,
      error: "x".repeat(241),
    })).toBeNull();
  });

  it("uses a distinct client error for rendering the block state", () => {
    const error = new FredRunAccessBlockedError("blocked");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("FredRunAccessBlockedError");
  });
});
