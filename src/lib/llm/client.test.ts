import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DeepSeekTool } from "../mcp/tools";
import { chatCompletion, type LlmMessage } from "./client";
import type { LlmRuntime } from "./runtime";

import {
  LLM_CHAT_TIMEOUT_MS,
  LLM_OPENAI_COMPATIBLE_TIMEOUT_MS,
  LLM_THINKING_TIMEOUT_MS,
  effectiveTimeoutMs,
} from "./client";

describe("LLM timeout constants", () => {
  it("LLM_CHAT_TIMEOUT_MS is 120_000", () => {
    expect(LLM_CHAT_TIMEOUT_MS).toBe(120_000);
  });

  it("LLM_THINKING_TIMEOUT_MS is 220_000", () => {
    expect(LLM_THINKING_TIMEOUT_MS).toBe(220_000);
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
    expect(requestBody(fetchMock)).not.toHaveProperty("max_tokens");
    expect(JSON.stringify(requestBody(fetchMock))).not.toContain("deepseek-secret");
  });

  it("applies a caller temperature override when reasoning is disabled", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(responseMessage({ content: "Antwort" }, "stop"));

    await chatCompletion({
      runtime: FLASH_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
      temperature: 0.9,
    });

    expect(requestBody(fetchMock)).toMatchObject({
      thinking: { type: "disabled" },
      temperature: 0.9,
    });
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

describe("OpenAI-compatible chat completion", () => {
  const OPENAI_COMPATIBLE_RUNTIME = {
    model: "openai:00000000-0000-4000-8000-000000000001",
    provider: "openai_compatible",
    upstreamModel: "glm-5.2",
    baseUrl: "https://gateway.example.com/v1",
    apiKey: "provider-secret-key",
    reasoning: "disabled",
  } satisfies LlmRuntime;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the correct OpenAI-compatible API endpoint URL", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(responseMessage({ content: "Antwort" }, "stop"));

    await chatCompletion({
      runtime: OPENAI_COMPATIBLE_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://gateway.example.com/v1/chat/completions",
    );
  });

  it("sends the upstream model in the request body", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(responseMessage({ content: "Antwort" }, "stop"));

    await chatCompletion({
      runtime: OPENAI_COMPATIBLE_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
    });

    const body = requestBody(fetchMock);
    expect(body.model).toBe("glm-5.2");
  });

  it("includes bearer authorization header", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(responseMessage({ content: "Antwort" }, "stop"));

    await chatCompletion({
      runtime: OPENAI_COMPATIBLE_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
    });

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers).toMatchObject({
      Authorization: "Bearer provider-secret-key",
    });
  });

  it("omits thinking and reasoning_effort from the payload", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(responseMessage({ content: "Antwort" }, "stop"));

    await chatCompletion({
      runtime: OPENAI_COMPATIBLE_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
    });

    const body = requestBody(fetchMock);
    expect(body).not.toHaveProperty("thinking");
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it("keeps standard OpenAI-compatible fields with max_tokens=16000 (model, messages, stream, temperature, max_tokens)", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(responseMessage({ content: "Antwort" }, "stop"));

    await chatCompletion({
      runtime: OPENAI_COMPATIBLE_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
    });

    const body = requestBody(fetchMock);
    expect(body).toMatchObject({
      model: "glm-5.2",
      messages: [{ role: "user", content: "Frage" }],
      stream: false,
      temperature: 0.2,
      max_tokens: 16000,
    });
  });

  it("supports tool calling for OpenAI-compatible provider", async () => {
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
      runtime: OPENAI_COMPATIBLE_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
      tools: [TOOL],
    });

    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("search_laws");
  });

  it("uses OpenAI-compatible-specific error text for auth failures", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));

    await expect(chatCompletion({
      runtime: OPENAI_COMPATIBLE_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
    })).rejects.toThrow("OpenAI-kompatibler Provider API-Zugang wurde abgelehnt");
  });

  it("uses OpenAI-compatible-specific error text for forbidden failures", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));

    await expect(chatCompletion({
      runtime: OPENAI_COMPATIBLE_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
    })).rejects.toThrow("OpenAI-kompatibler Provider API-Zugang wurde abgelehnt");
  });

  it("includes tools in the payload when provided", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(responseMessage({ content: "Antwort" }, "stop"));

    await chatCompletion({
      runtime: OPENAI_COMPATIBLE_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
      tools: [TOOL],
    });

    const body = requestBody(fetchMock);
    expect(body.tools).toBeDefined();
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools).toHaveLength(1);
  });

  it("does not set a tool_choice for OpenAI-compatible provider", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(responseMessage({ content: "Antwort" }, "stop"));

    await chatCompletion({
      runtime: OPENAI_COMPATIBLE_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
      tools: [TOOL],
    });

    const body = requestBody(fetchMock);
    expect(body).not.toHaveProperty("tool_choice");
  });
});

describe("LLM_OPENAI_COMPATIBLE_TIMEOUT_MS constant", () => {
  it("LLM_OPENAI_COMPATIBLE_TIMEOUT_MS is 600_000", () => {
    expect(LLM_OPENAI_COMPATIBLE_TIMEOUT_MS).toBe(600_000);
  });
});

