import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runAgent } from "./agent";
import { chatCompletion } from "./deepseek";
import { DEFAULT_SYSTEM_PROMPT } from "./default-system-prompt";
import { createDeadline } from "./deadline";
import { UserVisibleError } from "./errors";
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
const DEFAULT_LAW_RESULT = JSON.stringify({
  knowledge_id: "estg-current",
  chunk_id: "paragraph-16",
  document_type: "norm",
  title: "EStG 1988",
  valid_from: "1989-01-01",
  valid_to: null,
  content: "§ 16 EStG – amtlicher Normtext zu Werbungskosten.",
});

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
    vi.useRealTimers();
    expectCanonicalSystemMessages();
  });

  function mockMcpSession(
    toolResult: string | ((request: { arguments: Record<string, unknown> }) => Promise<string>)
      = DEFAULT_LAW_RESULT,
  ) {
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
        {
          name: "list_knowledge",
          description: "List documents in a knowledge base",
          inputSchema: {
            type: "object",
            properties: { kb_id: { type: "string" } },
          },
        },
      ],
    });
    const callTool = typeof toolResult === "function"
      ? vi.fn(toolResult)
      : vi.fn().mockResolvedValue(toolResult);
    MockedMcpClient.mockImplementation(function MockMcpClient() {
      return { openToolSession, callTool } as unknown as McpClient;
    });
    return { callTool, openToolSession };
  }

  it("uses semantic tool names and the canonical prompt for attachment-free requests", async () => {
    const { callTool } = mockMcpSession();
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "tool_calls",
        content: "STATUS: Werte relevante Rechtsgrundlagen aus.",
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
      "plan",
      "tools",
      "tool_call",
      "tool_result",
      "progress",
      "progress",
      "self_check",
      "finalize",
      "self_check",
      "answer",
    ]);
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(result.tools).toContain("search_laws");
    expect(result.tools).not.toContain("search_bfg");
    expect(result.tools).not.toContain("findok_verify_bfg_cases");
    expect(result.tools).not.toContain("hybrid_search");
    expect(result.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "tool_call",
        title: "Suche in „Gesetze und Verordnungen“",
      }),
      expect.objectContaining({
        type: "tool_result",
        title: "Treffer aus „Gesetze und Verordnungen“ werden ausgewertet",
      }),
      expect.objectContaining({
        type: "progress",
        title: "LLM-Arbeitsstatus: Werte relevante Rechtsgrundlagen aus.",
      }),
    ]));
    expect(JSON.stringify(result.steps)).not.toContain("Unveränderte interne Werkzeugbegründung");
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
          query: expect.stringMatching(
            /EStG § 33[\s\S]*Maßgeblicher Rechtsstand\/Stichtag/,
          ),
        }),
      }),
    );
    expectProtocolSafeMessages();
  });

  it("notifies callers for every deterministic plan and primary-research step", async () => {
    const { callTool } = mockMcpSession();
    const onStep = vi.fn();
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "stop", content: "Vorläufig.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Finale Antwort.", toolCalls: [] });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Welche Werbungskosten gelten?" }],
      onStep,
    });

    expect(onStep.mock.calls.map(([step]) => step.type)).toEqual(
      result.steps.map((step) => step.type),
    );
    expect(onStep.mock.calls.map(([step]) => step.type)).toContain("plan");
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(result.steps.some((step) => step.type === "tool_call")).toBe(true);
    expect(onStep).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "answer", content: withOverview("Finale Antwort.") }),
    );
  });

  it("keeps the non-specialist welcome response free of an overview block", async () => {
    const { openToolSession } = mockMcpSession();
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
    expect(openToolSession).not.toHaveBeenCalled();
    expect(mockedChatCompletion).toHaveBeenCalledTimes(1);
  });

  it("turns a referential PDF follow-up into a complete document without new research", async () => {
    const { callTool, openToolSession } = mockMcpSession();
    const printableDocument = [
      "# Aufstellung Werbungskosten 2024",
      "",
      "## Begründungen",
      "",
      "Vollständiger, bereits belegter Inhalt.",
    ].join("\n");
    mockedChatCompletion
      .mockResolvedValueOnce({
        finishReason: "stop",
        content: printableDocument,
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        finishReason: "tool_calls",
        content: "",
        toolCalls: [{
          id: "create-pdf-1",
          name: "create_pdf_document",
          arguments: JSON.stringify({
            title: "Aufstellung Werbungskosten 2024",
            content_markdown: printableDocument,
            stichtag: "2024-12-31",
          }),
        }],
      });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [
        { role: "user", content: "Welche Werbungskosten gelten 2024?" },
        { role: "assistant", content: "# 📘 Überblick\n\nBelegte Aufstellung samt Begründungen." },
        { role: "user", content: "Gib mir diese Aufstellung samt Begründungen als PDF." },
      ],
    });

    expect(result.answer).toBe(printableDocument);
    expect(result.pdfArtifacts).toEqual([
      expect.objectContaining({
        title: "Aufstellung Werbungskosten 2024",
        filename: "Aufstellung_Werbungskosten_2024.pdf",
        contentMarkdown: printableDocument,
        stichtag: "2024-12-31",
      }),
    ]);
    expect(openToolSession).not.toHaveBeenCalled();
    expect(callTool).not.toHaveBeenCalled();
    expect(mockedChatCompletion).toHaveBeenCalledTimes(2);
    expect(mockedChatCompletion.mock.calls[0]?.[0].messages).toEqual(expect.arrayContaining([
      { role: "assistant", content: "# 📘 Überblick\n\nBelegte Aufstellung samt Begründungen." },
      { role: "user", content: "Gib mir diese Aufstellung samt Begründungen als PDF." },
    ]));
  });

  it("still researches a new substantive legal question requested as a PDF", async () => {
    const { callTool } = mockMcpSession();
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "stop", content: "Vorläufig.", toolCalls: [] })
      .mockResolvedValueOnce({
        finishReason: "stop",
        content: "# 📘 Überblick\n\n## Werbungskosten einer Tagesmutter\n\nFinale Antwort.",
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        finishReason: "tool_calls",
        content: "",
        toolCalls: [{
          id: "create-pdf-2",
          name: "create_pdf_document",
          arguments: JSON.stringify({
            title: "Werbungskosten einer Tagesmutter",
            content_markdown: "# 📘 Überblick\n\n## Werbungskosten einer Tagesmutter\n\nFinale Antwort.",
            stichtag: "2024-12-31",
          }),
        }],
      });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{
        role: "user",
        content: "Erstelle eine neue rechtliche Aufstellung zu Werbungskosten einer Tagesmutter 2024 als PDF.",
      }],
    });

    expect(callTool).toHaveBeenCalled();
    expect(result.pdfArtifacts?.[0]).toEqual(expect.objectContaining({
      title: "Werbungskosten einer Tagesmutter",
    }));
  });

  it("retains legal conversation context when a referential PDF request asks for new content", async () => {
    const { callTool } = mockMcpSession();
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "stop", content: "Vorläufig.", toolCalls: [] })
      .mockResolvedValueOnce({
        finishReason: "stop",
        content: "# 📘 Überblick\n\n## Werbungskosten 2024 mit Begründungen\n\nFinale Antwort.",
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        finishReason: "tool_calls",
        content: "",
        toolCalls: [{
          id: "create-pdf-3",
          name: "create_pdf_document",
          arguments: JSON.stringify({
            title: "Werbungskosten 2024 mit Begründungen",
            content_markdown: "# 📘 Überblick\n\n## Werbungskosten 2024 mit Begründungen\n\nFinale Antwort.",
            stichtag: "2024-12-31",
          }),
        }],
      });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [
        { role: "user", content: "Welche Werbungskosten gelten 2024?" },
        { role: "assistant", content: "# 📘 Überblick\n\nBisherige Aufstellung." },
        {
          role: "user",
          content: "Ergänze die obige Aufstellung um Begründungen und gib sie als PDF aus.",
        },
      ],
    });

    const query = String(callTool.mock.calls[0]?.[0]?.arguments.query ?? "");
    expect(query).toContain("Welche Werbungskosten gelten 2024?");
    expect(query).toContain("Ergänze die obige Aufstellung um Begründungen");
    expect(result.pdfArtifacts?.[0]).toEqual(expect.objectContaining({
      title: "Werbungskosten 2024 mit Begründungen",
    }));
  });

  it.each([
    [
      "Welche Fassung des § 33 EStG galt am 30.06.2024?",
      "2024-06-30",
    ],
    [
      "Welche Rechtslage gilt per 31.12.2024 für Werbungskosten?",
      "2024-12-31",
    ],
  ] as const)("adds the explicit legal cutoff to the scoped law query: %s", async (
    question,
    expectedCutoff,
  ) => {
    const { callTool } = mockMcpSession();
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "stop", content: "Vorläufig.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Finale Antwort.", toolCalls: [] });

    await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: question }],
    });

    const query = String(callTool.mock.calls[0]?.[0]?.arguments.query ?? "");
    expect(query).toContain(question);
    expect(query).toContain(`Maßgeblicher Rechtsstand/Stichtag: ${expectedCutoff}`);
  });

  it("does not turn a child's birth date into the legal reference date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T12:00:00.000Z"));
    const { callTool } = mockMcpSession();
    const question = "Kann ich Werbungskosten geltend machen, wenn mein Kind geboren am 30.06.2024 ist?";
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "stop", content: "Vorläufig.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Finale Antwort.", toolCalls: [] });

    await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: question }],
    });

    const query = String(callTool.mock.calls[0]?.[0]?.arguments.query ?? "");
    expect(query).toContain("Kind geboren am 30.06.2024");
    expect(query).toContain("Maßgeblicher Rechtsstand/Stichtag: 2026-07-16");
    expect(query).not.toContain("Maßgeblicher Rechtsstand/Stichtag: 2024-06-30");
  });

  it("rejects an invalid explicit cutoff before opening an MCP session", async () => {
    const { callTool, openToolSession } = mockMcpSession();

    await expect(runAgent({
      runtime: TEST_RUNTIME,
      messages: [{
        role: "user",
        content: "Welche Rechtslage gilt per 31.02.2024 für Werbungskosten?",
      }],
    })).rejects.toMatchObject({ status: 400 });

    expect(openToolSession).not.toHaveBeenCalled();
    expect(callTool).not.toHaveBeenCalled();
    expect(mockedChatCompletion).not.toHaveBeenCalled();
  });

  it("uses today's cutoff for 'gilt das noch?' instead of inheriting the historical year", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T12:00:00.000Z"));
    const { callTool } = mockMcpSession();
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "stop", content: "Vorläufig.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Finale Antwort.", toolCalls: [] });

    await runAgent({
      runtime: TEST_RUNTIME,
      messages: [
        { role: "user", content: "Welche Werbungskosten galten 2020?" },
        { role: "assistant", content: "Historische Antwort." },
        { role: "user", content: "Gilt das noch?" },
      ],
    });

    const query = String(callTool.mock.calls[0]?.[0]?.arguments.query ?? "");
    expect(query).toContain("Gilt das noch?");
    expect(query).toContain("Maßgeblicher Rechtsstand/Stichtag: 2026-07-16");
    expect(query).not.toMatch(/\b2020\b/u);
  });

  it("answers an out-of-scope weather question without opening MCP", async () => {
    const { callTool, openToolSession } = mockMcpSession();
    mockedChatCompletion.mockResolvedValueOnce({
      finishReason: "stop",
      content: "Ich bin auf österreichische Steuerfragen spezialisiert.",
      toolCalls: [],
    });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Wie wird das Wetter morgen in Wien?" }],
    });

    expect(result.answer).toBe("Ich bin auf österreichische Steuerfragen spezialisiert.");
    expect(openToolSession).not.toHaveBeenCalled();
    expect(callTool).not.toHaveBeenCalled();
    expect(result.tools).toEqual([]);
    expect(mockedChatCompletion).toHaveBeenCalledTimes(1);
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
    const deadline = createDeadline(600_000);
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
      messages: [{ role: "user", content: "Welche Werbungskosten gelten?" }],
      mcpBearerToken: "mcp-token",
      deadline,
    });

    expect(mockedChatCompletion.mock.calls.every(([options]) => options.deadline === deadline)).toBe(true);
    expect(openToolSession).toHaveBeenCalledWith("mcp-token", { deadline });
    expect(callTool).toHaveBeenCalledWith(expect.objectContaining({ deadline }));
    deadline.dispose();
  });

  it("preserves a partial final answer after length without repeating the full evidence prompt", async () => {
    mockMcpSession();
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "stop", content: "Vorläufig.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "length", content: "Unvollständiger Entwurf", toolCalls: [] });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Welche Werbungskosten gelten?" }],
    });

    expect(result.answer).toBe(withOverview("Unvollständiger Entwurf"));
    expect(result.status).toBe("partial");
    expect(mockedChatCompletion).toHaveBeenCalledTimes(2);
  });

  it("keeps researched provenance when the final synthesis provider fails", async () => {
    mockMcpSession();
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "stop", content: "Vorläufig.", toolCalls: [] })
      .mockRejectedValueOnce(new Error("provider unavailable"));

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Welche Werbungskosten gelten?" }],
    });

    expect(result.status).toBe("partial");
    expect(result.answer).toContain("Belegte Fundstellen");
    expect(mockedChatCompletion).toHaveBeenCalledTimes(2);
  });

  it("finalizes from registered primary evidence when research planning reaches length", async () => {
    const { callTool } = mockMcpSession();
    mockedChatCompletion
      .mockResolvedValueOnce({
        finishReason: "length",
        content: "Unvollständige Rechercheplanung",
        toolCalls: [{
          id: "call-1",
          name: "search_laws",
          arguments: JSON.stringify({ query: "EStG" }),
        }],
      })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Finale Antwort.", toolCalls: [] });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Welche Werbungskosten gelten?" }],
    });

    expect(result.answer).toBe(withOverview("Finale Antwort."));
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(mockedChatCompletion).toHaveBeenCalledTimes(2);
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
      messages: [{ role: "user", content: "Welche Werbungskosten gelten?" }],
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
    expect(result.steps[1]).toMatchObject({ type: "plan", title: "Rechercheplan erstellt" });
    expect(result.steps[2]).toMatchObject({ type: "tools", title: "Datenbank bereit" });

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

  it("bounds one model tool batch while preserving the completed calls", async () => {
    const { callTool } = mockMcpSession();
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "tool_calls",
        content: "STATUS: Werte alle angeforderten Rechtsquellen aus.",
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
      messages: [{ role: "user", content: "Welche Werbungskosten gelten?" }],
    });

    expect(result.answer).toBe(withOverview("Finale Antwort nach sieben Aufrufen."));
    expect(callTool).toHaveBeenCalledTimes(7);
    expect(result.steps.filter((step) => step.type === "tool_call")).toHaveLength(7);
    expect(result.steps.filter((step) => step.type === "progress")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: "LLM-Arbeitsstatus: Werte alle angeforderten Rechtsquellen aus.",
      }),
    ]));
    expect(result.status).toBe("partial");
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

  it("keeps earlier evidence and finalizes partially when a later transport call fails", async () => {
    const { callTool } = mockMcpSession(async (request) => {
      const query = String(request.arguments.query ?? "");
      if (query === "Fehlerquelle") {
        throw new UserVisibleError("Die optionale Quelle ist vorübergehend nicht erreichbar.", 503);
      }
      return query === "Zusatzbeleg"
        ? "Zusätzliche belegte Passage."
        : "Primäre belegte Gesetzespassage.";
    });
    mockedChatCompletion
      .mockResolvedValueOnce({
        finishReason: "tool_calls",
        content: "STATUS: Werte ergänzende Quellen aus.",
        toolCalls: [
          { id: "success-after-primary", name: "search_laws", arguments: JSON.stringify({ query: "Zusatzbeleg" }) },
          { id: "transport-failure", name: "search_laws", arguments: JSON.stringify({ query: "Fehlerquelle" }) },
        ],
      })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Vorläufige Antwort.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Finale Teilantwort.", toolCalls: [] });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Welche Voraussetzungen gelten für Werbungskosten?" }],
    });

    expect(callTool).toHaveBeenCalledTimes(4);
    expect(result.status).toBe("partial");
    expect(result.answer).toBe(withOverview("Finale Teilantwort."));
    expect(result.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "tool_result", toolName: "search_laws", success: false }),
    ]));
    const nextIterationMessages = mockedChatCompletion.mock.calls[1]?.[0].messages;
    expect(nextIterationMessages).toContainEqual(expect.objectContaining({
      role: "tool",
      tool_call_id: "success-after-primary",
    }));
    expect(nextIterationMessages).toContainEqual(expect.objectContaining({
      role: "tool",
      tool_call_id: "transport-failure",
    }));
    const finalContext = mockedChatCompletion.mock.calls[2]?.[0].messages
      .map((message) => message.content ?? "")
      .join("\n");
    expect(finalContext).toContain("Primäre belegte Gesetzespassage");
    expect(finalContext).toContain("Zusätzliche belegte Passage");
    expect(finalContext).toContain("vorübergehend nicht erreichbar");
  });

  it("uses matched content but never a law knowledge_description in final synthesis", async () => {
    mockMcpSession(JSON.stringify({
      results: [{
        knowledge_id: "estg-document",
        chunk_id: "paragraph-16",
        knowledge_description: "Unzutreffende Zusammenfassung zu § 69 EStG.",
        matched_content: "§ 16 EStG: belegte Passage zu Werbungskosten.",
      }],
    }));
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "stop", content: "Vorläufige Antwort.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Finale Antwort.", toolCalls: [] });

    await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Welche Voraussetzungen gelten für Werbungskosten?" }],
    });

    const finalContext = mockedChatCompletion.mock.calls.at(-1)?.[0].messages
      .map((message) => message.content ?? "")
      .join("\n") ?? "";
    expect(finalContext).toContain("§ 16 EStG");
    expect(finalContext).not.toContain("§ 69 EStG");
    expect(finalContext).not.toContain("Unzutreffende Zusammenfassung");
  });

  it("does not replay reasoning_content to an OpenAI-compatible provider", async () => {
    mockMcpSession();
    const openAiCompatibleRuntime = {
      ...TEST_RUNTIME,
      provider: "openai_compatible",
      model: "custom-model",
      upstreamModel: "custom-upstream",
      baseUrl: "https://provider.example/v1",
    } satisfies LlmRuntime;
    mockedChatCompletion
      .mockResolvedValueOnce({
        finishReason: "tool_calls",
        content: "STATUS: Verfeinere die Recherche.",
        reasoningContent: "Provider-interner Reasoning-Inhalt",
        toolCalls: [{
          id: "provider-call",
          name: "search_laws",
          arguments: JSON.stringify({ query: "Verfeinerte Suche" }),
        }],
      })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Vorläufig.", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Finale Antwort.", toolCalls: [] });

    await runAgent({
      runtime: openAiCompatibleRuntime,
      messages: [{ role: "user", content: "Welche Voraussetzungen gelten für Werbungskosten?" }],
    });

    const replayedAssistant = mockedChatCompletion.mock.calls[1]?.[0].messages.find(
      (message) => message.role === "assistant" && message.tool_calls?.some((call) => call.id === "provider-call"),
    );
    expect(replayedAssistant).toBeDefined();
    expect(replayedAssistant).not.toHaveProperty("reasoning_content");
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

  it("removes unsupported BFG references without an external post-verification", async () => {
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
      messages: [{ role: "user", content: "Welche BFG-Rechtsprechung gilt zu Werbungskosten?" }],
    });

    expect(result.answer).toContain("RV/7103053/2014");
    expect(result.answer).not.toContain("RV/7103080/2015");
    expect(result.status).toBe("partial");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "self_check", title: "Fundstellen intern gegen Evidenz geprüft" }),
    ]));
  });
  it("does not reject runAgent when model uses an unknown source_key; model receives failed tool result and can continue", async () => {
    const { callTool } = mockMcpSession();
    mockedChatCompletion
      .mockResolvedValueOnce({
        finishReason: "tool_calls",
        content: "Ich suche nach Arbeitsbehelfen.",
        toolCalls: [
          {
            id: "call-invalid-key",
            name: "list_research_documents",
            arguments: JSON.stringify({ source_key: "WORK_AIDS" }),
          },
        ],
      })
      .mockResolvedValueOnce({
        finishReason: "stop",
        content: "Vorläufige Antwort trotz ungültigem Quellenschlüssel.",
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        finishReason: "stop",
        content: "# 📘 Antwort\n\nErfolgreich recherchiert.",
        toolCalls: [],
      });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Suche im Organisationshandbuch nach Arbeitsbehelfen" }],
      mcpBearerToken: "mcp-token",
    });

    expect(result.answer).toContain("Erfolgreich recherchiert.");
    const failedSteps = result.steps.filter(
      (step) => step.type === "tool_result" && step.success === false,
    );
    expect(failedSteps.length).toBeGreaterThanOrEqual(1);
    const toolResultMessages = mockedChatCompletion.mock.calls
      .flatMap(([options]) => options.messages)
      .filter((m) => m.role === "tool");
    expect(toolResultMessages.some(
      (m) => m.content && m.content.includes("Unbekannter Quellenschlüssel"),
    )).toBe(true);
    // The controlled planner performs its mandatory primary-source lookup;
    // the rejected model-supplied source key itself must not trigger another MCP call.
    expect(callTool).toHaveBeenCalledTimes(1);
  });
});
