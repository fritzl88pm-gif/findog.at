import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { buildAttachmentContext } from "@/lib/attachments/context";
import { extractDocumentsWithConfiguredModel } from "@/lib/attachments/document-fallback";
import {
  mintFredEmbedSession,
  readFredEmbedServerConfig,
  readFredProModelId,
  readQuickFredEmbedServerConfig,
} from "@/lib/weknora/fred-embed";
import {
  createFredUpstreamSession,
  deriveFredSessionSignature,
  fetchFredUpstreamConfig,
  openFredUpstreamStream,
  relayFredWebhookEvent,
  stopFredUpstreamSession,
} from "@/lib/weknora/fred-native";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getScanningSettings } from "@/lib/scanning/settings";
import { parseFredNativeStreamLine } from "@/lib/fred-native-stream";
import { resolveBfgCitation } from "@/lib/findok/bfg-citations";

import { UserVisibleError } from "@/lib/errors";
import { POST } from "./route";

const { recordAdminRequest: mockRecordAdminRequest } = vi.hoisted(() => ({
  recordAdminRequest: vi.fn(),
}));

vi.mock("@/lib/admin-request-history", () => ({
  recordAdminRequest: mockRecordAdminRequest,
}));
vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/attachments/context", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/attachments/context")>();
  return { ...original, buildAttachmentContext: vi.fn() };
});
vi.mock("@/lib/attachments/document-fallback", () => ({
  extractDocumentsWithConfiguredModel: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/scanning/settings", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/scanning/settings")>();
  return { ...original, getScanningSettings: vi.fn() };
});
vi.mock("@/lib/findok/bfg-citations", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/findok/bfg-citations")>();
  return { ...original, resolveBfgCitation: vi.fn() };
});
vi.mock("@/lib/weknora/fred-embed", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/weknora/fred-embed")>();
  return {
    ...original,
    mintFredEmbedSession: vi.fn(),
    readFredEmbedServerConfig: vi.fn(),
    readFredProModelId: vi.fn(),
    readQuickFredEmbedServerConfig: vi.fn(),
  };
});
vi.mock("@/lib/weknora/fred-native", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/weknora/fred-native")>();
  return {
    ...original,
    createFredUpstreamSession: vi.fn(),
    deriveFredSessionSignature: vi.fn(),
    fetchFredUpstreamConfig: vi.fn(),
    fredVisitorId: vi.fn(() => "visitor-hash"),
    openFredUpstreamStream: vi.fn(),
    relayFredWebhookEvent: vi.fn(() => Promise.resolve()),
    stopFredUpstreamSession: vi.fn(() => Promise.resolve()),
  };
});

const userId = "11111111-1111-4111-8111-111111111111";
const auditUserId = "33333333-3333-4333-8333-333333333333";
const conversationId = "22222222-2222-4222-8222-222222222222";
const summaryRow = {
  conversation_id: conversationId,
  title: "Wie ist die Rechtslage?",
  created_at: "2026-07-19T10:00:00.000Z",
  updated_at: "2026-07-19T10:00:01.000Z",
  agent_key: "fred",
};