describe("effectiveTimeoutMs pure timeout selector", () => {
  it("returns 600_000 for openai_compatible provider", () => {
    const runtime = {
      model: "openai:xxx",
      provider: "openai_compatible" as const,
      upstreamModel: "m",
      baseUrl: "https://example.com",
      apiKey: "k",
      reasoning: "disabled" as const,
    } satisfies LlmRuntime;

    expect(effectiveTimeoutMs(runtime)).toBe(600_000);
  });

  it("returns 600_000 for openai_compatible even with reasoning enabled", () => {
    const runtime = {
      model: "openai:xxx",
      provider: "openai_compatible" as const,
      upstreamModel: "m",
      baseUrl: "https://example.com",
      apiKey: "k",
      reasoning: "high" as const,
    } satisfies LlmRuntime;

    expect(effectiveTimeoutMs(runtime)).toBe(600_000);
  });

  it("returns 120_000 for built-in non-thinking provider", () => {
    const runtime = {
      model: "deepseek-v4-flash",
      provider: "deepseek" as const,
      upstreamModel: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.com",
      apiKey: "k",
      reasoning: "disabled" as const,
    } satisfies LlmRuntime;

    expect(effectiveTimeoutMs(runtime)).toBe(120_000);
  });

  it("returns 220_000 for built-in thinking provider", () => {
    const runtime = {
      model: "deepseek-v4-flash",
      provider: "deepseek" as const,
      upstreamModel: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.com",
      apiKey: "k",
      reasoning: "high" as const,
    } satisfies LlmRuntime;

    expect(effectiveTimeoutMs(runtime)).toBe(220_000);
  });
});

describe("transport retry on fetch failure", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries once after initial TypeError and succeeds on second attempt", async () => {
    const fetchMock = vi.mocked(fetch);
    const successResponse = responseMessage({ content: "Gerettet" }, "stop");
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(successResponse);

    const result = await chatCompletion({
      runtime: FLASH_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.content).toBe("Gerettet");
  });

  it("does not retry runWithTimeout timeout (UserVisibleError)", async () => {
    const fetchMock = vi.mocked(fetch);
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    fetchMock.mockRejectedValueOnce(abortError);

    await expect(chatCompletion({
      runtime: FLASH_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
    })).rejects.toThrow("DeepSeek hat nicht rechtzeitig geantwortet");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a transport TypeError after the shared signal aborts", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(responseMessage({ content: "Zu spät" }, "stop"));
    const controller = new AbortController();
    controller.abort(new TypeError("fetch failed"));

    await expect(chatCompletion({
      runtime: FLASH_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
      signal: controller.signal,
    })).rejects.toThrow("DeepSeek hat nicht rechtzeitig geantwortet");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry on non-connection error (Error, not TypeError)", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValueOnce(new Error("Some non-connection error"));

    await expect(chatCompletion({
      runtime: FLASH_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
    })).rejects.toThrow("Some non-connection error");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws UserVisibleError with provider/model name after two transport failures", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(chatCompletion({
      runtime: FLASH_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
    })).rejects.toThrow(
      "DeepSeek ist nach einem Verbindungsfehler nicht erreichbar. Bitte später erneut versuchen.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws UserVisibleError with dynamic model label after two transport failures", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new TypeError("fetch failed"));

    const dynamicRuntime = {
      model: "openai:00000000-0000-4000-8000-000000000001",
      provider: "openai_compatible" as const,
      upstreamModel: "gpt-5.6-terra-high",
      baseUrl: "https://gateway.example.com/v1",
      apiKey: "secret",
      reasoning: "disabled" as const,
      label: "GPT 5.6 Terra High",
    } satisfies LlmRuntime;

    await expect(chatCompletion({
      runtime: dynamicRuntime,
      messages: [{ role: "user", content: "Frage" }],
    })).rejects.toThrow(
      "GPT 5.6 Terra High ist nach einem Verbindungsfehler nicht erreichbar. Bitte später erneut versuchen.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry HTTP 5xx - those are not TypeError transport failures", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response("Upstream error", { status: 502 }));

    await expect(chatCompletion({
      runtime: FLASH_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
    })).rejects.toThrow("DeepSeek ist derzeit nicht erreichbar");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses public label for openai_compatible HTTP 502 error (dynamic model)", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response("Gateway error", { status: 502 }));

    const dynamicRuntime = {
      model: "openai:00000000-0000-4000-8000-000000000001",
      provider: "openai_compatible" as const,
      upstreamModel: "gpt-5.6-terra-high",
      baseUrl: "https://gateway.example.com/v1",
      apiKey: "secret",
      reasoning: "disabled" as const,
      label: "GPT 5.6 Terra High",
    } satisfies LlmRuntime;

    await expect(chatCompletion({
      runtime: dynamicRuntime,
      messages: [{ role: "user", content: "Frage" }],
    })).rejects.toThrow(
      "GPT 5.6 Terra High ist derzeit nicht erreichbar",
    );
  });

describe("reasoning_content sanitization in payload", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("strips reasoning_content from messages in the JSON payload", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(responseMessage({ content: "Antwort" }, "stop"));

    // Simulate a runtime message with reasoning_content using a raw object
    const rawMsg = {
      role: "assistant" as const,
      content: "Überlegung",
      reasoning_content: "Interne Überlegung",
    };
    const messagesWithReasoning: LlmMessage[] = [
      { role: "user", content: "Frage" },
      rawMsg,
    ];

    await chatCompletion({
      runtime: FLASH_RUNTIME,
      messages: messagesWithReasoning,
    });

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as Record<string, unknown>;
    const sentMessages = body.messages as Array<Record<string, unknown>>;
    const assistantMsg = sentMessages.find((m) => m.role === "assistant");
    expect(assistantMsg?.reasoning_content).toBeUndefined();
    expect(assistantMsg?.content).toBe("Überlegung");
  });
});

});
