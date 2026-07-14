import { beforeEach, describe, expect, it, vi } from "vitest";

import { runAgent } from "./agent";
import { chatCompletion } from "./deepseek";
import { createDeadline } from "./deadline";
import { McpClient } from "./mcp/client";

vi.mock("./deepseek", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./deepseek")>();
  return { ...actual, chatCompletion: vi.fn() };
});

vi.mock("./mcp/client", () => ({ McpClient: vi.fn() }));

const mockedChatCompletion = vi.mocked(chatCompletion);
const MockedMcpClient = vi.mocked(McpClient);
const RESEARCH_POLICY_PROMPT_SUFFIX = [
  "# VERBINDLICHER RECHERCHEUMFANG",
  "Diese Regeln ersetzen entgegenstehende Recherche- und Ausgabevorgaben weiter oben.",
  "Bei Fachfragen ist die vollständige Nutzerfrage gegen die gesamte Quelle Gesetze und Verordnungen einschließlich aller enthaltenen Richtlinien zu recherchieren. Erzeuge keine zusätzlichen Richtlinienabfragen allein aufgrund einzelner Wörter.",
  "Begrenze Richtlinien- und Gesetzestreffer nicht anwendungsseitig und kürze die vom Recherchewerkzeug gelieferten Treffer im finalen Antwortkontext nicht. Berücksichtige und nenne alle sachlich einschlägigen gelieferten Treffer.",
  "Eine nachgelagerte automatische BFG-/Findok-Verifikation findet nicht statt. Die BFG-Recherchefunktion bleibt für Fachfragen regulär verfügbar.",
  "Berücksichtige den Stichtag ausdrücklich. Bei jahresabhängigen Beträgen bestimmt das genannte Jahr den maßgeblichen Rechtsstand; ein Tagesdatum ist nur nötig, wenn der Nutzer es vorgibt oder es für die Rechtsfrage entscheidend ist. Die starre Formulierung ‚Maßgeblicher Stichtag‘ ist nicht verpflichtend.",
].join("\n");
const OUTPUT_FORMAT_POLICY_PROMPT_SUFFIX = [
  "# VERBINDLICHES ANTWORTFORMAT",
  "Diese Regeln ersetzen entgegenstehende Überschriften-, Symbol- und Darstellungsregeln weiter oben.",
  "Formatiere jede tatsächlich verwendete Abschnittsüberschrift als eigene Markdown-Überschrift erster Ebene im Format `# <Icon> <Titel>`. Nicht einschlägige Abschnitte bleiben vollständig weg.",
  "Verwende `# 📘 Überblick` statt ‚Kurzantwort‘.",
  "Verwende ausschließlich `# 🏛️ BFG-Rechtsprechung` statt ‚BFG-Rechtsprechung / Recherchebefund‘. Eine gezielte einzelne BFG-Fundstellenabfrage darf weiterhin als ‚BFG-Fundstelle / Recherchebefund‘ bezeichnet werden.",
  "Sind BFG-Entscheidungen einschlägig, stelle alle verwerteten Entscheidungen als Markdown-Tabelle mit den Spalten `Entscheidung / Fundtyp`, `Kernaussage`, `Stichtags- und Sachverhaltsbezug` und `Relevanz / Verwertung` dar. Jede Zeile nennt, soweit geliefert, Gericht, Datum, Geschäftszahl oder ECLI, Quellenkennung und die Einordnung als Rechtssatz oder Entscheidungschunk. Bei keinem einschlägigen Treffer gib unter der BFG-Überschrift einen knappen qualifizierten Negativbefund aus und keine leere Tabelle.",
  "Stelle den Abschnitt `Richtlinien / Erlässe` immer als Markdown-Tabelle mit den Spalten `Richtlinie / Fundstelle`, `Aussage`, `Stand / Stichtagsbezug` und `Relevanz` dar. Nimm alle sachlich einschlägigen gelieferten Richtlinientreffer auf; bei keinem einschlägigen Treffer entfällt der Abschnitt.",
  "Verwende `# 🗂️ Interne Verwaltungspraxis` und `# 🧭 Abgrenzungen / Praxispunkte`. Verwende für diese beiden Abschnitte sowie für WinANV und FEXklusiv kein Warnsymbol. Hinweise auf fehlende Bindungswirkung bleiben als neutrale fachliche Einordnung erhalten. Echte Risiken, Unsicherheiten oder offene Klärungspunkte dürfen weiterhin passend gekennzeichnet werden.",
].join("\n");

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
      deepSeekTools: [
        {
          type: "function",
          function: {
            name: "hybrid_search",
            description: "Search scoped knowledge bases",
            parameters: { type: "object", properties: {} },
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

  it("uses semantic tool names and appends the research policy to attachment-free system prompts", async () => {
    const { callTool } = mockMcpSession();
    mockedChatCompletion
      .mockResolvedValueOnce({
        content: "Recherche",
        toolCalls: [
          {
            id: "call-1",
            name: "search_laws",
            arguments: JSON.stringify({ query: "EStG § 33" }),
          },
        ],
      })
      .mockResolvedValueOnce({ content: "Vorläufige Antwort.", toolCalls: [] })
      .mockResolvedValueOnce({ content: "Finale Antwort.", toolCalls: [] });

    const result = await runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      systemPrompt: "System-Prompt-Inhalt",
      messages: [{ role: "user", content: "EStG § 33" }],
      mcpBearerToken: "mcp-token",
    });

    expect(result.answer).toBe("Finale Antwort.");
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

    // Runtime policies are appended, while attachment content remains outside the system prompt.
    expect(mockedChatCompletion.mock.calls[0][0].messages[0]).toEqual({
      role: "system",
      content: `System-Prompt-Inhalt\n\n${RESEARCH_POLICY_PROMPT_SUFFIX}\n\n${OUTPUT_FORMAT_POLICY_PROMPT_SUFFIX}`,
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

  it("notifies callers for every visible deterministic step", async () => {
    const { callTool } = mockMcpSession();
    const onStep = vi.fn();
    mockedChatCompletion
      .mockResolvedValueOnce({ content: "Vorläufig.", toolCalls: [] })
      .mockResolvedValueOnce({ content: "Finale Antwort.", toolCalls: [] });

    const result = await runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      systemPrompt: "System",
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
      expect.objectContaining({ type: "answer", content: "Finale Antwort." }),
    );
  });

  it("passes the request deadline to model, session, and tool calls", async () => {
    const deadline = createDeadline(240_000);
    const { callTool, openToolSession } = mockMcpSession();
    mockedChatCompletion
      .mockResolvedValueOnce({
        content: "Recherche.",
        toolCalls: [{
          id: "deadline-call",
          name: "search_laws",
          arguments: JSON.stringify({ query: "Frage" }),
        }],
      })
      .mockResolvedValueOnce({ content: "Vorläufig.", toolCalls: [] })
      .mockResolvedValueOnce({ content: "Finale Antwort.", toolCalls: [] });

    await runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Frage" }],
      mcpBearerToken: "mcp-token",
      deadline,
    });

    expect(mockedChatCompletion.mock.calls.every(([options]) => options.deadline === deadline)).toBe(true);
    expect(openToolSession).toHaveBeenCalledWith("mcp-token", { deadline });
    expect(callTool).toHaveBeenCalledWith(expect.objectContaining({ deadline }));
    deadline.dispose();
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
    mockedChatCompletion.mockResolvedValueOnce({ content: "Finale Antwort.", toolCalls: [] });

    const result = await runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Frage" }],
      deadline,
    });

    expect(result.answer).toBe("Finale Antwort.");
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
      .mockResolvedValueOnce({ content: "Vorläufig.", toolCalls: [] })
      .mockResolvedValueOnce({ content: "Finale Antwort mit PDF-Kontext.", toolCalls: [] });

    const result = await runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      systemPrompt: "System-Prompt-Inhalt",
      messages: [{ role: "user", content: "Bitte PDF prüfen" }],
      pdfContext: { filename: "Bescheid.pdf", content: "Extrahierter Bescheidinhalt" },
      initialSteps: [{ type: "pdf_context", title: "PDF gelesen", content: "Bescheid.pdf" }],
    });

    expect(result.answer).toBe("Finale Antwort mit PDF-Kontext.");
    expect(result.steps[0]).toMatchObject({ type: "pdf_context" });
    expect(result.steps[1]).toMatchObject({ type: "tools", title: "Datenbank bereit" });

    // System message (index 0) must NOT contain attachment content
    const systemMessage = mockedChatCompletion.mock.calls[0]?.[0].messages[0];
    expect(systemMessage).toEqual({
      role: "system",
      content: `System-Prompt-Inhalt\n\n${RESEARCH_POLICY_PROMPT_SUFFIX}\n\n${OUTPUT_FORMAT_POLICY_PROMPT_SUFFIX}`,
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
        content: `System-Prompt-Inhalt\n\n${RESEARCH_POLICY_PROMPT_SUFFIX}\n\n${OUTPUT_FORMAT_POLICY_PROMPT_SUFFIX}`,
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
      .mockResolvedValueOnce({ content: "Vorläufig.", toolCalls: [] })
      .mockResolvedValueOnce({ content: "Finale Antwort mit Anhängen.", toolCalls: [] });

    await runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Anhänge prüfen" }],
      attachmentContexts: [
        { type: "pdf", filename: "Bescheid.pdf", content: "PDF-Inhalt" },
        { type: "image", filename: "Beleg.png", content: "Bild-Inhalt" },
      ],
    });

    const systemMessage = mockedChatCompletion.mock.calls[0]?.[0].messages[0];
    expect(systemMessage).toEqual({
      role: "system",
      content: `System\n\n${RESEARCH_POLICY_PROMPT_SUFFIX}\n\n${OUTPUT_FORMAT_POLICY_PROMPT_SUFFIX}`,
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
      .mockResolvedValueOnce({
        content: "Weitere Recherche",
        toolCalls: Array.from({ length: 7 }, (_value, index) => ({
          id: `call-${index + 1}`,
          name: "search_laws",
          arguments: JSON.stringify({ query: `Suche ${index + 1}` }),
        })),
      })
      .mockResolvedValueOnce({ content: "Vorläufige Antwort nach sieben Aufrufen.", toolCalls: [] })
      .mockResolvedValueOnce({ content: "Finale Antwort nach sieben Aufrufen.", toolCalls: [] });

    const result = await runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Frage" }],
    });

    expect(result.answer).toBe("Finale Antwort nach sieben Aufrufen.");
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
      .mockResolvedValueOnce({
        content: "BFG-Suche.",
        toolCalls: [{
          id: "bfg-search",
          name: "search_bfg",
          arguments: JSON.stringify({ query: "Rechtsprechung" }),
        }],
      })
      .mockResolvedValueOnce({ content: "Vorläufige Antwort.", toolCalls: [] })
      .mockResolvedValueOnce({ content: "Finale Antwort ohne Fundstelle.", toolCalls: [] });

    const result = await runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Welche BFG-Rechtsprechung ist einschlägig?" }],
    });

    expect(result.answer).toBe("Finale Antwort ohne Fundstelle.");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.steps.some((step) => step.type === "citation_verification")).toBe(false);
    expectProtocolSafeMessages();
  });

  it("returns BFG references unchanged without post-verification", async () => {
    mockMcpSession("Treffer: RV/7103053/2014");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mockedChatCompletion
      .mockResolvedValueOnce({
        content: "Recherche.",
        toolCalls: [{
          id: "citation-search",
          name: "search_bfg",
          arguments: JSON.stringify({ query: "Quellensteuer" }),
        }],
      })
      .mockResolvedValueOnce({ content: "Vorläufig.", toolCalls: [] })
      .mockResolvedValueOnce({
        content: "Siehe RV/7103053/2014 und RV/7103080/2015.",
        toolCalls: [],
      });

    const result = await runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Frage" }],
    });

    expect(result.answer).toBe("Siehe RV/7103053/2014 und RV/7103080/2015.");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.steps.some((step) => step.type === "citation_verification")).toBe(false);
  });
});
