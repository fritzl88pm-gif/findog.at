import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  FredTurnEvent,
  FredTurnRequest,
  FredTurnResult,
} from "./turn-types";
import {
  executeFredTurn,
  type TurnServiceConfigDeps,
  type TurnServicePersistenceDeps,
  type TurnServiceUpstreamDeps,
} from "./turn-service";

const userId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const channelId = "fred-channel";

function summaryConv(overrides: Record<string, unknown> = {}) {
  return {
    id: conversationId,
    title: "Wie ist die Rechtslage?",
    createdAt: "2026-07-19T10:00:00.000Z",
    updatedAt: "2026-07-19T10:00:01.000Z",
    agentKey: "fred" as const,
    ...overrides,
  };
}

function storedConvRow(overrides: Record<string, unknown> = {}) {
  return {
    id: conversationId,
    title: "Alt",
    created_at: "2026-07-19T09:00:00.000Z",
    updated_at: "2026-07-19T09:00:00.000Z",
    weknora_channel_id: channelId,
    weknora_session_id: "session-existing",
    agent_key: "fred",
    weknora_agent_id: "agent-1",
    ...overrides,
  };
}

function makeUpstreamDeps(overrides: Partial<TurnServiceUpstreamDeps> = {}): TurnServiceUpstreamDeps {
  return {
    mintSession: vi.fn().mockResolvedValue({
      token: "ems_test_session_token_1234567890123456",
      expiresIn: 1800,
    }),
    fetchUpstreamConfig: vi.fn().mockResolvedValue({
      agentId: "agent-1",
      knowledgeBaseIds: ["kb-1"],
      allowWebSearch: false,
      allowFileUpload: true,
      allowImageUpload: true,
    }),
    createSession: vi.fn().mockResolvedValue({
      id: "session-1",
      signature: "session-signature",
    }),
    deriveSessionSignature: vi.fn().mockReturnValue("derived-signature"),
    openStream: vi.fn().mockImplementation(async () => {
      return new ReadableStream<Uint8Array>({
        start(ctrl) {
          const frames = [
            'data: {"response_type":"agent_query","assistant_message_id":"answer-1"}\n\n',
            'data: {"response_type":"answer","content":"Hallo ","done":false}\n\n',
            'data: {"response_type":"answer","content":"Welt","done":true}\n\n',
            'data: {"response_type":"complete","data":{}}\n\n',
          ];
          ctrl.enqueue(new TextEncoder().encode(frames.join("")));
          ctrl.close();
        },
      });
    }),
    visitorId: vi.fn().mockReturnValue("visitor-hash"),
    relayEvent: vi.fn().mockResolvedValue(undefined),
    stopSession: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makePersistenceDeps(
  overrides: Partial<TurnServicePersistenceDeps> = {},
): TurnServicePersistenceDeps {
  const conv1 = summaryConv();
  const conv2 = summaryConv({ updatedAt: "2026-07-19T10:00:02.000Z" });
  return {
    recordEvent: vi.fn()
      .mockResolvedValueOnce({ conversation: conv1 })
      .mockResolvedValueOnce({ conversation: conv2, messageId: 2 }),
    loadConversation: vi.fn().mockResolvedValue(null),
    recordAdminRequest: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeConfigDeps(overrides: Partial<TurnServiceConfigDeps> = {}): TurnServiceConfigDeps {
  return {
    readFredConfig: vi.fn().mockReturnValue({
      channelId,
      publishToken: "em_publish_token_fixture_123456",
      exchangeOrigin: "https://findog.at",
    }),
    readQuickFredConfig: vi.fn().mockReturnValue(null),
    readProModelId: vi.fn().mockReturnValue("a1b2c3d4-e5f6-4789-abcd-ef0123456789"),
    ...overrides,
  };
}

function baseRequest(overrides: Partial<FredTurnRequest> = {}): FredTurnRequest {
  return {
    clientId: userId,
    query: "Wie ist die Rechtslage?",
    origin: "web",
    agentKey: "fred",
    webSearchEnabled: false,
    proModeEnabled: false,
    ...overrides,
  };
}

async function collectEvents(
  gen: AsyncGenerator<FredTurnEvent, FredTurnResult>,
): Promise<{ events: FredTurnEvent[]; result: FredTurnResult }> {
  const events: FredTurnEvent[] = [];
  let result: FredTurnResult | undefined;
  while (true) {
    const { value, done } = await gen.next();
    if (done) {
      result = value;
      break;
    }
    events.push(value);
  }
  return { events, result: result! };
}

describe("executeFredTurn", () => {
  let upstream: TurnServiceUpstreamDeps;
  let persistence: TurnServicePersistenceDeps;
  let config: TurnServiceConfigDeps;

  beforeEach(() => {
    upstream = makeUpstreamDeps();
    persistence = makePersistenceDeps();
    config = makeConfigDeps();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("streams a full answer and persists both sides", async () => {
    const gen = executeFredTurn(baseRequest(), upstream, persistence, config);
    const { events, result } = await collectEvents(gen);

    expect(events).toHaveLength(4); // conversation + 2 deltas + final
    expect(events[0]).toEqual({
      type: "conversation",
      conversation: expect.objectContaining({ id: conversationId, agentKey: "fred" }),
    });
    expect(events[1]).toEqual({ type: "delta", content: "Hallo " });
    expect(events[2]).toEqual({ type: "delta", content: "Welt" });
    expect(events[3]).toEqual({
      type: "final",
      answer: "Hallo Welt",
      assistantMessageId: 2,
      conversation: expect.objectContaining({ id: conversationId }),
      researchTrace: [],
      sourceReferences: [],
    });

    expect(result.answer).toBe("Hallo Welt");
    expect(result.rawAnswer).toBe("Hallo Welt");
    expect(result.stopped).toBe(false);

    expect(persistence.recordEvent).toHaveBeenCalledTimes(2);
    expect(persistence.recordEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      clientId: userId,
      eventType: "message_sent",
      content: "Wie ist die Rechtslage?",
    }));
    expect(persistence.recordEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      clientId: userId,
      eventType: "message_received",
      content: "Hallo Welt",
      displayContent: "Hallo Welt",
    }));
  });

  it("emits final upstream and verified citation research steps exactly once", async () => {
    const gz = "RV/1234567/2099";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      dokumentId: "doc-final",
      segmentId: "segment-final",
      indexName: "findok-bfg",
      dokumentPdfMediaUrl: "findok/resources/pdf/segment-final/doc-final.pdf",
      dokumentTitel: `BFG 01.01.2099, ${gz}`,
      titel: "Verifizierte Entscheidung",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));
    upstream.openStream = vi.fn().mockResolvedValue(new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(new TextEncoder().encode([
          `data: ${JSON.stringify({ response_type: "answer", content: `Siehe ${gz}.`, done: true })}\n\n`,
          'data: {"response_type":"references","data":{"event_id":"sources-final","references":[{"document_name":"EStG.md","chunk_id":"chunk-final","kb_id":"kb-final"}]}}',
        ].join("")));
        ctrl.close();
      },
    }));

    const { events } = await collectEvents(
      executeFredTurn(baseRequest(), upstream, persistence, config),
    );
    const researchStepIds = events.flatMap((event) =>
      event.type === "research" ? [event.step.id] : []
    );

    expect(researchStepIds.filter((id) => id === "sources-final")).toHaveLength(1);
    expect(researchStepIds.filter((id) => id === `findok:${gz}`)).toHaveLength(1);
  });

  it("continues an owned stored WeKnora session", async () => {
    persistence.loadConversation = vi.fn().mockResolvedValue(storedConvRow());

    const gen = executeFredTurn(
      baseRequest({ conversationId }),
      upstream,
      persistence,
      config,
    );
    const { events } = await collectEvents(gen);

    expect(events.at(-1)).toMatchObject({ type: "final" });
    expect(persistence.loadConversation).toHaveBeenCalledWith({
      clientId: userId,
      conversationId,
    });
    expect(upstream.deriveSessionSignature).toHaveBeenCalledWith({
      channelId,
      publishToken: "em_publish_token_fixture_123456",
      sessionId: "session-existing",
    });
    expect(upstream.createSession).not.toHaveBeenCalled();
  });

  it("throws when conversation is not found", async () => {
    persistence.loadConversation = vi.fn().mockResolvedValue(null);

    const gen = executeFredTurn(
      baseRequest({ conversationId }),
      upstream,
      persistence,
      config,
    );
    await expect(collectEvents(gen)).rejects.toThrow("nicht gefunden");
  });

  it("throws on agent key mismatch with stored conversation", async () => {
    persistence.loadConversation = vi.fn().mockResolvedValue(
      storedConvRow({ agent_key: "quickfred" }),
    );

    const gen = executeFredTurn(
      baseRequest({ conversationId, agentKey: "fred" }),
      upstream,
      persistence,
      config,
    );
    await expect(collectEvents(gen)).rejects.toThrow("bereits festgelegt");
  });

  it("uses QuickFred config when agentKey is quickfred", async () => {
    config.readQuickFredConfig = vi.fn().mockReturnValue({
      channelId: "qf-channel",
      publishToken: "em_qf_token_1234567890abcdef",
      exchangeOrigin: "https://findog.at",
      expectedAgentId: "agent-qf",
    });
    upstream.fetchUpstreamConfig = vi.fn().mockResolvedValue({
      agentId: "agent-qf",
      knowledgeBaseIds: [],
      allowWebSearch: false,
      allowFileUpload: false,
      allowImageUpload: false,
    });

    const gen = executeFredTurn(
      baseRequest({ agentKey: "quickfred" }),
      upstream,
      persistence,
      config,
    );
    const { events } = await collectEvents(gen);

    expect(events.at(-1)).toMatchObject({ type: "final" });
    expect(config.readQuickFredConfig).toHaveBeenCalled();
    expect(upstream.mintSession).toHaveBeenCalledWith(expect.objectContaining({
      channelId: "qf-channel",
    }));
  });

  it("throws on empty answer from upstream", async () => {
    upstream.openStream = vi.fn().mockImplementation(async () => {
      return new ReadableStream<Uint8Array>({
        start(ctrl) {
          ctrl.enqueue(new TextEncoder().encode(
            'data: {"response_type":"complete","data":{}}\n\n',
          ));
          ctrl.close();
        },
      });
    });

    const gen = executeFredTurn(baseRequest(), upstream, persistence, config);
    await expect(collectEvents(gen)).rejects.toThrow("keine Antwort");
  });

  it("throws on unsupported upstream events", async () => {
    upstream.openStream = vi.fn().mockImplementation(async () => {
      return new ReadableStream<Uint8Array>({
        start(ctrl) {
          ctrl.enqueue(new TextEncoder().encode(
            'data: {"response_type":"tool_approval_required","data":{"tool_call_id":"a-1","tool_name":"danger"}}\n\n',
          ));
          ctrl.close();
        },
      });
    });

    const gen = executeFredTurn(baseRequest(), upstream, persistence, config);
    await expect(collectEvents(gen)).rejects.toThrow("Bestätigung");
  });

  it("relays webhook events for message_sent and message_received", async () => {
    const gen = executeFredTurn(baseRequest(), upstream, persistence, config);
    await collectEvents(gen);

    expect(upstream.relayEvent).toHaveBeenCalledTimes(2);
    expect(upstream.relayEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: "message_sent",
      content: "Wie ist die Rechtslage?",
    }));
    expect(upstream.relayEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: "message_received",
    }));
  });

  it("uses the caller-provided assistant event id", async () => {
    const assistantEventId = "22222222-2222-4222-8222-222222222222";
    const gen = executeFredTurn(
      baseRequest({ assistantEventId }),
      upstream,
      persistence,
      config,
    );
    await collectEvents(gen);

    expect(persistence.recordEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      eventId: assistantEventId,
      eventType: "message_received",
    }));
  });

  it("stops upstream and skips assistant persistence when aborted", async () => {
    const abortController = new AbortController();
    upstream.openStream = vi.fn().mockResolvedValue(new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(new TextEncoder().encode(
          'data: {"response_type":"agent_query","assistant_message_id":"answer-stop"}\n\n',
        ));
      },
    }));

    const gen = executeFredTurn(
      baseRequest({ signal: abortController.signal }),
      upstream,
      persistence,
      config,
    );
    const first = await gen.next();
    expect(first.value).toMatchObject({ type: "conversation" });

    const pending = gen.next();
    await vi.waitFor(() => expect(upstream.openStream).toHaveBeenCalled());
    abortController.abort();
    const stopped = await pending;

    expect(stopped.done).toBe(true);
    expect(stopped.value).toMatchObject({ stopped: true, answer: "" });
    expect(upstream.stopSession).toHaveBeenCalledWith(expect.objectContaining({
      messageId: "answer-stop",
    }));
    expect(persistence.recordEvent).toHaveBeenCalledTimes(1);
  });
});

