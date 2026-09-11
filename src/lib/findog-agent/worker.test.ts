/**
 * Durable worker integration tests.
 *
 * These tests drive the *real* queue: an embedded PostgreSQL-compatible PGlite
 * database runs the real SQL lifecycle functions, the worker claims and executes
 * the run, and a local HTTP fixture (clearly labelled as such) stands in for the
 * provider and the knowledge API. No production service, credential or paid
 * provider is contacted.
 */

import { createServer, type Server } from "node:http";

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  FINDOG_AGENT_CREDENTIALS_ENV,
  decryptFindogAgentSecretMap,
  encryptFindogAgentSecret,
} from "./credentials";
import type { FindogAgentEngineInput, FindogAgentEngineResult } from "./engine";
import { createFindogAgentHttpTransport, createFindogAgentStaticTransport } from "./network";
import { createPgliteFindogAgentStore } from "./pglite-store";
import { createAuthUser, createFindogAgentTestDb, insertSettingsRevision } from "./pglite-test-db";
import { FindogAgentStoreError } from "./store";
import { FINDOG_AGENT_TEST_CREDENTIALS, findogAgentTestSettings } from "./testing";
import {
  claimAndExecuteFindogAgentRun,
  deriveFindogAgentHeartbeatIntervalMs,
  sanitizeFindogAgentHistoryContent,
  type FindogAgentWorkerOptions,
  type FindogAgentWorkerStore,
} from "./worker";
import type { FindogAgentRun } from "./types";

type FixtureMode = "tool_then_answer" | "hang";

const KNOWLEDGE_RESPONSE = {
  success: true,
  data: [{
    id: "chunk-1",
    knowledge_id: "doc-1",
    knowledge_base_id: "kb-1",
    knowledge_title: "Satzung",
    content: "Der Verein heißt Findog.",
    score: 0.9,
  }],
};

function modelBody(options: {
  toolCall?: boolean;
  content: string;
}): Record<string, unknown> {
  return {
    id: "chatcmpl-fixture",
    object: "chat.completion",
    model: "deepseek-flash",
    choices: [{
      index: 0,
      message: options.toolCall
        ? {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "call_fixture",
            type: "function",
            function: { name: "knowledge_search", arguments: JSON.stringify({ query: "Vereinsname" }) },
          }],
        }
        : { role: "assistant", content: options.content },
      finish_reason: options.toolCall ? "tool_calls" : "stop",
    }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  };
}

