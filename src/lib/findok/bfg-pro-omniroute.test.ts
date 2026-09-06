import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BfgProModelError } from "./bfg-pro";
import {
  BFG_PRO_LUNA_MODEL,
  BFG_PRO_LUNA_REASONING_EFFORT,
  completeBfgProLuna,
  normalizeOmnirouteChatCompletionsUrl,
} from "./bfg-pro-omniroute";

describe("normalizeOmnirouteChatCompletionsUrl", () => {
  it.each([
    ["https://omniroute.example", "https://omniroute.example/v1/chat/completions"],
    ["https://omniroute.example/", "https://omniroute.example/v1/chat/completions"],
    ["https://omniroute.example/v1", "https://omniroute.example/v1/chat/completions"],
    ["https://omniroute.example/v1/", "https://omniroute.example/v1/chat/completions"],
    ["https://omniroute.example/custom/base", "https://omniroute.example/custom/base/v1/chat/completions"],
    ["https://omniroute.example/custom/base/", "https://omniroute.example/custom/base/v1/chat/completions"],
    ["https://omniroute.example/custom/base/v1", "https://omniroute.example/custom/base/v1/chat/completions"],
    ["https://omniroute.example/custom/base/v1/", "https://omniroute.example/custom/base/v1/chat/completions"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeOmnirouteChatCompletionsUrl(input)).toBe(expected);
  });
});

describe("completeBfgProLuna transport", () => {
  const originalBaseUrl = process.env.OMNIROUTE_BASE_URL;
  const originalApiKey = process.env.OMNIROUTE_API_KEY;

  beforeEach(() => {
    process.env.OMNIROUTE_BASE_URL = "https://omniroute.example/v1/";
    process.env.OMNIROUTE_API_KEY = "test-omniroute-secret-key";
  });

  afterEach(() => {
    if (originalBaseUrl !== undefined) {
      process.env.OMNIROUTE_BASE_URL = originalBaseUrl;
    } else {
      delete process.env.OMNIROUTE_BASE_URL;
    }
    if (originalApiKey !== undefined) {
      process.env.OMNIROUTE_API_KEY = originalApiKey;
    } else {
      delete process.env.OMNIROUTE_API_KEY;
    }
  });

  it("sends exact codex/gpt-5.6-luna model, medium reasoning, server auth, and json_object format", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: { role: "assistant", content: '{"queries":["Arbeitszimmer"],"norm":null}' },
              finish_reason: "stop",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const messages = [{ role: "user" as const, content: "Sachverhalt" }];
    const result = await completeBfgProLuna({
      messages,
      fetchImpl: fetchMock,
      maxTokens: 2048,
    });

    expect(result).toBe('{"queries":["Arbeitszimmer"],"norm":null}');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, requestInit] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://omniroute.example/v1/chat/completions");
    expect(requestInit?.method).toBe("POST");
    expect(requestInit?.headers).toMatchObject({
      Authorization: "Bearer test-omniroute-secret-key",
      "Content-Type": "application/json",
      Accept: "application/json",
    });

    const body = JSON.parse(String(requestInit?.body));
    expect(body).toEqual({
      model: BFG_PRO_LUNA_MODEL,
      messages,
      reasoning_effort: BFG_PRO_LUNA_REASONING_EFFORT,
      response_format: { type: "json_object" },
      stream: false,
      max_tokens: 2048,
    });
    expect(BFG_PRO_LUNA_MODEL).toBe("codex/gpt-5.6-luna");
    expect(BFG_PRO_LUNA_REASONING_EFFORT).toBe("medium");
  });

  it.each([
    ["missing base URL", () => { delete process.env.OMNIROUTE_BASE_URL; }],
    ["empty base URL", () => { process.env.OMNIROUTE_BASE_URL = "   "; }],
    ["missing API key", () => { delete process.env.OMNIROUTE_API_KEY; }],
    ["empty API key", () => { process.env.OMNIROUTE_API_KEY = "   "; }],
  ])("fails closed when configuration is absent: %s", async (_label, mutateEnv) => {
    mutateEnv();
    const fetchMock = vi.fn<typeof fetch>();

    await expect(completeBfgProLuna({
      messages: [{ role: "user", content: "Test" }],
      fetchImpl: fetchMock,
    })).rejects.toBeInstanceOf(BfgProModelError);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed without secret leakage on HTTP non-2xx response", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Upstream internal error with sensitive details" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );

    let caughtError: unknown;
    try {
      await completeBfgProLuna({
        messages: [{ role: "user", content: "Test" }],
        fetchImpl: fetchMock,
      });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(BfgProModelError);
    const errMessage = (caughtError as Error).message;
    expect(errMessage).not.toContain("test-omniroute-secret-key");
    expect(errMessage).not.toContain("sensitive details");
  });

  it.each([
    ["finish_reason is length", { choices: [{ message: { content: "{}" }, finish_reason: "length" }] }],
    ["finish_reason is content_filter", { choices: [{ message: { content: "{}" }, finish_reason: "content_filter" }] }],
    ["empty choices array", { choices: [] }],
    ["missing choices property", {}],
    ["missing message content", { choices: [{ message: {}, finish_reason: "stop" }] }],
    ["null message content", { choices: [{ message: { content: null }, finish_reason: "stop" }] }],
  ])("rejects non-stop finish_reason or malformed choices: %s", async (_label, payload) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(completeBfgProLuna({
      messages: [{ role: "user", content: "Test" }],
      fetchImpl: fetchMock,
    })).rejects.toBeInstanceOf(BfgProModelError);
  });

  it("fails closed when response body is not valid JSON", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response("<html>Bad Gateway</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    await expect(completeBfgProLuna({
      messages: [{ role: "user", content: "Test" }],
      fetchImpl: fetchMock,
    })).rejects.toBeInstanceOf(BfgProModelError);
  });

  it("fails closed when reading body times out or aborts", async () => {
    const slowResponse = new Response(
      new ReadableStream({
        start() {
          // Never emits, hangs
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(slowResponse);

    await expect(completeBfgProLuna({
      messages: [{ role: "user", content: "Test" }],
      fetchImpl: fetchMock,
      timeoutMs: 10,
    })).rejects.toBeInstanceOf(BfgProModelError);
  });
});
