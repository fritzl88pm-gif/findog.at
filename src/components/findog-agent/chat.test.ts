// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import FindogAgentChat from "./chat";
import { createHost, jsonResponse, type TestHost } from "./ui-test-helpers";

const RUN_ID = "22222222-2222-4222-8222-222222222222";
const OLD_RUN_ID = "33333333-3333-4333-8333-333333333333";
const CONVERSATION_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION = {
  id: CONVERSATION_ID,
  title: "Steuerfrage",
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:05:00.000Z",
};
const USER_MESSAGE = {
  id: "m1",
  role: "user" as const,
  content: "Wie hoch ist die Steuer?",
  runId: RUN_ID,
  isPartial: false,
  createdAt: "2026-09-01T10:00:00.000Z",
};
const ASSISTANT_MESSAGE = {
  id: "m2",
  role: "assistant" as const,
  content: "Die Steuer beträgt 10 % [src_1].",
  runId: RUN_ID,
  isPartial: false,
  createdAt: "2026-09-01T10:05:00.000Z",
};
const SOURCE = {
  id: "src_1",
  kind: "knowledge" as const,
  provider: "weknora",
  title: "Merkblatt Steuer",
  text: "Der Satz beträgt 10 Prozent.",
  truncated: false,
  url: "https://example.test/merkblatt",
  retrievedAt: "2026-09-01T10:04:00.000Z",
  provenance: { knowledgeBaseId: "kb-1", chunkId: "chunk-7" },
};
const FINISHED_RUN = {
  id: RUN_ID,
  conversationId: CONVERSATION_ID,
  state: "succeeded" as const,
  cancelRequested: false,
  attemptCount: 1,
  settingsRevision: 3,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:05:00.000Z",
  startedAt: "2026-09-01T10:00:01.000Z",
  finishedAt: "2026-09-01T10:05:00.000Z",
  result: {
    answer: ASSISTANT_MESSAGE.content,
    citations: { citedSourceIds: ["src_1"], unknownSourceIds: [] },
    sources: [SOURCE],
    plan: { steps: ["Wissensdatenbank durchsuchen"], notes: null },
    notices: [],
    context: { truncated: false, droppedHistoryMessages: 0, estimatedInputTokens: 900, contextTokens: 128000 },
    webResearchPerformed: false,
    trace: [],
  },
  error: null,
  usage: {
    modelCalls: 2,
    promptTokens: 1000,
    completionTokens: 200,
    toolCalls: 1,
    knowledgeRetrievals: 1,
    webRetrievals: 0,
    mcpCalls: 0,
  },
  cost: {
    limitUsd: null,
    limitStatus: "not_configured",
    totalEstimatedUsd: 0.0123,
    coverage: { model: "estimated", web: "unused", knowledge: "uncovered", mcp: "unused" },
  },
};

type Call = { url: string; method: string; body: Record<string, unknown> | null };

let view: TestHost;
let calls: Call[];
const fetchMock = vi.fn();

function handlerFor(routes: (url: string, call: Call) => Response | null) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const call: Call = {
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null,
    };
    calls.push(call);
    const response = routes(url, call);
    if (!response) {
      throw new Error(`Unerwartete Anfrage: ${call.method} ${url}`);
    }
    return response;
  });
}

function conversationView(body: Record<string, unknown>) {
  return jsonResponse({
    conversation: CONVERSATION,
    messages: [],
    messagesTruncated: false,
    limit: 50,
    activeRun: null,
    ...body,
  });
}

async function renderChat() {
  await view.render(createElement(FindogAgentChat, { accessToken: "fixture-token" }));
}

function citationButton(sourceId: string): HTMLButtonElement {
  const found = [...view.host.querySelectorAll("button")].find((node) => node.textContent?.trim() === sourceId);
  if (!found) {
    throw new Error(`Beleg-Schaltfläche nicht gefunden: ${sourceId}`);
  }
  return found as HTMLButtonElement;
}