describe("upstreamQuery", () => {
  it("passes upstreamQuery to openStream when provided, but persists query unchanged", async () => {
    const upstream = makeUpstreamDeps();
    const persistence = makePersistenceDeps();
    const config = makeConfigDeps();

    const gen = executeFredTurn(
      baseRequest({
        query: "Originale Frage",
        upstreamQuery: "Erweiterte Frage mit Anhangsinhalt",
      }),
      upstream,
      persistence,
      config,
    );
    await collectEvents(gen);

    // openStream should receive upstreamQuery
    expect(upstream.openStream).toHaveBeenCalledWith(
      expect.objectContaining({ query: "Erweiterte Frage mit Anhangsinhalt" }),
    );

    // recordEvent (message_sent) should receive the original query
    expect(persistence.recordEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      content: "Originale Frage",
      eventType: "message_sent",
    }));

    // relayEvent (message_sent) should receive the original query
    expect(upstream.relayEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      content: "Originale Frage",
    }));

    // recordAdminRequest should receive the original query
    expect(persistence.recordAdminRequest).toHaveBeenCalledWith(expect.objectContaining({
      content: "Originale Frage",
    }));
  });

  it("falls back to query when upstreamQuery is absent", async () => {
    const upstream = makeUpstreamDeps();
    const persistence = makePersistenceDeps();
    const config = makeConfigDeps();

    const gen = executeFredTurn(
      baseRequest({ query: "Nur eine Frage" }),
      upstream,
      persistence,
      config,
    );
    await collectEvents(gen);

    expect(upstream.openStream).toHaveBeenCalledWith(
      expect.objectContaining({ query: "Nur eine Frage" }),
    );
  });
});
