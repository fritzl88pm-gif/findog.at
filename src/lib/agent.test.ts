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

  it("returns a final answer with visible plan, tool, result, and answer steps", async () => {
    const openToolSession = vi.fn().mockResolvedValue({
      sessionId: "mcp-session",
      tools: [
        {
          name: "knowledge_search",
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
            name: "knowledge_search",
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
    MockedMcpClient.mockImplementation(
      function MockMcpClient() {
        return {
          openToolSession,
          callTool,
        } as unknown as McpClient;
      },
    );
    mockedChatCompletion
      .mockResolvedValueOnce({
        content: "Ich recherchiere.",
        toolCalls: [
          {
            id: "call-1",
            name: "knowledge_search",
            arguments: JSON.stringify({ query: "Pendlerpauschale 2024" }),
          },
        ],
      })
      .mockResolvedValueOnce({
        content: "Finale Antwort.",
        toolCalls: [],
      });

    const result = (await runAgent({
      apiKey: "deepseek-key",
      model: "deepseek-v4-flash",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Frage" }],
      mcpBearerToken: "mcp-token",
    })) as unknown as AgentRunShape;

    expect(result.answer).toBe("Finale Antwort.");
    expect(result.tools).toEqual(["knowledge_search"]);
    expect(result.steps.map((step) => step.type)).toEqual([
      "plan",
      "tools",
      "tool_call",
      "tool_result",
      "answer",
    ]);
    expect(result.steps[2]).toMatchObject({
      toolName: "knowledge_search",
    });
    expect(result.steps[3]).toMatchObject({
      toolName: "knowledge_search",
      success: true,
    });
  });
});
