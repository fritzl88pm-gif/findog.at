import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DeepSeekTool } from "../mcp/tools";
import { chatCompletion } from "./client";
import type { LlmRuntime } from "./runtime";

import { LLM_CHAT_TIMEOUT_MS, LLM_THINKING_TIMEOUT_MS } from "./client";

describe("LLM timeout constants", () => {
  it("LLM_CHAT_TIMEOUT_MS is 100_000", () => {
    expect(LLM_CHAT_TIMEOUT_MS).toBe(100_000);
  });

  it("LLM_THINKING_TIMEOUT_MS is 190_000", () => {
    expect(LLM_THINKING_TIMEOUT_MS).toBe(190_000);
  });
});

const TOOL: DeepSeekTool = {
  type: "function",
  function: {
    name: "search_laws",
    description: "Search laws",
    parameters: { type: "object", properties: { query: { type: "string" } } },
  },
};

const FLASH_RUNTIME = {
  model: "deepseek-v4-flash",
  provider: "deepseek",
  upstreamModel: "deepseek-v4-flash",
  baseUrl: "https://api.deepseek.com",
  apiKey: "deepseek-secret",
  reasoning: "disabled",
} satisfies LlmRuntime;

function responseMessage(
  message: Record<string, unknown>,
  finishReason = "stop",
  status = 200,
): Response {
  return new Response(
    JSON.stringify({ choices: [{ message, finish_reason: finishReason }] }),
    { status },
  );
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const raw = fetchMock.mock.calls[0]?.[1]?.body;
  if (typeof raw !== "string") {
    throw new Error("missing request body");
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("finish_reason parsing and guards", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns finishReason stop for a complete answer", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(responseMessage({ content: "Antwort" }, "stop"));

    const result = await chatCompletion({
      runtime: FLASH_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
    });

    expect(result.finishReason).toBe("stop");
    expect(result.content).toBe("Antwort");
    expect(result.toolCalls).toEqual([]);
  });

  it("returns finishReason tool_calls when valid tool calls are present", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      responseMessage(
        {
          content: null,
          tool_calls: [{
            id: "call-1",
            type: "function",
            function: { name: "search_laws", arguments: { query: "EStG" } },
          }],
        },
        "tool_calls",
      ),
    );

    const result = await chatCompletion({
      runtime: FLASH_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
      tools: [TOOL],
    });

    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("search_laws");
  });

  it("throws for tool_calls finish_reason without valid tool calls", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      responseMessage(
        { content: null, tool_calls: [{ id: "bad", type: "function", function: { name: "", arguments: "{}" } }] },
        "tool_calls",
      ),
    );

    await expect(chatCompletion({
      runtime: FLASH_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
    })).rejects.toThrow("unvollständige Werkzeugauswahl");
  });

  it("throws for content_filter finish_reason", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(responseMessage({ content: "" }, "content_filter"));

    await expect(chatCompletion({
      runtime: FLASH_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
    })).rejects.toThrow("Sicherheitsfilters");
  });

  it("throws for unknown terminal finish_reason", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(responseMessage({ content: "" }, "other_unknown_reason"));

    await expect(chatCompletion({
      runtime: FLASH_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
    })).rejects.toThrow("unbekannten Status");
  });

  it("throws for missing finish_reason", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: "Hi" } }] }), { status: 200 }),
    );

    await expect(chatCompletion({
      runtime: FLASH_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
    })).rejects.toThrow("unbekannten Status");
  });

  it("returns length without automatically retrying", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      responseMessage({ content: "Antwort angefangen," }, "length"),
    );

    const result = await chatCompletion({
      runtime: FLASH_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
      tools: [TOOL],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      finishReason: "length",
      content: "Antwort angefangen,",
      reasoningContent: null,
      toolCalls: [],
    });
  });

  it("includes finishReason in result for stop", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(responseMessage({ content: "Fertig." }, "stop"));

    const result = await chatCompletion({
      runtime: FLASH_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
    });

    expect(result).toMatchObject({
      content: "Fertig.",
      finishReason: "stop",
      toolCalls: [],
    });
  });
});