describe("findog agent durable worker (real SQL queue via PGlite)", () => {
  let db: PGlite;
  let close: () => Promise<void>;
  let adminId: string;
  let otherAdminId: string;
  let revision: number;
  let server: Server;
  let origin: string;
  let mode: FixtureMode = "tool_then_answer";
  let modelRequests = 0;
  let knowledgeRequests = 0;
  let abortedRequests = 0;

  beforeAll(async () => {
    const harness = await createFindogAgentTestDb();
    db = harness.db;
    close = harness.close;
    adminId = await createAuthUser(db);
    otherAdminId = await createAuthUser(db);
    revision = await insertSettingsRevision(db, adminId, { schemaVersion: 1, models: [] });

    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        response.setHeader("content-type", "application/json");

        if (request.url === "/chat/completions") {
          modelRequests += 1;
          if (mode === "hang") {
            // A client abort is only proven by a *premature* server response
            // close. The request 'close' event also fires once the request body
            // is fully read, which would count every request as aborted.
            response.on("close", () => {
              if (!response.writableEnded) {
                abortedRequests += 1;
              }
            });
            // Deliberately never respond: the test cancels or shuts down.
            return;
          }
          response.end(JSON.stringify(modelRequests === 1
            ? modelBody({ toolCall: true, content: "" })
            : modelBody({ content: "Der Verein heißt Findog [src_1]." })));
          return;
        }

        if (request.url === "/api/v1/knowledge-search") {
          knowledgeRequests += 1;
          response.end(JSON.stringify(KNOWLEDGE_RESPONSE));
          return;
        }

        response.statusCode = 404;
        response.end(JSON.stringify({ error: "not found" }));
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await close();
  });

  beforeEach(async () => {
    mode = "tool_then_answer";
    modelRequests = 0;
    knowledgeRequests = 0;
    abortedRequests = 0;
    await db.query(`
      update public.findog_agent_runs
      set state = 'cancelled', cancel_requested = true, lease_token = null,
          lease_expires_at = null, finished_at = now(), updated_at = now()
      where state in ('queued', 'running')
    `);
  });

  function encryptedCredentials(): Record<string, string> {
    process.env[FINDOG_AGENT_CREDENTIALS_ENV] = Buffer.alloc(32, 7).toString("base64");
    return Object.fromEntries(Object.entries(FINDOG_AGENT_TEST_CREDENTIALS).map(
      ([name, value]) => [name, encryptFindogAgentSecret(value)],
    ));
  }

  function buildOptions(overrides: {
    transport?: FindogAgentWorkerOptions["transport"];
    isAdmin?: FindogAgentWorkerOptions["isAdmin"];
    heartbeatIntervalMs?: number;
    shutdownGraceMs?: number;
    storeOverrides?: Partial<FindogAgentWorkerStore>;
  } = {}): FindogAgentWorkerOptions & { signal: AbortController } {
    const store = createPgliteFindogAgentStore(db);
    const credentials = encryptedCredentials();
    const credentialsSnapshot = {
      revision,
      updatedAt: "2026-09-10T20:00:00.000Z",
      settings: findogAgentTestSettings({
        connectionBaseUrl: origin,
        knowledge: {
          enabled: true,
          baseUrl: `${origin}/api/v1`,
          knowledgeBaseIds: ["kb-1"],
        },
      }),
      encryptedCredentials: credentials,
    };
    const controller = new AbortController();
    const workerStore = {
      ...store,
      getSettingsSnapshotByRevision: async () => credentialsSnapshot,
      ...(overrides.storeOverrides ?? {}),
    } as FindogAgentWorkerStore;
    return {
      store: workerStore,
      isAdmin: overrides.isAdmin ?? (async () => true),
      decryptCredentials: decryptFindogAgentSecretMap,
      transport: overrides.transport ?? createFindogAgentHttpTransport({
        allowedPrivateOrigins: [origin],
      }),
      heartbeatIntervalMs: overrides.heartbeatIntervalMs ?? 25,
      shutdownGraceMs: overrides.shutdownGraceMs,
      signal: controller,
    };
  }

  async function enqueue(conversationId = crypto.randomUUID(), question = "Wie heißt der Verein?"): Promise<string> {
    const store = createPgliteFindogAgentStore(db);
    const run = await store.enqueueRun({
      ownerId: adminId,
      conversationId,
      idempotencyKey: crypto.randomUUID(),
      settingsRevision: revision,
      question,
    });
    return run.id;
  }

  async function runState(runId: string): Promise<string> {
    const result = await db.query<{ state: string }>(
      "select state from public.findog_agent_runs where id = $1",
      [runId],
    );
    return result.rows[0].state;
  }

  async function messages(runId: string): Promise<Array<{ role: string; content: string; is_partial: boolean }>> {
    const result = await db.query<{ role: string; content: string; is_partial: boolean }>(
      "select role, content, is_partial from public.findog_agent_messages where conversation_id ="
      + " (select conversation_id from public.findog_agent_runs where id = $1) order by created_at, id",
      [runId],
    );
    return result.rows;
  }

  async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await predicate()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("waitFor timed out");
  }

  it("drives queue -> claim -> engine -> SQL final message end to end", async () => {
    const runId = await enqueue();
    const options = buildOptions();
    const outcome = await claimAndExecuteFindogAgentRun(options, { signal: options.signal.signal });

    expect(outcome).toMatchObject({ claimed: true, runId, status: "succeeded" });
    expect(await runState(runId)).toBe("succeeded");
    expect(modelRequests).toBe(2);
    expect(knowledgeRequests).toBe(1);

    const stored = await messages(runId);
    expect(stored).toEqual([
      { role: "user", content: "Wie heißt der Verein?", is_partial: false },
      { role: "assistant", content: "Der Verein heißt Findog [src_1].", is_partial: false },
    ]);

    const run = await db.query<{
      result: { answer: string; sources: Array<{ id: string }> } | null;
      usage: Record<string, unknown> | null;
      cost: Record<string, unknown> | null;
      lease_token: string | null;
    }>("select result, usage, cost, lease_token from public.findog_agent_runs where id = $1", [runId]);
    expect(run.rows[0].result?.answer).toBe("Der Verein heißt Findog [src_1].");
    expect(run.rows[0].result?.sources?.map((source) => source.id)).toEqual(["src_1"]);
    expect(run.rows[0].usage).toMatchObject({ modelCalls: 2, knowledgeRetrievals: 1 });
    expect(run.rows[0].cost).toMatchObject({ coverage: expect.objectContaining({ model: "unknown" }) });
    expect(run.rows[0].lease_token).toBeNull();

    // Reconnect contract: the cursor resumes exactly where it stopped, and
    // re-reading the same cursor never duplicates an event.
    const store = createPgliteFindogAgentStore(db);
    const events = await store.listRunEvents({ runId, ownerId: adminId });
    expect(events.length).toBeGreaterThan(2);
    expect(events.map((event) => event.sequence)).toEqual(
      Array.from({ length: events.length }, (_, index) => index + 1),
    );
    const resumed = await store.listRunEvents({ runId, ownerId: adminId, afterSequence: events.length });
    expect(resumed).toEqual([]);
    expect(modelRequests).toBe(2);
  });

  it("cancels a running run while the provider is pending and observes the upstream abort", async () => {
    mode = "hang";
    const runId = await enqueue();
    const options = buildOptions();
    const worker = claimAndExecuteFindogAgentRun(options, { signal: options.signal.signal });

    await waitFor(async () => (await runState(runId)) === "running");
    await waitFor(async () => modelRequests > 0);

    // No upstream connection has been closed before the administrator stops.
    expect(abortedRequests).toBe(0);

    const store = createPgliteFindogAgentStore(db);
    const cancelled = await store.cancelRun({ runId, ownerId: adminId });
    expect(cancelled.state).toBe("cancelled");

    const outcome = await worker;
    expect(outcome.status).not.toBe("succeeded");
    // The upstream socket was aborted: the worker never keeps paying for a run
    // the administrator stopped.
    await waitFor(async () => abortedRequests === 1);

    expect(await runState(runId)).toBe("cancelled");
    expect(await messages(runId)).toEqual([
      { role: "user", content: "Wie heißt der Verein?", is_partial: false },
    ]);
  });

  it("rejects a late provider result that arrives after the cancellation", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // A hostile transport that resolves successfully even after the abort.
    const transport = createFindogAgentStaticTransport(async () => {
      await gate;
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(modelBody({ content: "Zu spät [src_1]." })),
        truncated: false,
      };
    });

    const runId = await enqueue();
    const options = buildOptions({ transport });
    const worker = claimAndExecuteFindogAgentRun(options, { signal: options.signal.signal });
    await waitFor(async () => (await runState(runId)) === "running");

    const store = createPgliteFindogAgentStore(db);
    await store.cancelRun({ runId, ownerId: adminId });
    release();

    const outcome = await worker;
    expect(outcome.status).not.toBe("succeeded");
    expect(await runState(runId)).toBe("cancelled");
    // The late answer was never accepted or persisted.
    expect(await messages(runId)).toEqual([
      { role: "user", content: "Wie heißt der Verein?", is_partial: false },
    ]);
  });

  it("aborts the run and never publishes an answer when the heartbeat is lost", async () => {
    mode = "hang";
    const runId = await enqueue();
    const options = buildOptions({
      storeOverrides: {
        heartbeatRun: async () => {
          throw new FindogAgentStoreError("unavailable", "heartbeat unavailable");
        },
      },
    });
    const outcome = await claimAndExecuteFindogAgentRun(options, { signal: options.signal.signal });

    await waitFor(async () => abortedRequests > 0);
    const run = await db.query<{ state: string; error: { code?: string } | null }>(
      "select state, error from public.findog_agent_runs where id = $1",
      [runId],
    );
    expect(outcome.status).not.toBe("succeeded");
    expect(run.rows[0].state).toBe("failed");
    expect(run.rows[0].error?.code).toBe("lease_lost");
    expect(await messages(runId)).toEqual([
      { role: "user", content: "Wie heißt der Verein?", is_partial: false },
    ]);
  });

  it("stops before an external call when the owner lost administrator membership", async () => {
    const runId = await enqueue();
    let calls = 0;
    const options = buildOptions({
      isAdmin: async () => {
        calls += 1;
        return calls === 1;
      },
    });
    const outcome = await claimAndExecuteFindogAgentRun(options, { signal: options.signal.signal });

    expect(outcome.status).not.toBe("succeeded");
    // The first model call was allowed; the knowledge call after the revoked
    // membership check never happened.
    expect(modelRequests).toBe(1);
    expect(knowledgeRequests).toBe(0);
    expect(await messages(runId)).toEqual([
      { role: "user", content: "Wie heißt der Verein?", is_partial: false },
    ]);
  });

  it("fails the owned run truthfully on a graceful shutdown instead of a stop", async () => {
    mode = "hang";
    const runId = await enqueue();
    const options = buildOptions();
    const worker = claimAndExecuteFindogAgentRun(options, { signal: options.signal.signal });
    await waitFor(async () => (await runState(runId)) === "running");
    await waitFor(async () => modelRequests > 0);

    options.signal.abort();
    const outcome = await worker;

    await waitFor(async () => abortedRequests > 0);
    const run = await db.query<{ state: string; error: { code?: string } | null }>(
      "select state, error from public.findog_agent_runs where id = $1",
      [runId],
    );
    expect(outcome.status).toBe("failed");
    expect(run.rows[0].state).toBe("failed");
    expect(run.rows[0].error?.code).toBe("worker_shutdown");
    // Cancellation/stop semantics are preserved: the question stays.
    expect(await messages(runId)).toEqual([
      { role: "user", content: "Wie heißt der Verein?", is_partial: false },
    ]);
  });

  it("bounds the shutdown wait and fails the run when the engine does not settle", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let pendingRequests = 0;
    const transport = createFindogAgentStaticTransport(async () => {
      pendingRequests += 1;
      await gate;
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(modelBody({ content: "Späte Antwort [src_1]." })),
        truncated: false,
      };
    });
    const runId = await enqueue();
    const options = buildOptions({ transport, shutdownGraceMs: 50 });
    const worker = claimAndExecuteFindogAgentRun(options, { signal: options.signal.signal });
    await waitFor(async () => (await runState(runId)) === "running");
    await waitFor(async () => pendingRequests > 0);

    options.signal.abort();
    const outcome = await worker;
    const run = await db.query<{ state: string; error: { code?: string } | null }>(
      "select state, error from public.findog_agent_runs where id = $1",
      [runId],
    );
    expect(outcome.status).toBe("failed");
    expect(run.rows[0].state).toBe("failed");
    expect(run.rows[0].error?.code).toBe("worker_shutdown");

    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await messages(runId)).toEqual([
      { role: "user", content: "Wie heißt der Verein?", is_partial: false },
    ]);
  });

  it("keeps foreign conversations invisible and executes under the run's own owner", async () => {
    const foreignConversation = crypto.randomUUID();
    const store = createPgliteFindogAgentStore(db);
    const run = await store.enqueueRun({
      ownerId: otherAdminId,
      conversationId: foreignConversation,
      idempotencyKey: crypto.randomUUID(),
      settingsRevision: revision,
      question: "Fremde Frage",
    });

    // Owner-scoped reads never cross the admin boundary.
    await expect(store.getConversation({ ownerId: adminId, conversationId: foreignConversation }))
      .rejects.toMatchObject({ code: "not_found" });
    await expect(store.getRun({ ownerId: adminId, runId: run.id }))
      .rejects.toMatchObject({ code: "not_found" });

    const options = buildOptions();
    const outcome = await claimAndExecuteFindogAgentRun(options, { signal: options.signal.signal });

    // The worker did claim the queued run (the queue is global) but every
    // subsequent call uses the run's own owner, never a fixed or caller identity.
    expect(outcome.claimed).toBe(true);
    expect(outcome.runId).toBe(run.id);
    expect(await runState(run.id)).toBe("succeeded");
    const messages = await db.query<{ owner_id: string }>(
      "select owner_id from public.findog_agent_messages where conversation_id = $1",
      [foreignConversation],
    );
    expect(messages.rows.every((row) => row.owner_id === otherAdminId)).toBe(true);
  });
});

