import { beforeEach, describe, expect, it, vi } from "vitest";

import { isAdminUser } from "@/lib/admin-auth";
import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { FindogAgentStoreError } from "@/lib/findog-agent/store";
import { getSupabaseServerClient } from "@/lib/supabase/server";

vi.mock("@/lib/admin-auth", () => ({ isAdminUser: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/findog-agent/store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/findog-agent/store")>(
    "@/lib/findog-agent/store",
  );
  return {
    FindogAgentStoreError: actual.FindogAgentStoreError,
    createFindogAgentStore: vi.fn(),
  };
});

import { createFindogAgentStore } from "@/lib/findog-agent/store";
import { createDefaultFindogAgentSettings } from "@/lib/findog-agent/settings";
import { GET as getConversations } from "./conversations/route";
import { GET as getConversation } from "./conversations/[conversationId]/route";
import { POST as postRun } from "./runs/route";
import { GET as getRun } from "./runs/[runId]/route";
import { GET as getEvents } from "./runs/[runId]/events/route";
import { POST as postStop } from "./runs/[runId]/stop/route";

const CONVERSATION_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const MESSAGE_ID = "33333333-3333-4333-8333-333333333333";

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    conversationId: CONVERSATION_ID,
    ownerId: "admin-1",
    idempotencyKey: "key-1",
    state: "queued" as const,
    settingsRevision: 7,
    userMessageId: MESSAGE_ID,
    assistantMessageId: null,
    leaseToken: null,
    leaseExpiresAt: null,
    attemptCount: 0,
    cancelRequested: false,
    result: null,
    error: null,
    usage: null,
    cost: null,
    createdAt: "2026-09-10T20:00:00.000Z",
    updatedAt: "2026-09-10T20:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

function messageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: MESSAGE_ID,
    conversationId: CONVERSATION_ID,
    ownerId: "admin-1",
    runId: RUN_ID,
    role: "user" as const,
    content: "Wie heißt der Verein?",
    isPartial: false,
    createdAt: "2026-09-10T20:00:00.000Z",
    updatedAt: "2026-09-10T20:00:00.000Z",
    ...overrides,
  };
}

type MockStore = {
  getSettings: ReturnType<typeof vi.fn>;
  getSettingsSnapshotByRevision: ReturnType<typeof vi.fn>;
  listConversations: ReturnType<typeof vi.fn>;
  getConversation: ReturnType<typeof vi.fn>;
  listMessages: ReturnType<typeof vi.fn>;
  getActiveRun: ReturnType<typeof vi.fn>;
  enqueueRun: ReturnType<typeof vi.fn>;
  getRun: ReturnType<typeof vi.fn>;
  listRunEvents: ReturnType<typeof vi.fn>;
  cancelRun: ReturnType<typeof vi.fn>;
};

let store: MockStore;

const READY_SETTINGS = {
  revision: 7,
  updatedAt: "2026-09-10T20:00:00.000Z",
  settings: {
    ...createDefaultFindogAgentSettings(),
    enabled: true,
    activeModelId: "flash",
    connections: [{
      id: "primary",
      name: "DeepSeek",
      provider: "deepseek" as const,
      baseUrl: "https://api.deepseek.com/v1",
    }],
    models: [{
      id: "flash",
      label: "Flash",
      connectionId: "primary",
      model: "deepseek-flash",
      reasoningEffort: "high" as const,
      capabilities: ["tools" as const],
      maxOutputTokens: 1000,
      contextTokens: null,
      inputCostPerMillionUsd: null,
      outputCostPerMillionUsd: null,
    }],
  },
  encryptedCredentials: { "connection:primary:apiKey": "v1.a.b.c" },
};

function request(path: string, init?: RequestInit): Request {
  return new Request(`https://findog.at${path}`, init);
}

