import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runAgent as runAgentWithSystemPrompt, type RunAgentOptions } from "./agent";
import { chatCompletion } from "./deepseek";
import type { LlmRuntime } from "./llm/runtime";
import { McpClient } from "./mcp/client";

vi.mock("./deepseek", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./deepseek")>();
  return { ...actual, chatCompletion: vi.fn() };
});

vi.mock("./mcp/client", () => ({ McpClient: vi.fn() }));

const mockedChatCompletion = vi.mocked(chatCompletion);
const MockedMcpClient = vi.mocked(McpClient);
const TEST_SYSTEM_PROMPT = "Globaler Systemprompt aus der Datenbank";
const TEST_RUNTIME = {
  model: "deepseek-v4-pro",
  provider: "deepseek",
  upstreamModel: "deepseek-v4-pro",
  baseUrl: "https://api.deepseek.com",
  apiKey: "server-key",
  reasoning: "disabled",
} satisfies LlmRuntime;

const MEMORY_MARKER = "RV/1234/2020 Früherer Treffer aus Runde 1";
const MEMORY_BLOCK = `===== Bekannte Fundstellen aus früheren Runden dieses Gesprächs =====\n\n1. [search_bfg] ${MEMORY_MARKER}`;

function runAgent(options: Omit<RunAgentOptions, "systemPrompt">) {
  return runAgentWithSystemPrompt({ ...options, systemPrompt: TEST_SYSTEM_PROMPT });
}

function rawSearchTool(name: "faq_search" | "hybrid_search") {
  return {
    name,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        kb_id: { type: "string" },
        limit: { type: "integer" },
      },
    },
  };
}

function mockSession() {
  const callTool = vi.fn().mockResolvedValue("Amtlicher Betragswert 2024 mit nachvollziehbarer Quelle.");
  MockedMcpClient.mockImplementation(function MockMcpClient() {
    return {
      openToolSession: vi.fn().mockResolvedValue({
        sessionId: "session-1",
        tools: [rawSearchTool("faq_search"), rawSearchTool("hybrid_search")],
      }),
      callTool,
    } as unknown as McpClient;
  });
  return callTool;
}

function promptAt(index: number): string {
  return mockedChatCompletion.mock.calls.at(index)?.[0].messages
    .map((message) => message.content ?? "")
    .join("\n") ?? "";
}

describe("runAgent cross-turn memory", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    for (const [callIndex, [options]] of mockedChatCompletion.mock.calls.entries()) {
      const systemMessages = options.messages.filter((message) => message.role === "system");
      expect(systemMessages, `chatCompletion call ${callIndex} must have exactly one system message`)
        .toEqual([{ role: "system", content: TEST_SYSTEM_PROMPT }]);
    }
  });

  it("feeds carried-forward memory into both the research loop and the final synthesis", async () => {
    mockSession();
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "stop", content: "Vorläufige Antwort.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Finale Antwort.", toolCalls: [] });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Welche Voraussetzungen gelten für Werbungskosten?" }],
      researchMemory: MEMORY_BLOCK,
    });

    // Loop call (first) and finalize call (last) both see the memory block.
    expect(promptAt(0)).toContain(MEMORY_MARKER);
    expect(promptAt(-1)).toContain(MEMORY_MARKER);
    // A visible step announces that memory was considered.
    expect(result.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "progress", title: "Frühere Fundstellen berücksichtigt" }),
    ]));
  });

  it("does not inject any memory when none is carried forward", async () => {
    mockSession();
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "stop", content: "Vorläufige Antwort.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Finale Antwort.", toolCalls: [] });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Welche Voraussetzungen gelten für Werbungskosten?" }],
    });

    expect(promptAt(0)).not.toContain(MEMORY_MARKER);
    expect(promptAt(0)).not.toContain("Bekannte Fundstellen aus früheren Runden");
    expect(result.steps.some((step) => step.type === "progress" && step.title === "Frühere Fundstellen berücksichtigt"))
      .toBe(false);
  });

  it("leaves the deterministic simple-amount path free of memory", async () => {
    mockSession();
    mockedChatCompletion.mockResolvedValueOnce({
      finishReason: "stop",
      content: "Der Betrag gilt im Veranlagungsjahr 2024.",
      toolCalls: [],
    });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Wie hoch ist der Unterhaltsabsetzbetrag 2024?" }],
      researchMemory: MEMORY_BLOCK,
    });

    // simple_amount makes exactly one (finalize) chatCompletion call, without memory.
    expect(mockedChatCompletion).toHaveBeenCalledTimes(1);
    expect(promptAt(0)).not.toContain(MEMORY_MARKER);
    expect(result.steps.some((step) => step.type === "progress" && step.title === "Frühere Fundstellen berücksichtigt"))
      .toBe(false);
  });
});