function request(body: Record<string, unknown>): Request {
  return new Request("https://findog.at/api/fred/chat", {
    method: "POST",
    headers: {
      Authorization: "Bearer access-token",
      "Content-Type": "application/json",
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

function multipartRequest(options: {
  query: string;
  webSearchEnabled?: boolean;
  image?: File;
  attachment?: File;
}): Request {
  const formData = new FormData();
  formData.append("payload", JSON.stringify({
    query: options.query,
    webSearchEnabled: options.webSearchEnabled ?? false,
  }));
  if (options.image) formData.append("image", options.image, options.image.name);
  if (options.attachment) formData.append("attachment", options.attachment, options.attachment.name);
  return new Request("https://findog.at/api/fred/chat", {
    method: "POST",
    headers: {
      Authorization: "Bearer access-token",
      "Sec-Fetch-Site": "same-origin",
    },
    body: formData,
  });
}

function upstreamStream(): Response {
  return new Response([
    'data: {"response_type":"agent_query","assistant_message_id":"answer-1"}\n\n',
    'data: {"response_type":"answer","content":"Hallo ","done":false}\n\n',
    'data: {"response_type":"answer","content":"Welt","done":true}\n\n',
    'data: {"response_type":"complete","data":{}}\n\n',
  ].join(""), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function pdfFile(name = "Beleg.pdf"): File {
  return new File([new TextEncoder().encode("%PDF-1.7\nfixture")], name, {
    type: "application/pdf",
  });
}

function responseFromReader(reader: {
  read: () => Promise<ReadableStreamReadResult<Uint8Array>>;
  cancel: (reason?: unknown) => Promise<void>;
}): Response {
  return { body: { getReader: () => reader } } as unknown as Response;
}

async function nextEvent(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const result = await reader.read();
  if (result.done) return null;
  return parseFredNativeStreamLine(new TextDecoder().decode(result.value).trim());
}

function rpcForTurn() {
  return vi.fn()
    .mockResolvedValueOnce({ data: summaryRow, error: null })
    .mockResolvedValueOnce({
      data: { ...summaryRow, updated_at: "2026-07-19T10:00:02.000Z" },
      error: null,
    });
}

describe("POST /api/fred/chat", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRecordAdminRequest.mockResolvedValue(undefined);
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: userId });
    vi.mocked(readFredEmbedServerConfig).mockReturnValue({
      channelId: "fred-channel",
      publishToken: "em_publish_token_fixture_123456",
      exchangeOrigin: "https://findog.at",
    });
    vi.mocked(readFredProModelId).mockReturnValue("a1b2c3d4-e5f6-4789-abcd-ef0123456789");
    vi.mocked(mintFredEmbedSession).mockResolvedValue({
      token: "ems_session_token_fixture_123456",
      expiresIn: 1800,
      channelId: "fred-channel",
      embedOrigin: "https://taxdog.cloud",
    });
    vi.mocked(fetchFredUpstreamConfig).mockResolvedValue({
      agentId: "agent-1",
      knowledgeBaseIds: ["kb-1"],
      allowWebSearch: false,
      allowFileUpload: true,
    });
    vi.mocked(createFredUpstreamSession).mockResolvedValue({
      id: "session-1",
      signature: "session-signature",
    });
    vi.mocked(openFredUpstreamStream).mockImplementation(async () => upstreamStream());
    vi.mocked(buildAttachmentContext).mockImplementation(async (question) => `${question}\n\nEXTRACTED`);
    vi.mocked(getScanningSettings).mockResolvedValue({
      modelId: "google/gemini-3.5-flash",
      prompt: "Configured scanning prompt",
      updatedAt: "2026-07-19T10:00:00.000Z",
      updatedBy: userId,
    });
    vi.mocked(extractDocumentsWithConfiguredModel).mockResolvedValue(["FALLBACK"]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("streams a native answer and persists both sides under the authenticated user", async () => {
    const rpc = rpcForTurn();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);

    const response = await POST(request({ query: "Wie ist die Rechtslage?" }));
    const events = (await response.text())
      .split("\n")
      .map(parseFredNativeStreamLine)
      .filter(Boolean);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect(events).toEqual([
      {
        type: "conversation",
        conversation: {
          id: conversationId,
          title: "Wie ist die Rechtslage?",
          createdAt: "2026-07-19T10:00:00.000Z",
          updatedAt: "2026-07-19T10:00:01.000Z",
          agentKey: "fred",
        },
      },
      { type: "delta", content: "Hallo " },
      { type: "delta", content: "Welt" },
      {
        type: "final",
        answer: "Hallo Welt",
        conversation: expect.objectContaining({ id: conversationId }),
        researchTrace: [],
        sourceReferences: [],
      },
    ]);
    expect(rpc).toHaveBeenNthCalledWith(1, "record_fred_native_event", {
      payload: expect.objectContaining({
        client_id: userId,
        event_type: "message_sent",
        content: "Wie ist die Rechtslage?",
        session_id: "session-1",
        attachments: [],
        web_search_enabled: false,
      }),
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "record_fred_native_event", {
      payload: expect.objectContaining({
        client_id: userId,
        event_type: "message_received",
        content: "Hallo Welt",
        session_id: "session-1",
      }),
    });
    expect(relayFredWebhookEvent).toHaveBeenCalledTimes(2);
    expect(stopFredUpstreamSession).not.toHaveBeenCalled();
  });

  it("streams German research steps, strips split KB tags and persists raw provenance", async () => {
    const rpc = rpcForTurn();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);
    vi.mocked(openFredUpstreamStream).mockResolvedValue(new Response([
      'data: {"response_type":"thinking","data":{"event_id":"think-1","done":false},"content":"hidden reasoning"}\n\n',
      'data: {"response_type":"tool_call","data":{"tool_call_id":"call-1","tool_name":"knowledge_search","arguments":{"query":"hidden"}}}\n\n',
      'data: {"response_type":"tool_result","data":{"tool_call_id":"call-1","tool_name":"knowledge_search","success":true,"duration_ms":120}}\n\n',
      'data: {"response_type":"answer","content":"Nachweis <k","done":false}\n\n',
      'data: {"response_type":"answer","content":"b doc=\\"EStG.md\\" chunk_id=\\"chunk-1\\" kb_id=\\"kb-1\\" /> erbracht.","done":true}\n\n',
      'data: {"response_type":"complete","data":{}}\n\n',
    ].join(""), { headers: { "Content-Type": "text/event-stream" } }));

    const response = await POST(request({ query: "Bitte recherchieren" }));
    const events = (await response.text())
      .split("\n")
      .map(parseFredNativeStreamLine)
      .filter(Boolean);

    expect(events).toContainEqual({
      type: "research",
      step: {
        id: "call-1",
        kind: "knowledge",
        status: "completed",
        label: "Wissensbasis durchsucht",
        durationMs: 120,
      },
    });
    expect(events.filter((event) => event?.type === "delta")).toEqual([
      { type: "delta", content: "Nachweis " },
      { type: "delta", content: " erbracht." },
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "final",
      answer: "Nachweis  erbracht.",
      sourceReferences: [{
        kind: "knowledge",
        doc: "EStG.md",
        chunkId: "chunk-1",
        knowledgeBaseId: "kb-1",
      }],
    });
    expect(JSON.stringify(events)).not.toContain("hidden reasoning");
    expect(JSON.stringify(events)).not.toContain("hidden\"");
    expect(rpc).toHaveBeenNthCalledWith(2, "record_fred_native_event", {
      payload: expect.objectContaining({
        content: 'Nachweis <kb doc="EStG.md" chunk_id="chunk-1" kb_id="kb-1" /> erbracht.',
        display_content: "Nachweis  erbracht.",
        content_transformation: "weknora-research-de-v1",
        research_trace: expect.arrayContaining([
          expect.objectContaining({ id: "call-1", label: "Wissensbasis durchsucht" }),
        ]),
        source_references: [{
          kind: "knowledge",
          doc: "EStG.md",
          chunkId: "chunk-1",
          knowledgeBaseId: "kb-1",
        }],
      }),
    });
  });

  it("verifies BFG citations live, links only verified cases and leaves others unchanged", async () => {
    const rpc = rpcForTurn();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);
    vi.mocked(resolveBfgCitation).mockImplementation(async (gz) => gz === "RV/1100290/2023"
      ? {
          status: "verified",
          gz,
          title: "Kosten eines Fußballtrainers",
          documentTitle: `BFG 03.10.2024, ${gz}`,
          dokumentId: "doc-1",
          segmentId: "segment-1",
          indexName: "findok-bfg",
          fullTextUrl: "https://findok.bmf.gv.at/findok/volltext?gz=RV%2F1100290%2F2023",
          pdfUrl: "https://findok.bmf.gv.at/findok/resources/pdf/segment/entscheidung.pdf",
        }
      : { status: "not_found", gz, reason: "Nicht gefunden." });
    vi.mocked(openFredUpstreamStream).mockResolvedValue(new Response([
      'data: {"response_type":"answer","content":"Siehe RV/1100290/2023 und ","done":false}\n\n',
      'data: {"response_type":"answer","content":"RV/9999999/2023.","done":true}\n\n',
      'data: {"response_type":"complete","data":{}}\n\n',
    ].join(""), { headers: { "Content-Type": "text/event-stream" } }));

    const response = await POST(request({ query: "Welche Entscheidungen gibt es?" }));
    const events = (await response.text())
      .split("\n")
      .map(parseFredNativeStreamLine)
      .filter(Boolean);

    expect(events).toContainEqual({
      type: "replace",
      answer: "Siehe [RV/1100290/2023](https://findok.bmf.gv.at/findok/volltext?gz=RV%2F1100290%2F2023) und RV/9999999/2023.",
    });
    expect(events).toContainEqual({
      type: "research",
      step: {
        id: "findok:RV/1100290/2023",
        kind: "sources",
        status: "completed",
        label: "BFG-Fundstelle RV/1100290/2023 verifiziert",
      },
    });
    expect(events.at(-1)).toMatchObject({
      type: "final",
      answer: "Siehe [RV/1100290/2023](https://findok.bmf.gv.at/findok/volltext?gz=RV%2F1100290%2F2023) und RV/9999999/2023.",
    });
    expect(JSON.stringify(events)).toContain("RV/9999999/2023");
    expect(JSON.stringify(events)).not.toContain("[RV/9999999/2023]");
    expect(resolveBfgCitation).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(2, "record_fred_native_event", {
      payload: expect.objectContaining({
        content: "Siehe RV/1100290/2023 und RV/9999999/2023.",
        display_content: "Siehe [RV/1100290/2023](https://findok.bmf.gv.at/findok/volltext?gz=RV%2F1100290%2F2023) und RV/9999999/2023.",
        source_references: [expect.objectContaining({
          kind: "web",
          url: "https://findok.bmf.gv.at/findok/volltext?gz=RV%2F1100290%2F2023",
        })],
      }),
    });
  });

  it("continues only an owned stored WeKnora session", async () => {
    const rpc = rpcForTurn();
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: conversationId,
        title: "Alt",
        created_at: "2026-07-19T09:00:00.000Z",
        updated_at: "2026-07-19T09:00:00.000Z",
        weknora_channel_id: "fred-channel",
        weknora_session_id: "session-existing",
        agent_key: "fred",
        weknora_agent_id: "agent-1",
      },
      error: null,
    });
    const chain = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle,
    };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    const from = vi.fn(() => chain);
    vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc, from } as never);
    vi.mocked(deriveFredSessionSignature).mockReturnValue("derived-signature");

    const response = await POST(request({
      query: "Anschlussfrage",
      conversationId,
    }));
    await response.text();

    expect(response.status).toBe(200);
    expect(from).toHaveBeenCalledWith("fred_conversations");
    expect(chain.eq).toHaveBeenCalledWith("id", conversationId);
    expect(chain.eq).toHaveBeenCalledWith("client_id", userId);
    expect(deriveFredSessionSignature).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: "fred-channel" }),
      "session-existing",
    );
    expect(createFredUpstreamSession).not.toHaveBeenCalled();
    expect(openFredUpstreamStream).toHaveBeenCalledWith(expect.objectContaining({
      upstreamSession: { id: "session-existing", signature: "derived-signature" },
    }));
  });

  it("cancels an active upstream answer and requests an independent upstream stop", async () => {
    const rpc = rpcForTurn();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);
    let markSecondReadStarted!: () => void;
    const secondReadStarted = new Promise<void>((resolve) => {
      markSecondReadStarted = resolve;
    });
    const read = vi.fn()
      .mockResolvedValueOnce({
        done: false,
        value: new TextEncoder().encode(
          'data: {"response_type":"agent_query","assistant_message_id":"answer-active"}\n\n',
        ),
      })
      .mockImplementationOnce(() => {
        markSecondReadStarted();
        return new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined);
      });
    const cancel = vi.fn().mockResolvedValue(undefined);
    vi.mocked(openFredUpstreamStream).mockResolvedValue(responseFromReader({ read, cancel }));

    const response = await POST(request({ query: "Bitte abbrechen" }));
    const reader = response.body!.getReader();
    await nextEvent(reader);
    await secondReadStarted;
    await reader.cancel("browser-cancel");

    expect(stopFredUpstreamSession).toHaveBeenCalledWith(expect.objectContaining({
      messageId: "answer-active",
      signal: expect.any(AbortSignal),
    }));
    const stopSignal = vi.mocked(stopFredUpstreamSession).mock.calls[0][0].signal;
    expect(stopSignal.aborted).toBe(false);
    expect(cancel).toHaveBeenCalledWith("browser-cancel");
  });

  it("best-effort stops and cancels the upstream reader after a streamed processing error", async () => {
    const rpc = rpcForTurn();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);
    const read = vi.fn()
      .mockResolvedValueOnce({
        done: false,
        value: new TextEncoder().encode(
          'data: {"response_type":"agent_query","assistant_message_id":"answer-error"}\n\n',
        ),
      })
      .mockRejectedValueOnce(new Error("upstream read failed"));
    const cancel = vi.fn().mockResolvedValue(undefined);
    vi.mocked(openFredUpstreamStream).mockResolvedValue(responseFromReader({ read, cancel }));

    const response = await POST(request({ query: "Fehlerfall" }));
    const events = (await response.text())
      .split("\n")
      .map(parseFredNativeStreamLine)
      .filter(Boolean);

    expect(events).toContainEqual({ type: "error", error: "Fred konnte die Anfrage nicht abschließen." });
    expect(stopFredUpstreamSession).toHaveBeenCalledWith(expect.objectContaining({
      messageId: "answer-error",
    }));
    expect(cancel).toHaveBeenCalledWith(expect.any(Error));
  });

  it("cleans deadline timers and the request abort listener after early provider failure", async () => {
    vi.useFakeTimers();
    const rpc = rpcForTurn();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);
    vi.mocked(buildAttachmentContext).mockRejectedValue(new Error("provider failed"));
    const fredRequest = multipartRequest({ query: "Prüfen", attachment: pdfFile() });
    const addListener = vi.spyOn(fredRequest.signal, "addEventListener");
    const removeListener = vi.spyOn(fredRequest.signal, "removeEventListener");

    const response = await POST(fredRequest);
    await response.text();

    expect(addListener).toHaveBeenCalledWith("abort", expect.any(Function), { once: true });
    expect(removeListener).toHaveBeenCalledWith("abort", addListener.mock.calls[0][1]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans deadline timers and the request abort listener after normal completion", async () => {
    vi.useFakeTimers();
    const rpc = rpcForTurn();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);
    const fredRequest = request({ query: "Normal" });
    const addListener = vi.spyOn(fredRequest.signal, "addEventListener");
    const removeListener = vi.spyOn(fredRequest.signal, "removeEventListener");

    const response = await POST(fredRequest);
    await response.text();

    expect(removeListener).toHaveBeenCalledWith("abort", addListener.mock.calls[0][1]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("emits bounded attachment heartbeats only while preprocessing is pending", async () => {
    vi.useFakeTimers();
    const rpc = rpcForTurn();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);
    let resolveContext!: (value: string) => void;
    vi.mocked(buildAttachmentContext).mockReturnValue(new Promise((resolve) => {
      resolveContext = resolve;
    }));

    const response = await POST(multipartRequest({ query: "Prüfen", attachment: pdfFile() }));
    const reader = response.body!.getReader();
    const events = [await nextEvent(reader)];
    await vi.advanceTimersByTimeAsync(15_000);
    events.push(await nextEvent(reader));
    resolveContext("Prüfen\n\nEXTRACTED");
    while (true) {
      const event = await nextEvent(reader);
      if (!event) break;
      events.push(event);
    }
    await vi.advanceTimersByTimeAsync(30_000);

    expect(events.filter((event) => event?.type === "status" && event.label === "Anhänge werden analysiert …"))
      .toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preprocesses valid attachments locally and sends only the combined query upstream", async () => {
    const rpc = rpcForTurn();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);
    vi.mocked(fetchFredUpstreamConfig).mockResolvedValue({
      agentId: "agent-1",
      knowledgeBaseIds: ["kb-1"],
      allowWebSearch: true,
      allowFileUpload: true,
    });
    const pdf = pdfFile();

    const response = await POST(multipartRequest({
      query: "Bitte prüfe den Beleg",
      webSearchEnabled: true,
      attachment: pdf,
    }));
    await response.text();

    expect(response.status).toBe(200);
    expect(openFredUpstreamStream).toHaveBeenCalledWith(expect.objectContaining({
      webSearchEnabled: true,
      query: "Bitte prüfe den Beleg\n\nEXTRACTED",
    }));
    expect(vi.mocked(openFredUpstreamStream).mock.calls[0][0]).not.toHaveProperty("attachments");
    expect(rpc).toHaveBeenNthCalledWith(1, "record_fred_native_event", {
      payload: expect.objectContaining({
        content: "Bitte prüfe den Beleg",
        web_search_enabled: true,
        attachments: [{
          kind: "file",
          name: "Beleg.pdf",
          mime_type: "application/pdf",
          size_bytes: pdf.size,
          sha256: expect.any(String),
        }],
      }),
    });
  });

  it("uses the admin-configured model only when the MinerU document fallback is invoked", async () => {
    const rpc = rpcForTurn();
    const supabase = { rpc };
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase as never);
    vi.mocked(getScanningSettings).mockResolvedValue({
      modelId: "google/gemini-3.5-flash:online",
      prompt: "Scanning-specific prompt must not be used for Fred extraction",
      updatedAt: "2026-07-19T10:00:00.000Z",
      updatedBy: userId,
    });
    vi.mocked(buildAttachmentContext).mockImplementationOnce(async (question, attachments, options) => {
      if (!options?.documentFallbackProvider) throw new Error("document fallback missing");
      const fallback = await options.documentFallbackProvider(attachments as never);
      return `${question}\n\n${fallback.join("\n")}`;
    });

    const response = await POST(multipartRequest({
      query: "Bitte Dokument prüfen",
      attachment: pdfFile("Fallback.pdf"),
    }));
    await response.text();

    expect(getScanningSettings).toHaveBeenCalledWith(supabase);
    expect(extractDocumentsWithConfiguredModel).toHaveBeenCalledWith(
      [expect.objectContaining({ name: "Fallback.pdf", kind: "pdf" })],
      {
        model: "google/gemini-3.5-flash:online",
        signal: expect.any(AbortSignal),
      },
    );
    expect(openFredUpstreamStream).toHaveBeenCalledWith(expect.objectContaining({
      query: "Bitte Dokument prüfen\n\nFALLBACK",
    }));
  });

  it.each([
    ["PDF", new File(["not-pdf"], "Beleg.pdf", { type: "application/pdf" }), "attachment"],
    ["PNG", new File(["not-png"], "Bild.png", { type: "image/png" }), "image"],
    ["JPEG", new File(["not-jpeg"], "Bild.jpg", { type: "image/jpeg" }), "image"],
    ["GIF", new File(["not-gif"], "Bild.gif", { type: "image/gif" }), "image"],
    ["WebP", new File(["not-webp"], "Bild.webp", { type: "image/webp" }), "image"],
    ["DOCX", new File(["not-zip"], "Text.docx"), "attachment"],
    ["DOC", new File(["not-ole"], "Text.doc"), "attachment"],
    ["TXT", new File([new Uint8Array([65, 0, 66])], "Text.txt"), "attachment"],
  ])("rejects a %s signature mismatch before providers, persistence, and WeKnora", async (
    category,
    file,
    field,
  ) => {
    const rpc = vi.fn();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);
    const response = await POST(multipartRequest({
      query: "Prüfen",
      ...(field === "image" ? { image: file } : { attachment: file }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: expect.stringContaining(category),
    });
    expect(buildAttachmentContext).not.toHaveBeenCalled();
    expect(mintFredEmbedSession).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchFredUpstreamConfig).not.toHaveBeenCalled();
    expect(createFredUpstreamSession).not.toHaveBeenCalled();
    expect(openFredUpstreamStream).not.toHaveBeenCalled();
    expect(stopFredUpstreamSession).not.toHaveBeenCalled();
    expect(relayFredWebhookEvent).not.toHaveBeenCalled();
  });


  describe("QuickFred conversation binding", () => {
    const quickFredConfig = {
      agentKey: "quickfred" as const,
      channelId: "quickfred-channel",
      publishToken: "em_quickfred_publish_fixture_123456",
      exchangeOrigin: "https://findog.at",
      expectedAgentId: "a1b2c3d4-e5f6-4789-abcd-ef0123456789",
    };

    it("routes a new QuickFred conversation through its dedicated channel and persists the binding", async () => {
      vi.mocked(authenticateSupabaseRequest).mockResolvedValue({
        id: "33333333-3333-4333-8333-333333333333",
      });
      const quickSummary = { ...summaryRow, agent_key: "quickfred" };
      const rpc = vi.fn()
        .mockResolvedValueOnce({ data: quickSummary, error: null })
        .mockResolvedValueOnce({ data: quickSummary, error: null });
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);
      vi.mocked(readQuickFredEmbedServerConfig).mockReturnValue(quickFredConfig);
      vi.mocked(fetchFredUpstreamConfig).mockResolvedValue({
        agentId: quickFredConfig.expectedAgentId,
        knowledgeBaseIds: ["kb-quick"],
        allowWebSearch: false,
        allowFileUpload: true,
      });

      const response = await POST(request({
        query: "Schnelle Antwort",
        quickFredEnabled: true,
      }));
      const events = (await response.text())
        .trim()
        .split("\n")
        .map(parseFredNativeStreamLine)
        .filter(Boolean);

      expect(response.status).toBe(200);
      expect(readQuickFredEmbedServerConfig).toHaveBeenCalledOnce();
      expect(readFredEmbedServerConfig).toHaveBeenCalledOnce();
      expect(mintFredEmbedSession).toHaveBeenCalledWith(expect.objectContaining({
        config: quickFredConfig,
      }));
      expect(openFredUpstreamStream).toHaveBeenCalledWith(expect.objectContaining({
        config: quickFredConfig,
        upstreamConfig: expect.objectContaining({
          agentId: quickFredConfig.expectedAgentId,
        }),
      }));
      expect(rpc).toHaveBeenNthCalledWith(1, "record_fred_native_event", {
        payload: expect.objectContaining({
          agent_key: "quickfred",
          weknora_agent_id: quickFredConfig.expectedAgentId,
        }),
      });
      expect(events).toContainEqual({
        type: "conversation",
        conversation: expect.objectContaining({ agentKey: "quickfred" }),
      });
    });

    it("rejects malformed QuickFred flags and the QuickFred/Pro combination", async () => {
      vi.mocked(authenticateSupabaseRequest).mockResolvedValue({
        id: "44444444-4444-4444-8444-444444444444",
      });
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc: vi.fn() } as never);

      const malformed = await POST(request({ query: "Test", quickFredEnabled: "yes" }));
      expect(malformed.status).toBe(400);
      const combined = await POST(request({
        query: "Test",
        quickFredEnabled: true,
        proModeEnabled: true,
      }));
      expect(combined.status).toBe(400);
      expect(mintFredEmbedSession).not.toHaveBeenCalled();
    });

    it("rejects a browser flag that contradicts an existing fixed agent", async () => {
      vi.mocked(authenticateSupabaseRequest).mockResolvedValue({
        id: "55555555-5555-4555-8555-555555555555",
      });
      const maybeSingle = vi.fn().mockResolvedValue({
        data: {
          id: conversationId,
          title: "Quick",
          created_at: "2026-07-19T09:00:00.000Z",
          updated_at: "2026-07-19T09:00:00.000Z",
          weknora_channel_id: "quickfred-channel",
          weknora_session_id: "quick-session",
          agent_key: "quickfred",
          weknora_agent_id: quickFredConfig.expectedAgentId,
        },
        error: null,
      });
      const chain = { select: vi.fn(), eq: vi.fn(), maybeSingle };
      chain.select.mockReturnValue(chain);
      chain.eq.mockReturnValue(chain);
      vi.mocked(getSupabaseServerClient).mockReturnValue({
        rpc: vi.fn(),
        from: vi.fn(() => chain),
      } as never);

      const response = await POST(request({
        query: "Wechseln",
        conversationId,
        quickFredEnabled: false,
      }));

      expect(response.status).toBe(409);
      expect(openFredUpstreamStream).not.toHaveBeenCalled();
    });

    it("continues an existing QuickFred conversation from its stored binding when the browser flag is omitted", async () => {
      const quickSummary = { ...summaryRow, agent_key: "quickfred" };
      const rpc = vi.fn()
        .mockResolvedValueOnce({ data: quickSummary, error: null })
        .mockResolvedValueOnce({ data: quickSummary, error: null });
      const maybeSingle = vi.fn().mockResolvedValue({
        data: {
          id: conversationId,
          title: "Quick",
          created_at: "2026-07-19T09:00:00.000Z",
          updated_at: "2026-07-19T09:00:00.000Z",
          weknora_channel_id: "quickfred-channel",
          weknora_session_id: "quick-session",
          agent_key: "quickfred",
          weknora_agent_id: quickFredConfig.expectedAgentId,
        },
        error: null,
      });
      const chain = { select: vi.fn(), eq: vi.fn(), maybeSingle };
      chain.select.mockReturnValue(chain);
      chain.eq.mockReturnValue(chain);
      vi.mocked(getSupabaseServerClient).mockReturnValue({
        rpc,
        from: vi.fn(() => chain),
      } as never);
      vi.mocked(readQuickFredEmbedServerConfig).mockReturnValue(quickFredConfig);
      vi.mocked(fetchFredUpstreamConfig).mockResolvedValue({
        agentId: quickFredConfig.expectedAgentId,
        knowledgeBaseIds: ["kb-quick"],
        allowWebSearch: false,
        allowFileUpload: true,
      });
      vi.mocked(deriveFredSessionSignature).mockReturnValue("quick-signature");

      const response = await POST(request({
        query: "Anschlussfrage",
        conversationId,
      }));
      await response.text();

      expect(response.status).toBe(200);
      expect(readQuickFredEmbedServerConfig).toHaveBeenCalledOnce();
      expect(deriveFredSessionSignature).toHaveBeenCalledWith(
        expect.objectContaining({ channelId: "quickfred-channel" }),
        "quick-session",
      );
      expect(openFredUpstreamStream).toHaveBeenCalledWith(expect.objectContaining({
        config: quickFredConfig,
        upstreamSession: { id: "quick-session", signature: "quick-signature" },
      }));
    });

    it("fails closed on a QuickFred agent rebinding without persisting or falling back to Fred", async () => {
      const rpc = vi.fn();
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);
      vi.mocked(readQuickFredEmbedServerConfig).mockReturnValue(quickFredConfig);
      vi.mocked(fetchFredUpstreamConfig).mockResolvedValue({
        agentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        knowledgeBaseIds: ["kb-wrong"],
        allowWebSearch: false,
        allowFileUpload: true,
      });

      const response = await POST(request({
        query: "Schnelle Antwort",
        quickFredEnabled: true,
      }));
      const events = (await response.text())
        .trim()
        .split("\n")
        .map(parseFredNativeStreamLine)
        .filter(Boolean);

      expect(response.status).toBe(200);
      expect(events).toContainEqual({
        type: "error",
        error: "Der QuickFred-Kanal ist nicht an den erwarteten Agenten gebunden.",
      });
      expect(rpc).not.toHaveBeenCalled();
      expect(openFredUpstreamStream).not.toHaveBeenCalled();
      expect(mintFredEmbedSession).toHaveBeenCalledWith(expect.objectContaining({
        config: quickFredConfig,
      }));
    });

    it("keeps the QuickFred binding after the first user turn when the answer request fails", async () => {
      const quickSummary = { ...summaryRow, agent_key: "quickfred" };
      const rpc = vi.fn().mockResolvedValueOnce({ data: quickSummary, error: null });
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);
      vi.mocked(readQuickFredEmbedServerConfig).mockReturnValue(quickFredConfig);
      vi.mocked(fetchFredUpstreamConfig).mockResolvedValue({
        agentId: quickFredConfig.expectedAgentId,
        knowledgeBaseIds: ["kb-quick"],
        allowWebSearch: false,
        allowFileUpload: true,
      });
      vi.mocked(openFredUpstreamStream).mockRejectedValue(new Error("provider unavailable"));

      const response = await POST(request({
        query: "Schnelle Antwort",
        quickFredEnabled: true,
      }));
      const events = (await response.text())
        .trim()
        .split("\n")
        .map(parseFredNativeStreamLine)
        .filter(Boolean);

      expect(events[0]).toEqual({
        type: "conversation",
        conversation: expect.objectContaining({ agentKey: "quickfred" }),
      });
      expect(events.at(-1)).toEqual({
        type: "error",
        error: "QuickFred konnte die Anfrage nicht abschließen.",
      });
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc).toHaveBeenCalledWith("record_fred_native_event", {
        payload: expect.objectContaining({
          event_type: "message_sent",
          agent_key: "quickfred",
          weknora_agent_id: quickFredConfig.expectedAgentId,
        }),
      });
    });
  });

  describe("Pro Mode", () => {
    it("treats omitted proModeEnabled as false and sends empty summaryModelId", async () => {
      const rpc = rpcForTurn();
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);

      const response = await POST(request({ query: "Normal" }));
      await response.text();

      expect(openFredUpstreamStream).toHaveBeenCalledWith(expect.objectContaining({
        summaryModelId: "",
      }));
      expect(readFredProModelId).not.toHaveBeenCalled();
    });

    it("treats explicit proModeEnabled false as false and sends empty summaryModelId", async () => {
      const rpc = rpcForTurn();
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);

      const response = await POST(request({ query: "Normal", proModeEnabled: false }));
      await response.text();

      expect(openFredUpstreamStream).toHaveBeenCalledWith(expect.objectContaining({
        summaryModelId: "",
      }));
      expect(readFredProModelId).not.toHaveBeenCalled();
    });

    it("resolves proModeEnabled true via readFredProModelId and sends the model ID upstream", async () => {
      const rpc = rpcForTurn();
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);

      const response = await POST(request({ query: "Pro Frage", proModeEnabled: true }));
      await response.text();

      expect(readFredProModelId).toHaveBeenCalledOnce();
      expect(openFredUpstreamStream).toHaveBeenCalledWith(expect.objectContaining({
        summaryModelId: "a1b2c3d4-e5f6-4789-abcd-ef0123456789",
      }));
    });

    it("rejects non-boolean proModeEnabled with 400", async () => {
      const rpc = vi.fn();
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);

      const response = await POST(request({ query: "Test", proModeEnabled: "yes" }));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: expect.any(String) });
      expect(openFredUpstreamStream).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    });

    it("rejects numeric proModeEnabled with 400", async () => {
      const rpc = vi.fn();
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);

      const response = await POST(request({ query: "Test", proModeEnabled: 1 }));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: expect.any(String) });
      expect(openFredUpstreamStream).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    });

    it("ignores client-provided modelId or summaryModelId", async () => {
      const rpc = rpcForTurn();
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);

      const response = await POST(request({
        query: "Hack",
        modelId: "client-model",
        summaryModelId: "client-model",
      }));
      await response.text();

      expect(openFredUpstreamStream).toHaveBeenCalledWith(expect.objectContaining({
        summaryModelId: "",
      }));
    });

    it("allows webSearchEnabled and proModeEnabled simultaneously", async () => {
      const rpc = rpcForTurn();
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);
      vi.mocked(fetchFredUpstreamConfig).mockResolvedValue({
        agentId: "agent-1",
        knowledgeBaseIds: ["kb-1"],
        allowWebSearch: true,
        allowFileUpload: true,
      });

      const response = await POST(request({ query: "Pro Web", proModeEnabled: true, webSearchEnabled: true }));
      await response.text();

      expect(readFredProModelId).toHaveBeenCalledOnce();
      expect(openFredUpstreamStream).toHaveBeenCalledWith(expect.objectContaining({
        summaryModelId: "a1b2c3d4-e5f6-4789-abcd-ef0123456789",
        webSearchEnabled: true,
      }));
    });

    it("records pro_mode_enabled on the user event but not on the assistant event", async () => {
      const rpc = vi.fn()
        .mockResolvedValueOnce({ data: summaryRow, error: null })
        .mockResolvedValueOnce({
          data: { ...summaryRow, updated_at: "2026-07-19T10:00:02.000Z" },
          error: null,
        });
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);

      const response = await POST(request({ query: "Pro Frage", proModeEnabled: true }));
      await response.text();

      expect(rpc).toHaveBeenNthCalledWith(1, "record_fred_native_event", {
        payload: expect.objectContaining({
          pro_mode_enabled: true,
          event_type: "message_sent",
        }),
      });
      expect(rpc).toHaveBeenNthCalledWith(2, "record_fred_native_event", {
        payload: expect.objectContaining({
          pro_mode_enabled: false,
          event_type: "message_received",
        }),
      });
    });
  });

  describe("admin request audit persistence", () => {
    beforeEach(() => {
      vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: auditUserId });
    });

    it("calls recordAdminRequest exactly once with the authenticated user, returned conversationId, and original user query", async () => {
      const rpc = rpcForTurn();
      const supabase = { rpc };
      vi.mocked(getSupabaseServerClient).mockReturnValue(supabase as never);

      const response = await POST(request({ query: "Meine Anfrage" }));
      await response.text();

      expect(mockRecordAdminRequest).toHaveBeenCalledTimes(1);
      expect(mockRecordAdminRequest).toHaveBeenCalledWith({
        supabase,
        userId: auditUserId,
        conversationId,
        content: "Meine Anfrage",
      });
    });

    it("persists the durable user event before the audit call and the audit call before the upstream stream", async () => {
      const rpc = rpcForTurn();
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);

      const response = await POST(request({ query: "Reihenfolge" }));
      await response.text();

      // record_fred_native_event (message_sent) < recordAdminRequest < openFredUpstreamStream
      const rpcOrder = rpc.mock.invocationCallOrder[0];
      const adminOrder = vi.mocked(mockRecordAdminRequest).mock.invocationCallOrder[0];
      const upstreamOrder = vi.mocked(openFredUpstreamStream).mock.invocationCallOrder[0];

      expect(rpcOrder).toBeLessThan(adminOrder);
      expect(adminOrder).toBeLessThan(upstreamOrder);
    });

    it("emits only the error and skips upstream calls when recordAdminRequest rejects with UserVisibleError", async () => {
      const rpc = vi.fn().mockResolvedValueOnce({ data: summaryRow, error: null });
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);
      vi.mocked(mockRecordAdminRequest).mockRejectedValueOnce(
        new UserVisibleError("Die Anfrage konnte nicht sicher protokolliert werden. Bitte erneut versuchen.", 503),
      );

      const response = await POST(request({ query: "Sensible Anfrage" }));
      const events = (await response.text())
        .split("\n")
        .map(parseFredNativeStreamLine)
        .filter(Boolean);

      expect(events).toEqual([
        {
          type: "error",
          error: "Die Anfrage konnte nicht sicher protokolliert werden. Bitte erneut versuchen.",
        },
      ]);
      // Durable user event was persisted
      expect(rpc).toHaveBeenCalledWith("record_fred_native_event", {
        payload: expect.objectContaining({
          event_type: "message_sent",
          content: "Sensible Anfrage",
        }),
      });
      // But no upstream calls, no conversation event, no webhook
      expect(openFredUpstreamStream).not.toHaveBeenCalled();
      expect(relayFredWebhookEvent).not.toHaveBeenCalled();
      // Only the user-side RPC call ran
      expect(rpc).toHaveBeenCalledTimes(1);
    });
  });
});