function jsonRequest(path: string, body: unknown): Request {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSupabaseServerClient).mockReturnValue({} as never);
  vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "admin-1" });
  vi.mocked(isAdminUser).mockResolvedValue(true);

  store = {
    getSettings: vi.fn().mockResolvedValue(READY_SETTINGS),
    getSettingsSnapshotByRevision: vi.fn().mockResolvedValue(READY_SETTINGS),
    listConversations: vi.fn().mockResolvedValue([{
      id: CONVERSATION_ID,
      ownerId: "admin-1",
      title: "Erste Recherche",
      createdAt: "2026-09-10T20:00:00.000Z",
      updatedAt: "2026-09-10T20:00:00.000Z",
    }]),
    getConversation: vi.fn().mockResolvedValue({
      id: CONVERSATION_ID,
      ownerId: "admin-1",
      title: "Erste Recherche",
      createdAt: "2026-09-10T20:00:00.000Z",
      updatedAt: "2026-09-10T20:00:00.000Z",
    }),
    listMessages: vi.fn().mockResolvedValue({ messages: [messageRow()], hasMore: false }),
    getActiveRun: vi.fn().mockResolvedValue(null),
    enqueueRun: vi.fn().mockResolvedValue(runRow()),
    getRun: vi.fn().mockResolvedValue(runRow()),
    listRunEvents: vi.fn().mockResolvedValue([
      {
        id: 1,
        runId: RUN_ID,
        ownerId: "admin-1",
        sequence: 1,
        kind: "status",
        payload: { phase: "preparing" },
        createdAt: "2026-09-10T20:00:00.000Z",
      },
      {
        id: 2,
        runId: RUN_ID,
        ownerId: "admin-1",
        sequence: 2,
        kind: "output",
        payload: { text: "Entwurf" },
        createdAt: "2026-09-10T20:00:01.000Z",
      },
    ]),
    cancelRun: vi.fn().mockResolvedValue(runRow({ state: "cancelled", cancelRequested: true })),
  };
  vi.mocked(createFindogAgentStore).mockReturnValue(store as never);
});

