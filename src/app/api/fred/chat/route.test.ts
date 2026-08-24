import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { buildAttachmentContext } from "@/lib/attachments/context";
import { extractDocumentsWithConfiguredModel } from "@/lib/attachments/document-fallback";
import { createConfiguredDocumentProvider } from "@/lib/attachments/document-pipeline";
import {
  mintFredEmbedSession,
  readFredEmbedServerConfig,
  readFredProModelId,
  readQuickFredEmbedServerConfig,
} from "@/lib/weknora/fred-embed";
import {
  assertFredNativeAttachmentTotalSize,
  createFredUpstreamSession,
  deriveFredSessionSignature,
  fetchFredRecentEmbedImages,
  fetchFredUpstreamConfig,
  openFredUpstreamStream,
  relayFredWebhookEvent,
  stopFredUpstreamSession,
} from "@/lib/weknora/fred-native";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getScanningSettings } from "@/lib/scanning/settings";
import { parseFredNativeStreamLine } from "@/lib/fred-native-stream";
import {
  extractStreamStableBfgGzCandidates,
  verifyBfgCitations,
} from "@/lib/findok/bfg-citations";

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
vi.mock("@/lib/attachments/document-pipeline", () => ({
  createConfiguredDocumentProvider: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/scanning/settings", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/scanning/settings")>();
  return { ...original, getScanningSettings: vi.fn() };
});
vi.mock("@/lib/findok/bfg-citations", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/findok/bfg-citations")>();
  return {
    ...original,
    extractStreamStableBfgGzCandidates: vi.fn(),
    verifyBfgCitations: vi.fn(),
  };
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
    assertFredNativeAttachmentTotalSize: vi.fn(),
    createFredUpstreamSession: vi.fn(),
    deriveFredSessionSignature: vi.fn(),
    fetchFredRecentEmbedImages: vi.fn(async () => []),
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
  message_id: 1,
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
  proModeEnabled?: boolean;
  image?: File;
  attachment?: File;
  signal?: AbortSignal;
  browserAttachmentMode?: string;
}): Request {
  const formData = new FormData();
  formData.append("payload", JSON.stringify({
    query: options.query,
    webSearchEnabled: options.webSearchEnabled ?? false,
    ...(options.proModeEnabled !== undefined ? { proModeEnabled: options.proModeEnabled } : {}),
    ...(options.browserAttachmentMode !== undefined
      ? { fredAttachmentMode: options.browserAttachmentMode }
      : {}),
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
    signal: options.signal,
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

function pngFile(name = "Bild.png"): File {
  return new File([new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
  ])], name, { type: "image/png" });
}

function responseFromReader(reader: {
  read: () => Promise<ReadableStreamReadResult<Uint8Array>>;
  cancel: (reason?: unknown) => Promise<void>;
}): Response {
  return { body: { getReader: () => reader } } as unknown as Response;
}

function rejectReadOnAbort(signal: AbortSignal): Promise<ReadableStreamReadResult<Uint8Array>> {
  const pendingRead = new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
    const rejectForAbort = () => reject(signal.reason);
    if (signal.aborted) rejectForAbort();
    else signal.addEventListener("abort", rejectForAbort, { once: true });
  });
  void pendingRead.catch(() => undefined);
  return pendingRead;
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
      data: { ...summaryRow, updated_at: "2026-07-19T10:00:02.000Z", message_id: 2 },
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
      allowImageUpload: true,
    });
    vi.mocked(createFredUpstreamSession).mockResolvedValue({
      id: "session-1",
      signature: "session-signature",
    });
    vi.mocked(openFredUpstreamStream).mockImplementation(async () => upstreamStream());
    vi.mocked(extractStreamStableBfgGzCandidates).mockImplementation((text, streamComplete) => {
      if (!streamComplete) return [];
      return [...text.matchAll(/RV\/\d{7}\/\d{4}/gu)].map(([gz]) => gz);
    });
    vi.mocked(buildAttachmentContext).mockImplementation(async (question) => `${question}\n\nEXTRACTED`);
    vi.mocked(getScanningSettings).mockResolvedValue({
      documentPipeline: "mineru_with_openrouter_fallback",
      fredAttachmentMode: "findog_preprocess",
      modelId: "google/gemini-3.5-flash",
      prompt: "Configured scanning prompt",
      updatedAt: "2026-07-19T10:00:00.000Z",
      updatedBy: userId,
    });
    vi.mocked(extractDocumentsWithConfiguredModel).mockResolvedValue(["FALLBACK"]);
    vi.mocked(createConfiguredDocumentProvider).mockImplementation(({ getSettings, openrouterProvider }) => (
      async (files, options) => {
        const settings = await getSettings();
        return openrouterProvider(files, { ...(options ?? {}), model: settings.modelId });
      }
    ));
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
        assistantMessageId: 2,
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

  it("streams German research steps and persists structured source provenance", async () => {
    const rpc = rpcForTurn();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);
    vi.mocked(openFredUpstreamStream).mockResolvedValue(new Response([
      'data: {"response_type":"thinking","data":{"event_id":"think-1","done":false},"content":"hidden reasoning"}\n\n',
      'data: {"response_type":"tool_call","data":{"tool_call_id":"call-1","tool_name":"knowledge_search","arguments":{"query":"hidden"}}}\n\n',
      'data: {"response_type":"tool_result","data":{"tool_call_id":"call-1","tool_name":"knowledge_search","success":true,"duration_ms":120}}\n\n',
      'data: {"response_type":"references","data":{"event_id":"sources-1","references":[{"document_name":"EStG.md","chunk_id":"chunk-1","kb_id":"kb-1"}]}}\n\n',
      'data: {"response_type":"answer","content":"Nachweis ","done":false}\n\n',
      'data: {"response_type":"answer","content":"erbracht.","done":true}\n\n',
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
      { type: "delta", content: "erbracht." },
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "final",
      answer: "Nachweis erbracht.",
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
        content: "Nachweis erbracht.",
        display_content: "Nachweis erbracht.",
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

  it("forwards many small deltas and resolves BFG citations only during final processing", async () => {
    const rpc = rpcForTurn();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);
    vi.mocked(verifyBfgCitations).mockImplementation(async (gzs, _fetch, options) => {
      const verified = gzs.filter((gz) => gz === "RV/1100290/2023").map((gz) => ({
          status: "verified" as const,
          gz,
          title: "Kosten eines Fußballtrainers",
          documentTitle: `BFG 03.10.2024, ${gz}`,
          dokumentId: "doc-1",
          segmentId: "segment-1",
          indexName: "findok-bfg" as const,
          fullTextUrl: "https://findok.bmf.gv.at/findok/volltext?gz=RV%2F1100290%2F2023",
          pdfUrl: "https://findok.bmf.gv.at/findok/resources/pdf/segment/entscheidung.pdf",
        }));
      const rejected = gzs.filter((gz) => gz !== "RV/1100290/2023").map((gz) => ({
        status: "not_found" as const,
        gz,
        reason: "Nicht gefunden.",
      }));
      options?.onMetrics?.({
        candidateCount: gzs.length,
        verifiedCount: verified.length,
        cacheHits: 0,
        cacheMisses: gzs.length,
        coalesced: 0,
        durationMs: 1,
        timeoutCount: 0,
        errorCount: 0,
      });
      return { verified, rejected };
    });
    const rawAnswer = "Siehe RV/1100290/2023 und RV/9999999/2023.";
    vi.mocked(openFredUpstreamStream).mockResolvedValue(new Response([
      ...[...rawAnswer].map((content, index) => (
        `data: ${JSON.stringify({
          response_type: "answer",
          content,
          done: index === rawAnswer.length - 1,
        })}\n\n`
      )),
      'data: {"response_type":"complete","data":{}}\n\n',
    ].join(""), { headers: { "Content-Type": "text/event-stream" } }));

    const response = await POST(request({ query: "Welche Entscheidungen gibt es?" }));
    const events = (await response.text())
      .split("\n")
      .map(parseFredNativeStreamLine)
      .filter(Boolean);

    expect(events.filter((event) => event?.type === "delta")
      .map((event) => event?.type === "delta" ? event.content : "")
      .join("")).toBe(rawAnswer);
    expect(events.some((event) => event?.type === "replace")).toBe(false);
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
    expect(extractStreamStableBfgGzCandidates).toHaveBeenCalledTimes(1);
    expect(extractStreamStableBfgGzCandidates).toHaveBeenCalledWith(rawAnswer, true);
    expect(verifyBfgCitations).toHaveBeenCalledTimes(1);
    expect(verifyBfgCitations).toHaveBeenCalledWith(
      ["RV/1100290/2023", "RV/9999999/2023"],
      fetch,
      expect.objectContaining({ signal: expect.any(AbortSignal), onMetrics: expect.any(Function) }),
    );
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

  it("emits the route timeout error at exactly 720 seconds and cleans up upstream", async () => {
    vi.useFakeTimers();
    try {
      const rpc = rpcForTurn();
      vi.mocked(authenticateSupabaseRequest).mockResolvedValue({
        id: "44444444-4444-4444-8444-444444444444",
      });
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);
      let upstreamSignal!: AbortSignal;
      const cancel = vi.fn().mockResolvedValue(undefined);
      vi.mocked(openFredUpstreamStream).mockImplementation(async (options) => {
        upstreamSignal = options.signal;
        const read = vi.fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode(
              'data: {"response_type":"agent_query","assistant_message_id":"answer-timeout"}\n\n',
            ),
          })
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode(
              'data: {"response_type":"answer","content":"Anfang","done":false}\n\n',
            ),
          })
          .mockImplementationOnce(() => rejectReadOnAbort(upstreamSignal));
        return responseFromReader({ read, cancel });
      });

      const response = await POST(multipartRequest({ query: "Timeout", attachment: pdfFile() }));
      const reader = response.body!.getReader();
      const events: Array<Awaited<ReturnType<typeof nextEvent>>> = [];
      while (!events.some((event) => event?.type === "delta")) {
        events.push(await nextEvent(reader));
      }

      await vi.advanceTimersByTimeAsync(719_999);
      expect(upstreamSignal.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(upstreamSignal.aborted).toBe(true);
      while (true) {
        const event = await nextEvent(reader);
        if (!event) break;
        events.push(event);
      }

      expect(events.filter((event) => event?.type === "error")).toEqual([{
        type: "error",
        error: "Die Verarbeitung der Anfrage hat zu lange gedauert.",
      }]);
      expect(events.some((event) => event?.type === "final")).toBe(false);
      expect(stopFredUpstreamSession).toHaveBeenCalledOnce();
      expect(stopFredUpstreamSession).toHaveBeenCalledWith(expect.objectContaining({
        messageId: "answer-timeout",
      }));
      expect(cancel).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("keeps request cancellation silent while cleaning up upstream", async () => {
    const rpc = rpcForTurn();
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({
      id: "55555555-5555-4555-8555-555555555555",
    });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);
    const requestAbort = new AbortController();
    let upstreamSignal!: AbortSignal;
    const cancel = vi.fn().mockResolvedValue(undefined);
    vi.mocked(openFredUpstreamStream).mockImplementation(async (options) => {
      upstreamSignal = options.signal;
      const read = vi.fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(
            'data: {"response_type":"agent_query","assistant_message_id":"answer-request-cancel"}\n\n',
          ),
        })
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(
            'data: {"response_type":"answer","content":"Anfang","done":false}\n\n',
          ),
        })
        .mockImplementationOnce(() => rejectReadOnAbort(upstreamSignal));
      return responseFromReader({ read, cancel });
    });

    const response = await POST(multipartRequest({
      query: "Abbruch",
      attachment: pdfFile(),
      signal: requestAbort.signal,
    }));
    const reader = response.body!.getReader();
    const events: Array<Awaited<ReturnType<typeof nextEvent>>> = [];
    while (!events.some((event) => event?.type === "delta")) {
      events.push(await nextEvent(reader));
    }

    requestAbort.abort("browser-request-cancel");
    while (true) {
      const event = await nextEvent(reader);
      if (!event) break;
      events.push(event);
    }

    expect(events.some((event) => event?.type === "error")).toBe(false);
    expect(events.some((event) => event?.type === "final")).toBe(false);
    expect(stopFredUpstreamSession).toHaveBeenCalledOnce();
    expect(stopFredUpstreamSession).toHaveBeenCalledWith(expect.objectContaining({
      messageId: "answer-request-cancel",
    }));
    expect(cancel).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith("browser-request-cancel");
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
    const events = (await response.text())
      .trim()
      .split("\n")
      .map(parseFredNativeStreamLine)
      .filter(Boolean);

    expect(events).not.toContainEqual({
      type: "status",
      label: "Dokumente werden analysiert …",
    });
    expect(events).not.toContainEqual({ type: "status_clear" });
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

    expect(events.filter((event) => event?.type === "status" && event.label === "Dokumente werden analysiert …"))
      .toHaveLength(2);
    expect(events).not.toContainEqual({
      type: "status",
      label: "Anhänge werden an WeKnora übergeben …",
    });
    expect(events).toContainEqual({ type: "status_clear" });
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
      allowImageUpload: true,
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
    expect(vi.mocked(openFredUpstreamStream).mock.calls[0][0]).not.toHaveProperty("nativeAttachments");
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

  it("sends validated attachments natively and skips every Findog preprocessing provider", async () => {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({
      id: "44444444-4444-4444-8444-444444444444",
    });
    const rpc = rpcForTurn();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);
    vi.mocked(getScanningSettings).mockResolvedValue({
      documentPipeline: "mineru_with_openrouter_fallback",
      fredAttachmentMode: "weknora_native",
      modelId: "model/x",
      prompt: "Scanning-specific prompt must not be used",
      updatedAt: "2026-07-19T10:00:00.000Z",
      updatedBy: userId,
    });
    const image = pngFile();
    const pdf = pdfFile();
    vi.mocked(openFredUpstreamStream).mockImplementationOnce(async () => new Response([
      'data: {"response_type":"thinking","data":{"done":false}}\n\n',
      'data: {"response_type":"answer","content":"Analysiert"}\n\n',
      'data: {"response_type":"complete","data":{}}\n\n',
    ].join(""), { status: 200, headers: { "Content-Type": "text/event-stream" } }));

    const response = await POST(multipartRequest({
      query: "Bitte prüfe Bild und Beleg",
      image,
      attachment: pdf,
    }));
    const events = (await response.text())
      .trim()
      .split("\n")
      .map(parseFredNativeStreamLine)
      .filter(Boolean);

    expect(response.status).toBe(200);
    expect(events[0]).toEqual({
      type: "status",
      label: "Dokumente werden analysiert …",
    });
    expect(events).not.toContainEqual({
      type: "status",
      label: "Anhänge werden an WeKnora übergeben …",
    });
    const statusIndexes = events
      .map((event, index) => event?.type === "status" ? index : -1)
      .filter((index) => index >= 0);
    const clearIndex = events.findIndex((event) => event?.type === "status_clear");
    const researchIndex = events.findIndex((event) => event?.type === "research");
    const deltaIndex = events.findIndex((event) => event?.type === "delta");
    expect(clearIndex).toBeGreaterThan(statusIndexes.at(-1) ?? -1);
    expect(clearIndex).toBeLessThan(researchIndex);
    expect(clearIndex).toBeLessThan(deltaIndex);
    expect(buildAttachmentContext).not.toHaveBeenCalled();
    expect(createConfiguredDocumentProvider).not.toHaveBeenCalled();
    expect(extractDocumentsWithConfiguredModel).not.toHaveBeenCalled();
    expect(openFredUpstreamStream).toHaveBeenCalledWith(expect.objectContaining({
      query: "Bitte prüfe Bild und Beleg",
      nativeAttachments: [
        expect.objectContaining({ kind: "image", mimeType: "image/png", bytes: expect.any(Uint8Array) }),
        expect.objectContaining({ kind: "file", name: "Beleg.pdf", sizeBytes: pdf.size }),
      ],
    }));
    expect(rpc).toHaveBeenNthCalledWith(1, "record_fred_native_event", {
      payload: expect.objectContaining({
        attachments: [
          expect.objectContaining({ kind: "image", name: "Bild.png", mime_type: "image/png" }),
          expect.objectContaining({ kind: "file", name: "Beleg.pdf", mime_type: "application/pdf" }),
        ],
      }),
    });
  });

  it("rejects a native aggregate attachment overflow with 413 before runs, persistence, providers, and WeKnora", async () => {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({
      id: "12121212-1212-4121-8121-121212121212",
    });
    const rpc = vi.fn();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);
    vi.mocked(getScanningSettings).mockResolvedValue({
      documentPipeline: "mineru_with_openrouter_fallback",
      fredAttachmentMode: "weknora_native",
      modelId: "model/x",
      prompt: "prompt",
      updatedAt: "2026-07-19T10:00:00.000Z",
      updatedBy: userId,
    });
    vi.mocked(assertFredNativeAttachmentTotalSize).mockImplementation(() => {
      throw new UserVisibleError(
        "Die Fred-Anhänge sind zusammen zu groß. Bitte reduziere die Gesamtgröße.",
        413,
      );
    });

    const response = await POST(multipartRequest({
      query: "Bitte prüfe den Beleg",
      attachment: pdfFile(),
    }));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "Die Fred-Anhänge sind zusammen zu groß. Bitte reduziere die Gesamtgröße.",
    });
    expect(assertFredNativeAttachmentTotalSize).toHaveBeenCalledTimes(1);
    expect(vi.mocked(assertFredNativeAttachmentTotalSize).mock.calls[0][0])
      .toEqual([expect.objectContaining({ kind: "file", bytes: expect.any(Uint8Array) })]);
    expect(readFredEmbedServerConfig).not.toHaveBeenCalled();
    expect(buildAttachmentContext).not.toHaveBeenCalled();
    expect(createConfiguredDocumentProvider).not.toHaveBeenCalled();
    expect(mintFredEmbedSession).not.toHaveBeenCalled();
    expect(fetchFredUpstreamConfig).not.toHaveBeenCalled();
    expect(createFredUpstreamSession).not.toHaveBeenCalled();
    expect(openFredUpstreamStream).not.toHaveBeenCalled();
    expect(relayFredWebhookEvent).not.toHaveBeenCalled();
    expect(stopFredUpstreamSession).not.toHaveBeenCalled();
    expect(mockRecordAdminRequest).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("leaves the larger Findog preprocessing aggregate behavior in default mode unchanged", async () => {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({
      id: "99999999-9999-4999-8999-999999999999",
    });
    const rpc = rpcForTurn();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);
    vi.mocked(assertFredNativeAttachmentTotalSize).mockImplementation(() => {
      throw new UserVisibleError(
        "Die Fred-Anhänge sind zusammen zu groß. Bitte reduziere die Gesamtgröße.",
        413,
      );
    });

    const response = await POST(multipartRequest({
      query: "Bitte prüfe den Beleg",
      attachment: pdfFile(),
    }));
    await response.text();

    expect(response.status).toBe(200);
    expect(assertFredNativeAttachmentTotalSize).not.toHaveBeenCalled();
    expect(buildAttachmentContext).toHaveBeenCalledOnce();
    expect(vi.mocked(openFredUpstreamStream).mock.calls[0][0])
      .not.toHaveProperty("nativeAttachments");
  });

  it("accepts native document uploads when only agent image upload is disabled", async () => {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({
      id: "77777777-7777-4777-8777-777777777777",
    });
    const rpc = rpcForTurn();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);
    vi.mocked(getScanningSettings).mockResolvedValue({
      documentPipeline: "mineru_with_openrouter_fallback",
      fredAttachmentMode: "weknora_native",
      modelId: "model/x",
      prompt: "prompt",
      updatedAt: "2026-07-19T10:00:00.000Z",
      updatedBy: userId,
    });
    vi.mocked(fetchFredUpstreamConfig).mockResolvedValue({
      agentId: "agent-1",
      knowledgeBaseIds: ["kb-1"],
      allowWebSearch: true,
      allowFileUpload: true,
      allowImageUpload: false,
    });

    const response = await POST(multipartRequest({
      query: "Bitte prüfe nur den Beleg",
      attachment: pdfFile(),
    }));
    await response.text();

    expect(response.status).toBe(200);
    expect(buildAttachmentContext).not.toHaveBeenCalled();
    expect(openFredUpstreamStream).toHaveBeenCalledWith(expect.objectContaining({
      nativeAttachments: [expect.objectContaining({ kind: "file" })],
    }));
  });

  it("rejects native image uploads before opening the stream when agent image upload is disabled", async () => {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({
      id: "88888888-8888-4888-8888-888888888888",
    });
    const rpc = vi.fn();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);
    vi.mocked(getScanningSettings).mockResolvedValue({
      documentPipeline: "mineru_with_openrouter_fallback",
      fredAttachmentMode: "weknora_native",
      modelId: "model/x",
      prompt: "prompt",
      updatedAt: "2026-07-19T10:00:00.000Z",
      updatedBy: userId,
    });
    vi.mocked(fetchFredUpstreamConfig).mockResolvedValue({
      agentId: "agent-1",
      knowledgeBaseIds: ["kb-1"],
      allowWebSearch: true,
      allowFileUpload: true,
      allowImageUpload: false,
    });

    const response = await POST(multipartRequest({
      query: "Bitte prüfe das Bild",
      image: pngFile(),
    }));
    const events = (await response.text())
      .split("\n")
      .map(parseFredNativeStreamLine)
      .filter(Boolean);

    expect(events.at(-1)).toEqual({
      type: "error",
      error: "Bild-Upload ist für Fred derzeit nicht freigeschaltet.",
    });
    expect(openFredUpstreamStream).not.toHaveBeenCalled();
    expect(relayFredWebhookEvent).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("ignores a browser-provided attachment mode and uses the persisted server mode", async () => {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({
      id: "66666666-6666-4666-8666-666666666666",
    });
    const rpc = rpcForTurn();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);
    vi.mocked(getScanningSettings).mockResolvedValue({
      documentPipeline: "mineru_with_openrouter_fallback",
      fredAttachmentMode: "weknora_native",
      modelId: "model/x",
      prompt: "prompt",
      updatedAt: "2026-07-19T10:00:00.000Z",
      updatedBy: userId,
    });

    const response = await POST(multipartRequest({
      query: "Browser darf nicht entscheiden",
      attachment: pdfFile(),
      browserAttachmentMode: "findog_preprocess",
    }));
    await response.text();

    expect(buildAttachmentContext).not.toHaveBeenCalled();
    expect(openFredUpstreamStream).toHaveBeenCalledWith(expect.objectContaining({
      nativeAttachments: [expect.objectContaining({ kind: "file" })],
    }));
  });

  it("rejects a native attachment turn after live config disallows upload and before opening the stream", async () => {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({
      id: "55555555-5555-4555-8555-555555555555",
    });
    const rpc = vi.fn();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);
    vi.mocked(getScanningSettings).mockResolvedValue({
      documentPipeline: "mineru_with_openrouter_fallback",
      fredAttachmentMode: "weknora_native",
      modelId: "model/x",
      prompt: "prompt",
      updatedAt: "2026-07-19T10:00:00.000Z",
      updatedBy: userId,
    });
    vi.mocked(fetchFredUpstreamConfig).mockResolvedValue({
      agentId: "agent-1",
      knowledgeBaseIds: ["kb-1"],
      allowWebSearch: true,
      allowFileUpload: false,
      allowImageUpload: false,
    });

    const response = await POST(multipartRequest({
      query: "Bitte prüfe den Beleg",
      attachment: pdfFile(),
    }));
    const events = (await response.text())
      .split("\n")
      .map(parseFredNativeStreamLine)
      .filter(Boolean);

    expect(events.at(-1)).toEqual({
      type: "error",
      error: "Datei-Upload ist für Fred derzeit nicht freigeschaltet.",
    });
    expect(fetchFredUpstreamConfig).toHaveBeenCalledTimes(1);
    expect(openFredUpstreamStream).not.toHaveBeenCalled();
    expect(relayFredWebhookEvent).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("wires document preprocessing through the shared configured provider", async () => {
    const rpc = rpcForTurn();
    const supabase = { rpc };
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase as never);
    vi.mocked(getScanningSettings).mockResolvedValue({
      documentPipeline: "openrouter_only",
      fredAttachmentMode: "findog_preprocess",
      modelId: "google/gemini-3.5-flash:online",
      prompt: "Scanning-specific prompt must not be used for Fred extraction",
      updatedAt: "2026-07-19T10:00:00.000Z",
      updatedBy: userId,
    });
    vi.mocked(buildAttachmentContext).mockImplementationOnce(async (question, attachments, options) => {
      if (!options?.documentProvider) throw new Error("shared document provider missing");
      const documents = await options.documentProvider(attachments as never, {});
      return `${question}\n\n${documents.join("\n")}`;
    });

    const response = await POST(multipartRequest({
      query: "Bitte Dokument prüfen",
      attachment: pdfFile("Fallback.pdf"),
    }));
    await response.text();

    const dependencies = vi.mocked(createConfiguredDocumentProvider).mock.calls[0][0];
    expect(typeof dependencies.getSettings).toBe("function");
    expect(typeof dependencies.mineruProvider).toBe("function");
    expect(typeof dependencies.openrouterProvider).toBe("function");
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
        allowImageUpload: true,
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
        allowImageUpload: true,
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
        allowImageUpload: true,
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
        allowImageUpload: true,
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
        allowImageUpload: true,
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
          data: { ...summaryRow, updated_at: "2026-07-19T10:00:02.000Z", message_id: 2 },
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

  describe("message_id backward compatibility", () => {
    it("accepts a legacy RPC response without message_id and emits a successful final event without assistantMessageId", async () => {
      const legacySummaryRow = {
        conversation_id: conversationId,
        title: "Wie ist die Rechtslage?",
        created_at: "2026-07-19T10:00:00.000Z",
        updated_at: "2026-07-19T10:00:01.000Z",
        agent_key: "fred",
      };
      const rpc = vi.fn()
        .mockResolvedValueOnce({ data: legacySummaryRow, error: null })
        .mockResolvedValueOnce({
          data: { ...legacySummaryRow, updated_at: "2026-07-19T10:00:02.000Z" },
          error: null,
        });
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);

      const response = await POST(request({ query: "Wie ist die Rechtslage?" }));
      const events = (await response.text())
        .split("\n")
        .map(parseFredNativeStreamLine)
        .filter(Boolean);

      expect(response.status).toBe(200);
      const finalEvent = events.find((e) => e?.type === "final");
      expect(finalEvent).toBeTruthy();
      expect(finalEvent?.type).toBe("final");
      if (finalEvent?.type === "final") {
        expect(finalEvent.assistantMessageId).toBeUndefined();
        expect(finalEvent.answer).toBe("Hallo Welt");
      }
      expect(rpc).toHaveBeenCalledTimes(2);
    });

    it("fails safely when a present message_id is malformed", async () => {
      const malformedRow = { ...summaryRow, message_id: -1 };
      const rpc = vi.fn()
        .mockResolvedValueOnce({ data: summaryRow, error: null })
        .mockResolvedValueOnce({
          data: { ...malformedRow, updated_at: "2026-07-19T10:00:02.000Z" },
          error: null,
        });
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);

      const response = await POST(request({ query: "Wie ist die Rechtslage?" }));
      const events = (await response.text())
        .split("\n")
        .map(parseFredNativeStreamLine)
        .filter(Boolean);

      expect(events).toContainEqual({
        type: "error",
        error: "Ungültige Fred-Nachrichten-ID.",
      });
      // The user message was still persisted
      expect(rpc).toHaveBeenCalledTimes(2);
    });
  });

  });
  describe("Fred user personalization", () => {
    const PERS_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    beforeEach(() => {
      vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: PERS_USER_ID });
    });

    const prefRow = { preferred_name: "Alina", personality: "friendly" };

    function supabaseWithPreferences(row: { preferred_name: string | null; personality: string } | null) {
      const rpc = rpcForTurn();

      // Preferences query: .select().eq().maybeSingle()
      const prefMaybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
      const prefChain = { select: vi.fn(), eq: vi.fn(), maybeSingle: prefMaybeSingle };
      prefChain.select.mockReturnValue(prefChain);
      prefChain.eq.mockReturnValue(prefChain);

      // Profile query: .select().eq().maybeSingle()
      const profilePromptText = row?.personality === "friendly"
        ? "Antworte herzlich, zugewandt und gesprächig. Verwende häufiger passende Emojis, ohne fachliche Präzision, Professionalität oder Verständlichkeit zu beeinträchtigen."
        : row?.personality === "efficient"
        ? "Antworte prägnant, direkt und klar. Konzentriere dich auf die wesentlichen Informationen und vermeide unnötige Einleitungen, Wiederholungen und Ausschmückungen."
        : row?.personality === "cynical"
        ? "Antworte kritisch, trocken und sarkastisch. Der Sarkasmus darf pointiert sein, aber nicht beleidigend, abwertend oder respektlos gegenüber dem Benutzer oder Dritten. Fachliche Präzision und Verlässlichkeit bleiben vollständig erhalten."
        : "";
      const profileMaybeSingle = vi.fn().mockResolvedValue({ data: { prompt_text: profilePromptText }, error: null });
      const profileChain = { select: vi.fn(), eq: vi.fn(), maybeSingle: profileMaybeSingle };
      profileChain.select.mockReturnValue(profileChain);
      profileChain.eq.mockReturnValue(profileChain);

      const from = vi.fn((table: string) => {
        if (table === "fred_user_preferences") return prefChain;
        if (table === "fred_personality_profiles") return profileChain;
        return prefChain;
      }) as never;
      return { rpc, from } as never;
    }

    it("injects the user personalization block into the upstream query only", async () => {
      const mock = supabaseWithPreferences(prefRow);
      vi.mocked(getSupabaseServerClient).mockReturnValue(mock);

      const response = await POST(request({ query: "Wie ist die Rechtslage?" }));
      await response.text();

      expect(openFredUpstreamStream).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining("<user_personalization>"),
        }),
      );
      const callQuery = vi.mocked(openFredUpstreamStream).mock.calls[0][0].query;
      expect(callQuery).toContain("<user_personalization>");
      expect(callQuery).toContain('Der Benutzer möchte mit dem Namen „Alina“');
      expect(callQuery).toContain("Wie ist die Rechtslage?");
      // Block must be appended after the original query
      expect(callQuery.indexOf("Wie ist die Rechtslage?")).toBeLessThan(
        callQuery.indexOf("<user_personalization>"),
      );
      // Block must be the final content
      expect(callQuery.trimEnd()).toMatch(/<\/user_personalization>$/);
      // The persisted query is the original, unpolluted
      const rpcCalls = (mock as { rpc: ReturnType<typeof vi.fn> }).rpc;
      expect(rpcCalls).toHaveBeenCalledWith("record_fred_native_event", {
        payload: expect.objectContaining({
          content: "Wie ist die Rechtslage?",
          event_type: "message_sent",
        }),
      });
    });

    it("leaves the upstream query unchanged when preferences are standard + empty name", async () => {
      const mock = supabaseWithPreferences({ preferred_name: null, personality: "standard" });
      vi.mocked(getSupabaseServerClient).mockReturnValue(mock);

      const response = await POST(request({ query: "Test" }));
      await response.text();

      expect(openFredUpstreamStream).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "Test",
        }),
      );
    });

    it("preserves Fred availability when preference read fails", async () => {
      const rpc = rpcForTurn();
      const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: new Error("db-down") });
      const chain = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle,
      };
      chain.select.mockReturnValue(chain);
      chain.eq.mockReturnValue(chain);
      const from = vi.fn().mockReturnValue(chain);
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc, from } as never);

      const response = await POST(request({ query: "Ist Fred noch da?" }));
      await response.text();

      // The request succeeds
      expect(openFredUpstreamStream).toHaveBeenCalled();
      // The upstream query is clean (no personalization)
      const callQuery = vi.mocked(openFredUpstreamStream).mock.calls[0][0].query;
      expect(callQuery).not.toContain("<user_personalization>");
    });

    it("preserves Fred availability when preference load throws entirely", async () => {
      const rpc = rpcForTurn();
      const from = vi.fn().mockImplementation(() => {
        throw new Error("connection refused");
      });
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc, from } as never);

      const response = await POST(request({ query: "Test" }));
      await response.text();

      expect(openFredUpstreamStream).toHaveBeenCalled();
      const callQuery = vi.mocked(openFredUpstreamStream).mock.calls[0][0].query;
      expect(callQuery).not.toContain("<user_personalization>");
    });

    it("does not expose internal errors to the client when preference load fails", async () => {
      const rpc = rpcForTurn();
      const from = vi.fn().mockImplementation(() => {
        throw new Error("secret stack trace with db password");
      });
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc, from } as never);

      const response = await POST(request({ query: "Sicher?" }));
      const text = await response.text();

      expect(response.status).toBe(200);
      expect(text).not.toContain("secret");
      expect(text).not.toContain("password");
      expect(text).not.toContain("stack");
    });

    it("sends the personalization block to upstream for attachment requests too", async () => {
      const mock = supabaseWithPreferences(prefRow);
      vi.mocked(getSupabaseServerClient).mockReturnValue(mock);
      vi.mocked(buildAttachmentContext).mockImplementation(async (question) => `${question}\n\nEXTRACTED`);

      const response = await POST(multipartRequest({
        query: "Was steht im Beleg?",
        attachment: pdfFile(),
      }));
      await response.text();

      expect(openFredUpstreamStream).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining("<user_personalization>"),
        }),
      );
      const callQuery = vi.mocked(openFredUpstreamStream).mock.calls[0][0].query;
      expect(callQuery).toContain("<user_personalization>");
      expect(callQuery).toContain("EXTRACTED");
      // Attachment context must come before the personalization block
      expect(callQuery.indexOf("EXTRACTED")).toBeLessThan(
        callQuery.indexOf("<user_personalization>"),
      );
      // Block must be the final content
      expect(callQuery.trimEnd()).toMatch(/<\/user_personalization>$/);
      // Persisted content is original
      const rpcCalls = (mock as { rpc: ReturnType<typeof vi.fn> }).rpc;
      expect(rpcCalls).toHaveBeenCalledWith("record_fred_native_event", {
        payload: expect.objectContaining({
          content: "Was steht im Beleg?",
          event_type: "message_sent",
        }),
      });
    });

    it("keeps native attachment queries to the original question plus personalization", async () => {
      const mock = supabaseWithPreferences(prefRow);
      vi.mocked(getSupabaseServerClient).mockReturnValue(mock);
      vi.mocked(getScanningSettings).mockResolvedValue({
        documentPipeline: "mineru_with_openrouter_fallback",
        fredAttachmentMode: "weknora_native",
        modelId: "model/x",
        prompt: "prompt",
        updatedAt: "2026-07-19T10:00:00.000Z",
        updatedBy: PERS_USER_ID,
      });

      const response = await POST(multipartRequest({
        query: "Was steht im Beleg?",
        attachment: pdfFile(),
      }));
      await response.text();

      const callQuery = vi.mocked(openFredUpstreamStream).mock.calls[0][0].query;
      expect(callQuery).toContain("Was steht im Beleg?");
      expect(callQuery).toContain("<user_personalization>");
      expect(callQuery).not.toContain("EXTRACTED");
      expect(callQuery).not.toContain("BEGINN DER ANHÄNGE");
      expect(openFredUpstreamStream).toHaveBeenCalledWith(expect.objectContaining({
        nativeAttachments: [expect.objectContaining({ kind: "file" })],
      }));
    });

    it("leaves the upstream query unchanged when preferences are standard + empty name", async () => {
      const mock = supabaseWithPreferences({ preferred_name: null, personality: "standard" });
      vi.mocked(getSupabaseServerClient).mockReturnValue(mock);

      const response = await POST(request({ query: "Test" }));
      await response.text();

      expect(openFredUpstreamStream).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "Test",
        }),
      );
      const callQuery = vi.mocked(openFredUpstreamStream).mock.calls[0][0].query;
      expect(callQuery).not.toContain("<user_personalization>");
      expect(callQuery).not.toContain("name");
    });

    it("ignores missing profile and leaves upstream query unpersonalized without failing the turn", async () => {
      const rpc = rpcForTurn();

      // Preferences point to a non-existent personality profile 'unknown-xyz'
      const prefMaybeSingle = vi.fn().mockResolvedValue({
        data: { preferred_name: "Heinz", personality: "unknown-xyz" },
        error: null,
      });
      const prefChain = { select: vi.fn(), eq: vi.fn(), maybeSingle: prefMaybeSingle };
      prefChain.select.mockReturnValue(prefChain);
      prefChain.eq.mockReturnValue(prefChain);

      // Profile lookup returns {data: null, error: null} — missing definition
      const profileMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
      const profileChain = { select: vi.fn(), eq: vi.fn(), maybeSingle: profileMaybeSingle };
      profileChain.select.mockReturnValue(profileChain);
      profileChain.eq.mockReturnValue(profileChain);

      const convChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };

      const from = vi.fn((table: string) => {
        if (table === "fred_user_preferences") return prefChain;
        if (table === "fred_personality_profiles") return profileChain;
        if (table === "fred_conversations") return convChain;
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }), insert: vi.fn().mockResolvedValue({ error: null }) };
      }) as never;
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc, from } as never);

      const response = await POST(request({ query: "Test" }));
      await response.text();

      // Still succeeds (Fred available)
      expect(openFredUpstreamStream).toHaveBeenCalled();
      // The upstream query is clean — no personalization block at all
      const callQuery = vi.mocked(openFredUpstreamStream).mock.calls[0][0].query;
      expect(callQuery).not.toContain("<user_personalization>");
      expect(callQuery).not.toContain("Heinz");
    });
  });

  describe("research display mode preference", () => {
    const DISP_USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

    beforeEach(() => {
      vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: DISP_USER_ID });
    });

    function upstreamStreamWithToolCall(): Response {
      return new Response([
        'data: {"response_type":"agent_query","assistant_message_id":"answer-1"}\n\n',
        'data: {"response_type":"tool_call","data":{"tool_name":"web_search","tool_call_id":"tc-1","arguments":{"query":"test"}}}\n\n',
        'data: {"response_type":"tool_result","data":{"tool_name":"web_search","tool_call_id":"tc-1","result":{"status":"ok"},"duration_ms":250}}\n\n',
        'data: {"response_type":"answer","content":"Ergebnis","done":true}\n\n',
        'data: {"response_type":"complete","data":{}}\n\n',
      ].join(""), { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }

    it("emits execution events and persists execution trace when user preference is advanced", async () => {
      const rpc = rpcForTurn();
      vi.mocked(openFredUpstreamStream).mockImplementation(async () => upstreamStreamWithToolCall());

      const prefChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { preferred_name: null, personality: "standard", research_display_mode: "advanced" },
          error: null,
        }),
      };
      const profileChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { prompt_text: "" },
          error: null,
        }),
      };
      const convChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
      const from = vi.fn((table: string) => {
        if (table === "fred_user_preferences") return prefChain;
        if (table === "fred_personality_profiles") return profileChain;
        if (table === "fred_conversations") return convChain;
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }), insert: vi.fn().mockResolvedValue({ error: null }) };
      }) as never;
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc, from } as never);

      const response = await POST(request({ query: "Wie ist die Rechtslage?" }));
      const events = (await response.text())
        .split("\n")
        .map(parseFredNativeStreamLine)
        .filter(Boolean);

      const executionEvents = events.filter((e) => e?.type === "execution");
      expect(executionEvents.length).toBeGreaterThan(0);
      expect(executionEvents[0]).toMatchObject({
        type: "execution",
        step: expect.objectContaining({
          id: expect.stringMatching(/^web:/u),
          kind: "web",
        }),
      });

      const finalEvent = events.find((e) => e?.type === "final");
      expect(finalEvent).toMatchObject({
        type: "final",
        executionTrace: expect.arrayContaining([
          expect.objectContaining({ id: expect.stringMatching(/^web:/u), kind: "web", status: "completed" }),
        ]),
      });

      expect(rpc).toHaveBeenNthCalledWith(2, "record_fred_native_event", {
        payload: expect.objectContaining({
          event_type: "message_received",
          execution_trace: expect.arrayContaining([
            expect.objectContaining({ id: expect.stringMatching(/^web:/u), kind: "web", status: "completed" }),
          ]),
        }),
      });
    });

    it("does not emit execution events when user preference is simple even if client requested otherwise", async () => {
      const rpc = rpcForTurn();
      vi.mocked(openFredUpstreamStream).mockImplementation(async () => upstreamStreamWithToolCall());

      const prefChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { preferred_name: null, personality: "standard", research_display_mode: "simple" },
          error: null,
        }),
      };
      const profileChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { prompt_text: "" },
          error: null,
        }),
      };
      const convChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
      const from = vi.fn((table: string) => {
        if (table === "fred_user_preferences") return prefChain;
        if (table === "fred_personality_profiles") return profileChain;
        if (table === "fred_conversations") return convChain;
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }), insert: vi.fn().mockResolvedValue({ error: null }) };
      }) as never;
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc, from } as never);

      const response = await POST(request({ query: "Wie ist die Rechtslage?", researchDisplayMode: "advanced" }));
      const events = (await response.text())
        .split("\n")
        .map(parseFredNativeStreamLine)
        .filter(Boolean);

      const executionEvents = events.filter((e) => e?.type === "execution");
      expect(executionEvents).toHaveLength(0);

      const finalEvent = events.find((e) => e?.type === "final");
      expect(finalEvent).toMatchObject({
        type: "final",
      });
      if (finalEvent && "executionTrace" in finalEvent) {
        expect(finalEvent.executionTrace).toBeUndefined();
      }

      expect(rpc).toHaveBeenNthCalledWith(2, "record_fred_native_event", {
        payload: expect.objectContaining({
          event_type: "message_received",
          execution_trace: [],
        }),
      });
    });
  });


  describe("generation run diagnostics", () => {
    const diagUserId = "99999999-9999-4999-8999-999999999999";

    beforeEach(() => {
      vi.mocked(getSupabaseServerClient).mockReset();
      vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: diagUserId });
    });

    function makeGenRunSupabase(
      overrides: {
        insertError?: unknown;
        updateError?: unknown;
        selectError?: unknown;
        existingFirstDelta?: string | null;
      } = {},
    ) {
      const { insertError = null, updateError = null, selectError = null, existingFirstDelta = null } = overrides;

      // insert chain: .from("fred_generation_runs").insert({...}).select("id").single()
      const insertSingle = vi.fn(() => {
        return Promise.resolve(
          insertError
            ? { data: null, error: insertError }
            : { data: { id: "run-00000000-0000-4000-8000-000000000001" }, error: null },
        );
      });
      const insertSelectChain = vi.fn().mockReturnValue({ single: insertSingle });
      const insertChain = vi.fn().mockReturnValue({ select: insertSelectChain });

      // update chain: .from("fred_generation_runs").update({...}).eq("id", runId)
      const updateEq = vi.fn().mockResolvedValue(
        updateError ? { error: updateError } : { error: null },
      );
      const updateChain = vi.fn().mockReturnValue({ eq: updateEq });

      // select chain (for first_delta_at check): .from("fred_generation_runs").select("first_delta_at").eq("id", runId).maybeSingle()
      const selectMaybeSingle = vi.fn().mockResolvedValue(
        selectError
          ? { data: null, error: selectError }
          : { data: { first_delta_at: existingFirstDelta ?? null }, error: null },
      );
      const selectEq = vi.fn().mockReturnValue({ maybeSingle: selectMaybeSingle });
      const selectChain = vi.fn().mockReturnValue({ eq: selectEq });

      const from = vi.fn((table: string) => {
        if (table === "fred_generation_runs") {
          // We need to differentiate insert vs update vs select
          // Insert: .insert(...) -> insertChain
          // Update: .update(...) -> updateChain
          // Select: .select(...) -> selectChain
          return {
            insert: insertChain,
            update: updateChain,
            select: selectChain,
          };
        }
        // fallback for other tables
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        };
      }) as never;

      return { from, insertSingle, insertChain, updateEq, updateChain, selectMaybeSingle };
    }

    it("creates a run in preprocessing status before attachment preprocessing and advances to completed", async () => {
      const { from, insertSingle, updateChain } = makeGenRunSupabase();
      const rpc = rpcForTurn();
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc, from } as never);

      const response = await POST(multipartRequest({
        query: "Was steht im Beleg?",
        attachment: pdfFile(),
        webSearchEnabled: false,
      }));
      await response.text();

      // Run was created
      expect(insertSingle).toHaveBeenCalled();
      // Status advanced at least to completed
      const updateCalls = updateChain.mock.calls.map((call: unknown[]) => (call[0] as Record<string, unknown>)?.status);
      expect(updateCalls).toContain("completed");
    });

    it("marks the run failed when attachment preprocessing throws", async () => {
      const { from, insertSingle, updateChain } = makeGenRunSupabase();
      const rpc = vi.fn().mockResolvedValueOnce({ data: summaryRow, error: null });
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc, from } as never);
      vi.mocked(buildAttachmentContext).mockRejectedValueOnce(
        new UserVisibleError("Die Anhänge konnten nicht analysiert werden.", 400),
      );

      const response = await POST(multipartRequest({
        query: "Was steht im Beleg?",
        attachment: pdfFile(),
      }));
      const events = (await response.text())
        .split("\n")
        .map(parseFredNativeStreamLine)
        .filter(Boolean);

      expect(events).toContainEqual({
        type: "error",
        error: "Die Anhänge konnten nicht analysiert werden.",
      });
      // Run was created
      expect(insertSingle).toHaveBeenCalled();
      // Run was marked failed with preprocessing phase
      const updateCalls = updateChain.mock.calls.map((call: unknown[]) => call[0] as Record<string, unknown>);
      const failedUpdate = updateCalls.find((c) => c?.status === "failed");
      expect(failedUpdate).toBeDefined();
      expect((failedUpdate as Record<string, unknown>)?.failure_phase).toBe("preprocessing");
      expect((failedUpdate as Record<string, unknown>)?.error_code).toBe("preprocessing_failed");
    });

    it("marks failed on upstream EOF without a complete/final answer and emits exactly one EOF error", async () => {
      const { from, insertSingle, updateChain } = makeGenRunSupabase();
      const rpc = vi.fn()
        .mockResolvedValueOnce({ data: summaryRow, error: null });
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc, from } as never);

      // Stream ends with answer delta but no "complete" event
      vi.mocked(openFredUpstreamStream).mockResolvedValue(new Response([
        'data: {"response_type":"agent_query","assistant_message_id":"answer-eof"}\n\n',
        'data: {"response_type":"answer","content":"Teilantwort","done":true}\n\n',
        // No "complete" event — EOF happens here
      ].join(""), { headers: { "Content-Type": "text/event-stream" } }));

      const response = await POST(multipartRequest({
        query: "Frage",
        attachment: pdfFile(),
      }));
      const events = (await response.text())
        .split("\n")
        .map(parseFredNativeStreamLine)
        .filter(Boolean);

      // Should contain exactly one error event with the EOF message
      const errorEvents = events.filter((e) => e?.type === "error");
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0]).toEqual({
        type: "error",
        error: "Fred konnte die Antwort nicht abschließen. Die Frage wurde gespeichert; bitte erneut senden.",
      });

      // Run was marked failed with streaming phase
      const updateCalls = updateChain.mock.calls.map((call: unknown[]) => call[0] as Record<string, unknown>);
      const failedUpdate = updateCalls.find((c) => c?.status === "failed");
      expect(failedUpdate).toBeDefined();
      expect((failedUpdate as Record<string, unknown>)?.failure_phase).toBe("streaming");
      expect((failedUpdate as Record<string, unknown>)?.error_code).toBe("upstream_eof_without_final");
    });

    it("marks completed when the normal final stream completes and does not emit the EOF error", async () => {
      const { from, insertSingle, updateChain } = makeGenRunSupabase();
      const rpc = rpcForTurn();
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc, from } as never);
      // Use the default upstreamStream() which includes "complete"
      vi.mocked(openFredUpstreamStream).mockImplementation(async () => upstreamStream());

      const response = await POST(multipartRequest({
        query: "Frage",
        attachment: pdfFile(),
      }));
      const events = (await response.text())
        .split("\n")
        .map(parseFredNativeStreamLine)
        .filter(Boolean);

      // No EOF error
      const errorEvents = events.filter((e) => e?.type === "error");
      expect(errorEvents).toHaveLength(0);

      // Contains final event
      expect(events.some((e) => e?.type === "final")).toBe(true);

      // Run was marked completed
      const updateCalls = updateChain.mock.calls.map((call: unknown[]) => call[0] as Record<string, unknown>);
      const completedUpdate = updateCalls.find((c) => c?.status === "completed");
      expect(completedUpdate).toBeDefined();
    });

    it("marks cancelled on explicit browser abort", async () => {
      const { from, insertSingle, updateChain } = makeGenRunSupabase();
      const rpc = vi.fn()
        .mockResolvedValueOnce({ data: summaryRow, error: null });
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc, from } as never);

      const abortController = new AbortController();

      // Stream that never completes
      vi.mocked(openFredUpstreamStream).mockResolvedValue(new Response(
        new ReadableStream({
          start(ctrl) {
            ctrl.enqueue(new TextEncoder().encode(
              'data: {"response_type":"agent_query","assistant_message_id":"answer-cancel"}\n\n',
            ));
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      ));

      const response = await POST(multipartRequest({
        query: "Frage",
        attachment: pdfFile(),
        signal: abortController.signal,
      }));

      // Read the first event then abort
      const reader = response.body!.getReader();
      await reader.read();
      abortController.abort();
      await reader.cancel();

      // Allow async cleanup
      await new Promise((r) => setTimeout(r, 50));

      // Run was marked cancelled
      const updateCalls = updateChain.mock.calls.map((call: unknown[]) => call[0] as Record<string, unknown>);
      const cancelledUpdate = updateCalls.find((c) => c?.status === "cancelled");
      expect(cancelledUpdate).toBeDefined();
    });

    it("does not break the successful answer when diagnostics persistence fails", async () => {
      const { from, insertSingle, updateChain } = makeGenRunSupabase({ insertError: new Error("DB down") });
      const rpc = rpcForTurn();
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc, from } as never);
      vi.mocked(openFredUpstreamStream).mockImplementation(async () => upstreamStream());

      const response = await POST(multipartRequest({
        query: "Frage",
        attachment: pdfFile(),
      }));
      const events = (await response.text())
        .split("\n")
        .map(parseFredNativeStreamLine)
        .filter(Boolean);

      // The answer should still succeed
      expect(response.status).toBe(200);
      expect(events.some((e) => e?.type === "final")).toBe(true);
      expect(events.some((e) => e?.type === "error")).toBe(false);
    });


    it('updates run with conversation_id immediately after user recordEvent returns', async () => {
      const { from, updateChain } = makeGenRunSupabase();
      const rpc = vi.fn()
        .mockResolvedValueOnce({ data: summaryRow, error: null })
        .mockResolvedValueOnce({
          data: { ...summaryRow, updated_at: '2026-07-19T10:00:02.000Z', message_id: 2 },
          error: null,
        });
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc, from } as never);
      vi.mocked(openFredUpstreamStream).mockImplementation(async () => upstreamStream());

      const response = await POST(multipartRequest({
        query: 'Frage',
        attachment: pdfFile(),
      }));
      await response.text();

      // The run should have conversation_id set before completion
      const updateCalls = updateChain.mock.calls.map((call) => call[0] as Record<string, unknown>);
      const convUpdates = updateCalls.filter((c) => c?.conversation_id !== undefined);
      expect(convUpdates.length).toBeGreaterThanOrEqual(1);
      // At least one conversation_id update should happen before the completed status
      const completedIdx = updateCalls.findIndex((c) => c?.status === 'completed');
      const convIdx = updateCalls.findIndex((c) => c?.conversation_id !== undefined);
      expect(convIdx).toBeLessThan(completedIdx);
    });

    it('starts with model_route weknora:pending and updates to exact route after upstream config', async () => {
      const { from, insertChain, updateChain } = makeGenRunSupabase();
      const rpc = rpcForTurn();
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc, from } as never);
      vi.mocked(openFredUpstreamStream).mockImplementation(async () => upstreamStream());

      const response = await POST(multipartRequest({
        query: 'Frage',
        attachment: pdfFile(),
      }));
      await response.text();

      // Check insert contained "weknora:pending"
      const insertCalls = insertChain.mock.calls.map((call) => call[0] as Record<string, unknown>);
      const insertCall = insertCalls.find((c) => c?.model_route !== undefined);
      expect(insertCall?.model_route).toBe('weknora:pending');

      // Check that an update call set the exact model route
      const updateCalls = updateChain.mock.calls.map((call) => call[0] as Record<string, unknown>);
      const routeUpdates = updateCalls.filter((c) => c?.model_route !== undefined && c?.model_route !== 'weknora:pending');
      expect(routeUpdates.length).toBeGreaterThanOrEqual(1);
      const exactRoute = routeUpdates[0]?.model_route as string;
      expect(exactRoute).toMatch(/^weknora:fred:agent-1$/);
    });

    it('includes pro model id in exact route when pro mode is enabled', async () => {
      const { from, insertChain, updateChain } = makeGenRunSupabase();
      const rpc = rpcForTurn();
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc, from } as never);
      vi.mocked(openFredUpstreamStream).mockImplementation(async () => upstreamStream());

      const response = await POST(multipartRequest({
        query: 'Pro Frage',
        attachment: pdfFile(),
        proModeEnabled: true,
      }));
      await response.text();

      // Initial route is pending
      const insertCalls = insertChain.mock.calls.map((call) => call[0] as Record<string, unknown>);
      const insertCall = insertCalls.find((c) => c?.model_route !== undefined);
      expect(insertCall?.model_route).toBe('weknora:pending');

      // Exact route includes pro model id
      const updateCalls = updateChain.mock.calls.map((call) => call[0] as Record<string, unknown>);
      const routeUpdates = updateCalls.filter((c) => c?.model_route !== undefined && c?.model_route !== 'weknora:pending');
      expect(routeUpdates.length).toBeGreaterThanOrEqual(1);
      const exactRoute = routeUpdates[0]?.model_route as string;
      // readFredProModelId returns "a1b2c3d4-e5f6-4789-abcd-ef0123456789" in the mock
      expect(exactRoute).toContain(':pro=');
    });

    it('tracks failure phase as streaming for parser errors even without answer deltas', async () => {
      const { from, updateChain } = makeGenRunSupabase();
      const rpc = vi.fn()
        .mockResolvedValueOnce({ data: summaryRow, error: null });
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc, from } as never);

      // Stream with unparseable frame after successful open — triggers parser error
      vi.mocked(openFredUpstreamStream).mockResolvedValue(new Response([
        'data: {"response_type":"agent_query","assistant_message_id":"answer-bad"}\n\n',
        'data: {not-json}\n\n',
      ].join(''), { headers: { 'Content-Type': 'text/event-stream' } }));

      const response = await POST(multipartRequest({
        query: 'Frage',
        attachment: pdfFile(),
      }));
      await response.text();

      // Should be marked failed with streaming phase (not connecting)
      const updateCalls = updateChain.mock.calls.map((call) => call[0] as Record<string, unknown>);
      const failedUpdate = updateCalls.find((c) => c?.status === 'failed');
      expect(failedUpdate).toBeDefined();
      expect((failedUpdate as Record<string, unknown>)?.failure_phase).toBe('streaming');
    });

    it('cancelled is the last terminal status and no failed update follows after abort', async () => {
      const { from, updateChain } = makeGenRunSupabase();
      const rpc = vi.fn()
        .mockResolvedValueOnce({ data: summaryRow, error: null });
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc, from } as never);

      const abortController = new AbortController();

      // Stream that never completes — reader.read() hangs
      vi.mocked(openFredUpstreamStream).mockResolvedValue(new Response(
        new ReadableStream({
          start(ctrl) {
            ctrl.enqueue(new TextEncoder().encode(
              'data: {"response_type":"agent_query","assistant_message_id":"answer-cancel"}\n\n',
            ));
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      ));

      const response = await POST(multipartRequest({
        query: 'Frage',
        attachment: pdfFile(),
        signal: abortController.signal,
      }));

      // Read first event then abort
      const reader = response.body!.getReader();
      await reader.read();
      abortController.abort();
      await reader.cancel();

      // Allow async cleanup to settle
      await new Promise((r) => setTimeout(r, 100));

      // Get all status updates in order
      const updateCalls = updateChain.mock.calls.map((call) => call[0] as Record<string, unknown>);
      const statusUpdates = updateCalls
        .filter((c) => c?.status !== undefined)
        .map((c) => c?.status);

      // There must be exactly one cancelled update
      const cancelledCount = statusUpdates.filter((s) => s === 'cancelled').length;
      expect(cancelledCount).toBe(1);

      // The last terminal status must be cancelled, not failed
      const terminalStatuses = statusUpdates.filter(
        (s) => s === 'cancelled' || s === 'failed' || s === 'completed'
      );
      expect(terminalStatuses[terminalStatuses.length - 1]).toBe('cancelled');
    });
  });

  describe("Native upload image discovery and materialization", () => {
    it("discovers embed images in native image turn and rewrites trusted provider markdown to artifact markers", async () => {
      const currentUserId = "aaaa1111-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: currentUserId });
      const artifactId = "99999999-9999-4999-8999-999999999999";
      const insertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({
          data: [{ id: artifactId, source_uri: "minio://bucket/img1.png" }],
          error: null,
        }),
      });
      const from = vi.fn((table: string) => {
        if (table === "fred_native_image_artifacts") {
          return { insert: insertMock };
        }
        return {
          insert: vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [{ id: "run-1" }], error: null }) }),
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
          select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }) }),
        };
      });
      const rpc = rpcForTurn();
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc, from } as never);
      vi.mocked(getScanningSettings).mockResolvedValue({
        documentPipeline: "mineru_with_openrouter_fallback",
        fredAttachmentMode: "weknora_native",
        modelId: "model/x",
        prompt: "prompt",
        updatedAt: "2026-07-19T10:00:00.000Z",
        updatedBy: currentUserId,
      });
      vi.mocked(fetchFredRecentEmbedImages).mockResolvedValue([
        { url: "minio://bucket/img1.png", caption: "Bild.png" },
      ]);
      vi.mocked(openFredUpstreamStream).mockResolvedValue(new Response([
        'data: {"response_type":"agent_query","assistant_message_id":"answer-1"}\n\n',
        'data: {"response_type":"answer","content":"Hier ist das Bild: ![Beleg](minio://bucket/img1.png)","done":true}\n\n',
        'data: {"response_type":"complete","data":{}}\n\n',
      ].join(""), { status: 200, headers: { "Content-Type": "text/event-stream" } }));

      const response = await POST(multipartRequest({
        query: "Bitte Bild prüfen",
        image: pngFile(),
      }));

      const text = await response.text();
      const events = text.split("\n").filter(Boolean).map(parseFredNativeStreamLine);
      const finalEvent = events.find((e) => e?.type === "final");

      expect(fetchFredRecentEmbedImages).toHaveBeenCalledTimes(1);
      expect(insertMock).toHaveBeenCalledWith([
        expect.objectContaining({
          source_uri: "minio://bucket/img1.png",
          original_name: "Bild.png",
          mime_type: "image/png",
        }),
      ]);

      expect(rpc).toHaveBeenNthCalledWith(2, "record_fred_native_event", {
        payload: expect.objectContaining({
          content: "Hier ist das Bild: ![Beleg](minio://bucket/img1.png)",
          display_content: `Hier ist das Bild: ![Beleg](findog-artifact://${artifactId})`,
        }),
      });

      expect(finalEvent).toEqual(expect.objectContaining({
        type: "final",
        answer: `Hier ist das Bild: ![Beleg](findog-artifact://${artifactId})`,
      }));
    });

    it("fails closed on invented provider URI by stripping markup to alt text without inserting artifacts", async () => {
      const currentUserId = "bbbb2222-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: currentUserId });
      const insertMock = vi.fn();
      const from = vi.fn((table: string) => {
        if (table === "fred_native_image_artifacts") {
          return { insert: insertMock };
        }
        return {
          insert: vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [{ id: "run-1" }], error: null }) }),
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
        };
      });
      const rpc = rpcForTurn();
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc, from } as never);
      vi.mocked(getScanningSettings).mockResolvedValue({
        documentPipeline: "mineru_with_openrouter_fallback",
        fredAttachmentMode: "weknora_native",
        modelId: "model/x",
        prompt: "prompt",
        updatedAt: "2026-07-19T10:00:00.000Z",
        updatedBy: currentUserId,
      });
      vi.mocked(fetchFredRecentEmbedImages).mockResolvedValue([
        { url: "minio://bucket/real.png" },
      ]);
      vi.mocked(openFredUpstreamStream).mockResolvedValue(new Response([
        'data: {"response_type":"agent_query","assistant_message_id":"answer-1"}\n\n',
        'data: {"response_type":"answer","content":"Erfundenes Bild: ![Fake](minio://bucket/fake.png)","done":true}\n\n',
        'data: {"response_type":"complete","data":{}}\n\n',
      ].join(""), { status: 200, headers: { "Content-Type": "text/event-stream" } }));

      const response = await POST(multipartRequest({
        query: "Bitte prüfen",
        image: pngFile(),
      }));

      const text = await response.text();
      const events = text.split("\n").filter(Boolean).map(parseFredNativeStreamLine);
      const finalEvent = events.find((e) => e?.type === "final");

      expect(insertMock).not.toHaveBeenCalled();
      expect(rpc).toHaveBeenNthCalledWith(2, "record_fred_native_event", {
        payload: expect.objectContaining({
          display_content: "Erfundenes Bild: Fake",
        }),
      });
      expect(finalEvent).toEqual(expect.objectContaining({
        type: "final",
        answer: "Erfundenes Bild: Fake",
      }));
    });

    it("skips image discovery when fredAttachmentMode is findog_preprocess (custom mode)", async () => {
      const currentUserId = "cccc3333-cccc-4ccc-8ccc-cccccccccccc";
      vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: currentUserId });
      const rpc = rpcForTurn();
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);
      vi.mocked(getScanningSettings).mockResolvedValue({
        documentPipeline: "mineru_with_openrouter_fallback",
        fredAttachmentMode: "findog_preprocess",
        modelId: "model/x",
        prompt: "prompt",
        updatedAt: "2026-07-19T10:00:00.000Z",
        updatedBy: currentUserId,
      });

      const response = await POST(multipartRequest({
        query: "Frage im Custom Mode",
        image: pngFile(),
      }));
      await response.text();

      expect(fetchFredRecentEmbedImages).not.toHaveBeenCalled();
    });

    it("preserves text answer and strips provider images to alt text when image discovery fails", async () => {
      const currentUserId = "dddd4444-dddd-4ddd-8ddd-dddddddddddd";
      vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: currentUserId });
      const rpc = rpcForTurn();
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);
      vi.mocked(getScanningSettings).mockResolvedValue({
        documentPipeline: "mineru_with_openrouter_fallback",
        fredAttachmentMode: "weknora_native",
        modelId: "model/x",
        prompt: "prompt",
        updatedAt: "2026-07-19T10:00:00.000Z",
        updatedBy: currentUserId,
      });
      vi.mocked(fetchFredRecentEmbedImages).mockRejectedValue(new Error("Network timeout"));
      vi.mocked(openFredUpstreamStream).mockResolvedValue(new Response([
        'data: {"response_type":"agent_query","assistant_message_id":"answer-1"}\n\n',
        'data: {"response_type":"answer","content":"Antworttext: ![Graph](local://graph.png)","done":true}\n\n',
        'data: {"response_type":"complete","data":{}}\n\n',
      ].join(""), { status: 200, headers: { "Content-Type": "text/event-stream" } }));

      const response = await POST(multipartRequest({
        query: "Frage mit Fehler",
        image: pngFile(),
      }));

      expect(response.status).toBe(200);
      const text = await response.text();
      const events = text.split("\n").filter(Boolean).map(parseFredNativeStreamLine);
      const finalEvent = events.find((e) => e?.type === "final");

      expect(finalEvent).toEqual(expect.objectContaining({
        type: "final",
        answer: "Antworttext: Graph",
      }));
    });
  });

  describe("direct-result source gating vertical route behavior", () => {
    it("projects direct tool results into source_references in advanced mode", async () => {
      const currentUserId = "eeee5555-eeee-4eee-8eee-eeeeeeeeeeee";
      vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: currentUserId });
      const rpc = rpcForTurn();
      const prefChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { preferred_name: null, personality: "standard", research_display_mode: "advanced" },
          error: null,
        }),
      };
      const profileChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { prompt_text: "" },
          error: null,
        }),
      };
      const convChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
      const from = vi.fn((table: string) => {
        if (table === "fred_user_preferences") return prefChain;
        if (table === "fred_personality_profiles") return profileChain;
        if (table === "fred_conversations") return convChain;
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }), insert: vi.fn().mockResolvedValue({ error: null }) };
      }) as never;
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc, from } as never);
      vi.mocked(openFredUpstreamStream).mockResolvedValue(new Response([
        'data: {"response_type":"agent_query","assistant_message_id":"answer-1"}\n\n',
        'data: {"response_type":"tool_result","data":{"tool_call_id":"web-adv-1","tool_name":"web_search","results":[{"url":"https://www.bmf.gv.at/tax","title":"BMF Tax"}]}}\n\n',
        'data: {"response_type":"answer","content":"Ergebnis in Advanced.","done":true}\n\n',
        'data: {"response_type":"complete","data":{}}\n\n',
      ].join(""), { headers: { "Content-Type": "text/event-stream" } }));

      const response = await POST(request({
        query: "Frage im Advanced Mode",
        researchDisplayMode: "advanced",
      }));
      const events = (await response.text())
        .split("\n")
        .map(parseFredNativeStreamLine)
        .filter(Boolean);

      const finalEvent = events.find((e) => e?.type === "final");
      expect(finalEvent).toMatchObject({
        type: "final",
        sourceReferences: [
          { kind: "web", url: "https://www.bmf.gv.at/tax", title: "BMF Tax" },
        ],
      });

      expect(rpc).toHaveBeenNthCalledWith(2, "record_fred_native_event", {
        payload: expect.objectContaining({
          source_references: [
            { kind: "web", url: "https://www.bmf.gv.at/tax", title: "BMF Tax" },
          ],
        }),
      });
    });

    it("does NOT project direct tool results into source_references in simple mode", async () => {
      const currentUserId = "ffff6666-ffff-4fff-8fff-ffffffffffff";
      vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: currentUserId });
      const rpc = rpcForTurn();
      const prefChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { preferred_name: null, personality: "standard", research_display_mode: "simple" },
          error: null,
        }),
      };
      const profileChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { prompt_text: "" },
          error: null,
        }),
      };
      const convChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
      const from = vi.fn((table: string) => {
        if (table === "fred_user_preferences") return prefChain;
        if (table === "fred_personality_profiles") return profileChain;
        if (table === "fred_conversations") return convChain;
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }), insert: vi.fn().mockResolvedValue({ error: null }) };
      }) as never;
      vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc, from } as never);
      vi.mocked(openFredUpstreamStream).mockResolvedValue(new Response([
        'data: {"response_type":"agent_query","assistant_message_id":"answer-1"}\n\n',
        'data: {"response_type":"tool_result","data":{"tool_call_id":"web-sim-1","tool_name":"web_search","results":[{"url":"https://www.bmf.gv.at/tax","title":"BMF Tax"}]}}\n\n',
        'data: {"response_type":"answer","content":"Ergebnis in Simple.","done":true}\n\n',
        'data: {"response_type":"complete","data":{}}\n\n',
      ].join(""), { headers: { "Content-Type": "text/event-stream" } }));

      const response = await POST(request({
        query: "Frage im Simple Mode",
        researchDisplayMode: "simple",
      }));
      const events = (await response.text())
        .split("\n")
        .map(parseFredNativeStreamLine)
        .filter(Boolean);

      const finalEvent = events.find((e) => e?.type === "final");
      expect(finalEvent).toMatchObject({
        type: "final",
        sourceReferences: [],
      });

      expect(rpc).toHaveBeenNthCalledWith(2, "record_fred_native_event", {
        payload: expect.objectContaining({
          source_references: [],
        }),
      });
    });
  });
});
