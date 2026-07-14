import { beforeEach, describe, expect, it, vi } from "vitest";

import { chatCompletion } from "./deepseek";
import { McpClient } from "./mcp/client";
import { runAgent } from "./agent";

vi.mock("./deepseek", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./deepseek")>();
  return { ...actual, chatCompletion: vi.fn() };
});

vi.mock("./mcp/client", () => ({ McpClient: vi.fn() }));

const mockedChatCompletion = vi.mocked(chatCompletion);
const MockedMcpClient = vi.mocked(McpClient);
const BFG_KB_ID = "7e203a75-9e51-4839-afd4-7d24d2e5b033";
const FRED_WIKI_KB_ID = "9ddef4d4-79c3-4910-a312-604360720ac3";

function deepSeekTool(name: string) {
  return {
    type: "function" as const,
    function: {
      name,
      description: `Tool ${name}`,
      parameters: { type: "object" },
    },
  };
}

function scopedHybridSearchTool() {
  return {
    name: "hybrid_search",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        kb_id: { type: "string" },
        year: { type: "integer" },
        as_of: { type: "string" },
      },
    },
  };
}

function mockSession(callTool = vi.fn().mockResolvedValue("Amtlicher Betragswert mit nachvollziehbarer Quelle.")) {
  MockedMcpClient.mockImplementation(function MockMcpClient() {
    return {
      openToolSession: vi.fn().mockResolvedValue({
        sessionId: "session-1",
        tools: [
          scopedHybridSearchTool(),
          {
            name: "faq_search",
            inputSchema: { type: "object", properties: { query: { type: "string" } } },
          },
          {
            name: "wiki_search",
            inputSchema: { type: "object", properties: { query: { type: "string" } } },
          },
        ],
        deepSeekTools: [
          deepSeekTool("hybrid_search"),
          deepSeekTool("faq_search"),
          deepSeekTool("wiki_search"),
        ],
      }),
      callTool,
    } as unknown as McpClient;
  });
  return callTool;
}

