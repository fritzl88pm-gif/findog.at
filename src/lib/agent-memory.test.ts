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
const MEMORY_REQUERY_REQUIREMENT = [{
  evidenceId: "memory-evidence-bfg",
  sourceKey: "BFG",
  matchTerms: ["werbungskosten"],
}] as const;

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
      finalResearchMemory: MEMORY_BLOCK,
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

  it("requires a fresh successful tool result before using a discovery memory hint", async () => {
    const callTool = mockSession();
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "stop", content: "Rechtsantwort nur aus Memory.", toolCalls: [] })
      .mockResolvedValueOnce({
        finishReason: "tool_calls",
        content: "Die Fundstelle wird erneut geprüft.",
        toolCalls: [{
          id: "fresh-1",
          name: "search_bfg",
          arguments: JSON.stringify({ query: "Werbungskosten" }),
        }],
      })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Geprüfte Auswertung.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Finale geprüfte Antwort.", toolCalls: [] });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Welche Voraussetzungen gelten für Werbungskosten?" }],
      researchMemory: MEMORY_BLOCK,
      researchMemoryRequeryRequirements: MEMORY_REQUERY_REQUIREMENT,
    });

    expect(callTool).toHaveBeenCalledOnce();
    expect(mockedChatCompletion).toHaveBeenCalledTimes(4);
    expect(promptAt(-1)).not.toContain(MEMORY_MARKER);
    expect(result.answer).toContain("Finale geprüfte Antwort");
  });

  it("does not bypass a relevant requery requirement when the model says Willkommen", async () => {
    const callTool = mockSession();
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "stop", content: "Willkommen!", toolCalls: [] })
      .mockResolvedValueOnce({
        finishReason: "tool_calls",
        content: "Die relevante Fundstelle wird geprüft.",
        toolCalls: [{
          id: "fresh-after-welcome",
          name: "search_bfg",
          arguments: JSON.stringify({ query: "Werbungskosten" }),
        }],
      })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Geprüfte Auswertung.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Finale geprüfte Antwort.", toolCalls: [] });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Welche Voraussetzungen gelten für Werbungskosten?" }],
      researchMemory: MEMORY_BLOCK,
      researchMemoryRequeryRequirements: MEMORY_REQUERY_REQUIREMENT,
    });

    expect(callTool).toHaveBeenCalledOnce();
    expect(mockedChatCompletion).toHaveBeenCalledTimes(4);
    expect(result.answer).toContain("Finale geprüfte Antwort");
  });

  it("does not accept a usable result from the wrong source as fresh memory research", async () => {
    const callTool = mockSession();
    mockedChatCompletion
      .mockResolvedValueOnce({
        finishReason: "tool_calls",
        content: "Zunächst wird in Gesetzen gesucht.",
        toolCalls: [{
          id: "wrong-source",
          name: "search_laws",
          arguments: JSON.stringify({ query: "Werbungskosten" }),
        }],
      })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Antwort nach falscher Quelle.", toolCalls: [] })
      .mockResolvedValueOnce({
        finishReason: "tool_calls",
        content: "Nun wird die zum Hinweis gehörende Quelle geprüft.",
        toolCalls: [{
          id: "right-source",
          name: "search_bfg",
          arguments: JSON.stringify({ query: "Werbungskosten" }),
        }],
      })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Geprüfte Auswertung.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Finale geprüfte Antwort.", toolCalls: [] });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Welche Voraussetzungen gelten für Werbungskosten?" }],
      researchMemory: MEMORY_BLOCK,
      researchMemoryRequeryRequirements: MEMORY_REQUERY_REQUIREMENT,
    });

    expect(callTool).toHaveBeenCalledTimes(2);
    expect(mockedChatCompletion).toHaveBeenCalledTimes(5);
    expect(result.answer).toContain("Finale geprüfte Antwort");
  });

  it("does not accept an empty result from the matching source as fresh research", async () => {
    const callTool = mockSession();
    callTool
      .mockResolvedValueOnce('{"results":[],"count":0}')
      .mockResolvedValueOnce("Werbungskosten laut aktuellem BFG-Treffer.");
    mockedChatCompletion
      .mockResolvedValueOnce({
        finishReason: "tool_calls",
        content: "Die Fundstelle wird geprüft.",
        toolCalls: [{
          id: "empty-result",
          name: "search_bfg",
          arguments: JSON.stringify({ query: "Werbungskosten" }),
        }],
      })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Antwort trotz Leertreffer.", toolCalls: [] })
      .mockResolvedValueOnce({
        finishReason: "tool_calls",
        content: "Die Quelle wird erneut abgefragt.",
        toolCalls: [{
          id: "usable-result",
          name: "search_bfg",
          arguments: JSON.stringify({ query: "Werbungskosten" }),
        }],
      })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Geprüfte Auswertung.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Finale geprüfte Antwort.", toolCalls: [] });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Welche Voraussetzungen gelten für Werbungskosten?" }],
      researchMemory: MEMORY_BLOCK,
      researchMemoryRequeryRequirements: MEMORY_REQUERY_REQUIREMENT,
    });

    expect(callTool).toHaveBeenCalledTimes(2);
    expect(mockedChatCompletion).toHaveBeenCalledTimes(5);
    expect(result.researchEvidence).toHaveLength(1);
    expect(result.researchEvidence?.[0]?.content).toContain("aktuellem BFG-Treffer");
  });

  it("does not accept a same-source result whose query misses the memory topic", async () => {
    const callTool = mockSession();
    mockedChatCompletion
      .mockResolvedValueOnce({
        finishReason: "tool_calls",
        content: "Eine andere BFG-Frage wird gesucht.",
        toolCalls: [{
          id: "wrong-query",
          name: "search_bfg",
          arguments: JSON.stringify({ query: "Familienbonus" }),
        }],
      })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Antwort nach falscher Suche.", toolCalls: [] })
      .mockResolvedValueOnce({
        finishReason: "tool_calls",
        content: "Die passende Suche wird nachgeholt.",
        toolCalls: [{
          id: "right-query",
          name: "search_bfg",
          arguments: JSON.stringify({ query: "Werbungskosten" }),
        }],
      })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Geprüfte Auswertung.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Finale geprüfte Antwort.", toolCalls: [] });

    await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Welche Voraussetzungen gelten für Werbungskosten?" }],
      researchMemory: MEMORY_BLOCK,
      researchMemoryRequeryRequirements: MEMORY_REQUERY_REQUIREMENT,
    });

    expect(callTool).toHaveBeenCalledTimes(2);
    expect(mockedChatCompletion).toHaveBeenCalledTimes(5);
  });

  it("requires every specific term of a same-source memory requirement", async () => {
    const callTool = mockSession();
    mockedChatCompletion
      .mockResolvedValueOnce({
        finishReason: "tool_calls",
        content: "Zunächst wird nur mit dem gemeinsamen Oberbegriff gesucht.",
        toolCalls: [{
          id: "generic-werbungskosten",
          name: "search_bfg",
          arguments: JSON.stringify({ query: "Werbungskosten" }),
        }],
      })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Antwort nach generischer Suche.", toolCalls: [] })
      .mockResolvedValueOnce({
        finishReason: "tool_calls",
        content: "Nun wird ein spezifischer Hinweis vollständig geprüft.",
        toolCalls: [{
          id: "specific-arbeitszimmer",
          name: "search_bfg",
          arguments: JSON.stringify({ query: "Werbungskosten Arbeitszimmer Fortbildung" }),
        }],
      })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Spezifisch geprüfte Auswertung.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Finale geprüfte Antwort.", toolCalls: [] });

    await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{
        role: "user",
        content: "Was gilt bei Werbungskosten für Arbeitszimmer und Fortbildung?",
      }],
      researchMemory: MEMORY_BLOCK,
      researchMemoryRequeryRequirements: [
        {
          evidenceId: "memory-arbeitszimmer",
          sourceKey: "BFG",
          matchTerms: ["werbungskosten", "arbeitszimmer"],
        },
        {
          evidenceId: "memory-fortbildung",
          sourceKey: "BFG",
          matchTerms: ["werbungskosten", "fortbildung"],
        },
      ],
    });

    expect(callTool).toHaveBeenCalledTimes(2);
    expect(mockedChatCompletion).toHaveBeenCalledTimes(5);
    expect(callTool.mock.calls[0]?.[0]).toMatchObject({
      arguments: expect.objectContaining({ query: expect.stringContaining("Werbungskosten") }),
    });
    expect(callTool.mock.calls[1]?.[0]).toMatchObject({
      arguments: expect.objectContaining({
        query: expect.stringMatching(/Arbeitszimmer.*Fortbildung/u),
      }),
    });
  });

  it("rechecks every relevant discovery card and drops discovery-influenced drafts", async () => {
    const callTool = mockSession();
    mockedChatCompletion
      .mockResolvedValueOnce({
        finishReason: "tool_calls",
        content: "Der erste Hinweis wird geprüft.",
        toolCalls: [{
          id: "first-requery",
          name: "search_bfg",
          arguments: JSON.stringify({ query: "Werbungskosten" }),
        }],
      })
      .mockResolvedValueOnce({
        finishReason: "stop",
        content: "UNVERIFIZIERTE_ZWISCHENANTWORT",
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        finishReason: "tool_calls",
        content: "Der zweite Hinweis wird geprüft.",
        toolCalls: [{
          id: "second-requery",
          name: "search_laws",
          arguments: JSON.stringify({ query: "Familienbonus" }),
        }],
      })
      .mockResolvedValueOnce({
        finishReason: "stop",
        content: "UNVERIFIZIERTER_ENTWURF_NACH_RECHERCHE",
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        finishReason: "stop",
        content: "Finale Antwort nur aus den frischen Werkzeugresultaten.",
        toolCalls: [],
      });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{
        role: "user",
        content: "Was gilt zu Werbungskosten und Familienbonus?",
      }],
      researchMemory: `${MEMORY_BLOCK}\n\n2. [search_laws] Alter Familienbonus-Hinweis`,
      researchMemoryRequeryRequirements: [
        MEMORY_REQUERY_REQUIREMENT[0],
        {
          evidenceId: "memory-evidence-laws",
          sourceKey: "GESETZE",
          matchTerms: ["familienbonus"],
        },
      ],
    });

    expect(callTool).toHaveBeenCalledTimes(2);
    expect(mockedChatCompletion).toHaveBeenCalledTimes(5);
    expect(promptAt(-1)).not.toContain("UNVERIFIZIERTE_ZWISCHENANTWORT");
    expect(promptAt(-1)).not.toContain("UNVERIFIZIERTER_ENTWURF_NACH_RECHERCHE");
    expect(promptAt(-1)).not.toContain(MEMORY_MARKER);
    expect(result.answer).toContain("frischen Werkzeugresultaten");
  });

  it("uses query binding alone when a legacy discovery hint has no source key", async () => {
    const callTool = mockSession();
    mockedChatCompletion
      .mockResolvedValueOnce({
        finishReason: "tool_calls",
        content: "Die passende Suchfrage wird in einer verfügbaren Primärquelle geprüft.",
        toolCalls: [{
          id: "source-less-hint",
          name: "search_laws",
          arguments: JSON.stringify({ query: "Werbungskosten" }),
        }],
      })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Geprüfte Auswertung.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Finale geprüfte Antwort.", toolCalls: [] });

    await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Welche Voraussetzungen gelten für Werbungskosten?" }],
      researchMemory: MEMORY_BLOCK,
      researchMemoryRequeryRequirements: [{
        ...MEMORY_REQUERY_REQUIREMENT[0],
        sourceKey: null,
      }],
    });

    expect(callTool).toHaveBeenCalledOnce();
    expect(mockedChatCompletion).toHaveBeenCalledTimes(3);
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
