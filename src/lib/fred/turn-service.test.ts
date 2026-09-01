import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EOF_WITHOUT_FINAL_CLIENT_MESSAGE } from "./run-diagnostics";
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

  it("advances the durable request receipt with exact persisted message IDs", async () => {
    const onRequestTransition = vi.fn().mockResolvedValue(undefined);
    persistence = makePersistenceDeps({
      recordEvent: vi.fn()
        .mockResolvedValueOnce({ conversation: summaryConv(), messageId: 41 })
        .mockResolvedValueOnce({
          conversation: summaryConv({ updatedAt: "2026-07-19T10:00:02.000Z" }),
          messageId: 42,
        }),
    });

    await collectEvents(executeFredTurn(baseRequest({
      requestId: "77777777-7777-4777-8777-777777777777",
      userEventId: "88888888-8888-4888-8888-888888888888",
      assistantEventId: "99999999-9999-4999-8999-999999999999",
      onRequestTransition,
    }), upstream, persistence, config));

    expect(onRequestTransition.mock.calls).toEqual([
      [{ status: "user_persisted", conversationId, userMessageId: 41 }],
      [{ status: "generating" }],
      [{ status: "completed", assistantMessageId: 42 }],
    ]);
    expect(persistence.recordAdminRequest).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "77777777-7777-4777-8777-777777777777",
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
          'data: {"response_type":"references","data":{"event_id":"sources-final","references":[{"document_name":"EStG.md","chunk_id":"chunk-final","kb_id":"kb-final"}]}}\n\n',
          'data: {"response_type":"complete","data":{}}',
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

  it("rejects EOF after a plausible answer when no completion event arrived", async () => {
    const onRequestTransition = vi.fn().mockResolvedValue(undefined);
    persistence = makePersistenceDeps({
      recordEvent: vi.fn().mockResolvedValueOnce({
        conversation: summaryConv(),
        messageId: 41,
      }),
    });
    upstream.openStream = vi.fn().mockResolvedValue(new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(new TextEncoder().encode([
          'data: {"response_type":"agent_query","assistant_message_id":"answer-truncated"}\n\n',
          'data: {"response_type":"answer","content":"Nur ein Präfix","done":true}\n\n',
        ].join("")));
        ctrl.close();
      },
    }));

    const gen = executeFredTurn(
      baseRequest({ onRequestTransition }),
      upstream,
      persistence,
      config,
    );

    expect(await gen.next()).toMatchObject({
      done: false,
      value: { type: "conversation" },
    });
    expect(await gen.next()).toEqual({
      done: false,
      value: { type: "delta", content: "Nur ein Präfix" },
    });
    expect(await gen.next()).toEqual({
      done: false,
      value: { type: "error", error: EOF_WITHOUT_FINAL_CLIENT_MESSAGE },
    });
    await expect(gen.next()).rejects.toThrow(EOF_WITHOUT_FINAL_CLIENT_MESSAGE);

    expect(persistence.recordEvent).toHaveBeenCalledTimes(1);
    expect(onRequestTransition.mock.calls).toEqual([
      [{ status: "user_persisted", conversationId, userMessageId: 41 }],
      [{ status: "generating" }],
      [{ status: "failed", failurePhase: "streaming", errorCode: "turn_failed" }],
    ]);
    expect(upstream.relayEvent).toHaveBeenCalledTimes(1);
    expect(upstream.stopSession).toHaveBeenCalledWith(expect.objectContaining({
      messageId: "answer-truncated",
    }));
  });

  it("accepts a completion event in the final unterminated SSE frame", async () => {
    upstream.openStream = vi.fn().mockResolvedValue(new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(new TextEncoder().encode([
          'data: {"response_type":"answer","content":"Vollständig","done":true}\n\n',
          'data: {"response_type":"complete","data":{}}',
        ].join("")));
        ctrl.close();
      },
    }));

    const { events, result } = await collectEvents(
      executeFredTurn(baseRequest(), upstream, persistence, config),
    );

    expect(result).toMatchObject({ answer: "Vollständig", stopped: false });
    expect(events.at(-1)).toMatchObject({ type: "final", answer: "Vollständig" });
    expect(persistence.recordEvent).toHaveBeenCalledTimes(2);
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

