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

function expectProtocolSafeMessages(): void {
  for (const [callIndex, call] of mockedChatCompletion.mock.calls.entries()) {
    const messages = call[0].messages;
    for (let index = 1; index < messages.length; index += 1) {
      const previousRole = messages[index - 1]?.role;
      const currentRole = messages[index]?.role;
      expect(
        previousRole === "assistant" && currentRole === "assistant",
        `chatCompletion call ${callIndex} has consecutive assistant messages at ${index - 1}/${index}`,
      ).toBe(false);
      expect(
        previousRole === "user" && currentRole === "user",
        `chatCompletion call ${callIndex} has consecutive user messages at ${index - 1}/${index}`,
      ).toBe(false);
      expect(
        previousRole === "tool" && currentRole !== "tool" && currentRole !== "assistant",
        `chatCompletion call ${callIndex} has ${currentRole} directly after tool at ${index - 1}/${index}`,
      ).toBe(false);
    }
  }
}

describe("runAgent", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  function mockMcpSession() {
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
            },
          },
        },
      ],
      deepSeekTools: [
        {
          type: "function",
          function: {
            name: "hybrid_search",
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
    MockedMcpClient.mockImplementation(function MockMcpClient() {
      return {
        openToolSession,
        callTool,
      } as unknown as McpClient;
    });

    return { callTool, openToolSession };
  }

  it("plans before tool use, shows progress, self-checks, and returns the final answer", async () => {
    mockMcpSession();
    mockedChatCompletion
      .mockResolvedValueOnce({
        content: "1. Gesetzliche Grundlage prüfen\n2. BFG-Judikatur zur Pendlerpauschale suchen",
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        content: "Ich recherchiere.",
        toolCalls: [
          {
            id: "call-1",
            name: "hybrid_search",
            arguments: JSON.stringify({ query: "Pendlerpauschale 2024" }),
          },
        ],
      })
      .mockResolvedValueOnce({
        content:
          "- ~~Gesetzliche Grundlage prüfen~~\n- BFG-Judikatur zur Pendlerpauschale suchen",
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        content: "Die Recherche ist abgeschlossen.",
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        content: "Selbstcheck: Alle Planpunkte wurden anhand der Recherche behandelt.",
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        content: "Finale Antwort.",
        toolCalls: [],
      });

    const result = (await runAgent({
      apiKey: "test-key",
      model: "deepseek-v4-flash",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Frage" }],
      mcpBearerToken: "mcp-token",
    })) as unknown as AgentRunShape;

    expect(result.answer).toBe("Finale Antwort.");
    expect(result.tools).toEqual(["hybrid_search"]);
    expect(result.steps.map((step) => step.type)).toEqual([
      "plan",
      "tools",
      "tool_call",
      "tool_result",
      "progress",
      "finalize",
      "self_check",
      "answer",
    ]);
    expect(result.steps[0]?.content).toBe(
      "1. Gesetzliche Grundlage prüfen\n2. BFG-Judikatur zur Pendlerpauschale suchen",
    );
    expect(result.steps[2]).toMatchObject({
      toolName: "hybrid_search",
    });
    expect(result.steps[3]).toMatchObject({
      toolName: "hybrid_search",
      success: true,
    });
    expect(result.steps[4]?.content).toContain("~~Gesetzliche Grundlage prüfen~~");
    expect(result.steps.at(-2)).toMatchObject({
      type: "self_check",
      content: "Selbstcheck: Alle Planpunkte wurden anhand der Recherche behandelt.",
    });

    expect(mockedChatCompletion.mock.calls[0]?.[0]).not.toHaveProperty("tools");
    expect(mockedChatCompletion.mock.calls[0]?.[0].messages[0]?.content).toContain(
      "Erstelle zuerst einen dynamischen Arbeitsplan",
    );
    expect(mockedChatCompletion.mock.calls[1]?.[0].tools).toHaveLength(1);
    expect(mockedChatCompletion.mock.calls[1]?.[0].messages[0]?.content).toContain(
      "Arbeite den Arbeitsplan systematisch ab.",
    );
    expect(mockedChatCompletion.mock.calls[2]?.[0]).not.toHaveProperty("tools");
    expect(mockedChatCompletion.mock.calls[2]?.[0].messages.at(-1)).toMatchObject({
      role: "user",
      content: expect.stringContaining("Aktualisiere den Arbeitsplan"),
    });
    expectProtocolSafeMessages();
  });

  it("notifies callers whenever a visible agent step is added", async () => {
    mockMcpSession();
    const onStep = vi.fn();

    mockedChatCompletion
      .mockResolvedValueOnce({
        content: "1. Rechtsgrundlage prüfen",
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        content: "Ich recherchiere.",
        toolCalls: [
          {
            id: "call-1",
            name: "hybrid_search",
            arguments: JSON.stringify({ query: "Pendlerpauschale" }),
          },
        ],
      })
      .mockResolvedValueOnce({
        content: "- ~~Rechtsgrundlage prüfen~~",
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        content: "Die Recherche ist abgeschlossen.",
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        content: "Selbstcheck: erledigt.",
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        content: "Finale Antwort.",
        toolCalls: [],
      });

    const result = await runAgent({
      apiKey: "test-key",
      model: "deepseek-v4-flash",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Frage" }],
      mcpBearerToken: "mcp-token",
      onStep,
    });

    expect(onStep.mock.calls.map(([step]) => step.type)).toEqual(
      result.steps.map((step) => step.type),
    );
    expect(onStep).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "tool_call",
        title: "Datenbank wird abgefragt",
        toolName: "hybrid_search",
      }),
    );
    expect(onStep).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "answer",
        content: "Finale Antwort.",
      }),
    );
  });

  it("passes extracted PDF context into the selected answer model", async () => {
    mockMcpSession();
    mockedChatCompletion
      .mockResolvedValueOnce({
        content: "1. PDF-Sachverhalt prüfen",
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        content: "Vorläufige Antwort ohne Werkzeuge.",
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        content: "Selbstcheck: PDF wurde berücksichtigt.",
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        content: "Finale Antwort mit PDF-Kontext.",
        toolCalls: [],
      });

    const result = await runAgent({
      apiKey: "test-key",
      model: "deepseek-v4-pro",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Was steht im Bescheid?" }],
      mcpBearerToken: "mcp-token",
      pdfContext: {
        filename: "Bescheid.pdf",
        content: "## Seite 1\nDer Bescheid nennt Einkommensteuer 2024.",
      },
      initialSteps: [
        {
          type: "pdf_context",
          title: "PDF-Kontext extrahiert",
          content: "Bescheid.pdf wurde serverseitig ausgelesen.",
        },
      ],
    });

    expect(result.answer).toBe("Finale Antwort mit PDF-Kontext.");
    expect(result.steps[0]).toMatchObject({
      type: "pdf_context",
      title: "PDF-Kontext extrahiert",
    });
    expect(mockedChatCompletion.mock.calls.every((call) => call[0].model === "deepseek-v4-pro")).toBe(
      true,
    );
    expect(mockedChatCompletion.mock.calls[0]?.[0].messages[0]?.content).toContain(
      "Vom Nutzer hochgeladenes PDF",
    );
    expect(mockedChatCompletion.mock.calls[0]?.[0].messages[0]?.content).toContain("Bescheid.pdf");
    expect(mockedChatCompletion.mock.calls[0]?.[0].messages[0]?.content).toContain(
      "Einkommensteuer 2024",
    );
    expect(mockedChatCompletion.mock.calls.at(-1)?.[0].messages[0]?.content).toContain(
      "Vom Nutzer hochgeladenes PDF",
    );
    expectProtocolSafeMessages();
  });

  it("passes extracted PDF and image contexts into the selected answer model", async () => {
    mockMcpSession();
    mockedChatCompletion
      .mockResolvedValueOnce({
        content: "1. Anhänge prüfen",
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        content: "Vorläufige Antwort ohne Werkzeuge.",
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        content: "Selbstcheck: Anhänge wurden berücksichtigt.",
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        content: "Finale Antwort mit Anhang-Kontext.",
        toolCalls: [],
      });

    await runAgent({
      apiKey: "test-key",
      model: "deepseek-v4-flash",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Was steht in den Anhängen?" }],
      mcpBearerToken: "mcp-token",
      attachmentContexts: [
        {
          type: "pdf",
          filename: "Bescheid.pdf",
          content: "## Seite 1\nDer Bescheid nennt Einkommensteuer 2024.",
        },
        {
          type: "image",
          filename: "Beleg.png",
          content: "Foto eines Zahlungsbelegs über 120 Euro.",
        },
      ],
    });

    const planningSystemPrompt = mockedChatCompletion.mock.calls[0]?.[0].messages[0]?.content;
    expect(planningSystemPrompt).toContain("Vom Nutzer hochgeladene Anhänge");
    expect(planningSystemPrompt).toContain("PDF: Bescheid.pdf");
    expect(planningSystemPrompt).toContain("Bild: Beleg.png");
    expect(planningSystemPrompt).toContain("Einkommensteuer 2024");
    expect(planningSystemPrompt).toContain("Zahlungsbelegs über 120 Euro");
    expect(mockedChatCompletion.mock.calls.at(-1)?.[0].messages[0]?.content).toContain(
      "Vom Nutzer hochgeladene Anhänge",
    );
    expectProtocolSafeMessages();
  });

  it("synthesizes a final answer without tools after the tool loop reaches its limit", async () => {
    const { callTool } = mockMcpSession();

    mockedChatCompletion.mockImplementation(async (options) => {
      const lastMessage = options.messages.at(-1)?.content ?? "";
      if (lastMessage.includes("Erstelle zuerst einen dynamischen Arbeitsplan")) {
        return {
          content: "1. Anspruchsvoraussetzungen prüfen\n2. Bisherige Ergebnisse würdigen",
          toolCalls: [],
        };
      }
      if (lastMessage.includes("Aktualisiere den Arbeitsplan")) {
        return {
          content: "- ~~Anspruchsvoraussetzungen prüfen~~\n- Bisherige Ergebnisse würdigen",
          toolCalls: [],
        };
      }
      if (lastMessage.includes("Prüfe vor der finalen Antwort")) {
        return {
          content: "Selbstcheck: Die erreichbaren Punkte wurden geprüft.",
          toolCalls: [],
        };
      }
      if ((options.tools?.length ?? 0) === 0) {
        return {
          content: "Finale Antwort aus bisherigen Werkzeugergebnissen.",
          toolCalls: [],
        };
      }

      return {
        content: "Ich recherchiere weiter.",
        toolCalls: [
          {
            id: `call-${mockedChatCompletion.mock.calls.length}`,
            name: "hybrid_search",
            arguments: JSON.stringify({ query: "Familienbonus Plus" }),
          },
        ],
      };
    });

    const result = (await runAgent({
      apiKey: "test-key",
      model: "deepseek-v4-flash",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Frage" }],
      mcpBearerToken: "mcp-token",
    })) as unknown as AgentRunShape;

    expect(result.answer).toBe("Finale Antwort aus bisherigen Werkzeugergebnissen.");
    expect(callTool.mock.calls.length).toBeGreaterThan(4);
    expect(mockedChatCompletion.mock.calls.at(-1)?.[0]).not.toHaveProperty("tools");
    expect(result.steps.at(-3)?.type).toBe("finalize");
    expect(result.steps.at(-2)).toMatchObject({
      type: "self_check",
      content: "Selbstcheck: Die erreichbaren Punkte wurden geprüft.",
    });
    expect(result.steps.at(-1)).toMatchObject({
      type: "answer",
      content: "Finale Antwort aus bisherigen Werkzeugergebnissen.",
    });
    expectProtocolSafeMessages();
  });
});
