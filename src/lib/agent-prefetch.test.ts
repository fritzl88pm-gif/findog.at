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

describe("runAgent BFG prefetch", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  it("prefetches the exact BFG KB, verifies real hits, and appends omitted official links", async () => {
    const callTool = vi.fn().mockResolvedValue(
      "Treffer: RV/2100543/2025, RV/1100373/2020 und RV/1100299/2020",
    );
    MockedMcpClient.mockImplementation(function MockMcpClient() {
      return {
        openToolSession: vi.fn().mockResolvedValue({
          sessionId: "session-1",
          tools: [
            {
              name: "hybrid_search",
              inputSchema: {
                type: "object",
                properties: {
                  query: { type: "string" },
                  kb_id: { type: "string" },
                  vector_threshold: { type: "number" },
                  keyword_threshold: { type: "number" },
                  match_count: { type: "number" },
                },
              },
            },
          ],
          deepSeekTools: [
            {
              type: "function",
              function: {
                name: "hybrid_search",
                description: "Search",
                parameters: { type: "object", properties: {} },
              },
            },
          ],
        }),
        callTool,
      } as unknown as McpClient;
    });

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const decoded = decodeURIComponent(String(input));
      const gz = ["RV/2100543/2025", "RV/1100373/2020", "RV/1100299/2020"].find((item) =>
        decoded.includes(item),
      );
      if (!gz) {
        return new Response("nicht gefunden", { status: 404 });
      }
      const documentId = gz.replace(/\D/g, "");
      return new Response(
        JSON.stringify({
          dokumentId: documentId,
          segmentId: "segment",
          indexName: "findok-bfg",
          dokumentPdfMediaUrl: `findok/resources/pdf/segment/${documentId}.pdf`,
          dokumentTitel: `BFG, ${gz}`,
          titel: "Unterhaltsabsetzbetrag für Kinder in Drittstaaten",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }));

    mockedChatCompletion
      .mockResolvedValueOnce({ content: "Ich beantworte die Frage.", toolCalls: [] })
      .mockResolvedValueOnce({ content: "Finale Antwort ohne BFG-Zitat.", toolCalls: [] });

    const result = await runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      systemPrompt: "System",
      messages: [
        { role: "user", content: "Unterhaltsabsetzbetrag für Kinder in Drittstaaten" },
      ],
      mcpBearerToken: "mcp-token",
    });

    expect(callTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "hybrid_search",
        arguments: expect.objectContaining({
          query: "Unterhaltsabsetzbetrag für Kinder in Drittstaaten",
          kb_id: "7e203a75-9e51-4839-afd4-7d24d2e5b033",
          vector_threshold: 0.3,
          keyword_threshold: 0.1,
          match_count: 5,
        }),
      }),
    );
    for (const gz of ["RV/2100543/2025", "RV/1100373/2020", "RV/1100299/2020"]) {
      expect(result.answer).toContain(`[${gz}](https://findok.bmf.gv.at/findok/resources/pdf/`);
    }
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "citation_verification",
          content: "3 verifiziert, 0 verworfen.",
        }),
      ]),
    );

    const allPrompts = mockedChatCompletion.mock.calls
      .flatMap(([options]) => options.messages.map((message) => message.content ?? ""))
      .join("\n");
    expect(allPrompts).not.toContain("Erstelle zuerst einen dynamischen Arbeitsplan");
    expect(allPrompts).not.toContain("Aktualisiere den Arbeitsplan");
    expect(allPrompts).not.toContain("Selbstcheck");
  });

  it("does not invent an unsupported result-cap argument for a declared schema", async () => {
    const callTool = vi.fn().mockResolvedValue("Keine Treffer.");
    MockedMcpClient.mockImplementation(function MockMcpClient() {
      return {
        openToolSession: vi.fn().mockResolvedValue({
          sessionId: "session-1",
          tools: [
            {
              name: "hybrid_search",
              inputSchema: {
                type: "object",
                properties: {
                  query: { type: "string" },
                  kb_id: { type: "string" },
                },
              },
            },
          ],
          deepSeekTools: [],
        }),
        callTool,
      } as unknown as McpClient;
    });
    mockedChatCompletion
      .mockResolvedValueOnce({ content: "Vorläufig.", toolCalls: [] })
      .mockResolvedValueOnce({ content: "Finale Antwort.", toolCalls: [] });

    await runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Frage" }],
    });

    expect(callTool).toHaveBeenCalledWith(
      expect.objectContaining({
        arguments: {
          query: "Frage",
          kb_id: "7e203a75-9e51-4839-afd4-7d24d2e5b033",
        },
      }),
    );
  });

  it("keeps a failed prefetch non-fatal and visible as a failed agent step", async () => {
    MockedMcpClient.mockImplementation(function MockMcpClient() {
      return {
        openToolSession: vi.fn().mockResolvedValue({
          sessionId: "session-1",
          tools: [{ name: "hybrid_search", inputSchema: { type: "object" } }],
          deepSeekTools: [],
        }),
        callTool: vi.fn().mockRejectedValue(new Error("prefetch timeout")),
      } as unknown as McpClient;
    });
    mockedChatCompletion
      .mockResolvedValueOnce({ content: "Vorläufig.", toolCalls: [] })
      .mockResolvedValueOnce({ content: "Finale Antwort.", toolCalls: [] });

    const result = await runAgent({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      systemPrompt: "System",
      messages: [{ role: "user", content: "Frage" }],
    });

    expect(result.answer).toBe("Finale Antwort.");
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool_result",
          toolName: "hybrid_search",
          success: false,
          content: "BFG-Vorabfrage fehlgeschlagen.",
        }),
      ]),
    );
  });
});
