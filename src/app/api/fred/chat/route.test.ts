import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { buildAttachmentContext } from "@/lib/attachments/context";
import {
  mintFredEmbedSession,
  readFredEmbedServerConfig,
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
import { parseFredNativeStreamLine } from "@/lib/fred-native-stream";
import { resolveBfgCitation } from "@/lib/findok/bfg-citations";
import { POST } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/attachments/context", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/attachments/context")>();
  return { ...original, buildAttachmentContext: vi.fn() };
});
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));
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
const conversationId = "22222222-2222-4222-8222-222222222222";
const summaryRow = {
  conversation_id: conversationId,
  title: "Wie ist die Rechtslage?",
  created_at: "2026-07-19T10:00:00.000Z",
  updated_at: "2026-07-19T10:00:01.000Z",
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
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: userId });
    vi.mocked(readFredEmbedServerConfig).mockReturnValue({
      channelId: "fred-channel",
      publishToken: "em_publish_token_fixture_123456",
      exchangeOrigin: "https://findog.at",
    });
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
});
