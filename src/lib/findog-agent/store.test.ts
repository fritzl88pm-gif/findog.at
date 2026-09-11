import { describe, expect, it, vi } from "vitest";

import { createDefaultFindogAgentSettings } from "./settings";
import { FindogAgentStoreError, createFindogAgentStore } from "./store";

const SETTINGS = { ...createDefaultFindogAgentSettings(), schemaVersion: 1 as const };

function rpcClient(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as never, rpc };
}

type QueryCall = [string, ...unknown[]];

function recordingChain(result: { data: unknown; error: unknown }) {
  const calls: QueryCall[] = [];
  const chain = {
    calls,
    select: (...args: unknown[]) => {
      calls.push(["select", ...args]);
      return chain;
    },
    eq: (...args: unknown[]) => {
      calls.push(["eq", ...args]);
      return chain;
    },
    lt: (...args: unknown[]) => {
      calls.push(["lt", ...args]);
      return chain;
    },
    in: (...args: unknown[]) => {
      calls.push(["in", ...args]);
      return chain;
    },
    order: (...args: unknown[]) => {
      calls.push(["order", ...args]);
      return chain;
    },
    limit: (...args: unknown[]) => {
      calls.push(["limit", ...args]);
      return chain;
    },
    maybeSingle: () => {
      calls.push(["maybeSingle"]);
      return Promise.resolve(result);
    },
    then: <T>(resolve: (value: { data: unknown; error: unknown }) => T) => {
      calls.push(["then"]);
      return Promise.resolve(result).then(resolve);
    },
  };
  return chain;
}