describe("findog agent admin routes", () => {
  it("rejects a non-admin before touching the store", async () => {
    vi.mocked(isAdminUser).mockResolvedValue(false);
    const response = await getConversations(request("/api/admin/findog-agent/conversations"));
    expect(response.status).toBe(403);
    expect(store.listConversations).not.toHaveBeenCalled();
  });

  it("rejects a missing bearer token", async () => {
    vi.mocked(authenticateSupabaseRequest).mockRejectedValue(
      new UserVisibleError("Bitte zuerst anmelden.", 401),
    );
    const response = await getConversations(request("/api/admin/findog-agent/conversations"));
    expect(response.status).toBe(401);
  });

  it("lists owner-scoped conversations with truthful pagination and no secrets", async () => {
    store.listConversations.mockResolvedValueOnce([
      {
        id: CONVERSATION_ID,
        ownerId: "admin-1",
        title: "A",
        createdAt: "2026-09-10T20:00:00.000Z",
        updatedAt: "2026-09-10T20:00:00.000Z",
      },
      {
        id: "44444444-4444-4444-8444-444444444444",
        ownerId: "admin-1",
        title: "B",
        createdAt: "2026-09-10T19:00:00.000Z",
        updatedAt: "2026-09-10T19:00:00.000Z",
      },
    ]);
    const response = await getConversations(request("/api/admin/findog-agent/conversations?limit=1"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(body.limit).toBe(1);
    expect(body.hasMore).toBe(true);
    expect(body.conversations).toHaveLength(1);
    expect(body.conversations[0]).toEqual({
      id: CONVERSATION_ID,
      title: "A",
      createdAt: "2026-09-10T20:00:00.000Z",
      updatedAt: "2026-09-10T20:00:00.000Z",
    });
    expect(store.listConversations).toHaveBeenCalledWith({ ownerId: "admin-1", limit: 2 });

    const bad = await getConversations(request("/api/admin/findog-agent/conversations?limit=999"));
    expect(bad.status).toBe(400);
  });

  it("returns the conversation with canonical messages and the active run", async () => {
    store.getActiveRun.mockResolvedValueOnce(runRow({ state: "running", leaseToken: "secret-lease" }));
    const response = await getConversation(
      request(`/api/admin/findog-agent/conversations/${CONVERSATION_ID}`),
      { params: Promise.resolve({ conversationId: CONVERSATION_ID }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.messages).toEqual([{
      id: MESSAGE_ID,
      role: "user",
      content: "Wie heißt der Verein?",
      runId: RUN_ID,
      isPartial: false,
      createdAt: "2026-09-10T20:00:00.000Z",
    }]);
    expect(body.activeRun.state).toBe("running");
    expect(JSON.stringify(body)).not.toContain("secret-lease");
    expect(JSON.stringify(body)).not.toContain("ownerId");
    expect(body.messagesTruncated).toBe(false);
  });

  it("hides foreign or unknown conversations and runs behind a 404", async () => {
    store.getConversation.mockRejectedValueOnce(new FindogAgentStoreError("not_found"));
    const response = await getConversation(
      request(`/api/admin/findog-agent/conversations/${CONVERSATION_ID}`),
      { params: Promise.resolve({ conversationId: CONVERSATION_ID }) },
    );
    expect(response.status).toBe(404);

    store.getRun.mockRejectedValueOnce(new FindogAgentStoreError("not_found"));
    const runResponse = await getRun(
      request(`/api/admin/findog-agent/runs/${RUN_ID}`),
      { params: Promise.resolve({ runId: RUN_ID }) },
    );
    expect(runResponse.status).toBe(404);
  });

  it("rejects malformed ids and bodies with 4xx before enqueueing", async () => {
    const malformed = await getRun(
      request("/api/admin/findog-agent/runs/not-a-uuid"),
      { params: Promise.resolve({ runId: "not-a-uuid" }) },
    );
    expect(malformed.status).toBe(400);

    for (const body of [
      { conversationId: "nope", question: "Frage", idempotencyKey: "k" },
      { conversationId: CONVERSATION_ID, question: "   ", idempotencyKey: "k" },
      { conversationId: CONVERSATION_ID, question: "Frage", idempotencyKey: "" },
      { conversationId: CONVERSATION_ID, question: "Frage", idempotencyKey: "k", extra: 1 },
    ]) {
      const response = await postRun(jsonRequest("/api/admin/findog-agent/runs", body));
      expect(response.status).toBe(400);
    }
    expect(store.enqueueRun).not.toHaveBeenCalled();
  });

  it("enqueues idempotently and returns a redacted run", async () => {
    const body = {
      conversationId: CONVERSATION_ID,
      question: "Wie heißt der Verein?",
      idempotencyKey: "key-1",
      conversationTitle: "Erste Recherche",
    };
    const first = await postRun(jsonRequest("/api/admin/findog-agent/runs", body));
    const second = await postRun(jsonRequest("/api/admin/findog-agent/runs", body));
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect((await first.json()).run.id).toBe((await second.json()).run.id);
    expect(store.enqueueRun).toHaveBeenCalledTimes(2);
    expect(store.enqueueRun).toHaveBeenLastCalledWith({
      ownerId: "admin-1",
      conversationId: CONVERSATION_ID,
      idempotencyKey: "key-1",
      settingsRevision: 7,
      question: "Wie heißt der Verein?",
      conversationTitle: "Erste Recherche",
    });
  });

  it("blocks enqueue when the agent is disabled", async () => {
    store.getSettings.mockResolvedValueOnce({
      ...READY_SETTINGS,
      settings: { ...READY_SETTINGS.settings, enabled: false },
    });
    const response = await postRun(jsonRequest("/api/admin/findog-agent/runs", {
      conversationId: CONVERSATION_ID,
      question: "Frage",
      idempotencyKey: "key-1",
    }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("agent_disabled");
    expect(store.enqueueRun).not.toHaveBeenCalled();
  });

  it("blocks enqueue when the active model credential is missing", async () => {
    store.getSettings.mockResolvedValueOnce({ ...READY_SETTINGS, encryptedCredentials: {} });
    const response = await postRun(jsonRequest("/api/admin/findog-agent/runs", {
      conversationId: CONVERSATION_ID,
      question: "Frage",
      idempotencyKey: "key-1",
    }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("credentials_missing");
    expect(store.enqueueRun).not.toHaveBeenCalled();
  });

  it("reads events after a cursor with bounded batches and no owner leakage", async () => {
    const response = await getEvents(
      request(`/api/admin/findog-agent/runs/${RUN_ID}/events?afterSequence=0&limit=1`),
      { params: Promise.resolve({ runId: RUN_ID }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.events).toHaveLength(1);
    expect(body.hasMore).toBe(true);
    expect(body.afterSequence).toBe(0);
    expect(store.listRunEvents).toHaveBeenCalledWith({
      ownerId: "admin-1",
      runId: RUN_ID,
      afterSequence: 0,
    });
    expect(JSON.stringify(body)).not.toContain("ownerId");

    const bad = await getEvents(
      request(`/api/admin/findog-agent/runs/${RUN_ID}/events?afterSequence=-1`),
      { params: Promise.resolve({ runId: RUN_ID }) },
    );
    expect(bad.status).toBe(400);
  });

  it("stops an owned run and treats a foreign run as absent", async () => {
    const response = await postStop(
      request(`/api/admin/findog-agent/runs/${RUN_ID}/stop`, { method: "POST" }),
      { params: Promise.resolve({ runId: RUN_ID }) },
    );
    expect(response.status).toBe(200);
    expect((await response.json()).run.state).toBe("cancelled");
    expect(store.cancelRun).toHaveBeenCalledWith({ ownerId: "admin-1", runId: RUN_ID });

    store.cancelRun.mockRejectedValueOnce(new FindogAgentStoreError("forbidden"));
    const foreign = await postStop(
      request(`/api/admin/findog-agent/runs/${RUN_ID}/stop`, { method: "POST" }),
      { params: Promise.resolve({ runId: RUN_ID }) },
    );
    expect(foreign.status).toBe(403);
  });

  it("fails with 503 when Supabase is not configured", async () => {
    vi.mocked(getSupabaseServerClient).mockReturnValue(null);
    const response = await getConversations(request("/api/admin/findog-agent/conversations"));
    expect(response.status).toBe(503);
  });
});
