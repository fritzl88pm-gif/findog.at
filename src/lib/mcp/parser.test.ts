import { describe, expect, it } from "vitest";

import { extractJsonPayloads } from "./parser";

describe("extractJsonPayloads", () => {
  it("parses a plain JSON-RPC object response", () => {
    const payloads = extractJsonPayloads('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}');

    expect(payloads).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        result: {
          ok: true,
        },
      },
    ]);
  });

  it("extracts JSON objects from SSE data lines", () => {
    const body = [
      "event: message",
      'data: {"jsonrpc":"2.0","id":1,"result":{"first":true}}',
      "",
      "event: message",
      'data: {"jsonrpc":"2.0","id":2,"result":{"second":true}}',
      "",
    ].join("\n");

    const payloads = extractJsonPayloads(body);

    expect(payloads).toHaveLength(2);
    expect(payloads[0]?.result).toEqual({ first: true });
    expect(payloads[1]?.result).toEqual({ second: true });
  });

  it("ignores blank and non-JSON SSE data lines", () => {
    const body = ["data:", "data: [DONE]", 'data: {"result":{"ok":true}}'].join("\n");

    expect(extractJsonPayloads(body)).toEqual([
      {
        result: {
          ok: true,
        },
      },
    ]);
  });
});
