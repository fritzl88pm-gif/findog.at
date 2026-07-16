import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runAgent } from "./agent";
import { chatCompletion } from "./deepseek";
import { DEFAULT_SYSTEM_PROMPT } from "./default-system-prompt";
import type { LlmRuntime } from "./llm/runtime";
import { McpClient } from "./mcp/client";
import { RESEARCH_SOURCES } from "./research-sources";

vi.mock("./deepseek", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./deepseek")>();
  return { ...actual, chatCompletion: vi.fn() };
});

vi.mock("./mcp/client", () => ({ McpClient: vi.fn() }));

const mockedChatCompletion = vi.mocked(chatCompletion);
const MockedMcpClient = vi.mocked(McpClient);
const TEST_RUNTIME = {
  model: "deepseek-v4-pro",
  provider: "deepseek",
  upstreamModel: "deepseek-v4-pro",
  baseUrl: "https://api.deepseek.com",
  apiKey: "server-key",
  reasoning: "disabled",
} satisfies LlmRuntime;
const REASONING_RUNTIME = {
  ...TEST_RUNTIME,
  reasoning: "high",
} satisfies LlmRuntime;

function hybridSearchTool(
  properties: Record<string, unknown> = {
    query: { type: "string" },
    kb_id: { type: "string" },
  },
) {
  return {
    name: "hybrid_search",
    inputSchema: {
      type: "object",
      properties,
    },
  };
}

function mockMcp(
  resolveResult: (request: { arguments: Record<string, unknown> }) => string | Promise<string>,
) {
  const openToolSession = vi.fn().mockResolvedValue({
    sessionId: "guard-session",
    tools: [hybridSearchTool()],
  });
  const callTool = vi.fn().mockImplementation(resolveResult);
  MockedMcpClient.mockImplementation(function MockMcpClient() {
    return { openToolSession, callTool } as unknown as McpClient;
  });
  return { callTool, openToolSession };
}

