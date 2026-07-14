import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DeepSeekTool } from "../mcp/tools";
import { chatCompletion } from "./client";
import type { LlmRuntime } from "./runtime";

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

function responseMessage(message: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message }] }), { status });
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const raw = fetchMock.mock.calls[0]?.[1]?.body;
  if (typeof raw !== "string") {
    throw new Error("missing request body");
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("provider-neutral chatCompletion", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses non-thinking sampling and automatic tool choice only when reasoning is disabled", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(responseMessage({ content: "Antwort" }));

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
    }));
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
      toolCalls: [{ id: "call-1", name: "search_laws", arguments: '{"query":"EStG"}' }],
    });
  });

  it("uses the Z.AI Coding endpoint and sends Turbo's enabled mode without an invented effort", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(responseMessage({ content: "GLM-Antwort" }));
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