describe("findog agent store error mapping", () => {
  it("maps a concurrent settings revision to a conflict", async () => {
    const { client, rpc } = rpcClient({
      data: null,
      error: { code: "40001", message: "findog agent settings changed concurrently" },
    });
    const store = createFindogAgentStore(client);
    await expect(store.updateSettings({
      expectedRevision: 1,
      createdBy: "admin-1",
      settings: SETTINGS,
      encryptedCredentials: {},
    })).rejects.toMatchObject({ code: "conflict", status: 409 });
    expect(rpc).toHaveBeenCalledWith("set_findog_agent_settings", {
      p_expected_revision: 1,
      p_created_by: "admin-1",
      p_settings: SETTINGS,
      p_encrypted_credentials: {},
    });
  });

  it("maps a stale lease to a fenced error", async () => {
    const { client } = rpcClient({
      data: null,
      error: { code: "55000", message: "findog agent run lease is stale or not active" },
    });
    const store = createFindogAgentStore(client);
    await expect(store.heartbeatRun({
      runId: "run-1",
      ownerId: "admin-1",
      leaseToken: "token-1",
      leaseSeconds: 90,
    })).rejects.toMatchObject({ code: "stale_lease", status: 409 });
  });

  it("rejects an unauthorised owner mapping", async () => {
    const { client } = rpcClient({
      data: null,
      error: { code: "42501", message: "findog agent owner is not an administrator" },
    });
    const store = createFindogAgentStore(client);
    await expect(store.enqueueRun({
      ownerId: "user-1",
      conversationId: "conversation-1",
      idempotencyKey: "key-1",
      settingsRevision: 1,
      question: "Frage",
    })).rejects.toMatchObject({ code: "forbidden", status: 403 });
  });

  it("maps an empty rpc result to not found and a transport failure to unavailable", async () => {
    const empty = rpcClient({ data: [], error: null });
    const store = createFindogAgentStore(empty.client);
    await expect(store.cancelRun({ runId: "run-1", ownerId: "admin-1" }))
      .rejects.toMatchObject({ code: "not_found", status: 404 });

    const failure = rpcClient({ data: null, error: { code: "08006", message: "connection lost" } });
    const failureStore = createFindogAgentStore(failure.client);
    await expect(failureStore.listRunEvents({ runId: "run-1", ownerId: "admin-1" }))
      .rejects.toMatchObject({ code: "unavailable", status: 503 });
  });

  it("returns typed rows for successful lifecycle calls", async () => {
    const { client, rpc } = rpcClient({
      data: [{
        id: "run-1",
        conversation_id: "conversation-1",
        owner_id: "admin-1",
        idempotency_key: "key-1",
        state: "running",
        settings_revision: 3,
        lease_token: "token-1",
        lease_expires_at: "2026-09-10T21:00:00.000Z",
        attempt_count: 1,
        cancel_requested: false,
        user_message_id: "message-1",
        assistant_message_id: null,
        result: null,
        error: null,
        usage: null,
        cost: null,
        created_at: "2026-09-10T20:00:00.000Z",
        updated_at: "2026-09-10T20:00:01.000Z",
        started_at: "2026-09-10T20:00:01.000Z",
        finished_at: null,
      }],
      error: null,
    });
    const store = createFindogAgentStore(client);
    const run = await store.claimRuns({ leaseToken: "token-1", leaseSeconds: 90, limit: 1 });
    expect(run[0]).toMatchObject({ id: "run-1", state: "running", settingsRevision: 3, attemptCount: 1 });
    expect(rpc).toHaveBeenCalledWith("claim_findog_agent_runs", {
      p_lease_token: "token-1",
      p_lease_seconds: 90,
      p_limit: 1,
    });
  });

  it("exposes a store error type with a stable status", () => {
    const error = new FindogAgentStoreError("conflict", "kaputt");
    expect(error.status).toBe(409);
    expect(error).toBeInstanceOf(Error);
  });

  it("scopes conversation and message reads to the authenticated owner", async () => {
    const conversations = recordingChain({
      data: [{
        id: "conversation-1",
        owner_id: "admin-1",
        title: "Recherche",
        created_at: "2026-09-10T20:00:00.000Z",
        updated_at: "2026-09-10T20:00:00.000Z",
      }],
      error: null,
    });
    const messages = recordingChain({
      data: [{
        id: "message-1",
        conversation_id: "conversation-1",
        owner_id: "admin-1",
        run_id: "run-1",
        role: "user",
        content: "Frage",
        is_partial: false,
        created_at: "2026-09-10T20:00:00.000Z",
        updated_at: "2026-09-10T20:00:00.000Z",
      }],
      error: null,
    });
    const client = {
      from: (table: string) => (table === "findog_agent_messages" ? messages : conversations),
    } as never;
    const store = createFindogAgentStore(client);

    const conversationsResult = await store.listConversations({ ownerId: "admin-1" });
    expect(conversationsResult[0]).toMatchObject({ id: "conversation-1", ownerId: "admin-1" });
    expect(conversations.calls).toContainEqual(["eq", "owner_id", "admin-1"]);
    expect(conversations.calls).toContainEqual(["order", "created_at", { ascending: false }]);

    const messagesResult = await store.listMessages({ ownerId: "admin-1", conversationId: "conversation-1" });
    expect(messagesResult.messages[0]).toMatchObject({ id: "message-1", role: "user", isPartial: false });
    expect(messagesResult.hasMore).toBe(false);
    expect(messages.calls).toContainEqual(["eq", "owner_id", "admin-1"]);
    expect(messages.calls).toContainEqual(["eq", "conversation_id", "conversation-1"]);
    expect(messages.calls).toContainEqual(["eq", "is_partial", false]);
    // Deterministic order: the id is the tie-break for equal timestamps.
    expect(messages.calls).toContainEqual(["order", "created_at", { ascending: false }]);
    expect(messages.calls).toContainEqual(["order", "id", { ascending: false }]);
  });

  it("returns the most recent bounded window and reports truncation", async () => {
    const rows = Array.from({ length: 3 }, (_, index) => ({
      id: `00000000-0000-4000-8000-00000000000${index}`,
      conversation_id: "conversation-1",
      owner_id: "admin-1",
      run_id: null,
      role: index % 2 === 0 ? "user" : "assistant",
      content: `Nachricht ${index}`,
      is_partial: false,
      created_at: `2026-09-10T20:00:0${index}.000Z`,
      updated_at: `2026-09-10T20:00:0${index}.000Z`,
    }));
    // PostgREST returns rows in the requested (descending) order; the store
    // fetches limit + 1 rows to learn the truth about `hasMore` and reverses
    // the bounded window back to chronological order.
    const messages = recordingChain({ data: [...rows].reverse(), error: null });
    const client = { from: () => messages } as never;
    const store = createFindogAgentStore(client);

    const window = await store.listMessages({
      ownerId: "admin-1",
      conversationId: "conversation-1",
      limit: 2,
    });
    expect(window.hasMore).toBe(true);
    expect(window.messages.map((message) => message.content)).toEqual(["Nachricht 1", "Nachricht 2"]);
    expect(messages.calls).toContainEqual(["limit", 3]);
  });

  it("reads a prior-message window strictly before the question cursor", async () => {
    const older = recordingChain({
      data: [{
        id: "00000000-0000-4000-8000-000000000001",
        conversation_id: "conversation-1",
        owner_id: "admin-1",
        run_id: "run-1",
        role: "user",
        content: "Vorherige Frage",
        is_partial: false,
        created_at: "2026-09-10T19:00:00.000Z",
        updated_at: "2026-09-10T19:00:00.000Z",
      }],
      error: null,
    });
    const sameTimestamp = recordingChain({ data: [], error: null });
    const chains = [older, sameTimestamp];
    let index = 0;
    const client = { from: () => chains[index++] } as never;
    const store = createFindogAgentStore(client);

    const window = await store.listMessages({
      ownerId: "admin-1",
      conversationId: "conversation-1",
      limit: 5,
      before: {
        createdAt: "2026-09-10T20:00:00.000Z",
        messageId: "00000000-0000-4000-8000-000000000002",
      },
    });
    expect(window.messages.map((message) => message.content)).toEqual(["Vorherige Frage"]);
    expect(older.calls).toContainEqual(["lt", "created_at", "2026-09-10T20:00:00.000Z"]);
    expect(sameTimestamp.calls).toContainEqual(["eq", "created_at", "2026-09-10T20:00:00.000Z"]);
    expect(sameTimestamp.calls).toContainEqual([
      "lt",
      "id",
      "00000000-0000-4000-8000-000000000002",
    ]);
  });

  it("returns not found for a conversation or run outside the owner scope", async () => {
    const empty = { data: null, error: null };
    const client = {
      from: () => recordingChain(empty),
      rpc: vi.fn(),
    } as never;
    const store = createFindogAgentStore(client);
    await expect(store.getConversation({ ownerId: "admin-1", conversationId: "conversation-1" }))
      .rejects.toMatchObject({ code: "not_found" });
    await expect(store.getRun({ ownerId: "admin-1", runId: "run-1" }))
      .rejects.toMatchObject({ code: "not_found" });
  });
});