describe("agent research and evidence guards", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    for (const [options] of mockedChatCompletion.mock.calls) {
      expect(options.messages.filter((message) => message.role === "system"))
        .toEqual([{ role: "system", content: DEFAULT_SYSTEM_PROMPT }]);
    }
  });

  it("runs the mandatory scoped law search before a model may stop", async () => {
    const question = "Welche Voraussetzungen gelten für Werbungskosten?";
    const { callTool } = mockMcp(() => "Werbungskosten richten sich nach § 16 Abs. 1 EStG 1988.");
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "stop", content: "Entwurf.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "§ 16 EStG [Q1] ist maßgeblich.", toolCalls: [] });

    await runAgent({ runtime: TEST_RUNTIME, messages: [{ role: "user", content: question }] });

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith(expect.objectContaining({
      name: "hybrid_search",
      arguments: {
        query: question,
        kb_id: RESEARCH_SOURCES.GESETZE.kbId,
      },
    }));
    expect(mockedChatCompletion.mock.calls[0]?.[0].messages).toContainEqual(
      expect.objectContaining({
        role: "user",
        content: expect.stringMatching(/untrusted JSON data[\s\S]*§ 16/u),
      }),
    );
  });

  it("passes mandatory evidence to reasoning models without a synthetic tool continuation", async () => {
    mockMcp(() => "Werbungskosten nach § 16 Abs. 1 EStG 1988.");
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "stop", content: "Entwurf.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "§ 16 EStG [Q1] ist maßgeblich.", toolCalls: [] });

    await runAgent({
      runtime: REASONING_RUNTIME,
      messages: [{ role: "user", content: "Welche Werbungskosten gelten?" }],
    });

    const planningMessages = mockedChatCompletion.mock.calls[0]?.[0].messages ?? [];
    expect(planningMessages.some((message) => message.role === "tool")).toBe(false);
    expect(planningMessages.some((message) =>
      message.role === "assistant" && "tool_calls" in message && Boolean(message.tool_calls?.length),
    )).toBe(false);
    expect(planningMessages).toContainEqual(expect.objectContaining({
      role: "user",
      content: expect.stringContaining("Serverseitig erhobene Rechercheevidenz"),
    }));
  });

  it("resolves a fragmentary follow-up from prior user context", async () => {
    const { callTool } = mockMcp(() => "Werbungskosten 2024 nach § 16 Abs. 1 EStG 1988.");
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "stop", content: "Entwurf.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "§ 16 EStG [Q1] gilt auch 2024.", toolCalls: [] });

    await runAgent({
      runtime: TEST_RUNTIME,
      messages: [
        { role: "user", content: "Kann eine Tagesmutter Werbungskosten geltend machen?" },
        { role: "assistant", content: "Bisherige Antwort." },
        { role: "user", content: "Und im Jahr 2024?" },
      ],
    });

    const query = String(callTool.mock.calls[0]?.[0].arguments.query);
    expect(query).toContain("Tagesmutter");
    expect(query).toContain("Werbungskosten");
    expect(query).toContain("2024");
    expect(query).not.toBe("Und im Jahr 2024?");
  });

  it("executes an explicitly requested BFG search after laws before the model may stop", async () => {
    const gz = "RV/7103053/2014";
    const { callTool } = mockMcp((request) =>
      request.arguments.kb_id === RESEARCH_SOURCES.BFG.kbId
        ? `BFG ${gz}`
        : "Amtlicher Gesetzes- und Richtlinienkontext.",
    );
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "stop", content: "Entwurf.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: `BFG ${gz} [Q1] [Q2].`, toolCalls: [] });

    await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Welche BFG-Rechtsprechung gibt es zu Werbungskosten?" }],
    });

    expect(callTool.mock.calls.map(([request]) => request.arguments.kb_id)).toEqual([
      RESEARCH_SOURCES.GESETZE.kbId,
      RESEARCH_SOURCES.BFG.kbId,
    ]);
  });

  it("can finalize a qualified negative BFG outcome after a successful search", async () => {
    const { callTool } = mockMcp((request) =>
      request.arguments.kb_id === RESEARCH_SOURCES.BFG.kbId
        ? "Keine Treffer gefunden."
        : "§ 16 Abs. 1 EStG 1988 ist die Rechtsgrundlage.",
    );
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "stop", content: "Entwurf.", toolCalls: [] })
      .mockResolvedValueOnce({
        finishReason: "stop",
        content: "§ 16 EStG ist die Rechtsgrundlage [Q1]. In der abgefragten BFG-KB wurden keine Treffer gefunden [Q2].",
        toolCalls: [],
      });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Welche BFG-Rechtsprechung gibt es zu Werbungskosten?" }],
    });

    expect(callTool).toHaveBeenCalledTimes(2);
    expect(result.answer).toContain("keine Treffer gefunden [Q2]");
  });

  it("fails closed when the mandatory law search returns a soft database error", async () => {
    mockMcp(() => "Datenbankfehler: Zeitüberschreitung");

    await expect(runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Welche Werbungskosten gelten?" }],
    })).rejects.toMatchObject({ status: 503 });

    expect(mockedChatCompletion).not.toHaveBeenCalled();
  });

  it.each([
    "",
    "Keine Treffer.",
    "[]",
    "{}",
    '{"results":[]}',
  ])("does not treat an empty mandatory result as evidence: %j", async (emptyResult) => {
    const { callTool } = mockMcp(() => emptyResult);

    await expect(runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Welche Werbungskosten gelten?" }],
    })).rejects.toMatchObject({ status: 503 });

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(mockedChatCompletion).not.toHaveBeenCalled();
  });

  it("fails closed when the MCP exposes no routable law search", async () => {
    const openToolSession = vi.fn().mockResolvedValue({ sessionId: "no-law-session", tools: [] });
    const callTool = vi.fn();
    MockedMcpClient.mockImplementation(function MockMcpClient() {
      return { openToolSession, callTool } as unknown as McpClient;
    });

    await expect(runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Welche Werbungskosten gelten?" }],
    })).rejects.toMatchObject({ status: 503 });

    expect(callTool).not.toHaveBeenCalled();
    expect(mockedChatCompletion).not.toHaveBeenCalled();
  });

  it.each([
    { properties: { query: { type: "string" } }, reason: "missing source id" },
    { properties: { kb_id: { type: "string" } }, reason: "missing query" },
    {
      properties: { query: { type: "string" }, kb_name: { type: "string" } },
      reason: "source name instead of stable id",
    },
  ])("fails closed for an insecure mandatory route: $reason", async ({ properties }) => {
    const openToolSession = vi.fn().mockResolvedValue({
      sessionId: "insecure-law-session",
      tools: [hybridSearchTool(properties)],
    });
    const callTool = vi.fn();
    MockedMcpClient.mockImplementation(function MockMcpClient() {
      return { openToolSession, callTool } as unknown as McpClient;
    });

    await expect(runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Welche Werbungskosten gelten?" }],
    })).rejects.toMatchObject({ status: 503 });

    expect(callTool).not.toHaveBeenCalled();
    expect(mockedChatCompletion).not.toHaveBeenCalled();
  });

  it.each([
    ["question", "knowledge_base_id"],
    ["search_query", "knowledgeBaseId"],
  ])("accepts schema-declared query/source aliases %s and %s", async (queryAlias, kbAlias) => {
    const question = "Welche Werbungskosten gelten?";
    const openToolSession = vi.fn().mockResolvedValue({
      sessionId: "aliased-law-session",
      tools: [hybridSearchTool({
        [queryAlias]: { type: "string" },
        [kbAlias]: { type: "string" },
      })],
    });
    const callTool = vi.fn().mockResolvedValue("Werbungskosten nach § 16 Abs. 1 EStG 1988.");
    MockedMcpClient.mockImplementation(function MockMcpClient() {
      return { openToolSession, callTool } as unknown as McpClient;
    });
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "stop", content: "Entwurf.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "§ 16 EStG [Q1] ist maßgeblich.", toolCalls: [] });

    await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: question }],
    });

    expect(callTool).toHaveBeenCalledWith(expect.objectContaining({
      name: "hybrid_search",
      arguments: {
        [queryAlias]: question,
        [kbAlias]: RESEARCH_SOURCES.GESETZE.kbId,
      },
    }));
  });

  it("runs explicitly requested Win ANV and FEXklusiv after the law search", async () => {
    const openToolSession = vi.fn().mockResolvedValue({
      sessionId: "internal-practice-session",
      tools: [
        hybridSearchTool(),
        {
          name: "faq_search",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
              kb_id: { type: "string" },
            },
          },
        },
      ],
    });
    const callTool = vi.fn().mockImplementation((request: { arguments: Record<string, unknown> }) =>
      `Beleg aus ${String(request.arguments.kb_id)}.`,
    );
    MockedMcpClient.mockImplementation(function MockMcpClient() {
      return { openToolSession, callTool } as unknown as McpClient;
    });
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "stop", content: "Entwurf.", toolCalls: [] })
      .mockResolvedValueOnce({
        finishReason: "stop",
        content: "Die angefragte interne Praxis wurde recherchiert. [Q1] [Q2] [Q3]",
        toolCalls: [],
      });

    await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{
        role: "user",
        content: "Was sagen Win ANV und FEXklusiv zu diesem Werbungskostenfall?",
      }],
    });

    expect(callTool.mock.calls.map(([request]) => request.arguments.kb_id)).toEqual([
      RESEARCH_SOURCES.GESETZE.kbId,
      RESEARCH_SOURCES.WIN_ANV.kbId,
      RESEARCH_SOURCES.FEXKLUSIV.kbId,
    ]);
    expect(mockedChatCompletion).toHaveBeenCalledTimes(2);
  });

  it("routes a pure internal organization question directly to work aids", async () => {
    const { callTool } = mockMcp(() => "Laut OHB ist CC Scan der Dienststelle A zugeordnet.");
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "stop", content: "Entwurf.", toolCalls: [] })
      .mockResolvedValueOnce({
        finishReason: "stop",
        content: "Laut OHB ist CC Scan der Dienststelle A zugeordnet [Q1].",
        toolCalls: [],
      });

    await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Welche Dienststelle ist laut OHB für CC Scan zuständig?" }],
    });

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith(expect.objectContaining({
      arguments: expect.objectContaining({ kb_id: RESEARCH_SOURCES.ARBEITSBEHELFE.kbId }),
    }));
  });

  it("blocks an optional model-selected search when the raw route cannot carry its KB id", async () => {
    const openToolSession = vi.fn().mockResolvedValue({
      sessionId: "unscoped-optional-session",
      tools: [
        hybridSearchTool(),
        {
          name: "faq_search",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
          },
        },
      ],
    });
    const callTool = vi.fn().mockResolvedValue("§ 16 Abs. 1 EStG 1988 ist einschlägig.");
    MockedMcpClient.mockImplementation(function MockMcpClient() {
      return { openToolSession, callTool } as unknown as McpClient;
    });
    mockedChatCompletion.mockResolvedValueOnce({
      finishReason: "tool_calls",
      content: "Interne Praxis prüfen.",
      toolCalls: [{
        id: "unscoped-win-anv",
        name: "search_win_anv",
        arguments: JSON.stringify({ query: "Werbungskosten interne Praxis" }),
      }],
    });

    await expect(runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Welche Werbungskosten gelten?" }],
    })).rejects.toMatchObject({ status: 503 });

    expect(callTool).toHaveBeenCalledTimes(1);
  });

  it("adds a bounded attachment extract to the mandatory law query", async () => {
    const { callTool } = mockMcp(() => "Kinderbetreuungskosten nach § 16 Abs. 1 EStG 1988.");
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "stop", content: "Entwurf.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "§ 16 EStG [Q1] ist anhand des Bescheids [Q2] zu prüfen.", toolCalls: [] });

    await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Bitte den angehängten Bescheid prüfen." }],
      pdfContext: {
        filename: "Bescheid.pdf",
        content: "Streitpunkt sind Kinderbetreuungskosten der Tagesmutter.",
      },
    });

    const query = String(callTool.mock.calls[0]?.[0].arguments.query);
    expect(query).toContain("Bitte den angehängten Bescheid prüfen.");
    expect(query).toContain("Bescheid.pdf");
    expect(query).toContain("Kinderbetreuungskosten der Tagesmutter");
  });

  it("keeps greetings free of MCP research", async () => {
    const openToolSession = vi.fn();
    MockedMcpClient.mockImplementation(function MockMcpClient() {
      return { openToolSession, callTool: vi.fn() } as unknown as McpClient;
    });
    mockedChatCompletion.mockResolvedValueOnce({
      finishReason: "stop",
      content: "# 👋 Willkommen\n\nWie kann ich helfen?",
      toolCalls: [],
    });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Hallo" }],
    });

    expect(openToolSession).not.toHaveBeenCalled();
    expect(result.answer).not.toContain("Überblick");
  });

  it("corrects an invented legal reference against successful tool evidence", async () => {
    const { callTool } = mockMcp(() => "Werbungskosten nach § 16 Abs. 1 EStG 1988.");
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "stop", content: "Entwurf.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "§ 20 EStG [Q1] ist maßgeblich.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "§ 16 EStG [Q1] ist maßgeblich.", toolCalls: [] });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Welche Werbungskosten gelten?" }],
    });

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(result.answer).toContain("§ 16 EStG [Q1]");
    expect(result.answer).not.toContain("§ 20 EStG");
    expect(mockedChatCompletion).toHaveBeenCalledTimes(3);
  });

  it("corrects a materially unsupported claim despite a formally valid Q citation", async () => {
    const { callTool } = mockMcp(() =>
      "§ 16 EStG. Tagesmütter können beruflich veranlasste Fahrtkosten geltend machen.",
    );
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "stop", content: "Entwurf.", toolCalls: [] })
      .mockResolvedValueOnce({
        finishReason: "stop",
        content: "§ 16 EStG [Q1]. Tagesmütter können sämtliche privaten Lebenshaltungskosten uneingeschränkt abziehen.",
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        finishReason: "stop",
        content: "Beruflich bedingte Fahrtaufwendungen einer Tagesmutter können nach § 16 EStG berücksichtigt werden [Q1].",
        toolCalls: [],
      });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Kann eine Tagesmutter Werbungskosten geltend machen?" }],
    });

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(result.answer).toContain("Beruflich bedingte Fahrtaufwendungen");
    expect(result.answer).not.toContain("Lebenshaltungskosten");
    expect(mockedChatCompletion).toHaveBeenCalledTimes(3);
    expect(mockedChatCompletion.mock.calls[2]?.[0].messages.at(-1)?.content)
      .toContain("inhaltlich nicht belegt");
  });

  it("does not emit an answer when the one correction remains ungrounded", async () => {
    mockMcp(() => "Werbungskosten nach § 16 Abs. 1 EStG 1988.");
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "stop", content: "Entwurf.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "§ 20 EStG [Q1] ist maßgeblich.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "§ 20 EStG [Q1] bleibt maßgeblich.", toolCalls: [] });

    await expect(runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Welche Werbungskosten gelten?" }],
    })).rejects.toMatchObject({ status: 502 });
  });
});