describe("provider-neutral chatCompletion", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses non-thinking sampling and automatic tool choice only when reasoning is disabled", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(responseMessage({ content: "Antwort" }, "stop"));

    await chatCompletion({
      runtime: FLASH_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
      tools: [TOOL],
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.deepseek.com/chat/completions");
    expect(requestBody(fetchMock)).toMatchObject({
      model: "deepseek-v4-flash",
      thinking: { type: "disabled" },
      temperature: 0.2,
      tool_choice: "auto",
    });
    expect(JSON.stringify(requestBody(fetchMock))).not.toContain("deepseek-secret");
  });

  it("omits temperature and tool_choice in thinking mode and preserves reasoning plus object arguments", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(responseMessage({
      content: "Recherche",
      reasoning_content: "Unveränderte Reasoning-Sequenz",
      tool_calls: [{
        id: "call-1",
        type: "function",
        function: { name: "search_laws", arguments: { query: "EStG" } },
      }],
    }, "tool_calls"));
    const runtime = { ...FLASH_RUNTIME, reasoning: "max" } satisfies LlmRuntime;

    const result = await chatCompletion({
      runtime,
      messages: [{ role: "user", content: "Frage" }],
      tools: [TOOL],
    });

    const body = requestBody(fetchMock);
    expect(body).toMatchObject({
      thinking: { type: "enabled" },
      reasoning_effort: "max",
    });
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("tool_choice");
    expect(result).toEqual({
      content: "Recherche",
      reasoningContent: "Unveränderte Reasoning-Sequenz",
      finishReason: "tool_calls",
      toolCalls: [{ id: "call-1", name: "search_laws", arguments: '{"query":"EStG"}' }],
    });
  });

  it("uses the Z.AI Coding endpoint and sends Turbo's enabled mode without an invented effort", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(responseMessage({ content: "GLM-Antwort" }, "stop"));
    const runtime = {
      model: "glm-5-turbo",
      provider: "zai",
      upstreamModel: "glm-5-turbo",
      baseUrl: "https://api.z.ai/api/coding/paas/v4",
      apiKey: "zai-secret",
      reasoning: "enabled",
    } satisfies LlmRuntime;

    await chatCompletion({ runtime, messages: [{ role: "user", content: "Frage" }] });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.z.ai/api/coding/paas/v4/chat/completions",
    );
    const body = requestBody(fetchMock);
    expect(body).toMatchObject({
      model: "glm-5-turbo",
      thinking: { type: "enabled" },
    });
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("tool_choice");
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "Accept-Language": "en-US,en",
      Authorization: "Bearer zai-secret",
    });
  });

  it("does not expose an upstream error body or API key in user-visible failures", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ error: { message: "private zai-secret detail" } }),
      { status: 400 },
    ));

    await expect(chatCompletion({
      runtime: FLASH_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
    })).rejects.toThrow("DeepSeek Anfrage ist mit HTTP 400 fehlgeschlagen.");
  });
});

describe("LaoZhang chat completion", () => {
  const LAOZHANG_RUNTIME = {
    model: "laozhang:00000000-0000-4000-8000-000000000001",
    provider: "laozhang",
    upstreamModel: "glm-5.2",
    baseUrl: "https://api.laozhang.ai/v1",
    apiKey: "lz-secret-key",
    reasoning: "disabled",
  } satisfies LlmRuntime;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the correct LaoZhang API endpoint URL", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(responseMessage({ content: "Antwort" }, "stop"));

    await chatCompletion({
      runtime: LAOZHANG_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.laozhang.ai/v1/chat/completions",
    );
  });

  it("sends the upstream model in the request body", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(responseMessage({ content: "Antwort" }, "stop"));

    await chatCompletion({
      runtime: LAOZHANG_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
    });

    const body = requestBody(fetchMock);
    expect(body.model).toBe("glm-5.2");
  });

  it("includes bearer authorization header", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(responseMessage({ content: "Antwort" }, "stop"));

    await chatCompletion({
      runtime: LAOZHANG_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
    });

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers).toMatchObject({
      Authorization: "Bearer lz-secret-key",
    });
  });

  it("omits thinking and reasoning_effort from the payload", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(responseMessage({ content: "Antwort" }, "stop"));

    await chatCompletion({
      runtime: LAOZHANG_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
    });

    const body = requestBody(fetchMock);
    expect(body).not.toHaveProperty("thinking");
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it("keeps standard OpenAI-compatible fields (model, messages, stream, temperature)", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(responseMessage({ content: "Antwort" }, "stop"));

    await chatCompletion({
      runtime: LAOZHANG_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
    });

    const body = requestBody(fetchMock);
    expect(body).toMatchObject({
      model: "glm-5.2",
      messages: [{ role: "user", content: "Frage" }],
      stream: false,
      temperature: 0.2,
    });
  });

  it("supports tool calling for laozhang", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      responseMessage(
        {
          content: null,
          tool_calls: [{
            id: "call-1",
            type: "function",
            function: { name: "search_laws", arguments: { query: "EStG" } },
          }],
        },
        "tool_calls",
      ),
    );

    const result = await chatCompletion({
      runtime: LAOZHANG_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
      tools: [TOOL],
    });

    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("search_laws");
  });

  it("uses LaoZhang-specific error text for auth failures", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));

    await expect(chatCompletion({
      runtime: LAOZHANG_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
    })).rejects.toThrow("LaoZhang API-Zugang wurde abgelehnt");
  });

  it("uses LaoZhang-specific error text for forbidden failures", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));

    await expect(chatCompletion({
      runtime: LAOZHANG_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
    })).rejects.toThrow("LaoZhang API-Zugang wurde abgelehnt");
  });

  it("includes tools in the payload when provided", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(responseMessage({ content: "Antwort" }, "stop"));

    await chatCompletion({
      runtime: LAOZHANG_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
      tools: [TOOL],
    });

    const body = requestBody(fetchMock);
    expect(body.tools).toBeDefined();
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools).toHaveLength(1);
  });

  it("does not set a tool_choice for laozhang", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(responseMessage({ content: "Antwort" }, "stop"));

    await chatCompletion({
      runtime: LAOZHANG_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
      tools: [TOOL],
    });

    const body = requestBody(fetchMock);
    expect(body).not.toHaveProperty("tool_choice");
  });
});
