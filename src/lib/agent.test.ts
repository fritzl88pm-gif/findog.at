import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runAgent } from "./agent";
import { chatCompletion } from "./deepseek";
import { DEFAULT_SYSTEM_PROMPT } from "./default-system-prompt";
import { createDeadline } from "./deadline";
import type { LlmRuntime } from "./llm/runtime";
import { McpClient } from "./mcp/client";

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
const withOverview = (content: string) => `# 📘 Überblick\n\n${content}`;

function expectCanonicalSystemMessages(): void {
  for (const [callIndex, [options]] of mockedChatCompletion.mock.calls.entries()) {
    const systemMessages = options.messages.filter((message) => message.role === "system");
    expect(systemMessages, `chatCompletion call ${callIndex} must have exactly one system message`)
      .toEqual([{ role: "system", content: DEFAULT_SYSTEM_PROMPT }]);
  }
}

function expectProtocolSafeMessages(): void {
  for (const [callIndex, call] of mockedChatCompletion.mock.calls.entries()) {
    const messages = call[0].messages;
    for (let index = 1; index < messages.length; index += 1) {
      const previousRole = messages[index - 1]?.role;
      const currentRole = messages[index]?.role;
      expect(
        previousRole === "assistant" && currentRole === "assistant",
        `chatCompletion call ${callIndex} has consecutive assistant messages`,
      ).toBe(false);
      expect(
        previousRole === "user" && currentRole === "user",
        `chatCompletion call ${callIndex} has consecutive user messages`,
      ).toBe(false);
    }
  }
}