describe("researchDisplayMode", () => {
  it("simple mode emits no execution events and persists empty execution trace", async () => {
    const upstream = makeUpstreamDeps({
      openStream: vi.fn().mockImplementation(async () => {
        return new ReadableStream<Uint8Array>({
          start(ctrl) {
            const frames = [
              'data: {"response_type":"agent_query","assistant_message_id":"answer-1"}\n\n',
              'data: {"response_type":"thinking","data":{"event_id":"t1","content":"secret"}}\n\n',
              'data: {"response_type":"tool_call","data":{"tool_call_id":"c1","tool_name":"knowledge_search"}}\n\n',
              'data: {"response_type":"answer","content":"Hallo","done":true}\n\n',
              'data: {"response_type":"complete","data":{}}\n\n',
            ];
            ctrl.enqueue(new TextEncoder().encode(frames.join("")));
            ctrl.close();
          },
        });
      }),
    });
    const persistence = makePersistenceDeps();
    const config = makeConfigDeps();

    const gen = executeFredTurn(
      baseRequest({
        query: "Frage",
        researchDisplayMode: "simple",
      }),
      upstream,
      persistence,
      config,
    );
    const { events } = await collectEvents(gen);

    const execEvents = events.filter((e) => e.type === "execution");
    expect(execEvents).toHaveLength(0);

    const researchEvents = events.filter((e) => e.type === "research");
    expect(researchEvents.length).toBeGreaterThan(0);

    expect(persistence.recordEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      eventType: "message_received",
      executionTrace: [],
    }));
  });

  it("advanced mode emits typed sanitized execution events and persists execution trace", async () => {
    const upstream = makeUpstreamDeps({
      openStream: vi.fn().mockImplementation(async () => {
        return new ReadableStream<Uint8Array>({
          start(ctrl) {
            const frames = [
              'data: {"response_type":"agent_query","assistant_message_id":"answer-1"}\n\n',
              'data: {"response_type":"thinking","data":{"event_id":"t1","content":"secret reasoning"}}\n\n',
              'data: {"response_type":"tool_call","data":{"tool_call_id":"c1","tool_name":"todo_write","arguments":{"todos":[{"id":"1","task":"Task A","status":"in_progress"}]}}}\n\n',
              'data: {"response_type":"answer","content":"Ergebnis","done":true}\n\n',
              'data: {"response_type":"complete","data":{}}\n\n',
            ];
            ctrl.enqueue(new TextEncoder().encode(frames.join("")));
            ctrl.close();
          },
        });
      }),
    });
    const persistence = makePersistenceDeps();
    const config = makeConfigDeps();

    const gen = executeFredTurn(
      baseRequest({
        query: "Frage",
        researchDisplayMode: "advanced",
      }),
      upstream,
      persistence,
      config,
    );
    const { events } = await collectEvents(gen);

    const execEvents = events.filter((e) => e.type === "execution");
    expect(execEvents.length).toBeGreaterThanOrEqual(3);
    expect(execEvents[0]).toMatchObject({
      type: "execution",
      step: {
        kind: "analysis",
        label: "Anfrage an Fred übermittelt",
        status: "completed",
      },
    });
    expect(execEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "execution",
          step: expect.objectContaining({
            id: expect.stringMatching(/^analysis:[a-z0-9]+$/u),
            kind: "analysis",
            label: "Anfrage wird analysiert",
          }),
        }),
        expect.objectContaining({
          type: "execution",
          step: expect.objectContaining({
            id: expect.stringMatching(/^planning:[a-z0-9]+$/u),
            kind: "planning",
            label: "Rechercheplan wird aktualisiert",
          }),
        }),
      ]),
    );

    const finalEvent = events.find((e) => e.type === "final");
    expect(finalEvent).toMatchObject({
      type: "final",
      executionTrace: expect.arrayContaining([
        expect.objectContaining({ id: expect.stringMatching(/^analysis:/u), kind: "analysis" }),
        expect.objectContaining({ id: expect.stringMatching(/^planning:/u), kind: "planning" }),
      ]),
    });

    expect(persistence.recordEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      eventType: "message_received",
      executionTrace: expect.arrayContaining([
        expect.objectContaining({ id: expect.stringMatching(/^analysis:/u), kind: "analysis" }),
      ]),
    }));
  });

  it("extracts direct native tool results into sourceReferences and persists them in final event and storage", async () => {
    const upstream = makeUpstreamDeps({
      openStream: vi.fn().mockImplementation(async () => {
        return new ReadableStream<Uint8Array>({
          start(ctrl) {
            const frames = [
              'data: {"response_type":"agent_query","assistant_message_id":"answer-1"}\n\n',
              'data: {"response_type":"tool_result","data":{"tool_call_id":"web-1","tool_name":"web_search","results":[{"url":"https://www.bmf.gv.at/tax","title":"BMF Tax"}]}}\n\n',
              'data: {"response_type":"tool_result","data":{"tool_call_id":"kb-1","tool_name":"search_knowledge","results":[{"knowledge_title":"EStG 2025","chunk_id":"chk-1","knowledge_base_id":"kb-at"}]}}\n\n',
              'data: {"response_type":"answer","content":"Hier ist die Antwort.","done":true}\n\n',
              'data: {"response_type":"complete","data":{}}\n\n',
            ];
            ctrl.enqueue(new TextEncoder().encode(frames.join("")));
            ctrl.close();
          },
        });
      }),
    });
    const persistence = makePersistenceDeps();
    const config = makeConfigDeps();

    const gen = executeFredTurn(
      baseRequest({
        query: "Frage zu Steuern",
        researchDisplayMode: "advanced",
      }),
      upstream,
      persistence,
      config,
    );
    const { events } = await collectEvents(gen);

    const finalEvent = events.find((e) => e.type === "final");
    expect(finalEvent).toMatchObject({
      type: "final",
      sourceReferences: [
        { kind: "web", url: "https://www.bmf.gv.at/tax", title: "BMF Tax" },
        { kind: "knowledge", doc: "EStG 2025", chunkId: "chk-1", knowledgeBaseId: "kb-at" },
      ],
    });

    expect(persistence.recordEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      eventType: "message_received",
      sourceReferences: [
        { kind: "web", url: "https://www.bmf.gv.at/tax", title: "BMF Tax" },
        { kind: "knowledge", doc: "EStG 2025", chunkId: "chk-1", knowledgeBaseId: "kb-at" },
      ],
    }));
  });

  it("yields NO direct-result sourceReferences in simple/default mode for the same native direct-result stream", async () => {
    const upstream = makeUpstreamDeps({
      openStream: vi.fn().mockImplementation(async () => {
        return new ReadableStream<Uint8Array>({
          start(ctrl) {
            const frames = [
              'data: {"response_type":"agent_query","assistant_message_id":"answer-1"}\n\n',
              'data: {"response_type":"tool_result","data":{"tool_call_id":"web-1","tool_name":"web_search","results":[{"url":"https://www.bmf.gv.at/tax","title":"BMF Tax"}]}}\n\n',
              'data: {"response_type":"tool_result","data":{"tool_call_id":"kb-1","tool_name":"search_knowledge","results":[{"knowledge_title":"EStG 2025","chunk_id":"chk-1","knowledge_base_id":"kb-at"}]}}\n\n',
              'data: {"response_type":"answer","content":"Hier ist die einfache Antwort.","done":true}\n\n',
              'data: {"response_type":"complete","data":{}}\n\n',
            ];
            ctrl.enqueue(new TextEncoder().encode(frames.join("")));
            ctrl.close();
          },
        });
      }),
    });
    const persistence = makePersistenceDeps();
    const config = makeConfigDeps();

    const gen = executeFredTurn(
      baseRequest({
        query: "Einfache Frage",
        researchDisplayMode: "simple",
      }),
      upstream,
      persistence,
      config,
    );
    const { events } = await collectEvents(gen);

    const finalEvent = events.find((e) => e.type === "final");
    expect(finalEvent).toMatchObject({
      type: "final",
      sourceReferences: [],
    });

    expect(persistence.recordEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      eventType: "message_received",
      sourceReferences: [],
    }));
  });

  it("keeps explicit references available in simple mode", async () => {
    const upstream = makeUpstreamDeps({
      openStream: vi.fn().mockImplementation(async () => {
        return new ReadableStream<Uint8Array>({
          start(ctrl) {
            const frames = [
              'data: {"response_type":"agent_query","assistant_message_id":"answer-1"}\n\n',
              'data: {"response_type":"references","data":{"references":[{"document_name":"EStG.md","chunk_id":"chk-1","kb_id":"kb-1"}]}}\n\n',
              'data: {"response_type":"answer","content":"Antwort mit Quellen.","done":true}\n\n',
              'data: {"response_type":"complete","data":{}}\n\n',
            ];
            ctrl.enqueue(new TextEncoder().encode(frames.join("")));
            ctrl.close();
          },
        });
      }),
    });
    const persistence = makePersistenceDeps();
    const config = makeConfigDeps();

    const gen = executeFredTurn(
      baseRequest({
        query: "Frage mit expliziten Quellen",
        researchDisplayMode: "simple",
      }),
      upstream,
      persistence,
      config,
    );
    const { events } = await collectEvents(gen);

    const finalEvent = events.find((e) => e.type === "final");
    expect(finalEvent).toMatchObject({
      type: "final",
      sourceReferences: [
        { kind: "knowledge", doc: "EStG.md", chunkId: "chk-1", knowledgeBaseId: "kb-1" },
      ],
    });

    expect(persistence.recordEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      eventType: "message_received",
      sourceReferences: [
        { kind: "knowledge", doc: "EStG.md", chunkId: "chk-1", knowledgeBaseId: "kb-1" },
      ],
    }));
  });

  it("Telegram/default path remains final-only and does not gain direct-result metadata", async () => {
    const upstream = makeUpstreamDeps({
      openStream: vi.fn().mockImplementation(async () => {
        return new ReadableStream<Uint8Array>({
          start(ctrl) {
            const frames = [
              'data: {"response_type":"agent_query","assistant_message_id":"answer-1"}\n\n',
              'data: {"response_type":"tool_result","data":{"tool_call_id":"web-1","tool_name":"web_search","results":[{"url":"https://www.bmf.gv.at/tax","title":"BMF Tax"}]}}\n\n',
              'data: {"response_type":"answer","content":"Telegram Antwort.","done":true}\n\n',
              'data: {"response_type":"complete","data":{}}\n\n',
            ];
            ctrl.enqueue(new TextEncoder().encode(frames.join("")));
            ctrl.close();
          },
        });
      }),
    });
    const persistence = makePersistenceDeps();
    const config = makeConfigDeps();

    const gen = executeFredTurn(
      baseRequest({
        query: "Telegram Anfrage",
        origin: "telegram",
        telegramIntegrationId: "tele-1",
        // researchDisplayMode is omitted in Telegram requests
      }),
      upstream,
      persistence,
      config,
    );
    const { events, result } = await collectEvents(gen);

    expect(result.answer).toBe("Telegram Antwort.");
    const finalEvent = events.find((e) => e.type === "final");
    expect(finalEvent).toMatchObject({
      type: "final",
      answer: "Telegram Antwort.",
      sourceReferences: [],
    });

    expect(persistence.recordEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      eventType: "message_received",
      sourceReferences: [],
    }));
  });
});
