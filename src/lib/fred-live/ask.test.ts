import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFredUpstreamSession, fetchFredUpstreamConfig, openFredUpstreamStream, stopFredUpstreamSession } from "@/lib/weknora/fred-native";
import { mintFredEmbedSession, readQuickFredEmbedServerConfig } from "@/lib/weknora/fred-embed";
import { askQuickFred, assembleFredLiveAnswer, projectFredLiveSources, toSpokenAnswer } from "./ask";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/weknora/fred-embed", () => ({
  mintFredEmbedSession: vi.fn(),
  readQuickFredEmbedServerConfig: vi.fn(),
  FredEmbedConfigurationError: class extends Error {},
}));
vi.mock("@/lib/weknora/fred-native", () => ({
  createFredUpstreamSession: vi.fn(),
  deriveFredSessionSignature: vi.fn(() => "derived"),
  fetchFredUpstreamConfig: vi.fn(),
  fredVisitorId: vi.fn(() => "visitor"),
  openFredUpstreamStream: vi.fn(),
  stopFredUpstreamSession: vi.fn(),
}));

const config = { channelId: "quick", publishToken: "em_1234567890123456", exchangeOrigin: "https://findog.at", expectedAgentId: "11111111-1111-4111-8111-111111111111" };
const session = { token: "ems_1234567890123456", expiresIn: 300, channelId: "quick", embedOrigin: "https://taxdog.cloud" as const };

function stream(...events: unknown[]) {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

describe("askQuickFred", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(readQuickFredEmbedServerConfig).mockReturnValue(config);
    vi.mocked(mintFredEmbedSession).mockResolvedValue(session);
    vi.mocked(fetchFredUpstreamConfig).mockResolvedValue({ agentId: config.expectedAgentId, knowledgeBaseIds: ["kb-1"], allowWebSearch: true, allowFileUpload: false, allowImageUpload: false });
    vi.mocked(createFredUpstreamSession).mockResolvedValue({ id: "new-session", signature: "sig" });
    vi.mocked(openFredUpstreamStream).mockResolvedValue(stream(
      { response_type: "answer", content: "Hallo " },
      { response_type: "answer", content: "Welt" },
      { response_type: "references", data: { sources: [{ doc: "Steuerleitfaden", knowledge_base_id: "kb-1" }] } },
      { response_type: "complete" },
    ));
  });

  it("creates a session and assembles a recorded stream", async () => {
    const result = await askQuickFred({ question: "Frage", signal: new AbortController().signal });
    expect(result.answer).toBe("Hallo Welt");
    expect(result.upstreamSessionId).toBe("new-session");
    expect(createFredUpstreamSession).toHaveBeenCalled();
    expect(openFredUpstreamStream).toHaveBeenCalledWith(expect.objectContaining({ webSearchEnabled: false, summaryModelId: "" }));
  });

  it("resumes with a server-derived signature", async () => {
    const result = await askQuickFred({ question: "Frage", upstreamSessionId: "old-session", signal: new AbortController().signal });
    expect(result.upstreamSessionId).toBe("old-session");
    expect(createFredUpstreamSession).not.toHaveBeenCalled();
    expect(openFredUpstreamStream).toHaveBeenCalledWith(expect.objectContaining({ upstreamSession: { id: "old-session", signature: "derived" } }));
  });

  it("reduces the markdown answer to speakable sentences", () => {
    expect(toSpokenAnswer([
      "## Pendlerpauschale",
      "",
      "- **Grosse** Pauschale: siehe [Paragraf 16 EStG](https://www.ris.bka.gv.at/estg).",
      "1. Antrag beim `Finanzamt` stellen.",
      "",
      "| Jahr | Betrag |",
      "| --- | --- |",
      "| 2026 | 100 |",
    ].join("\n"))).toBe([
      "Pendlerpauschale",
      "",
      "Grosse Pauschale: siehe Paragraf 16 EStG.",
      "Antrag beim Finanzamt stellen.",
      "",
      "Jahr Betrag",
      "2026 100",
    ].join("\n"));
    expect(assembleFredLiveAnswer([{ response_type: "answer", content: "**Hallo** Welt" }])).toBe("Hallo Welt");
  });

  it("caps and deduplicates answer and sources", () => {
    expect(assembleFredLiveAnswer([{ response_type: "answer", content: "x".repeat(6_100) }])).toHaveLength(6_000);
    expect(projectFredLiveSources([
      { kind: "knowledge", doc: "A", knowledgeBaseId: "1" },
      { kind: "knowledge", doc: "A", knowledgeBaseId: "1" },
      ...Array.from({ length: 8 }, (_, i) => ({ kind: "knowledge" as const, doc: `D${i}` })),
    ])).toHaveLength(5);
  });

  it("maps abort to 504 and upstream errors to 502", async () => {
    const controller = new AbortController();
    vi.mocked(openFredUpstreamStream).mockRejectedValueOnce(new DOMException("aborted", "AbortError"));
    controller.abort();
    await expect(askQuickFred({ question: "Frage", signal: controller.signal })).rejects.toMatchObject({ status: 504 });
    vi.mocked(openFredUpstreamStream).mockRejectedValueOnce(new Error("upstream"));
    await expect(askQuickFred({ question: "Frage", signal: new AbortController().signal })).rejects.toMatchObject({ status: 502 });
  });

  it("stops an upstream session after abort", async () => {
    const controller = new AbortController();
    vi.mocked(openFredUpstreamStream).mockImplementationOnce(async ({ signal }) => {
      controller.abort();
      void signal;
      throw new DOMException("aborted", "AbortError");
    });
    await expect(askQuickFred({ question: "Frage", signal: controller.signal })).rejects.toMatchObject({ status: 504 });
    expect(stopFredUpstreamSession).toHaveBeenCalled();
  });
});