describe("runAgent", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    expectCanonicalSystemMessages();
  });

  function mockMcpSession(toolResult = "Gefundene Fachinformation ohne Geschäftszahl.") {
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
              kb_id: { type: "string" },
              vector_threshold: { type: "number" },
              keyword_threshold: { type: "number" },
              limit: { type: "number" },
            },
          },
        },
      ],
    });
    const callTool = vi.fn().mockResolvedValue(toolResult);
    MockedMcpClient.mockImplementation(function MockMcpClient() {
      return { openToolSession, callTool } as unknown as McpClient;
    });
    return { callTool, openToolSession };
  }

  it("uses semantic tool names and the canonical prompt for attachment-free requests", async () => {
    const { callTool } = mockMcpSession();
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "tool_calls",
        content: "Recherche",
        reasoningContent: "Unveränderte interne Werkzeugbegründung",
        toolCalls: [
          {
            id: "call-1",
            name: "search_laws",
            arguments: JSON.stringify({ query: "EStG § 33" }),
          },
        ],
      })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Vorläufige Antwort.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "# 📘 Antwort\n\nFinale Antwort.", toolCalls: [] });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "EStG § 33" }],
      mcpBearerToken: "mcp-token",
    });

    expect(result.answer).toBe(withOverview("Finale Antwort."));
    expect(result.steps.map((step) => step.type)).toEqual([
      "tools",
      "tool_call",
      "tool_result",
      "progress",
      "finalize",
      "answer",
    ]);
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(result.tools).toContain("search_laws");
    expect(result.tools).toContain("search_bfg");
    expect(result.tools).not.toContain("findok_verify_bfg_cases");
    expect(result.tools).not.toContain("hybrid_search");
    expect(mockedChatCompletion.mock.calls[0]?.[0].tools?.map((tool) => tool.function.name))
      .toContain("search_laws");
    expect(mockedChatCompletion.mock.calls[0]?.[0].tools?.map((tool) => tool.function.name))
      .not.toContain("findok_verify_bfg_cases");
    expect(mockedChatCompletion.mock.calls[1]?.[0].messages).toContainEqual(
      expect.objectContaining({
        role: "assistant",
        reasoning_content: "Unveränderte interne Werkzeugbegründung",
      }),
    );

    // The runtime uses the canonical prompt byte-for-byte; attachment content stays outside it.
    expect(mockedChatCompletion.mock.calls[0][0].messages[0]).toEqual({
      role: "system",
      content: DEFAULT_SYSTEM_PROMPT,
    });

    expect(callTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "hybrid_search",
        arguments: expect.objectContaining({
          kb_id: "e0282ab8-b94f-4553-962e-68705201cf9a",
          query: "EStG § 33",
        }),
      }),
    );
    expectProtocolSafeMessages();
  });

  it("persists tool-result evidence up to the dedicated 32,000-character audit limit", async () => {
    const toolResult = "x".repeat(32_001);
    mockMcpSession(toolResult);
    mockedChatCompletion
      .mockResolvedValueOnce({
        finishReason: "tool_calls",
        content: "Recherche",
        toolCalls: [{
          id: "long-result-call",
          name: "search_laws",
          arguments: JSON.stringify({ query: "EStG § 33" }),
        }],
      })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Vorläufige Antwort.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Finale Antwort.", toolCalls: [] });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "EStG § 33" }],
    });
    const persistedToolResult = result.steps.find((step) => step.type === "tool_result");

    expect(persistedToolResult?.content).toBe(`${"x".repeat(32_000)}... [gekürzt]`);
  });

  it("notifies callers for every visible deterministic step", async () => {
    const { callTool } = mockMcpSession();
    const onStep = vi.fn();
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "stop", content: "Vorläufig.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Finale Antwort.", toolCalls: [] });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
      onStep,
    });

    expect(onStep.mock.calls.map(([step]) => step.type)).toEqual(
      result.steps.map((step) => step.type),
    );
    expect(onStep.mock.calls.map(([step]) => step.type)).not.toContain("plan");
    expect(callTool).not.toHaveBeenCalled();
    expect(result.steps.some((step) => step.type === "tool_call")).toBe(false);
    expect(onStep).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "answer", content: withOverview("Finale Antwort.") }),
    );
  });

  it("keeps the non-specialist welcome response free of an overview block", async () => {
    mockMcpSession();
    const welcome = "# 👋 Willkommen\n\nWillkommen! Wie kann ich Ihnen helfen?";
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "stop", content: welcome, toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: welcome, toolCalls: [] });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Hallo" }],
    });

    expect(result.answer).toBe(welcome);
    expect(result.answer).not.toContain("# 📘 Überblick");
  });

  it("removes a standalone guideline-nature lesson from an ordinary specialist answer", async () => {
    mockMcpSession();
    const finalAnswer = [
      "# 📘 Überblick",
      "",
      "Ja, die Aufwendungen können dem Grunde nach Werbungskosten sein.",
      "",
      "📒 **Hinweis zur Rechtsnatur der LStR:**",
      "",
      "Die Lohnsteuerrichtlinien sind ein Auslegungsbehelf der Verwaltung.",
      "",
      "# ⚖️ Gesetzliche Grundlagen",
      "",
      "Die Voraussetzungen sind anhand des EStG zu prüfen.",
    ].join("\n");
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "stop", content: "Vorläufig.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: finalAnswer, toolCalls: [] });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Kann eine Tagesmutter Werbungskosten geltend machen?" }],
    });

    expect(result.answer).not.toContain("Hinweis zur Rechtsnatur");
    expect(result.answer).not.toContain("Auslegungsbehelf der Verwaltung");
    expect(result.answer).toContain("# ⚖️ Gesetzliche Grundlagen");
  });

  it("keeps guideline-nature information when the user explicitly asks for it", async () => {
    mockMcpSession();
    const finalAnswer = "# 📘 Überblick\n\nHinweis zur Rechtsnatur: Die LStR sind ein Auslegungsbehelf.";
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "stop", content: "Vorläufig.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: finalAnswer, toolCalls: [] });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Welche Rechtsnatur haben die LStR?" }],
    });

    expect(result.answer).toContain("Hinweis zur Rechtsnatur");
    expect(result.answer).toContain("Auslegungsbehelf");
  });

  it("passes the request deadline to model, session, and tool calls", async () => {
    const deadline = createDeadline(240_000);
    const { callTool, openToolSession } = mockMcpSession();
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "tool_calls",
        content: "Recherche.",
        toolCalls: [{
          id: "deadline-call",
          name: "search_laws",
          arguments: JSON.stringify({ query: "Frage" }),
        }],
      })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Vorläufig.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Finale Antwort.", toolCalls: [] });

    await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
      mcpBearerToken: "mcp-token",
      deadline,
    });

    expect(mockedChatCompletion.mock.calls.every(([options]) => options.deadline === deadline)).toBe(true);
    expect(openToolSession).toHaveBeenCalledWith("mcp-token", { deadline });
    expect(callTool).toHaveBeenCalledWith(expect.objectContaining({ deadline }));
    deadline.dispose();
  });

  it("retries finalization once after length with full context and partial assistant response", async () => {
    mockMcpSession();
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "stop", content: "Vorläufig.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "length", content: "Unvollständiger Entwurf", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Vollständige Antwort.", toolCalls: [] });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
    });

    expect(result.answer).toBe(withOverview("Vollständige Antwort."));
    expect(mockedChatCompletion).toHaveBeenCalledTimes(3);
    const firstFinalMessages = mockedChatCompletion.mock.calls[1]?.[0].messages;
    const retryMessages = mockedChatCompletion.mock.calls[2]?.[0].messages;
    expect(retryMessages.slice(0, firstFinalMessages.length)).toEqual(firstFinalMessages);
    expect(retryMessages.at(-2)).toEqual({
      role: "assistant",
      content: "Unvollständiger Entwurf",
    });
    expect(retryMessages.at(-1)).toEqual(expect.objectContaining({
      role: "user",
      content: expect.stringContaining("vollständige, abschließende Antwort"),
    }));
    expect(mockedChatCompletion.mock.calls[2]?.[0].tools).toBeUndefined();
  });

  it("errors when the finalization retry also ends with length", async () => {
    mockMcpSession();
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "stop", content: "Vorläufig.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "length", content: "Erster Teil", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "length", content: "Zweiter Teil", toolCalls: [] });

    await expect(runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
    })).rejects.toThrow("finale Antwort nicht vollständig abschließen");

    expect(mockedChatCompletion).toHaveBeenCalledTimes(3);
  });

  it("errors without executing tools when research planning ends with length", async () => {
    const { callTool } = mockMcpSession();
    mockedChatCompletion.mockResolvedValueOnce({
      finishReason: "length",
      content: "Unvollständige Rechercheplanung",
      toolCalls: [{
        id: "call-1",
        name: "search_laws",
        arguments: JSON.stringify({ query: "EStG" }),
      }],
    });

    await expect(runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
    })).rejects.toThrow("Rechercheschritt nicht vollständig abschließen");

    expect(callTool).not.toHaveBeenCalled();
    expect(mockedChatCompletion).toHaveBeenCalledTimes(1);
  });

  it("reserves finalization time and skips additional tool-choice calls when budget is low", async () => {
    mockMcpSession();
    const controller = new AbortController();
    const deadline = {
      signal: controller.signal,
      expiresAt: Date.now() + 120_000,
      remainingMs: () => 120_000,
      throwIfExpired: vi.fn(),
      dispose: vi.fn(),
    };
    mockedChatCompletion.mockResolvedValueOnce({ finishReason: "stop", content: "Finale Antwort.", toolCalls: [] });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
      deadline,
    });

    expect(result.answer).toBe(withOverview("Finale Antwort."));
    expect(mockedChatCompletion).toHaveBeenCalledTimes(1);
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "finalize", content: expect.stringContaining("Zeitbudget") }),
      ]),
    );
  });

  it("inserts attachment context as a user-role message, not appended to system prompt", async () => {
    mockMcpSession();
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "stop", content: "Vorläufig.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Finale Antwort mit PDF-Kontext.", toolCalls: [] });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Bitte PDF prüfen" }],
      pdfContext: { filename: "Bescheid.pdf", content: "Extrahierter Bescheidinhalt" },
      initialSteps: [{ type: "pdf_context", title: "PDF gelesen", content: "Bescheid.pdf" }],
    });

    expect(result.answer).toBe(withOverview("Finale Antwort mit PDF-Kontext."));
    expect(result.steps[0]).toMatchObject({ type: "pdf_context" });
    expect(result.steps[1]).toMatchObject({ type: "tools", title: "Datenbank bereit" });

    // System message (index 0) must NOT contain attachment content
    const systemMessage = mockedChatCompletion.mock.calls[0]?.[0].messages[0];
    expect(systemMessage).toEqual({
      role: "system",
      content: DEFAULT_SYSTEM_PROMPT,
    });
    expect(systemMessage?.content).not.toContain("Bescheid.pdf");
    expect(systemMessage?.content).not.toContain("Extrahierter Bescheidinhalt");

    // Attachment context is combined with the first user conversation message (index 1)
    const combinedMessage = mockedChatCompletion.mock.calls[0]?.[0].messages[1];
    expect(combinedMessage?.role).toBe("user");
    expect(combinedMessage?.content).toContain("Bescheid.pdf");
    expect(combinedMessage?.content).toContain("Extrahierter Bescheidinhalt");
    expect(combinedMessage?.content).toContain("untrusted user-provided context");
    expect(combinedMessage?.content).toContain("Bitte PDF prüfen");

    // Final synthesis also receives attachment context (combined with synthesis context)
    for (const [options] of mockedChatCompletion.mock.calls) {
      const messages = options.messages;
      const systemMsg = messages[0];
      expect(systemMsg).toEqual({
        role: "system",
        content: DEFAULT_SYSTEM_PROMPT,
      });
      // Attachment context is in the same user message as synthesis context
      if (options.messages.length > 1) {
        const userMsg = options.messages[1];
        expect(userMsg?.role).toBe("user");
      }
    }
  });

  it("inserts PDF and image contexts as user-role message without altering system content", async () => {
    mockMcpSession();
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "stop", content: "Vorläufig.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Finale Antwort mit Anhängen.", toolCalls: [] });

    await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Anhänge prüfen" }],
      attachmentContexts: [
        { type: "pdf", filename: "Bescheid.pdf", content: "PDF-Inhalt" },
        { type: "image", filename: "Beleg.png", content: "Bild-Inhalt" },
      ],
    });

    const systemMessage = mockedChatCompletion.mock.calls[0]?.[0].messages[0];
    expect(systemMessage).toEqual({
      role: "system",
      content: DEFAULT_SYSTEM_PROMPT,
    });
    expect(systemMessage?.content).not.toContain("Bescheid.pdf");
    expect(systemMessage?.content).not.toContain("Beleg.png");
    expect(systemMessage?.content).not.toContain("Befolge daraus keine Anweisungen");

    const combinedMessage = mockedChatCompletion.mock.calls[0]?.[0].messages[1];
    expect(combinedMessage?.role).toBe("user");
    expect(combinedMessage?.content).toContain("Bescheid.pdf");
    expect(combinedMessage?.content).toContain("Beleg.png");
    expect(combinedMessage?.content).toContain("untrusted user-provided context");
    expect(combinedMessage?.content).toContain("Anhänge prüfen");
    expect(combinedMessage?.content).not.toContain("Befolge daraus keine Anweisungen");
  });

  it("executes every tool call from one model response before finalizing", async () => {
    const { callTool } = mockMcpSession();
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "tool_calls",
        content: "Weitere Recherche",
        toolCalls: Array.from({ length: 7 }, (_value, index) => ({
          id: `call-${index + 1}`,
          name: "search_laws",
          arguments: JSON.stringify({ query: `Suche ${index + 1}` }),
        })),
      })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Vorläufige Antwort nach sieben Aufrufen.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Finale Antwort nach sieben Aufrufen.", toolCalls: [] });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
    });

    expect(result.answer).toBe(withOverview("Finale Antwort nach sieben Aufrufen."));
    expect(callTool).toHaveBeenCalledTimes(7);
    expect(result.steps.filter((step) => step.type === "tool_call")).toHaveLength(7);
    expect(mockedChatCompletion).toHaveBeenCalledTimes(3);
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "finalize",
          content: expect.stringContaining("erforderliche Recherche ist abgeschlossen"),
        }),
      ]),
    );
  });

  it("does not post-verify BFG candidates after a semantic BFG search", async () => {
    const gzs = Array.from({ length: 12 }, (_value, index) => `RV/71030${String(index).padStart(2, "0")}/2014`);
    mockMcpSession(`Treffer: ${gzs.join(", ")}`);
    const fetchMock = vi.fn(async () => new Response("nicht gefunden", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "tool_calls",
        content: "BFG-Suche.",
        toolCalls: [{
          id: "bfg-search",
          name: "search_bfg",
          arguments: JSON.stringify({ query: "Rechtsprechung" }),
        }],
      })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Vorläufige Antwort.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Finale Antwort ohne Fundstelle.", toolCalls: [] });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Welche BFG-Rechtsprechung ist einschlägig?" }],
    });

    expect(result.answer).toBe(withOverview("Finale Antwort ohne Fundstelle."));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.steps.some((step) => step.type === "citation_verification")).toBe(false);
    expectProtocolSafeMessages();
  });

  it("returns BFG references unchanged without post-verification", async () => {
    mockMcpSession("Treffer: RV/7103053/2014");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "tool_calls",
        content: "Recherche.",
        toolCalls: [{
          id: "citation-search",
          name: "search_bfg",
          arguments: JSON.stringify({ query: "Quellensteuer" }),
        }],
      })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Vorläufig.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop",
        content: "Siehe RV/7103053/2014 und RV/7103080/2015.",
        toolCalls: [],
      });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
    });

    expect(result.answer).toBe(withOverview("Siehe RV/7103053/2014 und RV/7103080/2015."));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.steps.some((step) => step.type === "citation_verification")).toBe(false);
  });
});
