import { beforeEach, describe, expect, it, vi } from "vitest";

import { chatCompletion } from "./deepseek";
import { McpClient } from "./mcp/client";
import { runAgent } from "./agent";

vi.mock("./deepseek", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./deepseek")>();
  return {
    ...actual,
    chatCompletion: vi.fn(),
  };
});

vi.mock("./mcp/client", () => ({
  McpClient: vi.fn(),
}));

const mockedChatCompletion = vi.mocked(chatCompletion);
const MockedMcpClient = vi.mocked(McpClient);

type AgentRunShape = {
  answer: string;
  steps: Array<{ type: string; content: string; toolName?: string; success?: boolean }>;
  tools: string[];
};

describe("runAgent", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  function mockMcpSession() {
    const openToolSession = vi.fn().mockResolvedValue({
      sessionId: "mcp-session",
      tools: [
        {
          name: "hybrid_search",
          description: "Search scoped knowledge bases",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
          },
        },
      ],
      deepSeekTools: [
        {
          type: "function",
          function: {
            name: "hybrid_search",
            description: "Search scoped knowledge bases",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string" },
              },
            },
          },
        },
      ],
    });
    const callTool = vi.fn().mockResolvedValue("Gefundene Normen und BFG-Fundstellen.");
    MockedMcpClient.mockImplementation(function MockMcpClient() {
      return {
        openToolSession,
        callTool,
      } as unknown as McpClient;
    });

    return { callTool, openToolSession };
  }

  it("returns a final answer with visible plan, tool, result, and answer steps", async () => {
    mockMcpSession();
    mockedChatCompletion
      .mockResolvedValueOnce({
        content: "Ich recherchiere.",
        toolCalls: [
          {
            id: "call-1",
            name: "hybrid_search",
            arguments: JSON.stringify({ query: "Pendlerpauschale 2024" }),
          },
        ],
      })
      .mockResolvedValueOnce({
        content: "Finale Antwort.",
        toolCalls: [],
      });

    const result = (await runAgent({
      apiKey: "test-key",
      model: "deepseek-v4-flash",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Frage" }],
      mcpBearerToken: "mcp-token",
    })) as unknown as AgentRunShape;

    expect(result.answer).toBe("Finale Antwort.");
    expect(result.tools).toEqual(["hybrid_search"]);
    expect(result.steps.map((step) => step.type)).toEqual([
      "plan",
      "tools",
      "tool_call",
      "tool_result",
      "answer",
    ]);
    expect(result.steps[2]).toMatchObject({
      toolName: "hybrid_search",
    });
    expect(result.steps[3]).toMatchObject({
      toolName: "hybrid_search",
      success: true,
    });
  });

  it("synthesizes a final answer without tools after the tool loop reaches its limit", async () => {
    const { callTool } = mockMcpSession();

    mockedChatCompletion.mockImplementation(async (options) => {
      if ((options.tools?.length ?? 0) === 0) {
        return {
          content: "Finale Antwort aus bisherigen Werkzeugergebnissen.",
          toolCalls: [],
        };
      }

      return {
        content: "Ich recherchiere weiter.",
        toolCalls: [
          {
            id: `call-${mockedChatCompletion.mock.calls.length}`,
            name: "hybrid_search",
            arguments: JSON.stringify({ query: "Familienbonus Plus" }),
          },
        ],
      };
    });

    const result = (await runAgent({
      apiKey: "test-key",
      model: "deepseek-v4-flash",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Frage" }],
      mcpBearerToken: "mcp-token",
    })) as unknown as AgentRunShape;

    expect(result.answer).toBe("Finale Antwort aus bisherigen Werkzeugergebnissen.");
    expect(callTool.mock.calls.length).toBeGreaterThan(4);
    expect(mockedChatCompletion.mock.calls.at(-1)?.[0]).not.toHaveProperty("tools");
    expect(result.steps.at(-2)?.type).toBe("finalize");
    expect(result.steps.at(-1)).toMatchObject({
      type: "answer",
      content: "Finale Antwort aus bisherigen Werkzeugergebnissen.",
    });
  });
});