function historyButton(title: string): HTMLButtonElement {
  const found = [...view.host.querySelectorAll("button")].find(
    (node) => node.querySelector("strong")?.textContent === title,
  );
  if (!found) {
    throw new Error(`Verlaufs-Schaltfläche nicht gefunden: ${title}`);
  }
  return found as HTMLButtonElement;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock.mockReset());
  calls = [];
  view = createHost();
  sessionStorage.clear();
});

afterEach(async () => {
  await view.unmount();
  vi.unstubAllGlobals();
});

const HISTORY_URL = "/api/admin/findog-agent/conversations?limit=20";
const conversationUrl = (id: string) => `/api/admin/findog-agent/conversations/${id}?limit=50`;
const runUrl = (id: string) => `/api/admin/findog-agent/runs/${id}`;
const eventsUrl = (id: string) => `/api/admin/findog-agent/runs/${id}/events`;

describe("Findog Agent chat", () => {
  it("loads history and canonical messages, recovers the answer's own run and shows cited excerpts", async () => {
    handlerFor((url, call) => {
      if (url === HISTORY_URL) {
        return jsonResponse({ conversations: [CONVERSATION], limit: 20, hasMore: false });
      }
      if (url === conversationUrl(CONVERSATION_ID)) {
        return conversationView({ messages: [USER_MESSAGE, ASSISTANT_MESSAGE] });
      }
      if (url === runUrl(RUN_ID) && call.method === "GET") {
        return jsonResponse({ run: FINISHED_RUN });
      }
      return null;
    });
    await renderChat();
    expect(view.host.textContent).toContain("Die Steuer beträgt 10 %");
    expect(view.host.textContent).toContain("Merkblatt Steuer");
    expect(view.host.textContent).toContain("Eingabe-Tokens");
    expect(calls.every((call) => call.method === "GET")).toBe(true);

    await view.click(citationButton("src_1"));
    expect(view.host.querySelector("pre")?.textContent).toBe("Der Satz beträgt 10 Prozent.");
    expect(view.host.textContent).toContain("kb-1");
    expect(view.host.querySelector('a[href="https://example.test/merkblatt"]')).not.toBeNull();
  });

  it("sends one question per submission and reuses the idempotency key on retry", async () => {
    const keys: string[] = [];
    let posts = 0;
    handlerFor((url, call) => {
      if (url === HISTORY_URL) {
        return jsonResponse({ conversations: [], limit: 20, hasMore: false });
      }
      if (url === "/api/admin/findog-agent/runs" && call.method === "POST") {
        posts += 1;
        keys.push(String(call.body?.idempotencyKey));
        return posts === 1
          ? jsonResponse({ error: "Der Speicher ist nicht erreichbar." }, 503)
          : jsonResponse({ run: { ...FINISHED_RUN, state: "queued", result: null } }, 202);
      }
      if (url.startsWith("/api/admin/findog-agent/conversations/")) {
        return conversationView({ messages: [USER_MESSAGE] });
      }
      if (url.startsWith(eventsUrl(RUN_ID))) {
        return jsonResponse({ events: [], afterSequence: 0, limit: 200, hasMore: false });
      }
      if (url === runUrl(RUN_ID)) {
        return jsonResponse({ run: { ...FINISHED_RUN, state: "queued", result: null } });
      }
      return null;
    });
    await renderChat();
    await view.type("#findog-agent-question", "Wie hoch ist die Steuer?");
    await view.click(view.button("Frage senden"));
    expect(view.host.textContent).toContain("Der Speicher ist nicht erreichbar.");
    expect((view.host.querySelector("#findog-agent-question") as HTMLTextAreaElement).value)
      .toBe("Wie hoch ist die Steuer?");
    await view.click(view.button("Frage senden"));
    expect(posts).toBe(2);
    expect(keys[0]).toBe(keys[1]);
    expect(view.host.textContent).toContain("Wie hoch ist die Steuer?");
    const enqueues = calls.filter((call) => call.method === "POST");
    expect(enqueues).toHaveLength(2);
    expect(enqueues[0]?.body?.conversationTitle).toBe("Wie hoch ist die Steuer?");
  });

  it("stops a running run, keeps the question and discards any unfinished draft", async () => {
    handlerFor((url, call) => {
      if (url === HISTORY_URL) {
        return jsonResponse({ conversations: [CONVERSATION], limit: 20, hasMore: false });
      }
      if (url === `${runUrl(RUN_ID)}/stop` && call.method === "POST") {
        return jsonResponse({ run: { ...FINISHED_RUN, state: "cancelled", result: null } });
      }
      if (url === conversationUrl(CONVERSATION_ID)) {
        return conversationView({
          messages: [USER_MESSAGE],
          activeRun: { ...FINISHED_RUN, state: "running", result: null, finishedAt: null },
        });
      }
      if (url.startsWith(eventsUrl(RUN_ID))) {
        return jsonResponse({ events: [], afterSequence: 0, limit: 200, hasMore: false });
      }
      if (url === runUrl(RUN_ID)) {
        return jsonResponse({ run: { ...FINISHED_RUN, state: "running", result: null, finishedAt: null } });
      }
      return null;
    });
    await renderChat();
    expect(view.host.textContent).toContain("Recherche läuft");
    await view.click(view.button("Stopp"));
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    expect(view.host.textContent).toContain("Wie hoch ist die Steuer?");
    expect(view.host.textContent).not.toContain("Die Steuer beträgt 10 %");
    await view.unmount();
    // Unmounting only aborts polling; it must never issue a Stop.
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("reconnects to an active run on remount without posting another question", async () => {
    handlerFor((url) => {
      if (url === HISTORY_URL) {
        return jsonResponse({ conversations: [CONVERSATION], limit: 20, hasMore: false });
      }
      if (url === conversationUrl(CONVERSATION_ID)) {
        return conversationView({
          messages: [USER_MESSAGE],
          activeRun: { ...FINISHED_RUN, state: "running", result: null, finishedAt: null },
        });
      }
      if (url.startsWith(eventsUrl(RUN_ID))) {
        return jsonResponse({
          events: [{ sequence: 1, kind: "plan", payload: { steps: ["Schritt A"] }, createdAt: "2026-09-01T10:01:00.000Z" }],
          afterSequence: 0,
          limit: 200,
          hasMore: false,
        });
      }
      if (url === runUrl(RUN_ID)) {
        return jsonResponse({ run: { ...FINISHED_RUN, state: "running", result: null, finishedAt: null } });
      }
      return null;
    });
    await renderChat();
    expect(view.host.textContent).toContain("Schritt A");
    await view.unmount();

    view = createHost();
    await renderChat();
    expect(view.host.textContent).toContain("Schritt A");
    expect(calls.every((call) => call.method === "GET")).toBe(true);
    expect(calls.filter((call) => call.url.includes("/events"))[0]?.url).toContain("afterSequence=0");
  });

  it("resumes polling from the last event sequence and only publishes the finalized answer", async () => {
    let statusReads = 0;
    handlerFor((url) => {
      if (url === HISTORY_URL) {
        return jsonResponse({ conversations: [CONVERSATION], limit: 20, hasMore: false });
      }
      if (url === conversationUrl(CONVERSATION_ID)) {
        return statusReads > 1
          ? conversationView({ messages: [USER_MESSAGE, ASSISTANT_MESSAGE] })
          : conversationView({
            messages: [USER_MESSAGE],
            activeRun: { ...FINISHED_RUN, state: "running", result: null, finishedAt: null },
          });
      }
      if (url.startsWith(eventsUrl(RUN_ID))) {
        const after = Number(new URL(url, "https://fixture.test").searchParams.get("afterSequence"));
        return after === 0
          ? jsonResponse({
            events: [
              { sequence: 1, kind: "status", payload: { phase: "model" }, createdAt: "2026-09-01T10:00:30.000Z" },
              { sequence: 2, kind: "tool_call", payload: { step: 1, tool: "knowledge_search" }, createdAt: "2026-09-01T10:00:40.000Z" },
              { sequence: 3, kind: "source", payload: { id: "src_1", title: "Merkblatt Steuer" }, createdAt: "2026-09-01T10:00:41.000Z" },
            ],
            afterSequence: 0,
            limit: 200,
            hasMore: false,
          })
          : jsonResponse({ events: [], afterSequence: after, limit: 200, hasMore: false });
      }
      if (url === runUrl(RUN_ID)) {
        statusReads += 1;
        return statusReads > 1
          ? jsonResponse({ run: FINISHED_RUN })
          : jsonResponse({ run: { ...FINISHED_RUN, state: "running", result: null, finishedAt: null } });
      }
      return null;
    });
    await renderChat();
    // The running answer is represented only by live activity, never by a draft.
    expect(view.host.textContent).toContain("knowledge_search");
    expect(view.host.textContent).not.toContain("Die Steuer beträgt 10 %");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1700));
    });
    expect(view.host.textContent).toContain("Die Steuer beträgt 10 %");
    expect(calls.filter((call) => call.url.includes("afterSequence=3")).length).toBeGreaterThan(0);
  });

  it("resolves a historical citation through its own run instead of the current one", async () => {
    const oldMessage = {
      ...ASSISTANT_MESSAGE,
      id: "m0",
      runId: OLD_RUN_ID,
      content: "Alte Antwort [src_1].",
      createdAt: "2026-08-01T10:00:00.000Z",
    };
    handlerFor((url) => {
      if (url === HISTORY_URL) {
        return jsonResponse({ conversations: [CONVERSATION], limit: 20, hasMore: false });
      }
      if (url === conversationUrl(CONVERSATION_ID)) {
        return conversationView({ messages: [oldMessage, USER_MESSAGE, ASSISTANT_MESSAGE] });
      }
      if (url === runUrl(RUN_ID)) {
        return jsonResponse({ run: FINISHED_RUN });
      }
      if (url === runUrl(OLD_RUN_ID)) {
        return jsonResponse({
          run: {
            ...FINISHED_RUN,
            id: OLD_RUN_ID,
            result: {
              ...FINISHED_RUN.result,
              sources: [{ ...SOURCE, title: "Altes Merkblatt", text: "Alter Belegtext." }],
            },
          },
        });
      }
      return null;
    });
    await renderChat();
    expect(calls.some((call) => call.url === runUrl(RUN_ID))).toBe(true);
    await view.click(citationButton("src_1"));
    expect(calls.some((call) => call.url === runUrl(OLD_RUN_ID))).toBe(true);
    expect(view.host.querySelector("pre")?.textContent).toBe("Alter Belegtext.");
  });

  it("clears the feature state when the API denies access", async () => {
    handlerFor((url) => {
      if (url === HISTORY_URL) {
        return jsonResponse({ conversations: [CONVERSATION], limit: 20, hasMore: false });
      }
      if (url === conversationUrl(CONVERSATION_ID)) {
        return jsonResponse({ error: "Du hast keine Administrationsberechtigung." }, 403);
      }
      return null;
    });
    await renderChat();
    expect(view.host.textContent).toContain("Administrationsberechtigung");
    expect(view.host.textContent).not.toContain("Steuerfrage");
    expect(view.host.querySelector("textarea")).toBeNull();
  });

  it("reports truncated history and message windows instead of claiming completeness", async () => {
    handlerFor((url) => {
      if (url === HISTORY_URL) {
        return jsonResponse({ conversations: [CONVERSATION], limit: 20, hasMore: true });
      }
      if (url === conversationUrl(CONVERSATION_ID)) {
        return conversationView({ messages: [USER_MESSAGE], messagesTruncated: true });
      }
      return null;
    });
    await renderChat();
    expect(view.host.textContent).toContain("nur die letzten 20 Unterhaltungen");
    expect(view.host.textContent).toContain("nur die letzten 50 Nachrichten");
  });

  it("keeps the whole submission identity across an uncertain enqueue and adopts the returned run", async () => {
    const posts: Call[] = [];
    let acceptedConversationId: string | null = null;
    const runningRun = (conversationId: string) => ({
      ...FINISHED_RUN,
      conversationId,
      state: "running" as const,
      result: null,
      finishedAt: null,
    });
    handlerFor((url, call) => {
      if (url === HISTORY_URL) {
        return jsonResponse({ conversations: [], limit: 20, hasMore: false });
      }
      if (url === "/api/admin/findog-agent/runs" && call.method === "POST") {
        posts.push(call);
        const body = call.body as { conversationId: string };
        if (!acceptedConversationId) {
          // The server committed the run but the response never arrived.
          acceptedConversationId = body.conversationId;
          throw new TypeError("Failed to fetch");
        }
        return jsonResponse({ run: runningRun(acceptedConversationId) });
      }
      if (acceptedConversationId && url === conversationUrl(acceptedConversationId)) {
        return conversationView({
          conversation: { ...CONVERSATION, id: acceptedConversationId },
          messages: [USER_MESSAGE],
          activeRun: runningRun(acceptedConversationId),
        });
      }
      if (url.startsWith(eventsUrl(RUN_ID))) {
        return jsonResponse({ events: [], afterSequence: 0, limit: 200, hasMore: false });
      }
      if (url === runUrl(RUN_ID) && acceptedConversationId) {
        return jsonResponse({ run: runningRun(acceptedConversationId) });
      }
      return null;
    });
    await renderChat();
    await view.type("#findog-agent-question", "Wie hoch ist die Steuer?");
    await view.click(view.button("Frage senden"));
    expect(view.host.textContent).toContain("Failed to fetch");
    expect((view.host.querySelector("#findog-agent-question") as HTMLTextAreaElement).value)
      .toBe("Wie hoch ist die Steuer?");

    await view.click(view.button("Frage senden"));
    expect(posts).toHaveLength(2);
    expect(posts[0]?.body?.idempotencyKey).toBe(posts[1]?.body?.idempotencyKey);
    expect(posts[0]?.body?.conversationId).not.toBeUndefined();
    expect(posts[1]?.body?.conversationId).toBe(posts[0]?.body?.conversationId);
    // The canonical run returned by the idempotent replay is adopted, not a new id.
    expect(view.button("Stopp").disabled).toBe(false);
    expect(calls.some((call) => call.url === conversationUrl(acceptedConversationId as string))).toBe(true);
  });

  it("never re-generates an accepted run when the follow-up conversation read fails", async () => {
    let posts = 0;
    let reads = 0;
    const canonicalConversationId = "44444444-4444-4444-8444-444444444444";
    const runningRun = {
      ...FINISHED_RUN,
      conversationId: canonicalConversationId,
      state: "running" as const,
      result: null,
      finishedAt: null,
    };
    handlerFor((url, call) => {
      if (url === HISTORY_URL) {
        return jsonResponse({ conversations: [], limit: 20, hasMore: false });
      }
      if (url === "/api/admin/findog-agent/runs" && call.method === "POST") {
        posts += 1;
        return jsonResponse({ run: runningRun });
      }
      if (url === conversationUrl(canonicalConversationId)) {
        reads += 1;
        return reads === 1
          ? jsonResponse({ error: "Unterhaltung nicht erreichbar." }, 503)
          : conversationView({
            conversation: { ...CONVERSATION, id: canonicalConversationId },
            messages: [USER_MESSAGE],
            activeRun: runningRun,
          });
      }
      if (url.startsWith(eventsUrl(RUN_ID))) {
        return jsonResponse({ events: [], afterSequence: 0, limit: 200, hasMore: false });
      }
      if (url === runUrl(RUN_ID)) {
        return jsonResponse({ run: runningRun });
      }
      return null;
    });
    await renderChat();
    await view.type("#findog-agent-question", "Wie hoch ist die Steuer?");
    await view.click(view.button("Frage senden"));
    expect(posts).toBe(1);
    expect(view.host.textContent).toContain("Unterhaltung nicht erreichbar.");
    // The accepted run survives the failed read and is still observed (no re-POST).
    expect(view.button("Stopp").disabled).toBe(false);
    expect(view.button("Frage senden").disabled).toBe(true);
    expect(posts).toBe(1);
  });

  it("reconnects after a temporary observation failure instead of detaching from the run", async () => {
    let eventRequests = 0;
    handlerFor((url) => {
      if (url === HISTORY_URL) {
        return jsonResponse({ conversations: [CONVERSATION], limit: 20, hasMore: false });
      }
      if (url === conversationUrl(CONVERSATION_ID)) {
        return conversationView({
          messages: [USER_MESSAGE],
          activeRun: { ...FINISHED_RUN, state: "running", result: null, finishedAt: null },
        });
      }
      if (url.startsWith(eventsUrl(RUN_ID))) {
        eventRequests += 1;
        return eventRequests === 1
          ? jsonResponse({ error: "Temporärer Fehler." }, 503)
          : jsonResponse({ events: [], afterSequence: 0, limit: 200, hasMore: false });
      }
      if (url === runUrl(RUN_ID)) {
        return jsonResponse({ run: { ...FINISHED_RUN, state: "running", result: null, finishedAt: null } });
      }
      return null;
    });
    await renderChat();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1700));
    });
    expect(eventRequests).toBeGreaterThan(1);
    expect(view.host.textContent).not.toContain("Temporärer Fehler.");
    expect(view.host.textContent).not.toContain("Die Verbindung wurde unterbrochen");
    expect(view.button("Stopp").disabled).toBe(false);
  });

  it("stops polling on a permanently missing run instead of retrying forever", async () => {
    let eventRequests = 0;
    handlerFor((url) => {
      if (url === HISTORY_URL) {
        return jsonResponse({ conversations: [CONVERSATION], limit: 20, hasMore: false });
      }
      if (url === conversationUrl(CONVERSATION_ID)) {
        return conversationView({
          messages: [USER_MESSAGE],
          activeRun: { ...FINISHED_RUN, state: "running", result: null, finishedAt: null },
        });
      }
      if (url.startsWith(eventsUrl(RUN_ID))) {
        eventRequests += 1;
        return jsonResponse({ error: "Lauf nicht gefunden." }, 404);
      }
      return null;
    });
    await renderChat();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2200));
    });
    expect(eventRequests).toBe(1);
    expect(view.host.textContent).toContain("Lauf nicht gefunden.");
  });

  it("keeps the latest conversation when an earlier navigation response resolves late", async () => {
    const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const conversation = (id: string, title: string) => ({
      ...CONVERSATION,
      id,
      title,
    });
    const message = (id: string) => ({
      ...USER_MESSAGE,
      id: `msg-${id}`,
      content: `Nachricht ${id}`,
      runId: null,
    });
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push({ url, method: "GET", body: null });
      if (url === HISTORY_URL) {
        return jsonResponse({
          conversations: [conversation(C, "C"), conversation(A, "A"), conversation(B, "B")],
          limit: 20,
          hasMore: false,
        });
      }
      if (url === conversationUrl(A)) {
        // A slow, already superseded navigation response.
        await new Promise((resolve) => setTimeout(resolve, 150));
        return conversationView({ conversation: conversation(A, "A"), messages: [message("A")] });
      }
      if (url === conversationUrl(B)) {
        return conversationView({ conversation: conversation(B, "B"), messages: [message("B")] });
      }
      if (url === conversationUrl(C)) {
        return conversationView({ conversation: conversation(C, "C"), messages: [message("C")] });
      }
      return jsonResponse({ error: "Unerwartete Anfrage." }, 404);
    });
    await renderChat();
    expect(view.host.textContent).toContain("Nachricht C");

    await view.click(historyButton("A"));
    await view.click(historyButton("B"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(view.host.textContent).toContain("Nachricht B");
    expect(view.host.textContent).not.toContain("Nachricht A");
  });
});