describe("runAgent retrieval policy", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps the 2024 Unterhaltsabsetzbetrag question out of BFG and preserves its year", async () => {
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

    expect(result.tools).toEqual(["hybrid_search"]);
    expect(callTool).toHaveBeenCalledTimes(2);
    expect(callTool.mock.calls.map(([request]) => request.arguments.kb_id)).toEqual([
      FRED_WIKI_KB_ID,
      "30ac8ebb-13b6-462a-ada0-a35e63f99dbb",
    ]);
    for (const [request] of callTool.mock.calls) {
      expect(request.name).toBe("hybrid_search");
      expect(request.arguments).toEqual(expect.objectContaining({
        query: expect.stringContaining("2024"),
        year: 2024,
      }));
      expect(request.arguments).not.toHaveProperty("as_of");
      expect(JSON.stringify(request.arguments)).not.toContain(BFG_KB_ID);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.answer).toBe("Der Betrag gilt im Veranlagungsjahr 2024.");
    expect(result.answer).not.toMatch(/\bBFG\b|RV\/\d+/u);
    expect(result.steps.some((step) => step.type === "citation_verification")).toBe(false);

    const finalPrompt = mockedChatCompletion.mock.calls.at(-1)?.[0].messages
      .map((message) => message.content ?? "")
      .join("\n");
    expect(finalPrompt).not.toContain("Findok-Verifikation der BFG-Fundstellen");
    expect(finalPrompt).toContain("Nenne keine BFG-Entscheidungen");
    expect(finalPrompt).toContain("Veranlagungsjahr 2024");
    const persistedArguments = result.steps
      .filter((step) => step.type === "tool_call")
      .map((step) => step.arguments ?? "")
      .join("\n");
    expect(persistedArguments).toContain(FRED_WIKI_KB_ID);
    expect(persistedArguments).toContain("2024");
    expect(persistedArguments).not.toContain(BFG_KB_ID);
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

      expect(callTool).toHaveBeenCalledTimes(2);
      expect(callTool.mock.calls.map(([request]) => request.arguments.kb_id)).toEqual([
        FRED_WIKI_KB_ID,
        "30ac8ebb-13b6-462a-ada0-a35e63f99dbb",
      ]);
      for (const [request] of callTool.mock.calls) {
        expect(request.arguments).toEqual(expect.objectContaining({
          query: expect.stringMatching(/2026.*2026-07-14/u),
          year: 2026,
          as_of: "2026-07-14",
        }));
      }
      expect(mockedChatCompletion).toHaveBeenCalledTimes(1);
      const finalPrompt = mockedChatCompletion.mock.calls.at(-1)?.[0].messages
        .map((message) => message.content ?? "")
        .join("\n");
      expect(finalPrompt).toContain("Stichtag 2026-07-14");
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

    expect(callTool).toHaveBeenCalledTimes(2);
    for (const [request] of callTool.mock.calls) {
      expect(request.arguments).toEqual(expect.objectContaining({
        query: expect.stringContaining("2024-07-01"),
        as_of: "2024-07-01",
        year: 2024,
      }));
      expect(JSON.stringify(request.arguments)).not.toContain("2024-12-31");
    }
    expect(mockedChatCompletion).toHaveBeenCalledTimes(1);
  });

  it("recognizes the short amount form and performs exactly two scoped source checks", async () => {
    const callTool = mockSession();
    mockedChatCompletion.mockResolvedValueOnce({
      content: "Kurzantwort, Rechtsstand 2024.",
      toolCalls: [],
    });

    const result = await runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Unterhaltsabsetzbetrag 2024?" }],
    });

    expect(callTool).toHaveBeenCalledTimes(2);
    expect(result.steps.filter((step) => step.type === "tool_call")).toHaveLength(2);
    expect(mockedChatCompletion).toHaveBeenCalledTimes(1);
    expect(callTool.mock.calls.map(([request]) => request.arguments.kb_id)).toEqual([
      FRED_WIKI_KB_ID,
      "30ac8ebb-13b6-462a-ada0-a35e63f99dbb",
    ]);
    for (const [request] of callTool.mock.calls) {
      expect(request.arguments.query).toContain("2024");
    }
  });

  it("checks two requested years separately without enabling BFG", async () => {
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

    expect(result.tools).toEqual(["hybrid_search"]);
    expect(callTool).toHaveBeenCalledTimes(2);
    expect(callTool.mock.calls.map(([request]) => request.arguments.year)).toEqual([2023, 2024]);
    for (const [index, [request]] of callTool.mock.calls.entries()) {
      const expectedYear = index === 0 ? "2023" : "2024";
      const otherYear = index === 0 ? "2024" : "2023";
      expect(request.arguments.kb_id).toBe(FRED_WIKI_KB_ID);
      expect(request.arguments.query).toContain(expectedYear);
      expect(request.arguments.query).not.toContain(otherYear);
    }
    const finalPrompt = mockedChatCompletion.mock.calls[0]?.[0].messages
      .map((message) => message.content ?? "")
      .join("\n");
    expect(finalPrompt).toContain("Rechtsstände 2023 und 2024 getrennt");
    expect(finalPrompt).toContain("Nenne keine BFG-Entscheidungen");
  });

  it("does not answer a year comparison when one requested legal version is missing", async () => {
    const callTool = mockSession(
      vi.fn()
        .mockResolvedValueOnce("Betrag für 2023.")
        .mockRejectedValueOnce(new Error("Kein belastbarer Treffer für 2024.")),
    );

    await expect(runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Wie hoch war der Unterhaltsabsetzbetrag 2023 und 2024?" }],
    })).rejects.toMatchObject({ status: 502 });

    expect(callTool).toHaveBeenCalledTimes(2);
    expect(mockedChatCompletion).not.toHaveBeenCalled();
  });

  it("does not mistake the statute title EStG 1988 for a requested comparison year", async () => {
    const callTool = mockSession();
    mockedChatCompletion.mockResolvedValueOnce({
      content: "Kurzantwort für das Veranlagungsjahr 2024.",
      toolCalls: [],
    });

    await runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Wie hoch ist der Unterhaltsabsetzbetrag 2024 nach § 33 EStG 1988?" }],
    });

    expect(callTool).toHaveBeenCalledTimes(2);
    for (const [request] of callTool.mock.calls) {
      expect(request.arguments.year).toBe(2024);
      expect(request.arguments.query).toContain("EStG 1988");
    }
    const finalPrompt = mockedChatCompletion.mock.calls[0]?.[0].messages
      .map((message) => message.content ?? "")
      .join("\n");
    expect(finalPrompt).toContain("Veranlagungsjahr 2024");
    expect(finalPrompt).not.toContain("Rechtsstände 2024 und 1988");
  });

  it.each([
    "Wie hoch ist die Familienbeihilfe 2024 für ein am 1.7.2010 geborenes Kind?",
    "Wie hoch ist die Familienbeihilfe 2024 für ein Kind mit Geburtsdatum am 1.7.2010?",
    "Wie hoch ist die Familienbeihilfe 2024 für ein Kind, das am 1.7.2010 zur Welt gekommen ist?",
  ])("keeps a child's birth date as factual context instead of using it as the legal cutoff: %s", async (question) => {
    const callTool = mockSession();
    mockedChatCompletion.mockResolvedValueOnce({
      content: "Familienbeihilfe im Jahr 2024.",
      toolCalls: [],
    });

    await runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      systemPrompt: "System",
      messages: [{ role: "user", content: question }],
    });

    expect(callTool).toHaveBeenCalledTimes(2);
    for (const [request] of callTool.mock.calls) {
      expect(request.arguments.year).toBe(2024);
      expect(request.arguments.query).toContain("1.7.2010");
      expect(request.arguments).not.toHaveProperty("as_of");
    }
  });

  it("ignores a bare birth year and FLAG 1967 when selecting the legal year", async () => {
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
        content: "Wie hoch ist die Familienbeihilfe 2024 nach FLAG 1967 für ein 2010 geborenes Kind?",
      }],
    });

    expect(callTool).toHaveBeenCalledTimes(2);
    for (const [request] of callTool.mock.calls) {
      expect(request.arguments.year).toBe(2024);
      expect(request.arguments.query).toContain("FLAG 1967");
      expect(request.arguments.query).toContain("2010 geborenes Kind");
    }
  });

  it("routes other standard amount names such as Familienbonus Plus through the simple path", async () => {
    const callTool = mockSession();
    mockedChatCompletion.mockResolvedValueOnce({
      content: "Familienbonus Plus im Veranlagungsjahr 2024.",
      toolCalls: [],
    });

    const result = await runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Wie hoch ist der Familienbonus Plus 2024?" }],
    });

    expect(result.tools).toEqual(["hybrid_search"]);
    expect(callTool).toHaveBeenCalledTimes(2);
  });

  it("fails closed when no safely scoped amount-search tool is available", async () => {
    const callTool = vi.fn();
    MockedMcpClient.mockImplementation(function MockMcpClient() {
      return {
        openToolSession: vi.fn().mockResolvedValue({
          sessionId: "session-1",
          tools: [{
            name: "hybrid_search",
            inputSchema: {
              type: "object",
              properties: { query: { type: "string" }, kb_id: { type: "string" } },
            },
          }],
          deepSeekTools: [deepSeekTool("hybrid_search")],
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

  it.each(["Keine Treffer.", "Keine relevanten Treffer gefunden.", "No results found."])(
    "does not treat an empty search result as a reliable amount source: %s",
    async (emptyResult) => {
      const callTool = mockSession(vi.fn().mockResolvedValue(emptyResult));

      await expect(runAgent({
        apiKey: "server-key",
        model: "deepseek-v4-pro",
        systemPrompt: "System",
        messages: [{ role: "user", content: "Wie hoch ist der Unterhaltsabsetzbetrag 2024?" }],
      })).rejects.toMatchObject({ status: 502 });

      expect(callTool).toHaveBeenCalledTimes(2);
      expect(mockedChatCompletion).not.toHaveBeenCalled();
    },
  );

  it.each([
    "Wie hoch ist der Unterhaltsabsetzbetrag zum Stichtag 31.2.2024?",
    "Wie hoch ist der Unterhaltsabsetzbetrag am 31.2.2024?",
  ])("rejects an invalid explicit legal cutoff before any retrieval: %s", async (question) => {
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

  it("rewrites a simple answer that states an additional wrong legal year", async () => {
    mockSession();
    mockedChatCompletion
      .mockResolvedValueOnce({
        content: "2024: EUR 1. 2025: EUR 2.",
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

    expect(result.answer).not.toContain("2025");
    expect(mockedChatCompletion).toHaveBeenCalledTimes(2);
  });

  it("does not expose a simple answer that still contains judicature after correction", async () => {
    mockSession();
    mockedChatCompletion.mockResolvedValue({
      content: "Der Verwaltungsgerichtshof bestätigt den Betrag für 2024.",
      toolCalls: [],
    });

    await expect(runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Wie hoch ist der Unterhaltsabsetzbetrag 2024?" }],
    })).rejects.toMatchObject({ status: 502 });
    expect(mockedChatCompletion).toHaveBeenCalledTimes(2);
  });

  it("verifies relevant BFG hits but never appends decisions omitted by the final answer", async () => {
    const gzs = ["RV/2100543/2025", "RV/1100373/2020", "RV/1100299/2020"];
    const callTool = mockSession(vi.fn().mockResolvedValue(`Treffer: ${gzs.join(", ")}`));
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const decoded = decodeURIComponent(String(input));
      const gz = gzs.find((item) => decoded.includes(item));
      if (!gz) {
        return new Response("nicht gefunden", { status: 404 });
      }
      return new Response(JSON.stringify({
        dokumentId: gz.replace(/\D/g, ""),
        segmentId: "segment",
        indexName: "findok-bfg",
        dokumentPdfMediaUrl: `findok/resources/pdf/segment/${gz.replace(/\D/g, "")}.pdf`,
        dokumentTitel: `BFG, ${gz}`,
        titel: "Unterhaltsabsetzbetrag für Kinder in Drittstaaten",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    mockedChatCompletion
      .mockResolvedValueOnce({
        content: "BFG-Recherche.",
        toolCalls: [{
          id: "bfg-1",
          name: "hybrid_search",
          arguments: JSON.stringify({ query: "Unterhaltsabsetzbetrag Drittstaat", kb_id: BFG_KB_ID }),
        }],
      })
      .mockResolvedValueOnce({ content: "Vorläufige Antwort ohne Geschäftszahl.", toolCalls: [] })
      .mockResolvedValueOnce({ content: "Finale Antwort ohne BFG-Zitat.", toolCalls: [] });

    const result = await runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Welche BFG-Rechtsprechung gilt für den Unterhaltsabsetzbetrag bei Kindern in Drittstaaten?" }],
    });

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(result.answer).toBe("Finale Antwort ohne BFG-Zitat.");
    for (const gz of gzs) {
      expect(result.answer).not.toContain(gz);
    }
    expect(result.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "citation_verification", content: "3 verifiziert, 0 verworfen." }),
    ]));
  });
});