describe("findog agent worker history sanitisation", () => {
  it("strips earlier source ids so they cannot be mistaken for current evidence", () => {
    expect(sanitizeFindogAgentHistoryContent("Antwort [src_1] mit Beleg.")).toBe(
      "Antwort mit Beleg.",
    );
    expect(sanitizeFindogAgentHistoryContent("Beides [src_1, src_2] hier.")).toBe("Beides hier.");
    expect(sanitizeFindogAgentHistoryContent("Ohne Marker.")).toBe("Ohne Marker.");
  });
});

describe("findog agent worker lease, heartbeat and shutdown bounds", () => {
  type FixtureBehaviour = "ok" | "hang" | "throw";

  function engineSuccess(): FindogAgentEngineResult {
    return {
      status: "succeeded",
      answer: "Antwort",
      sources: [],
      citations: { citedSourceIds: [], unknownSourceIds: [] },
      plan: { steps: [], notes: null, updatedAtStep: null },
      trace: [],
      usage: {
        modelCalls: 0,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        reasoningTokens: null,
        toolCalls: 0,
        knowledgeRetrievals: 0,
        webRetrievals: 0,
        mcpCalls: 0,
      },
      cost: {
        limitUsd: null,
        limitStatus: "not_configured",
        modelReportedUsd: null,
        modelEstimatedUsd: null,
        webEstimatedUsd: null,
        totalEstimatedUsd: null,
        coverage: { model: "unused", web: "unused", knowledge: "unused", mcp: "unused" },
      },
      context: { truncated: false, droppedHistoryMessages: 0, estimatedInputTokens: 0, contextTokens: null },
      notices: [],
      webResearchPerformed: false,
      error: null,
    };
  }

  function fixtureRun(leaseToken: string, leaseExpiresAt: string): FindogAgentRun {
    return {
      id: "run-1",
      conversationId: "conversation-1",
      ownerId: "owner-1",
      idempotencyKey: "idem-1",
      state: "running",
      settingsRevision: 1,
      userMessageId: "message-1",
      assistantMessageId: null,
      leaseToken,
      leaseExpiresAt,
      attemptCount: 1,
      cancelRequested: false,
      result: null,
      error: null,
      usage: null,
      cost: null,
      createdAt: "2026-09-10T20:00:00.000Z",
      updatedAt: "2026-09-10T20:00:00.000Z",
      startedAt: "2026-09-10T20:00:00.000Z",
      finishedAt: null,
    };
  }

  /** In-memory store that lets a test deliberately stall heartbeat/setup/finish. */
  function createFixture(overrides: {
    leaseSeconds?: number;
    expiredLease?: boolean;
    heartbeat?: FixtureBehaviour;
    finish?: FixtureBehaviour;
    settingsRead?: FixtureBehaviour;
    messageRead?: FixtureBehaviour;
  } = {}) {
    const leaseSeconds = overrides.leaseSeconds ?? 90;
    const state = {
      run: null as FindogAgentRun | null,
      claimDeadlineMs: 0,
      heartbeatCalls: 0,
      heartbeatAt: [] as number[],
      finishAttempts: 0,
      finishes: [] as Array<Record<string, unknown>>,
    };
    const snapshot = {
      revision: 1,
      updatedAt: "2026-09-10T20:00:00.000Z",
      settings: findogAgentTestSettings(),
      encryptedCredentials: {},
    };
    const store = {
      claimRuns: async ({ leaseToken }: { leaseToken: string }) => {
        const deadline = Date.now() + (overrides.expiredLease ? -1_000 : leaseSeconds * 1_000);
        state.claimDeadlineMs = deadline;
        state.run = fixtureRun(leaseToken, new Date(deadline).toISOString());
        return [state.run];
      },
      getSettingsSnapshotByRevision: async () => (
        overrides.settingsRead === "hang" ? new Promise<never>(() => {}) : snapshot
      ),
      getMessage: async () => {
        if (overrides.messageRead === "throw") {
          throw new FindogAgentStoreError("unavailable", "message read failed");
        }
        return {
          id: "message-1",
          conversationId: "conversation-1",
          ownerId: "owner-1",
          runId: "run-1",
          role: "user" as const,
          content: "Frage",
          isPartial: false,
          createdAt: "2026-09-10T19:59:59.000Z",
          updatedAt: "2026-09-10T19:59:59.000Z",
        };
      },
      listMessages: async () => ({ messages: [], hasMore: false }),
      getRun: async () => {
        if (!state.run) {
          throw new FindogAgentStoreError("not_found");
        }
        return state.run;
      },
      heartbeatRun: async () => {
        state.heartbeatCalls += 1;
        state.heartbeatAt.push(Date.now());
        if (overrides.heartbeat === "hang") {
          return new Promise<never>(() => {});
        }
        if (overrides.heartbeat === "throw") {
          throw new FindogAgentStoreError("unavailable", "heartbeat failed");
        }
        state.run = { ...state.run!, leaseExpiresAt: new Date(Date.now() + leaseSeconds * 1_000).toISOString() };
        return state.run;
      },
      appendRunEvent: async () => ({}),
      finishRun: async (input: Record<string, unknown>) => {
        state.finishAttempts += 1;
        if (overrides.finish === "hang") {
          return new Promise<never>(() => {});
        }
        if (overrides.finish === "throw") {
          throw new FindogAgentStoreError("unavailable", "finish failed");
        }
        state.finishes.push(input);
        return state.run;
      },
    } as unknown as FindogAgentWorkerStore;
    return { store, state };
  }

  function buildOptions(
    fixture: ReturnType<typeof createFixture>,
    extra: Partial<FindogAgentWorkerOptions> = {},
  ): FindogAgentWorkerOptions & { signal: AbortController } {
    const controller = new AbortController();
    return {
      store: fixture.store,
      isAdmin: async () => true,
      decryptCredentials: () => ({ "connection:primary:apiKey": "test-model-key" }),
      transport: createFindogAgentStaticTransport(async () => {
        throw new Error("no transport expected");
      }),
      ...extra,
      signal: controller,
    };
  }

  const neverSettles = () => new Promise<never>(() => {});

  function rejectOnAbort(input: FindogAgentEngineInput): Promise<never> {
    return new Promise<never>((_, reject) => {
      input.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  }

  function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        const timer = setTimeout(() => reject(new Error("timed out")), ms);
        timer.unref?.();
      }),
    ]);
  }

  it("keeps the heartbeat well inside every supported lease", () => {
    for (const leaseSeconds of [15, 20, 30, 60, 90, 300, 3_600]) {
      const interval = deriveFindogAgentHeartbeatIntervalMs(leaseSeconds);
      expect(interval).toBeLessThanOrEqual((leaseSeconds * 1_000) / 3 + 1);
      expect(interval).toBeLessThan(leaseSeconds * 1_000);
    }
    // The shortest supported lease must not inherit the 20 s default.
    expect(deriveFindogAgentHeartbeatIntervalMs(15)).toBe(5_000);
    // An explicit faster interval is kept; a slower one is clamped.
    expect(deriveFindogAgentHeartbeatIntervalMs(15, 1_000)).toBe(1_000);
    expect(deriveFindogAgentHeartbeatIntervalMs(15, 20_000)).toBe(5_000);
  });

  it("refuses an already-expired lease before any external call", async () => {
    const fixture = createFixture({ expiredLease: true });
    let transportCalls = 0;
    const options = buildOptions(fixture, {
      transport: createFindogAgentStaticTransport(async () => {
        transportCalls += 1;
        throw new Error("transport must not run");
      }),
    });

    const outcome = await claimAndExecuteFindogAgentRun(options, { signal: options.signal.signal });

    expect(transportCalls).toBe(0);
    expect(outcome.claimed).toBe(true);
    expect(outcome.status).toBe("failed");
    expect(fixture.state.finishes[0]).toMatchObject({ error: { code: "lease_lost" } });
  });

  it("renews a short supported lease before it expires", async () => {
    const fixture = createFixture({ leaseSeconds: 1 });
    const options = buildOptions(fixture, {
      leaseSeconds: 1,
      runTurn: (async (input: FindogAgentEngineInput) => new Promise<FindogAgentEngineResult>((resolve, reject) => {
        const timer = setTimeout(() => resolve(engineSuccess()), 1_600);
        input.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("aborted"));
        }, { once: true });
      })) as unknown as FindogAgentWorkerOptions["runTurn"],
    });

    const outcome = await claimAndExecuteFindogAgentRun(options, { signal: options.signal.signal });

    expect(outcome.status).toBe("succeeded");
    expect(fixture.state.heartbeatCalls).toBeGreaterThanOrEqual(2);
    // The first renewal happened before the initial lease expired.
    expect(fixture.state.heartbeatAt[0]).toBeLessThan(fixture.state.claimDeadlineMs);
  });

  it("aborts paid work when a pending heartbeat lets the verified lease lapse", async () => {
    const fixture = createFixture({ leaseSeconds: 1, heartbeat: "hang" });
    let abortedAt = 0;
    const startedAt = Date.now();
    const options = buildOptions(fixture, {
      runTurn: (async (input: FindogAgentEngineInput) => {
        await new Promise<never>((_, reject) => {
          input.signal.addEventListener("abort", () => {
            abortedAt = Date.now();
            reject(new Error("aborted"));
          }, { once: true });
        });
        return engineSuccess();
      }) as unknown as FindogAgentWorkerOptions["runTurn"],
      leaseSeconds: 1,
    });

    const outcome = await claimAndExecuteFindogAgentRun(options, { signal: options.signal.signal });
    const elapsed = Date.now() - startedAt;

    // The local watchdog fired at the last verified expiry, not sooner.
    expect(abortedAt).toBeGreaterThanOrEqual(startedAt + 900);
    expect(elapsed).toBeLessThan(3_000);
    expect(outcome.status).toBe("failed");
    expect(fixture.state.finishes[0]).toMatchObject({ error: { code: "lease_lost" } });
    // Non-overlapping probes: the hung renewal was never stacked.
    expect(fixture.state.heartbeatCalls).toBe(1);
  });

  it("bounds shutdown when the heartbeat never settles", async () => {
    const fixture = createFixture({ heartbeat: "hang" });
    const options = buildOptions(fixture, {
      heartbeatIntervalMs: 5,
      shutdownGraceMs: 20,
      runTurn: (async () => neverSettles()) as unknown as FindogAgentWorkerOptions["runTurn"],
    });

    const worker = claimAndExecuteFindogAgentRun(options, { signal: options.signal.signal });
    while (fixture.state.heartbeatCalls === 0) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    options.signal.abort();

    const outcome = await withTimeout(worker, 1_000);
    expect(outcome.status).toBe("failed");
    expect(fixture.state.finishes[0]).toMatchObject({ error: { code: "worker_shutdown" } });
  });

  it("bounds shutdown when the settings read never settles", async () => {
    const fixture = createFixture({ settingsRead: "hang" });
    const options = buildOptions(fixture, { heartbeatIntervalMs: 5, shutdownGraceMs: 20 });

    const worker = claimAndExecuteFindogAgentRun(options, { signal: options.signal.signal });
    await new Promise((resolve) => setTimeout(resolve, 30));
    options.signal.abort();

    const outcome = await withTimeout(worker, 1_000);
    expect(outcome.status).toBe("failed");
    expect(fixture.state.finishes[0]).toMatchObject({ error: { code: "worker_shutdown" } });
  });

  it("reports an abandoned run when the terminal write never settles", async () => {
    const fixture = createFixture({ finish: "hang" });
    const options = buildOptions(fixture, {
      heartbeatIntervalMs: 5,
      shutdownGraceMs: 20,
      runTurn: (async (input: FindogAgentEngineInput) => {
        await rejectOnAbort(input);
        return engineSuccess();
      }) as unknown as FindogAgentWorkerOptions["runTurn"],
    });

    const worker = claimAndExecuteFindogAgentRun(options, { signal: options.signal.signal });
    await new Promise((resolve) => setTimeout(resolve, 30));
    options.signal.abort();

    const outcome = await withTimeout(worker, 2_000);
    // The attempt was made, but a stalled write is never claimed as persisted.
    expect(fixture.state.finishAttempts).toBeGreaterThanOrEqual(1);
    expect(outcome.status).toBe("abandoned");
  });

  it("does not claim a terminal write that the store rejected", async () => {
    const fixture = createFixture({ messageRead: "throw", finish: "throw" });
    const options = buildOptions(fixture);

    const outcome = await claimAndExecuteFindogAgentRun(options, { signal: options.signal.signal });

    expect(outcome.status).toBe("abandoned");
    expect(fixture.state.finishes).toEqual([]);
  });
});
