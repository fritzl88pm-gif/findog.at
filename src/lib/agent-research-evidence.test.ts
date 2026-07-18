import { beforeEach, describe, expect, it, vi } from "vitest";

import { runAgent as runAgentWithSystemPrompt, type RunAgentOptions } from "./agent";
import { chatCompletion } from "./deepseek";
import type { LlmRuntime } from "./llm/runtime";
import { McpClient } from "./mcp/client";
import type { ResearchEvidenceDraft } from "./research-evidence";
import type { ResearchMemoryCard } from "./research-memory-cards";
import { RESEARCH_SOURCES } from "./research-sources";

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
const TEST_STICHTAG = {
  kind: "explicit",
  stichtag: "2026-07-18",
  matchedText: "18.07.2026",
} as const;

function runAgent(options: Omit<RunAgentOptions, "systemPrompt">) {
  return runAgentWithSystemPrompt({ ...options, systemPrompt: TEST_SYSTEM_PROMPT });
}

function mockDetailedMcpResult(options: {
  text: string;
  structuredContent?: Record<string, unknown>;
}) {
  const callTool = vi.fn().mockRejectedValue(
    new Error("callTool must not be used when callToolDetailed is available"),
  );
  const callToolDetailed = vi.fn().mockResolvedValue({
    text: options.text,
    structuredContent: options.structuredContent,
    isError: false,
  });
  MockedMcpClient.mockImplementation(function MockMcpClient() {
    return {
      openToolSession: vi.fn().mockResolvedValue({
        sessionId: "mcp-session",
        tools: [{
          name: "hybrid_search",
          description: "Search scoped knowledge bases",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
              kb_id: { type: "string" },
              limit: { type: "number" },
            },
          },
        }],
      }),
      callTool,
      callToolDetailed,
    } as unknown as McpClient;
  });
  return { callTool, callToolDetailed };
}

function mockOneBfgResearchRound() {
  mockedChatCompletion
    .mockResolvedValueOnce({
      finishReason: "tool_calls",
      content: "Die BFG-Rechtsprechung wird geprüft.",
      toolCalls: [{
        id: "research-1",
        name: "search_bfg",
        arguments: JSON.stringify({ query: "Werbungskosten Fortbildung" }),
      }],
    })
    .mockResolvedValueOnce({
      finishReason: "stop",
      content: "Vorläufige Auswertung.",
      toolCalls: [],
    })
    .mockResolvedValueOnce({
      finishReason: "stop",
      content: "Abschließende Antwort auf Grundlage der Recherche.",
      toolCalls: [],
    });
}

