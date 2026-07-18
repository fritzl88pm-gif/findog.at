import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runAgent as runAgentWithSystemPrompt, type RunAgentOptions } from "./agent";
import { chatCompletion } from "./deepseek";
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
const TEST_SYSTEM_PROMPT = "Globaler Systemprompt aus der Datenbank";
const TEST_RUNTIME = {
  model: "deepseek-v4-pro",
  provider: "deepseek",
  upstreamModel: "deepseek-v4-pro",
  baseUrl: "https://api.deepseek.com",
  apiKey: "server-key",
  reasoning: "disabled",
} satisfies LlmRuntime;
const withOverview = (content: string) => `# 📘 Überblick\n\n${content}`;

function runAgent(options: Omit<RunAgentOptions, "systemPrompt">) {
  return runAgentWithSystemPrompt({ ...options, systemPrompt: TEST_SYSTEM_PROMPT });
}

function expectCanonicalSystemMessages(): void {
  for (const [callIndex, [options]] of mockedChatCompletion.mock.calls.entries()) {
    const systemMessages = options.messages.filter((message) => message.role === "system");
    expect(systemMessages, `chatCompletion call ${callIndex} must have exactly one system message`)
      .toEqual([{ role: "system", content: TEST_SYSTEM_PROMPT }]);
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
    const callTool = vi.fn().mockResolvedValue(toolResult);
    MockedMcpClient.mockImplementation(function MockMcpClient() {
      return { openToolSession, callTool } as unknown as McpClient;
    });
    return { callTool, openToolSession };
  }

  it("creates a complete PDF answer for a referential follow-up without opening MCP", async () => {
    const previousAnswer = [
      "# 📘 Überblick",
      "",
      "| Position | Ergebnis |",
      "| --- | --- |",
      "| Werbungskosten | anerkannt |",
      "",
      "# 📎 Quellen, Provenienz und Rechtsstand",
      "",
      "[Q1] § 16 EStG in der am Stichtag anwendbaren Fassung.",
    ].join("\n");
    const generatedPdfAnswer = [
      "# 📘 Überblick",
      "",
      "Die Aufstellung wird vollständig mit den verlangten Begründungen ausgegeben.",
      "",
      "# Aufstellung samt Begründungen",
      "",
      "| Position | Ergebnis | Begründung |",
      "| --- | --- | --- |",
      "| Werbungskosten | anerkannt | Der berufliche Zusammenhang ist belegt. |",
      "",
      "# 📎 Quellen, Provenienz und Rechtsstand",
      "",
      "[Q1] § 16 EStG in der am Stichtag anwendbaren Fassung.",
    ].join("\n");
    mockedChatCompletion
      .mockResolvedValueOnce({
        finishReason: "stop",
        content: generatedPdfAnswer,
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        finishReason: "tool_calls",
        content: "",
        toolCalls: [{
          id: "create-pdf-1",
          name: "create_pdf_document",
          arguments: JSON.stringify({
            title: "Aufstellung samt Begründungen",
            content_markdown: generatedPdfAnswer,
            stichtag: null,
          }),
        }],
      });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [
        { role: "user", content: "Stelle die Prüfungspunkte mit Begründungen dar." },
        { role: "assistant", content: previousAnswer },
        { role: "user", content: "Gib mir diese Aufstellung samt Begründungen als PDF." },
      ],
    });

    expect(result.answer).toBe("Hier ist Ihre PDF:");
    expect(result.answer).not.toContain("Der berufliche Zusammenhang ist belegt.");
    expect(result.pdfArtifacts?.[0]).toEqual(expect.objectContaining({
      title: "Aufstellung samt Begründungen",
      contentMarkdown: generatedPdfAnswer,
    }));
    expect(result.tools).toEqual(["create_pdf_document"]);
    expect(result.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "answer" }),
      expect.objectContaining({ type: "tool_result", toolName: "create_pdf_document", success: true }),
    ]));
    expect(MockedMcpClient).not.toHaveBeenCalled();
    expect(mockedChatCompletion).toHaveBeenCalledTimes(2);
    const directCall = mockedChatCompletion.mock.calls[0]?.[0];
    expect(directCall?.tools).toBeUndefined();
    expect(directCall?.messages).toContainEqual({ role: "assistant", content: previousAnswer });
    expect(directCall?.messages.at(-1)).toEqual(expect.objectContaining({
      role: "user",
      content: expect.stringContaining("vollständige, druckfertige Fassung"),
    }));
  });

  it("retries a length-limited referential PDF answer once as a complete final version", async () => {
    const partialAnswer = "# 📘 Überblick\n\nTeilantwort mit begonnener Aufstellung.";
    const completeAnswer = [
      "# 📘 Überblick",
      "",
      "Vollständige druckfertige Ausarbeitung.",
      "",
      "# Anspruchsvoraussetzungen",
      "",
      "Alle Voraussetzungen und Begründungen sind vollständig enthalten.",
    ].join("\n");
    mockedChatCompletion
      .mockResolvedValueOnce({
        finishReason: "length",
        content: partialAnswer,
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        finishReason: "stop",
        content: completeAnswer,
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        finishReason: "tool_calls",
        content: "",
        toolCalls: [{
          id: "create-pdf-2",
          name: "create_pdf_document",
          arguments: JSON.stringify({
            title: "Anspruchsvoraussetzungen",
            content_markdown: completeAnswer,
            stichtag: null,
          }),
        }],
      });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [
        { role: "user", content: "Stelle die Anspruchsvoraussetzungen mit Begründungen dar." },
        { role: "assistant", content: "# 📘 Überblick\n\nBisherige fachliche Antwort." },
        { role: "user", content: "Gib mir diese Aufstellung als PDF." },
      ],
    });

    expect(result.answer).toBe("Hier ist Ihre PDF:");
    expect(result.pdfArtifacts?.[0]).toEqual(expect.objectContaining({
      title: "Anspruchsvoraussetzungen",
      contentMarkdown: completeAnswer,
    }));
    expect(MockedMcpClient).not.toHaveBeenCalled();
    expect(mockedChatCompletion).toHaveBeenCalledTimes(3);
    const retryCall = mockedChatCompletion.mock.calls[1]?.[0];
    expect(retryCall?.messages).toContainEqual({ role: "assistant", content: partialAnswer });
    expect(retryCall?.messages.at(-1)).toEqual(expect.objectContaining({
      role: "user",
      content: expect.stringContaining("vollständige, abschließende und druckfertige Fassung"),
    }));
  });

  it("runs a new substantive PDF question through the normal research agent and offers its final answer", async () => {
    const { callTool, openToolSession } = mockMcpSession();
    const finalPdfAnswer = [
      "# 📘 Überblick",
      "",
      "Abschließende fachliche Ausarbeitung mit Begründungen.",
      "",
      "# Voraussetzungen des § 34 EStG",
      "",
      "Die gesetzlichen Voraussetzungen werden begründet dargestellt.",
    ].join("\n");
    mockedChatCompletion
      .mockResolvedValueOnce({
        finishReason: "tool_calls",
        content: "Recherchiere die gesetzlichen Voraussetzungen.",
        toolCalls: [{
          id: "pdf-law-search",
          name: "search_laws",
          arguments: JSON.stringify({ query: "§ 34 EStG Voraussetzungen" }),
        }],
      })
      .mockResolvedValueOnce({
        finishReason: "stop",
        content: "Vorläufige Ausarbeitung auf Basis der Recherche.",
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        finishReason: "stop",
        content: finalPdfAnswer,
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        finishReason: "tool_calls",
        content: "",
        toolCalls: [{
          id: "create-pdf-3",
          name: "create_pdf_document",
          arguments: JSON.stringify({
            title: "Voraussetzungen des § 34 EStG",
            content_markdown: finalPdfAnswer,
            stichtag: null,
          }),
        }],
      });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{
        role: "user",
        content: "Erstelle eine neue Aufstellung zu den Voraussetzungen des § 34 EStG als PDF.",
      }],
      mcpBearerToken: "mcp-token",
    });

    expect(openToolSession).toHaveBeenCalledWith("mcp-token", { deadline: undefined });
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(mockedChatCompletion).toHaveBeenCalledTimes(4);
    expect(result.answer).toBe("Hier ist Ihre PDF:");
    expect(result.pdfArtifacts?.[0]).toEqual(expect.objectContaining({
      title: "Voraussetzungen des § 34 EStG",
      contentMarkdown: finalPdfAnswer,
    }));
    expect(result.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "tool_call", toolName: "search_laws" }),
    ]));
    expect(result.steps).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "pdf_offer" }),
    ]));
  });

  it("does not bypass research for a referential PDF request that changes the legal content", async () => {
    const { callTool, openToolSession } = mockMcpSession();
    mockedChatCompletion
      .mockResolvedValueOnce({
        finishReason: "tool_calls",
        content: "Die Aktualisierung wird anhand der Rechtslage geprüft.",
        toolCalls: [{
          id: "updated-pdf-law-search",
          name: "search_laws",
          arguments: JSON.stringify({ query: "zum Stand 2026" }),
        }],
      })
      .mockResolvedValueOnce({
        finishReason: "stop",
        content: "Vorläufig aktualisierte fachliche Antwort.",
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        finishReason: "stop",
        content: "Aktualisierte fachliche Antwort.",
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        finishReason: "tool_calls",
        content: "",
        toolCalls: [{
          id: "create-pdf-4",
          name: "create_pdf_document",
          arguments: JSON.stringify({
            title: "Aktualisierte Aufstellung 2026",
            content_markdown: "# 📘 Überblick\n\nAktualisierte fachliche Antwort.",
            stichtag: "2026-01-01",
          }),
        }],
      });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [
        { role: "user", content: "Erstelle eine Aufstellung für 2024." },
        { role: "assistant", content: "# 📘 Überblick\n\nBisherige Aufstellung für 2024." },
        {
          role: "user",
          content: "Aktualisiere diese Aufstellung zum Stand 2026 und gib sie als PDF aus.",
        },
      ],
    });

    expect(openToolSession).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith(expect.objectContaining({
      arguments: expect.objectContaining({
        query: [
          "Ausgangsfrage: Erstelle eine Aufstellung für 2024.",
          "",
          "Aktueller Änderungsauftrag: Aktualisiere diese Aufstellung zum Stand 2026 und gib sie als PDF aus.",
        ].join("\n"),
      }),
    }));
    expect(mockedChatCompletion).toHaveBeenCalledTimes(4);
    expect(result.answer).toBe("Hier ist Ihre PDF:");
    expect(result.pdfArtifacts?.[0]).toEqual(expect.objectContaining({
      title: "Aktualisierte Aufstellung 2026",
      stichtag: "2026-01-01",
    }));
  });

  it("rejects a referential PDF update when repeated planning yields no research result", async () => {
    const { callTool } = mockMcpSession();
    for (let iteration = 0; iteration < 6; iteration += 1) {
      mockedChatCompletion.mockResolvedValueOnce({
        finishReason: "stop",
        content: "Ich würde die bestehende Aufstellung ohne weitere Recherche aktualisieren.",
        toolCalls: [],
      });
    }

    await expect(runAgent({
      runtime: TEST_RUNTIME,
      messages: [
        { role: "user", content: "Erstelle eine Aufstellung zur geltenden Rechtslage." },
        { role: "assistant", content: "# 📘 Überblick\n\nBisherige Aufstellung." },
        {
          role: "user",
          content: "Aktualisiere diese Aufstellung und gib sie als PDF aus.",
        },
      ],
    })).rejects.toThrow("ohne ein erfolgreiches Rechercheergebnis");

    expect(mockedChatCompletion).toHaveBeenCalledTimes(6);
    expect(callTool).not.toHaveBeenCalled();
    expect(mockedChatCompletion.mock.calls[1]?.[0].messages.at(-1)).toEqual(
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining("mindestens eine geeignete Recherchefunktion"),
      }),
    );
  });

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
      "answer",
    ]);
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(result.tools).toContain("search_laws");
    expect(result.tools).toContain("search_bfg");
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
      content: TEST_SYSTEM_PROMPT,
    });

    expect(callTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "hybrid_search",
        arguments: expect.objectContaining({
          kb_id: "e0282ab8-b94f-4553-962e-68705201cf9a",
          query: expect.stringMatching(/^EStG § 33\nVerbindlicher Rechtsstand\/Stichtag: \d{4}-\d{2}-\d{2}$/u),
        }),
      }),
    );
    expectProtocolSafeMessages();
  });

  it("notifies callers for every visible deterministic step", async () => {
    const { callTool } = mockMcpSession();
    const onStep = vi.fn();
    mockedChatCompletion.mockResolvedValueOnce({ finishReason: "stop", content: "Finale Antwort.", toolCalls: [] });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [
        { role: "user", content: "Vorherige Frage" },
        { role: "assistant", content: "Vorherige Antwort" },
        { role: "user", content: "Folgefrage" },
      ],
      onStep,
    });

    expect(onStep.mock.calls.map(([step]) => step.type)).toEqual(
      result.steps.map((step) => step.type),
    );
    expect(onStep.mock.calls.map(([step]) => step.type)).not.toContain("plan");
    expect(callTool).not.toHaveBeenCalled();
    expect(result.steps.some((step) => step.type === "tool_call")).toBe(false);
    expect(result.steps.some((step) => step.type === "finalize")).toBe(false);
    expect(mockedChatCompletion).toHaveBeenCalledOnce();
    expect(onStep).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "answer", content: withOverview("Finale Antwort.") }),
    );
  });

  it("requires a usable research result before the first specialist answer", async () => {
    const { callTool } = mockMcpSession("§ 16 EStG in der am Stichtag geltenden Fassung.");
    mockedChatCompletion
      .mockResolvedValueOnce({
        finishReason: "stop",
        content: "Unbelegter Entwurf aus Modellwissen.",
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        finishReason: "stop",
        content: "Geprüfte finale Antwort.",
        toolCalls: [],
      });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Welche Werbungskosten kann ich nach § 16 EStG absetzen?" }],
    });

    expect(callTool).toHaveBeenCalledOnce();
    expect(result.steps.map((step) => step.type)).toEqual([
      "tools",
      "tool_call",
      "tool_result",
      "progress",
      "finalize",
      "answer",
    ]);
    expect(mockedChatCompletion.mock.calls[0]?.[0]).toEqual(
      expect.not.objectContaining({ toolChoice: expect.anything() }),
    );
    expect(mockedChatCompletion.mock.calls[1]?.[0].tools).toBeUndefined();
  });

  it("falls back to a direct BFG search when an initial case-law answer contains no tool call", async () => {
    const { callTool } = mockMcpSession("Verifizierter BFG-Rechtssatz zur Fortbildung.");
    mockedChatCompletion
      .mockResolvedValueOnce({
        finishReason: "stop",
        content: "Unbelegte Judikaturauskunft.",
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        finishReason: "stop",
        content: "Geprüfte BFG-Auskunft.",
        toolCalls: [],
      });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Welche BFG-Rechtsprechung gibt es zu Fortbildungskosten?" }],
    });

    expect(callTool).toHaveBeenCalledOnce();
    expect(result.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "tool_call", toolName: "search_bfg" }),
      expect.objectContaining({ type: "tool_result", toolName: "search_bfg", success: true }),
    ]));
    expect(mockedChatCompletion.mock.calls[0]?.[0]).toEqual(
      expect.not.objectContaining({ toolChoice: expect.anything() }),
    );
  });

  it("does not return a first specialist answer when no usable research result can be obtained", async () => {
    const { callTool } = mockMcpSession("Keine Treffer gefunden.");
    mockedChatCompletion.mockResolvedValueOnce({
      finishReason: "stop",
      content: "Unbelegte fachliche Antwort aus Modellwissen.",
      toolCalls: [],
    });

    await expect(runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Welche Voraussetzungen gelten nach § 16 EStG?" }],
    })).rejects.toThrow("kein verwertbares Rechercheergebnis");

    expect(mockedChatCompletion).toHaveBeenCalledOnce();
    expect(mockedChatCompletion.mock.calls[0]?.[0]).toEqual(
      expect.not.objectContaining({ toolChoice: expect.anything() }),
    );
    expect(callTool).toHaveBeenCalledOnce();
  });

  it("does not accept repeated empty direct searches as first-turn research evidence", async () => {
    const { callTool } = mockMcpSession("Keine Treffer gefunden.");
    for (let iteration = 0; iteration < 6; iteration += 1) {
      mockedChatCompletion.mockResolvedValueOnce({
        finishReason: "tool_calls",
        content: "Die Rechtsgrundlage wird gesucht.",
        toolCalls: [{
          id: `empty-initial-search-${iteration}`,
          name: "search_laws",
          arguments: JSON.stringify({ query: "§ 16 EStG" }),
        }],
      });
    }

    await expect(runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Welche Voraussetzungen gelten nach § 16 EStG?" }],
    })).rejects.toThrow("kein verwertbares Rechercheergebnis");

    expect(mockedChatCompletion).toHaveBeenCalledTimes(6);
    expect(callTool).toHaveBeenCalledTimes(6);
  });

  it("does not finalize an unresearched first specialist answer when the tool budget disappears", async () => {
    const { callTool } = mockMcpSession();
    const controller = new AbortController();
    const deadline = {
      signal: controller.signal,
      expiresAt: Date.now() + 240_000,
      remainingMs: vi.fn()
        .mockReturnValueOnce(240_000)
        .mockReturnValueOnce(90_000),
      throwIfExpired: vi.fn(),
      dispose: vi.fn(),
    };
    mockedChatCompletion.mockResolvedValueOnce({
      finishReason: "tool_calls",
      content: "Die Rechtsgrundlage wird gesucht.",
      toolCalls: [{
        id: "deadline-initial-search",
        name: "search_laws",
        arguments: JSON.stringify({ query: "§ 16 EStG" }),
      }],
    });

    await expect(runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Welche Voraussetzungen gelten nach § 16 EStG?" }],
      deadline,
    })).rejects.toThrow("kein verwertbares Rechercheergebnis");

    expect(callTool).not.toHaveBeenCalled();
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

  it.each([
    ["Danke", "Gern geschehen."],
    ["Was kannst du?", "Ich unterstütze bei Fragen zum österreichischen Steuerrecht."],
  ])("keeps the conversational first turn %s free of research", async (question, answer) => {
    const { callTool } = mockMcpSession();
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "stop", content: answer, toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: answer, toolCalls: [] });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: question }],
    });

    expect(result.answer).toBe(answer);
    expect(callTool).not.toHaveBeenCalled();
    expect(result.steps.some((step) => step.type === "tool_call")).toBe(false);
  });

  it("keeps an explicitly requested standalone justification free of an overview block", async () => {
    mockMcpSession();
    const justification = "Die Pflichtveranlagung war durchzuführen, weil die maßgebliche Einkommensgrenze im Zusammenhang mit dem Klimabonus überschritten wurde.";
    mockedChatCompletion.mockResolvedValueOnce({
      finishReason: "stop",
      content: justification,
      toolCalls: [],
    });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [
        { role: "user", content: "Wir prüfen eine Pflichtveranlagung." },
        { role: "assistant", content: "Welchen Text benötigen Sie?" },
        { role: "user", content: "Ich brauche eine einfache Begründung wegen der Pflichtveranlagung bei Einkommensüberschreitung beim Klimabonus." },
      ],
    });

    expect(result.answer).toBe(justification);
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
    mockedChatCompletion.mockResolvedValueOnce({ finishReason: "stop", content: finalAnswer, toolCalls: [] });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [
        { role: "user", content: "Ich habe eine Folgefrage." },
        { role: "assistant", content: "Gerne." },
        { role: "user", content: "Kann eine Tagesmutter Werbungskosten geltend machen?" },
      ],
    });

    expect(result.answer).not.toContain("Hinweis zur Rechtsnatur");
    expect(result.answer).not.toContain("Auslegungsbehelf der Verwaltung");
    expect(result.answer).toContain("# ⚖️ Gesetzliche Grundlagen");
  });

  it("keeps guideline-nature information when the user explicitly asks for it", async () => {
    mockMcpSession();
    const finalAnswer = "# 📘 Überblick\n\nHinweis zur Rechtsnatur: Die LStR sind ein Auslegungsbehelf.";
    mockedChatCompletion.mockResolvedValueOnce({ finishReason: "stop", content: finalAnswer, toolCalls: [] });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [
        { role: "user", content: "Ich habe eine Folgefrage." },
        { role: "assistant", content: "Gerne." },
        { role: "user", content: "Welche Rechtsnatur haben die LStR?" },
      ],
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

  it("retries a truncated terminal answer once with full context and the partial response", async () => {
    mockMcpSession();
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "length", content: "Unvollständiger Entwurf", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "stop", content: "Vollständige Antwort.", toolCalls: [] });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [
        { role: "user", content: "Vorherige Frage" },
        { role: "assistant", content: "Vorherige Antwort" },
        { role: "user", content: "Folgefrage" },
      ],
    });

    expect(result.answer).toBe(withOverview("Vollständige Antwort."));
    expect(mockedChatCompletion).toHaveBeenCalledTimes(2);
    const firstFinalMessages = mockedChatCompletion.mock.calls[0]?.[0].messages;
    const retryMessages = mockedChatCompletion.mock.calls[1]?.[0].messages;
    expect(retryMessages.slice(0, firstFinalMessages.length)).toEqual(firstFinalMessages);
    expect(retryMessages.at(-2)).toEqual({
      role: "assistant",
      content: "Unvollständiger Entwurf",
    });
    expect(retryMessages.at(-1)).toEqual(expect.objectContaining({
      role: "user",
      content: expect.stringContaining("vollständige, abschließende Antwort"),
    }));
    expect(mockedChatCompletion.mock.calls[1]?.[0].tools).toBeUndefined();
    expect(result.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "finalize", title: "Antwort wird vervollständigt" }),
    ]));
  });

  it("errors when the truncated-answer retry also ends with length", async () => {
    mockMcpSession();
    mockedChatCompletion
      .mockResolvedValueOnce({ finishReason: "length", content: "Erster Teil", toolCalls: [] })
      .mockResolvedValueOnce({ finishReason: "length", content: "Zweiter Teil", toolCalls: [] });

    await expect(runAgent({
      runtime: TEST_RUNTIME,
      messages: [
        { role: "user", content: "Vorherige Frage" },
        { role: "assistant", content: "Vorherige Antwort" },
        { role: "user", content: "Folgefrage" },
      ],
    })).rejects.toThrow("finale Antwort nicht vollständig abschließen");

    expect(mockedChatCompletion).toHaveBeenCalledTimes(2);
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
    expect(mockedChatCompletion.mock.calls[0]?.[0].messages.at(-1)?.content).toContain(
      "keinen Prüfbericht",
    );
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "finalize", content: expect.stringContaining("Zeitbudget") }),
      ]),
    );
  });

  it("inserts attachment context as a user-role message, not appended to system prompt", async () => {
    mockMcpSession();
    mockedChatCompletion.mockResolvedValueOnce({
      finishReason: "stop",
      content: "Finale Antwort mit PDF-Kontext.",
      toolCalls: [],
    });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Fasse dieses PDF zusammen." }],
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
      content: TEST_SYSTEM_PROMPT,
    });
    expect(systemMessage?.content).not.toContain("Bescheid.pdf");
    expect(systemMessage?.content).not.toContain("Extrahierter Bescheidinhalt");

    // Attachment context is combined with the first user conversation message (index 1)
    const combinedMessage = mockedChatCompletion.mock.calls[0]?.[0].messages[1];
    expect(combinedMessage?.role).toBe("user");
    expect(combinedMessage?.content).toContain("Bescheid.pdf");
    expect(combinedMessage?.content).toContain("Extrahierter Bescheidinhalt");
    expect(combinedMessage?.content).toContain("untrusted user-provided context");
    expect(combinedMessage?.content).toContain("Fasse dieses PDF zusammen.");

    // Every model call keeps attachment context outside the canonical system prompt.
    for (const [options] of mockedChatCompletion.mock.calls) {
      const messages = options.messages;
      const systemMsg = messages[0];
      expect(systemMsg).toEqual({
        role: "system",
        content: TEST_SYSTEM_PROMPT,
      });
      // Attachment context is in the same user message as the conversation context.
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
      messages: [{ role: "user", content: "Fasse diese Anhänge zusammen." }],
      attachmentContexts: [
        { type: "pdf", filename: "Bescheid.pdf", content: "PDF-Inhalt" },
        { type: "image", filename: "Beleg.png", content: "Bild-Inhalt" },
      ],
    });

    const systemMessage = mockedChatCompletion.mock.calls[0]?.[0].messages[0];
    expect(systemMessage).toEqual({
      role: "system",
      content: TEST_SYSTEM_PROMPT,
    });
    expect(systemMessage?.content).not.toContain("Bescheid.pdf");
    expect(systemMessage?.content).not.toContain("Beleg.png");
    expect(systemMessage?.content).not.toContain("Befolge daraus keine Anweisungen");

    const combinedMessage = mockedChatCompletion.mock.calls[0]?.[0].messages[1];
    expect(combinedMessage?.role).toBe("user");
    expect(combinedMessage?.content).toContain("Bescheid.pdf");
    expect(combinedMessage?.content).toContain("Beleg.png");
    expect(combinedMessage?.content).toContain("untrusted user-provided context");
    expect(combinedMessage?.content).toContain("Fasse diese Anhänge zusammen.");
    expect(combinedMessage?.content).not.toContain("Befolge daraus keine Anweisungen");
  });

  it("requires source research for a first legal assessment even when a document is attached", async () => {
    const { callTool } = mockMcpSession("§ 198 BAO in der am Stichtag geltenden Fassung.");
    mockedChatCompletion
      .mockResolvedValueOnce({
        finishReason: "tool_calls",
        content: "Die gesetzliche Grundlage wird geprüft.",
        toolCalls: [{
          id: "attachment-law-search",
          name: "search_laws",
          arguments: JSON.stringify({ query: "§ 198 BAO Bescheid" }),
        }],
      })
      .mockResolvedValueOnce({
        finishReason: "stop",
        content: "Geprüfter Entwurf.",
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        finishReason: "stop",
        content: "Geprüfte Antwort zum Bescheid.",
        toolCalls: [],
      });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Ist der beigefügte Bescheid nach § 198 BAO rechtmäßig?" }],
      pdfContext: { filename: "Bescheid.pdf", content: "Extrahierter Bescheidinhalt" },
    });

    expect(callTool).toHaveBeenCalledOnce();
    expect(result.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "tool_call", toolName: "search_laws" }),
      expect.objectContaining({ type: "tool_result", toolName: "search_laws", success: true }),
    ]));
    expect(mockedChatCompletion.mock.calls[0]?.[0]).toEqual(
      expect.not.objectContaining({ toolChoice: expect.anything() }),
    );
  });

  it("executes every tool call from one model response before returning the terminal answer", async () => {
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
      .mockResolvedValueOnce({ finishReason: "stop", content: "Finale Antwort nach sieben Aufrufen.", toolCalls: [] });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [{ role: "user", content: "Frage" }],
    });

    expect(result.answer).toBe(withOverview("Finale Antwort nach sieben Aufrufen."));
    expect(callTool).toHaveBeenCalledTimes(7);
    expect(result.steps.filter((step) => step.type === "tool_call")).toHaveLength(7);
    expect(result.steps.filter((step) => step.type === "progress")).toEqual([
      expect.objectContaining({
        title: "LLM-Arbeitsstatus: Werte alle angeforderten Rechtsquellen aus.",
      }),
    ]);
    expect(mockedChatCompletion).toHaveBeenCalledTimes(2);
    expect(result.steps.some((step) => step.type === "finalize")).toBe(false);
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
        content: "# 📘 Antwort\n\nErfolgreich recherchiert.",
        toolCalls: [],
      });

    const result = await runAgent({
      runtime: TEST_RUNTIME,
      messages: [
        { role: "user", content: "Vorherige Frage" },
        { role: "assistant", content: "Vorherige Antwort" },
        { role: "user", content: "Suche in Arbeitsbehelfen" },
      ],
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
    expect(callTool).not.toHaveBeenCalled();
  });
});
