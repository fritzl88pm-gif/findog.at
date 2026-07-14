import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runAgent } from "./agent";
import { chatCompletion } from "./deepseek";
import { DEFAULT_SYSTEM_PROMPT } from "./default-system-prompt";
import { McpClient } from "./mcp/client";
import { RESEARCH_SOURCES } from "./research-sources";

vi.mock("./deepseek", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./deepseek")>();
  return { ...actual, chatCompletion: vi.fn() };
});

vi.mock("./mcp/client", () => ({ McpClient: vi.fn() }));

const mockedChatCompletion = vi.mocked(chatCompletion);
const MockedMcpClient = vi.mocked(McpClient);

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

function mockSession(
  callTool = vi.fn().mockImplementation(async (request: { arguments: Record<string, unknown> }) =>
    `Amtlicher Betragswert für ${String(request.arguments.query)} mit nachvollziehbarer Quelle.`,
  ),
) {
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

function finalPrompt(): string {
  return mockedChatCompletion.mock.calls.at(-1)?.[0].messages
    .map((message) => message.content ?? "")
    .join("\n") ?? "";
}

describe("runAgent retrieval policy", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    for (const [callIndex, [options]] of mockedChatCompletion.mock.calls.entries()) {
      const systemMessages = options.messages.filter((message) => message.role === "system");
      expect(systemMessages, `chatCompletion call ${callIndex} must have exactly one system message`)
        .toEqual([{ role: "system", content: DEFAULT_SYSTEM_PROMPT }]);
    }
  });

  it("routes the 2024 Unterhaltsabsetzbetrag question once to the scoped amount-table FAQ", async () => {
    const callTool = mockSession();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mockedChatCompletion.mockResolvedValueOnce({
      content: "Der Betrag gilt im Veranlagungsjahr 2024.",
      toolCalls: [],
    });

    const result = await runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "Wie hoch ist der Unterhaltsabsetzbetrag 2024?" }],
      mcpBearerToken: "mcp-token",
    });

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith(expect.objectContaining({
      name: "faq_search",
      arguments: expect.objectContaining({
        kb_id: RESEARCH_SOURCES.BETRAGSTABELLE.kbId,
        query: expect.stringContaining("2024"),
      }),
    }));
    expect(callTool.mock.calls[0]?.[0].arguments).not.toHaveProperty("year");
    expect(callTool.mock.calls[0]?.[0].arguments).not.toHaveProperty("as_of");
    expect(JSON.stringify(callTool.mock.calls)).not.toContain(RESEARCH_SOURCES.BFG.kbId);
    expect(result.tools).toEqual(["search_amount_table"]);
    expect(result.answer).toBe("Der Betrag gilt im Veranlagungsjahr 2024.");
    expect(result.answer).not.toMatch(/\bBFG\b|RV\/\d+/u);
    expect(result.steps.some((step) => step.type === "citation_verification")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockedChatCompletion).toHaveBeenCalledTimes(1);
    expect(finalPrompt()).toContain("Veranlagungsjahr 2024");
    expect(finalPrompt()).not.toContain("Findok-Verifikation der BFG-Fundstellen");
  });

  it.each([
    ["AVAB", "Alleinverdienerabsetzbetrag"],
    ["AEAB", "Alleinerzieherabsetzbetrag"],
    ["UAB", "Unterhaltsabsetzbetrag"],
  ])("expands the amount abbreviation %s before the scoped amount-table query", async (abbreviation, expandedTerm) => {
    const callTool = mockSession();
    mockedChatCompletion.mockResolvedValueOnce({
      content: "Der Betrag gilt im Veranlagungsjahr 2024.",
      toolCalls: [],
    });

    const result = await runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: `Wie hoch ist der ${abbreviation} 2024?` }],
    });

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith(expect.objectContaining({
      name: "faq_search",
      arguments: expect.objectContaining({
        kb_id: RESEARCH_SOURCES.BETRAGSTABELLE.kbId,
        query: expect.stringContaining(expandedTerm),
      }),
    }));
    expect(JSON.stringify(callTool.mock.calls)).not.toContain(RESEARCH_SOURCES.GESETZE.kbId);
    expect(JSON.stringify(callTool.mock.calls)).not.toContain(RESEARCH_SOURCES.BFG.kbId);
    expect(result.tools).toEqual(["search_amount_table"]);
  });

  it("uses the year-segmented amount KB when the MCP exposes no separate year field", async () => {
    const callTool = vi.fn().mockResolvedValue("Unterhaltsabsetzbetrag 2024: belegter Jahreswert.");
    MockedMcpClient.mockImplementation(function MockMcpClient() {
      return {
        openToolSession: vi.fn().mockResolvedValue({
          sessionId: "session-1",
          tools: ["faq_search", "hybrid_search"].map((name) => ({
            name,
            inputSchema: {
              type: "object",
              properties: { query: { type: "string" }, kb_id: { type: "string" } },
            },
          })),
        }),
        callTool,
      } as unknown as McpClient;
    });
    mockedChatCompletion.mockResolvedValueOnce({
      content: "Der Betrag gilt im Veranlagungsjahr 2024.",
      toolCalls: [],
    });

    await runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "Wie hoch ist der Unterhaltsabsetzbetrag 2024?" }],
    });

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith(expect.objectContaining({
      name: "faq_search",
      arguments: {
        query: expect.stringContaining("2024"),
        kb_id: RESEARCH_SOURCES.BETRAGSTABELLE.kbId,
      },
    }));
  });

  it("uses the current Vienna year when a simple amount question omits the year", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:00:00Z"));
    try {
      const callTool = mockSession();
      mockedChatCompletion.mockResolvedValueOnce({
        content: "Kurzantwort für das Jahr 2026.",
        toolCalls: [],
      });

      await runAgent({
        apiKey: "server-key",
        model: "deepseek-v4-pro",
        messages: [{ role: "user", content: "Wie hoch ist der Unterhaltsabsetzbetrag?" }],
      });

      expect(callTool).toHaveBeenCalledTimes(1);
      expect(callTool).toHaveBeenCalledWith(expect.objectContaining({
        name: "faq_search",
        arguments: expect.objectContaining({
          kb_id: RESEARCH_SOURCES.BETRAGSTABELLE.kbId,
          query: expect.stringContaining("2026"),
        }),
      }));
      expect(callTool.mock.calls[0]?.[0].arguments).not.toHaveProperty("year");
      expect(callTool.mock.calls[0]?.[0].arguments).not.toHaveProperty("as_of");
      expect(mockedChatCompletion).toHaveBeenCalledTimes(1);
      expect(finalPrompt()).toContain("Veranlagungsjahr 2026");
      expect(finalPrompt()).not.toContain("Stichtag 2026-07-14");
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves an explicitly requested daily cutoff without inventing a year-end date", async () => {
    const callTool = mockSession();
    mockedChatCompletion.mockResolvedValueOnce({
      content: "Der Unterhaltsabsetzbetrag gilt am Stichtag 2024-07-01.",
      toolCalls: [],
    });

    await runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "Wie hoch war der Unterhaltsabsetzbetrag am 1.7.2024?" }],
    });

    expect(callTool).toHaveBeenCalledTimes(1);
    const request = callTool.mock.calls[0]?.[0];
    expect(request.arguments).toEqual(expect.objectContaining({
      kb_id: RESEARCH_SOURCES.BETRAGSTABELLE.kbId,
      query: expect.stringContaining("2024-07-01"),
    }));
    expect(request.arguments).not.toHaveProperty("year");
    expect(request.arguments).not.toHaveProperty("as_of");
    expect(JSON.stringify(request.arguments)).not.toContain("2024-12-31");
  });

  it("checks two requested years separately and never exceeds two calls", async () => {
    const callTool = mockSession();
    mockedChatCompletion.mockResolvedValueOnce({
      content: "Unterhaltsabsetzbetrag: Veranlagungsjahr 2023 und Veranlagungsjahr 2024.",
      toolCalls: [],
    });

    const result = await runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "Wie hoch war der Unterhaltsabsetzbetrag 2023 und 2024?" }],
    });

    expect(callTool).toHaveBeenCalledTimes(2);
    expect(callTool.mock.calls.map(([request]) => request.name)).toEqual(["faq_search", "faq_search"]);
    for (const [index, [request]] of callTool.mock.calls.entries()) {
      const expectedYear = index === 0 ? "2023" : "2024";
      const otherYear = index === 0 ? "2024" : "2023";
      expect(request.arguments.kb_id).toBe(RESEARCH_SOURCES.BETRAGSTABELLE.kbId);
      expect(request.arguments.query).toContain(expectedYear);
      expect(request.arguments.query).not.toContain(otherYear);
      expect(request.arguments).not.toHaveProperty("year");
      expect(request.arguments).not.toHaveProperty("as_of");
      expect(JSON.stringify(request.arguments)).not.toContain(RESEARCH_SOURCES.BFG.kbId);
    }
    expect(result.tools).toEqual(["search_amount_table"]);
    expect(result.steps.filter((step) => step.type === "tool_call")).toHaveLength(2);
    expect(mockedChatCompletion).toHaveBeenCalledTimes(1);
  });

  it("does not fall back from a pure amount question to laws or BFG", async () => {
    const callTool = mockSession(vi.fn().mockResolvedValue("Keine relevanten Treffer gefunden."));

    await expect(runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "Unterhaltsabsetzbetrag 2024?" }],
    })).rejects.toMatchObject({ status: 502 });

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      name: "faq_search",
      arguments: expect.objectContaining({ kb_id: RESEARCH_SOURCES.BETRAGSTABELLE.kbId }),
    }));
    expect(JSON.stringify(callTool.mock.calls)).not.toContain(RESEARCH_SOURCES.BFG.kbId);
    expect(JSON.stringify(callTool.mock.calls)).not.toContain(RESEARCH_SOURCES.GESETZE.kbId);
    expect(mockedChatCompletion).not.toHaveBeenCalled();
  });

  it("does not answer when the scoped amount source lacks a reliable result", async () => {
    const callTool = mockSession(vi.fn().mockResolvedValue("Keine Treffer."));

    await expect(runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "Wie hoch ist der Unterhaltsabsetzbetrag 2024?" }],
    })).rejects.toMatchObject({
      message: "In der Betragstabelle wurde für das angefragte Jahr kein eindeutig belegter Betrag gefunden.",
      status: 502,
    });

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(mockedChatCompletion).not.toHaveBeenCalled();
  });

  it("fails closed when raw search schemas cannot carry source and year scope", async () => {
    const callTool = vi.fn();
    MockedMcpClient.mockImplementation(function MockMcpClient() {
      return {
        openToolSession: vi.fn().mockResolvedValue({
          sessionId: "session-1",
          tools: [
            { name: "faq_search", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
            { name: "hybrid_search", inputSchema: { type: "object", properties: { query: { type: "string" } } } },
          ],
        }),
        callTool,
      } as unknown as McpClient;
    });

    await expect(runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "Wie hoch ist der Unterhaltsabsetzbetrag 2024?" }],
    })).rejects.toMatchObject({
      message: "Die Betragstabelle ist für diese Anfrage derzeit nicht verfügbar.",
      status: 503,
    });
    expect(callTool).not.toHaveBeenCalled();
    expect(mockedChatCompletion).not.toHaveBeenCalled();
  });

  it.each([
    "Wie hoch ist der Unterhaltsabsetzbetrag zum Stichtag 31.2.2024?",
    "Wie hoch ist der Unterhaltsabsetzbetrag am 31.2.2024?",
  ])("rejects an invalid explicit legal cutoff before retrieval: %s", async (question) => {
    const callTool = mockSession();

    await expect(runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: question }],
    })).rejects.toMatchObject({ status: 400 });
    expect(callTool).not.toHaveBeenCalled();
    expect(mockedChatCompletion).not.toHaveBeenCalled();
  });

  it("treats a contextual amount question as a Fachfrage and searches laws with the full question", async () => {
    const callTool = mockSession();
    const question = "Wie hoch ist die Familienbeihilfe 2024 für ein am 1.7.2010 geborenes Kind?";
    mockedChatCompletion
      .mockResolvedValueOnce({
        content: "Recherchiere Rechtsgrundlagen.",
        toolCalls: [{
          id: "laws-1",
          name: "search_laws",
          arguments: JSON.stringify({ query: "Familienbeihilfe Kind" }),
        }],
      })
      .mockResolvedValueOnce({ content: "Vorläufige Antwort.", toolCalls: [] })
      .mockResolvedValueOnce({ content: "Familienbeihilfe im Jahr 2024.", toolCalls: [] });

    await runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      messages: [{
        role: "user",
        content: question,
      }],
    });

    expect(callTool).toHaveBeenCalledTimes(1);
    const request = callTool.mock.calls[0]?.[0];
    expect(request.name).toBe("hybrid_search");
    expect(request.arguments.kb_id).toBe(RESEARCH_SOURCES.GESETZE.kbId);
    expect(request.arguments.query).toBe(question);
    expect(request.arguments).not.toHaveProperty("year");
    expect(request.arguments).not.toHaveProperty("as_of");
    expect(request.arguments).not.toHaveProperty("limit");
  });

  it("returns a simple amount answer without a second post-answer validation call", async () => {
    mockSession();
    mockedChatCompletion.mockResolvedValueOnce({
      content: "Im angefragten Rechtsstand beträgt der Wert EUR 1.",
      toolCalls: [],
    });

    const result = await runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "Wie hoch ist der Unterhaltsabsetzbetrag 2024?" }],
    });

    expect(result.answer).toBe("Im angefragten Rechtsstand beträgt der Wert EUR 1.");
    expect(mockedChatCompletion).toHaveBeenCalledTimes(1);
  });

  it("performs no hidden BFG prefetch for a general question", async () => {
    const callTool = mockSession();
    mockedChatCompletion
      .mockResolvedValueOnce({ content: "Vorläufige Antwort.", toolCalls: [] })
      .mockResolvedValueOnce({ content: "Finale Antwort.", toolCalls: [] });

    const result = await runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "Welche Voraussetzungen gelten für Werbungskosten?" }],
    });

    expect(callTool).not.toHaveBeenCalled();
    expect(result.answer).toBe("Finale Antwort.");
    expect(result.steps.some((step) => "toolName" in step && step.toolName === "bfg_prefetch")).toBe(false);
    expect(result.steps.some((step) => step.type === "citation_verification")).toBe(false);
  });

  it("queries BFG when selected without a post-retrieval Findok verification", async () => {
    const gz = "RV/2100543/2025";
    const callTool = mockSession(vi.fn().mockResolvedValue(`Treffer: ${gz}`));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mockedChatCompletion
      .mockResolvedValueOnce({
        content: "BFG-Recherche.",
        toolCalls: [{
          id: "bfg-1",
          name: "search_bfg",
          arguments: JSON.stringify({ query: "Unterhaltsabsetzbetrag Drittstaat" }),
        }],
      })
      .mockResolvedValueOnce({ content: "Vorläufige Antwort ohne Geschäftszahl.", toolCalls: [] })
      .mockResolvedValueOnce({ content: "Finale Antwort ohne BFG-Zitat.", toolCalls: [] });

    const result = await runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      messages: [{
        role: "user",
        content: "Welche BFG-Rechtsprechung gilt für den Unterhaltsabsetzbetrag bei Kindern in Drittstaaten?",
      }],
    });

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith(expect.objectContaining({
      name: "hybrid_search",
      arguments: expect.objectContaining({
        query: "Unterhaltsabsetzbetrag Drittstaat",
        kb_id: RESEARCH_SOURCES.BFG.kbId,
      }),
    }));
    expect(result.answer).toBe("Finale Antwort ohne BFG-Zitat.");
    expect(result.answer).not.toContain(gz);
    expect(result.steps.some((step) => step.type === "citation_verification")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.steps.some((step) => "toolName" in step && step.toolName === "bfg_prefetch")).toBe(false);
  });
});