describe("runAgent research evidence", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps the full MCP payload while the UI step is shortened and generates cards once", async () => {
    const resultTail = "FULL_EVIDENCE_TAIL_9f3c";
    const fullResult = `BFG Treffer: ${"A".repeat(1_700)} ${resultTail}`;
    const structuredContent = {
      hits: [{ decisionId: "RV/1234-W/2025", chunk: 3 }],
      total: 1,
    };
    const { callTool, callToolDetailed } = mockDetailedMcpResult({
      text: fullResult,
      structuredContent,
    });
    const effectiveQuery = [
      "Werbungskosten Fortbildung",
      "Verbindlicher Rechtsstand/Stichtag: 2026-07-18",
    ].join("\n");
    mockOneBfgResearchRound();
    const generateResearchMemoryCards = vi.fn(
      async (evidence: ResearchEvidenceDraft[]): Promise<ResearchMemoryCard[]> => [{
        id: "card-1",
        summary: "Kurze, modellgenerierte Memory Card.",
        topics: ["Werbungskosten", "Fortbildung"],
        evidenceIds: [evidence[0].id],
        generatedBy: "llm",
        requeryRequired: true,
      }],
    );

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{
        role: "user",
        content: "Welche BFG-Rechtsprechung gibt es zu Fortbildungskosten?",
      }],
      researchResultLimit: 7,
      researchStichtag: TEST_STICHTAG,
      generateResearchMemoryCards,
    });

    expect(callTool).not.toHaveBeenCalled();
    expect(callToolDetailed).toHaveBeenCalledOnce();
    expect(callToolDetailed).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "mcp-session",
      name: "hybrid_search",
      arguments: {
        kb_id: RESEARCH_SOURCES.BFG.kbId,
        query: effectiveQuery,
        limit: 7,
      },
    }));

    const evidence = result.researchEvidence?.[0];
    expect(evidence).toBeDefined();
    expect(evidence).toMatchObject({
      evidenceOrder: 0,
      semanticToolName: "search_bfg",
      semanticArguments: { query: "Werbungskosten Fortbildung" },
      rawToolName: "hybrid_search",
      effectiveArguments: {
        kb_id: RESEARCH_SOURCES.BFG.kbId,
        query: effectiveQuery,
        limit: 7,
      },
      source: {
        key: "BFG",
        name: RESEARCH_SOURCES.BFG.name,
        kbId: RESEARCH_SOURCES.BFG.kbId,
        system: null,
      },
      stichtag: TEST_STICHTAG,
      structuredContent,
      content: fullResult,
      originalContentChars: fullResult.length,
      contentTruncated: false,
      resultLimit: 7,
      kind: "discovery",
      requeryRequired: true,
    });

    const resultStepOrder = result.steps.findIndex((step) =>
      step.type === "tool_result" && step.toolName === "search_bfg"
    );
    expect(resultStepOrder).toBeGreaterThanOrEqual(0);
    expect(evidence?.resultStepOrder).toBe(resultStepOrder);
    const visibleResultStep = result.steps[resultStepOrder];
    expect(visibleResultStep).toMatchObject({
      type: "tool_result",
      toolName: "search_bfg",
      success: true,
    });
    expect(visibleResultStep.content.endsWith("... [gekürzt]")).toBe(true);
    expect(visibleResultStep.content).not.toContain(resultTail);
    expect(visibleResultStep.content.length).toBeLessThan(fullResult.length);

    expect(generateResearchMemoryCards).toHaveBeenCalledOnce();
    expect(generateResearchMemoryCards).toHaveBeenCalledWith(result.researchEvidence);
    expect(result.researchMemoryCards).toEqual([{
      id: "card-1",
      summary: "Kurze, modellgenerierte Memory Card.",
      topics: ["Werbungskosten", "Fortbildung"],
      evidenceIds: [evidence?.id],
      generatedBy: "llm",
      requeryRequired: true,
    }]);
  });

  it("falls back to a claim-free card when the memory generator fails", async () => {
    const resultTail = "MUST_NOT_LEAK_INTO_FALLBACK";
    mockDetailedMcpResult({
      text: `BFG Treffer mit Aussage ${resultTail}`,
      structuredContent: { hits: [{ decisionId: "RV/4321-W/2025" }] },
    });
    mockOneBfgResearchRound();
    const generateResearchMemoryCards = vi.fn(
      async (): Promise<ResearchMemoryCard[]> => {
        throw new Error("Memory model unavailable");
      },
    );

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{
        role: "user",
        content: "Welche BFG-Rechtsprechung gibt es zu Fortbildungskosten?",
      }],
      researchResultLimit: 7,
      researchStichtag: TEST_STICHTAG,
      generateResearchMemoryCards,
    });

    expect(generateResearchMemoryCards).toHaveBeenCalledOnce();
    expect(result.researchEvidence).toHaveLength(1);
    expect(result.researchMemoryCards).toHaveLength(1);
    expect(result.researchMemoryCards?.[0]).toMatchObject({
      generatedBy: "fallback",
      evidenceIds: [result.researchEvidence?.[0].id],
      requeryRequired: true,
    });
    expect(result.researchMemoryCards?.[0].summary).not.toContain(resultTail);
  });

  it("batches successful evidence from multiple tool iterations into one memory-generator call", async () => {
    const { callToolDetailed } = mockDetailedMcpResult({ text: "Erster Treffer" });
    callToolDetailed
      .mockResolvedValueOnce({ text: "Erster Treffer", isError: false })
      .mockResolvedValueOnce({ text: "Zweiter Treffer", isError: false });
    mockedChatCompletion
      .mockResolvedValueOnce({
        finishReason: "tool_calls",
        content: "Erste Quellenabfrage.",
        toolCalls: [{
          id: "research-1",
          name: "search_bfg",
          arguments: JSON.stringify({ query: "Fortbildung" }),
        }],
      })
      .mockResolvedValueOnce({
        finishReason: "tool_calls",
        content: "Zweite Quellenabfrage nach Auswertung des ersten Treffers.",
        toolCalls: [{
          id: "research-2",
          name: "search_bfg",
          arguments: JSON.stringify({ query: "Umschulung" }),
        }],
      })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Auswertung.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Finale Antwort.", toolCalls: [] });
    const generateResearchMemoryCards = vi.fn(
      async (evidence: ResearchEvidenceDraft[]): Promise<ResearchMemoryCard[]> =>
        evidence.map((item, index) => ({
          id: `card-${index}`,
          summary: `Hinweis ${index}`,
          topics: ["BFG"],
          evidenceIds: [item.id],
          generatedBy: "llm",
          requeryRequired: true,
        })),
    );

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Vergleiche BFG-Fälle zu Fortbildung und Umschulung." }],
      researchResultLimit: 7,
      researchStichtag: TEST_STICHTAG,
      generateResearchMemoryCards,
    });

    expect(callToolDetailed).toHaveBeenCalledTimes(2);
    expect(result.researchEvidence).toHaveLength(2);
    expect(result.researchEvidence?.map((evidence) => evidence.semanticArguments)).toEqual([
      { query: "Fortbildung" },
      { query: "Umschulung" },
    ]);
    expect(generateResearchMemoryCards).toHaveBeenCalledOnce();
    expect(generateResearchMemoryCards).toHaveBeenCalledWith(result.researchEvidence);
    expect(result.researchMemoryCards).toHaveLength(2);
  });
});
