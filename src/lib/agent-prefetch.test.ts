import { beforeEach, describe, expect, it, vi } from "vitest";

import { runAgent } from "./agent";
import { chatCompletion } from "./deepseek";
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
        year: { type: "integer" },
        as_of: { type: "string" },
        limit: { type: "integer" },
      },
    },
  };
}

function mockSession(
  callTool = vi.fn().mockImplementation(async (request: { arguments: Record<string, unknown> }) =>
    `Amtlicher Betragswert für ${String(request.arguments.year)} mit nachvollziehbarer Quelle.`,
  ),
) {
  MockedMcpClient.mockImplementation(function MockMcpClient() {
    return {
      openToolSession: vi.fn().mockResolvedValue({
        sessionId: "session-1",
        tools: [rawSearchTool("faq_search"), rawSearchTool("hybrid_search")],
        deepSeekTools: [],
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
      systemPrompt: "System",
      messages: [{ role: "user", content: "Wie hoch ist der Unterhaltsabsetzbetrag 2024?" }],
      mcpBearerToken: "mcp-token",
    });

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith(expect.objectContaining({
      name: "faq_search",
      arguments: expect.objectContaining({
        kb_id: RESEARCH_SOURCES.BETRAGSTABELLE.kbId,
        year: 2024,
        query: expect.stringContaining("2024"),
      }),
    }));
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
          deepSeekTools: [],
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
      systemPrompt: "System",
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

  it("uses the current Vienna date when a simple amount question omits the year", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T12:00:00Z"));
    try {
      const callTool = mockSession();
      mockedChatCompletion.mockResolvedValueOnce({
        content: "Kurzantwort mit Stichtag 2026-07-14.",
        toolCalls: [],
      });

      await runAgent({
        apiKey: "server-key",
        model: "deepseek-v4-pro",
        systemPrompt: "System",
        messages: [{ role: "user", content: "Wie hoch ist der Unterhaltsabsetzbetrag?" }],
      });

      expect(callTool).toHaveBeenCalledTimes(1);
      expect(callTool).toHaveBeenCalledWith(expect.objectContaining({
        name: "faq_search",
        arguments: expect.objectContaining({
          kb_id: RESEARCH_SOURCES.BETRAGSTABELLE.kbId,
          year: 2026,
          as_of: "2026-07-14",
          query: expect.stringMatching(/2026.*2026-07-14/u),
        }),
      }));
      expect(mockedChatCompletion).toHaveBeenCalledTimes(1);
      expect(finalPrompt()).toContain("Stichtag 2026-07-14");
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves an explicitly requested daily cutoff without inventing a year-end date", async () => {
    const callTool = mockSession();
    mockedChatCompletion.mockResolvedValueOnce({
      content: "Kurzantwort mit Stichtag 01.07.2024.",
      toolCalls: [],
    });

    await runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Wie hoch war der Unterhaltsabsetzbetrag am 1.7.2024?" }],
    });

    expect(callTool).toHaveBeenCalledTimes(1);
    const request = callTool.mock.calls[0]?.[0];
    expect(request.arguments).toEqual(expect.objectContaining({
      kb_id: RESEARCH_SOURCES.BETRAGSTABELLE.kbId,
      year: 2024,
      as_of: "2024-07-01",
      query: expect.stringContaining("2024-07-01"),
    }));
    expect(JSON.stringify(request.arguments)).not.toContain("2024-12-31");
  });

  it("checks two requested years separately and never exceeds two calls", async () => {
    const callTool = mockSession();
    mockedChatCompletion.mockResolvedValueOnce({
      content: "Getrennter Vergleich für 2023 und 2024.",
      toolCalls: [],
    });

    const result = await runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Wie hoch war der Unterhaltsabsetzbetrag 2023 und 2024?" }],
    });

    expect(callTool).toHaveBeenCalledTimes(2);
    expect(callTool.mock.calls.map(([request]) => request.name)).toEqual(["faq_search", "faq_search"]);
    expect(callTool.mock.calls.map(([request]) => request.arguments.year)).toEqual([2023, 2024]);
    for (const [index, [request]] of callTool.mock.calls.entries()) {
      const expectedYear = index === 0 ? "2023" : "2024";
      const otherYear = index === 0 ? "2024" : "2023";
      expect(request.arguments.kb_id).toBe(RESEARCH_SOURCES.BETRAGSTABELLE.kbId);
      expect(request.arguments.query).toContain(expectedYear);
      expect(request.arguments.query).not.toContain(otherYear);
      expect(JSON.stringify(request.arguments)).not.toContain(RESEARCH_SOURCES.BFG.kbId);
    }
    expect(result.tools).toEqual(["search_amount_table"]);
    expect(result.steps.filter((step) => step.type === "tool_call")).toHaveLength(2);
    expect(mockedChatCompletion).toHaveBeenCalledTimes(1);
  });

  it("falls back once from the amount table to laws without querying BFG", async () => {
    const callTool = mockSession(
      vi.fn()
        .mockResolvedValueOnce("Keine relevanten Treffer gefunden.")
        .mockResolvedValueOnce("Gesetzesfundstelle 2024 mit amtlichem Betragswert."),
    );
    mockedChatCompletion.mockResolvedValueOnce({
      content: "Der Betrag gilt im Veranlagungsjahr 2024.",
      toolCalls: [],
    });

    const result = await runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Unterhaltsabsetzbetrag 2024?" }],
    });

    expect(callTool).toHaveBeenCalledTimes(2);
    expect(callTool.mock.calls.map(([request]) => request.name)).toEqual(["faq_search", "hybrid_search"]);
    expect(callTool.mock.calls.map(([request]) => request.arguments.kb_id)).toEqual([
      RESEARCH_SOURCES.BETRAGSTABELLE.kbId,
      RESEARCH_SOURCES.GESETZE.kbId,
    ]);
    expect(JSON.stringify(callTool.mock.calls)).not.toContain(RESEARCH_SOURCES.BFG.kbId);
    expect(result.tools).toEqual(["search_amount_table", "search_laws"]);
  });

  it("does not answer when both scoped sources lack a reliable result", async () => {
    const callTool = mockSession(vi.fn().mockResolvedValue("Keine Treffer."));

    await expect(runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Wie hoch ist der Unterhaltsabsetzbetrag 2024?" }],
    })).rejects.toMatchObject({ status: 502 });

    expect(callTool).toHaveBeenCalledTimes(2);
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
          deepSeekTools: [],
        }),
        callTool,
      } as unknown as McpClient;
    });

    await expect(runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Wie hoch ist der Unterhaltsabsetzbetrag 2024?" }],
    })).rejects.toMatchObject({ status: 503 });
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
      systemPrompt: "System",
      messages: [{ role: "user", content: question }],
    })).rejects.toMatchObject({ status: 400 });
    expect(callTool).not.toHaveBeenCalled();
    expect(mockedChatCompletion).not.toHaveBeenCalled();
  });

  it("keeps a child's birth date as factual context instead of using it as the legal cutoff", async () => {
    const callTool = mockSession();
    mockedChatCompletion.mockResolvedValueOnce({
      content: "Familienbeihilfe im Jahr 2024.",
      toolCalls: [],
    });

    await runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      systemPrompt: "System",
      messages: [{
        role: "user",
        content: "Wie hoch ist die Familienbeihilfe 2024 für ein am 1.7.2010 geborenes Kind?",
      }],
    });

    expect(callTool).toHaveBeenCalledTimes(1);
    const request = callTool.mock.calls[0]?.[0];
    expect(request.arguments.year).toBe(2024);
    expect(request.arguments.query).toContain("1.7.2010");
    expect(request.arguments).not.toHaveProperty("as_of");
  });

  it("rewrites a forbidden judicature reference before returning a simple amount answer", async () => {
    mockSession();
    mockedChatCompletion
      .mockResolvedValueOnce({
        content: "Nach RV/7103053/2014 beträgt der Wert EUR 1.",
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        content: "Der Wert beträgt im Veranlagungsjahr 2024 EUR 1.",
        toolCalls: [],
      });

    const result = await runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Wie hoch ist der Unterhaltsabsetzbetrag 2024?" }],
    });

    expect(result.answer).toBe("Der Wert beträgt im Veranlagungsjahr 2024 EUR 1.");
    expect(result.answer).not.toMatch(/BFG|Judikatur|Rechtsprechung|RV\//u);
    expect(mockedChatCompletion).toHaveBeenCalledTimes(2);
  });

  it("performs no hidden BFG prefetch for a general question", async () => {
    const callTool = mockSession();
    mockedChatCompletion
      .mockResolvedValueOnce({ content: "Vorläufige Antwort.", toolCalls: [] })
      .mockResolvedValueOnce({ content: "Finale Antwort.", toolCalls: [] });

    const result = await runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Welche Voraussetzungen gelten für Werbungskosten?" }],
    });

    expect(callTool).not.toHaveBeenCalled();
    expect(result.answer).toBe("Finale Antwort.");
    expect(result.steps.some((step) => "toolName" in step && step.toolName === "bfg_prefetch")).toBe(false);
    expect(result.steps.some((step) => step.type === "citation_verification")).toBe(false);
  });

  it("queries and verifies BFG only when the model selects the semantic BFG tool", async () => {
    const gz = "RV/2100543/2025";
    const callTool = mockSession(vi.fn().mockResolvedValue(`Treffer: ${gz}`));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      dokumentId: "21005432025",
      segmentId: "segment",
      indexName: "findok-bfg",
      dokumentPdfMediaUrl: "findok/resources/pdf/segment/21005432025.pdf",
      dokumentTitel: `BFG, ${gz}`,
      titel: "Unterhaltsabsetzbetrag für Kinder in Drittstaaten",
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
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
      systemPrompt: "System",
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
    expect(result.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "citation_verification", content: "1 verifiziert, 0 verworfen." }),
    ]));
    expect(result.steps.some((step) => "toolName" in step && step.toolName === "bfg_prefetch")).toBe(false);
  });
});
