import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";

import {
  TEST_LEASE_TOKEN,
  TEST_OTHER_LEASE_TOKEN,
  createAuthUser,
  createFindogAgentTestDb,
  insertSettingsRevision,
} from "./pglite-test-db";

type RunRow = {
  id: string;
  conversation_id: string;
  owner_id: string;
  state: string;
  idempotency_key: string;
  attempt_count: number;
  lease_token: string | null;
  lease_expires_at: string | null;
  assistant_message_id: string | null;
  cancel_requested: boolean;
  error: { code?: string } | null;
};

type EventRow = { sequence: number; kind: string; payload: Record<string, unknown> };

describe("findog agent SQL lifecycle (real PostgreSQL via PGlite)", () => {
  let db: PGlite;
  let close: () => Promise<void>;
  let adminId: string;
  let otherAdminId: string;
  let nonAdminId: string;
  let revision: number;
  let conversationId: string;

  async function enqueue(options: {
    owner?: string;
    key?: string;
    question?: string;
    settingsRevision?: number;
    conversation?: string;
  } = {}): Promise<RunRow> {
    const result = await db.query<RunRow>(
      `select * from public.enqueue_findog_agent_run($1, $2, $3, $4, $5, $6)`,
      [
        options.owner ?? adminId,
        options.conversation ?? conversationId,
        options.key ?? crypto.randomUUID(),
        options.settingsRevision ?? revision,
        options.question ?? "Was ist neu?",
        "Erste Recherche",
      ],
    );
    return result.rows[0];
  }

  async function claim(token: string, limit = 1): Promise<RunRow[]> {
    const result = await db.query<RunRow>(
      "select * from public.claim_findog_agent_runs($1, 120, $2)",
      [token, limit],
    );
    return result.rows;
  }

  /** Terminalises leftover active runs so each test starts from a clean queue. */
  async function drainQueue(): Promise<void> {
    await db.query(`
      update public.findog_agent_runs
      set state = 'cancelled',
          cancel_requested = true,
          lease_token = null,
          lease_expires_at = null,
          finished_at = now(),
          updated_at = now()
      where state in ('queued', 'running')
    `);
  }

  beforeAll(async () => {
    const harness = await createFindogAgentTestDb();
    db = harness.db;
    close = harness.close;
    adminId = await createAuthUser(db);
    otherAdminId = await createAuthUser(db);
    nonAdminId = await createAuthUser(db, { admin: false });
    revision = await insertSettingsRevision(db, adminId, { schemaVersion: 1, models: [] });
    conversationId = crypto.randomUUID();
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await drainQueue();
  });

  it("denies execution to PUBLIC, anon and authenticated", async () => {
    const rows = await db.query<{ signature: string; allowed: boolean }>(`
      select signature, has_function_privilege('anon', signature, 'execute')
        or has_function_privilege('authenticated', signature, 'execute')
        or has_function_privilege('public', signature, 'execute') as allowed
      from unnest(array[
        'public.reap_findog_agent_runs(integer)',
        'public.set_findog_agent_settings(bigint, uuid, jsonb, jsonb)',
        'public.enqueue_findog_agent_run(uuid, uuid, text, bigint, text, text)',
        'public.claim_findog_agent_runs(uuid, integer, integer)',
        'public.heartbeat_findog_agent_run(uuid, uuid, uuid, integer)',
        'public.append_findog_agent_run_event(uuid, uuid, uuid, text, jsonb)',
        'public.list_findog_agent_run_events(uuid, uuid, bigint)',
        'public.save_findog_agent_run_partial_answer(uuid, uuid, uuid, text)',
        'public.finish_findog_agent_run(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, jsonb, text)',
        'public.cancel_findog_agent_run(uuid, uuid)'
      ]) as signature
    `);
    expect(rows.rows).toHaveLength(10);
    expect(rows.rows.filter((row) => row.allowed)).toEqual([]);

    const granted = await db.query<{ allowed: boolean }>(`
      select bool_and(has_function_privilege('service_role', signature, 'execute')) as allowed
      from unnest(array[
        'public.enqueue_findog_agent_run(uuid, uuid, text, bigint, text, text)',
        'public.cancel_findog_agent_run(uuid, uuid)'
      ]) as signature
    `);
    expect(granted.rows[0].allowed).toBe(true);
  });

  it("keeps tables deny-by-default with RLS enabled", async () => {
    const rows = await db.query<{ relname: string; rls: boolean; privileged: boolean }>(`
      select c.relname,
             c.relrowsecurity as rls,
             (has_table_privilege('anon', c.oid, 'select')
              or has_table_privilege('authenticated', c.oid, 'select')) as privileged
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname like 'findog_agent_%' and c.relkind = 'r'
    `);
    expect(rows.rows).toHaveLength(6);
    for (const row of rows.rows) {
      expect(row.rls).toBe(true);
      expect(row.privileged).toBe(false);
    }
  });

  it("appends immutable settings revisions and rejects stale writes", async () => {
    const second = await db.query<{ revision: string }>(
      "select revision from public.set_findog_agent_settings($1, $2, $3::jsonb, '{}'::jsonb)",
      [revision, adminId, JSON.stringify({ schemaVersion: 1, models: [] })],
    );
    const secondRevision = Number(second.rows[0].revision);
    expect(secondRevision).toBeGreaterThan(revision);

    await expect(db.query(
      "select revision from public.set_findog_agent_settings($1, $2, $3::jsonb, '{}'::jsonb)",
      [revision, adminId, JSON.stringify({ schemaVersion: 1, models: [] })],
    )).rejects.toThrowError(/changed concurrently/);

    const versions = await db.query<{ count: string }>(
      "select count(*)::text as count from public.findog_agent_settings_versions",
    );
    expect(Number(versions.rows[0].count)).toBe(2);
    revision = secondRevision;
  });

  it("rejects a settings author without administrator membership", async () => {
    await expect(db.query(
      "select revision from public.set_findog_agent_settings($1, $2, $3::jsonb, '{}'::jsonb)",
      [revision, nonAdminId, JSON.stringify({ schemaVersion: 1, models: [] })],
    )).rejects.toThrowError(/not an administrator/);
  });

  it("rejects a settings revision whose active model is not in the catalog", async () => {
    await expect(db.query(
      "select revision from public.set_findog_agent_settings($1, $2, $3::jsonb, '{}'::jsonb)",
      [revision, adminId, JSON.stringify({ schemaVersion: 1, models: [], activeModelId: "ghost" })],
    )).rejects.toThrowError(/active model/);
  });

  it("enqueues the question and run atomically and idempotently", async () => {
    const key = "idempotent-1";
    const first = await enqueue({ key, question: "Frage eins" });
    expect(first.state).toBe("queued");
    expect(first.attempt_count).toBe(0);

    const replay = await enqueue({ key, question: "Frage eins" });
    expect(replay.id).toBe(first.id);

    const messages = await db.query<{ role: string; content: string }>(
      "select role, content from public.findog_agent_messages where conversation_id = $1 order by created_at",
      [conversationId],
    );
    expect(messages.rows).toEqual([{ role: "user", content: "Frage eins" }]);

    const conversations = await db.query<{ count: string }>(
      "select count(*)::text as count from public.findog_agent_conversations where owner_id = $1",
      [adminId],
    );
    expect(Number(conversations.rows[0].count)).toBe(1);

    await expect(db.query(
      "select * from public.enqueue_findog_agent_run($1, $2, $3, $4, $5)",
      [adminId, conversationId, "idempotent-2", revision, "Zweite Frage"],
    )).rejects.toThrowError(/already has an active run/);

    expect(first.idempotency_key).toBe(key);
    expect(adminId).toBe(first.owner_id);
  });

  it("validates administrator membership and conversation ownership on enqueue", async () => {
    await expect(enqueue({ owner: nonAdminId, conversation: crypto.randomUUID(), key: "non-admin" }))
      .rejects.toThrowError(/not an administrator/);

    const shared = crypto.randomUUID();
    await db.query(
      "insert into public.findog_agent_conversations (id, owner_id) values ($1, $2)",
      [shared, adminId],
    );
    await expect(enqueue({ owner: otherAdminId, conversation: shared, key: "owner-c" }))
      .rejects.toThrowError(/is not owned by the requesting administrator/);

    const created = await enqueue({ key: "owner-a", conversation: shared });
    expect(created.owner_id).toBe(adminId);
  });

  it("claims queued runs with a lease and heartbeat fencing", async () => {
    const run = await enqueue({ key: "claim-1" });
    const claimed = await claim(TEST_LEASE_TOKEN);
    expect(claimed.map((row) => row.id)).toEqual([run.id]);
    expect(claimed[0].state).toBe("running");
    expect(claimed[0].lease_token).toBe(TEST_LEASE_TOKEN);
    expect(claimed[0].attempt_count).toBe(1);

    expect(await claim(TEST_OTHER_LEASE_TOKEN)).toEqual([]);

    const heartbeat = await db.query<RunRow>(
      "select * from public.heartbeat_findog_agent_run($1, $2, $3, 120)",
      [run.id, adminId, TEST_LEASE_TOKEN],
    );
    expect(heartbeat.rows[0].lease_token).toBe(TEST_LEASE_TOKEN);

    await expect(db.query(
      "select * from public.heartbeat_findog_agent_run($1, $2, $3, 120)",
      [run.id, adminId, TEST_OTHER_LEASE_TOKEN],
    )).rejects.toThrowError(/stale or not active/);
    await expect(db.query(
      "select * from public.heartbeat_findog_agent_run($1, $2, $3, 120)",
      [run.id, otherAdminId, TEST_LEASE_TOKEN],
    )).rejects.toThrowError(/stale or not active/);

    await db.query(
      "update public.findog_agent_runs set lease_expires_at = now() - interval '1 second' where id = $1",
      [run.id],
    );
    await expect(db.query(
      "select * from public.heartbeat_findog_agent_run($1, $2, $3, 120)",
      [run.id, adminId, TEST_LEASE_TOKEN],
    )).rejects.toThrowError(/stale or not active/);

    const terminal = await claim(TEST_OTHER_LEASE_TOKEN);
    expect(terminal).toEqual([]);
    const failed = await db.query<RunRow>(
      "select * from public.findog_agent_runs where id = $1",
      [run.id],
    );
    expect(failed.rows[0].state).toBe("failed");
    expect(failed.rows[0].error?.code).toBe("lease_expired");
    expect(failed.rows[0].attempt_count).toBe(1);
  });

  it("fails runs whose owner lost administrator membership", async () => {
    const revoked = await createAuthUser(db);
    const run = await enqueue({ owner: revoked, conversation: crypto.randomUUID(), key: "revoked-1" });
    expect(run.state).toBe("queued");

    await db.query("delete from public.admin_users where user_id = $1", [revoked]);

    expect(await claim(TEST_LEASE_TOKEN)).toEqual([]);
    const failed = await db.query<RunRow>(
      "select * from public.findog_agent_runs where id = $1",
      [run.id],
    );
    expect(failed.rows[0].state).toBe("failed");
    expect(failed.rows[0].error?.code).toBe("owner_not_admin");
  });

  it("requires the current unexpired token for events and sequences them monotonically", async () => {
    const run = await enqueue({ key: "events-1" });
    const claimed = await claim(TEST_LEASE_TOKEN);
    expect(claimed[0].id).toBe(run.id);

    await expect(db.query(
      "select * from public.append_findog_agent_run_event($1, $2, $3, 'step', $4::jsonb)",
      [run.id, adminId, TEST_OTHER_LEASE_TOKEN, JSON.stringify({ index: 1 })],
    )).rejects.toThrowError(/stale or not active/);

    for (const index of [1, 2, 3]) {
      await db.query(
        "select * from public.append_findog_agent_run_event($1, $2, $3, 'step', $4::jsonb)",
        [run.id, adminId, TEST_LEASE_TOKEN, JSON.stringify({ index })],
      );
    }

    const events = await db.query<EventRow>(
      "select * from public.list_findog_agent_run_events($1, $2, 0)",
      [run.id, adminId],
    );
    expect(events.rows.map((row) => row.sequence)).toEqual([1, 2, 3]);
    expect(events.rows.map((row) => row.payload.index)).toEqual([1, 2, 3]);

    const after = await db.query<EventRow>(
      "select * from public.list_findog_agent_run_events($1, $2, 2)",
      [run.id, adminId],
    );
    expect(after.rows.map((row) => row.sequence)).toEqual([3]);

    expect(await db.query(
      "select * from public.list_findog_agent_run_events($1, $2, 0)",
      [run.id, otherAdminId],
    )).toMatchObject({ rows: [] });

    await expect(db.query(
      "select * from public.append_findog_agent_run_event($1, $2, $3, 'shell', $4::jsonb)",
      [run.id, adminId, TEST_LEASE_TOKEN, "{}"],
    )).rejects.toThrowError(/event payload is invalid/);
  });

  it("finishes a run with the canonical answer and fences stale tokens", async () => {
    const run = await enqueue({ key: "finish-1" });
    await claim(TEST_LEASE_TOKEN);

    await expect(db.query(
      "select * from public.finish_findog_agent_run($1, $2, $3, 'succeeded', null, null, null, null, 'spät')",
      [run.id, adminId, TEST_OTHER_LEASE_TOKEN],
    )).rejects.toThrowError(/stale or not active/);

    const finished = await db.query<RunRow>(
      "select * from public.finish_findog_agent_run($1, $2, $3, 'succeeded', $4::jsonb, null, $5::jsonb, $6::jsonb, 'Antwort')",
      [run.id, adminId, TEST_LEASE_TOKEN, JSON.stringify({ answer: "Antwort" }), JSON.stringify({ inputTokens: 10 }), JSON.stringify({ usd: 0.01 })],
    );
    expect(finished.rows[0].state).toBe("succeeded");
    expect(finished.rows[0].lease_token).toBeNull();

    const answer = await db.query<{ role: string; content: string; is_partial: boolean }>(
      "select role, content, is_partial from public.findog_agent_messages where id = $1",
      [finished.rows[0].assistant_message_id],
    );
    expect(answer.rows[0]).toMatchObject({ role: "assistant", content: "Antwort", is_partial: false });

    await expect(db.query(
      "select * from public.finish_findog_agent_run($1, $2, $3, 'failed', null, null, null, null, null)",
      [run.id, adminId, TEST_LEASE_TOKEN],
    )).rejects.toThrowError(/stale or not active/);
  });

  it("cancels queued runs without a worker and removes partial answers", async () => {
    const queued = await enqueue({ key: "cancel-queued" });
    const cancelled = await db.query<RunRow>(
      "select * from public.cancel_findog_agent_run($1, $2)",
      [queued.id, adminId],
    );
    expect(cancelled.rows[0].state).toBe("cancelled");
    expect(cancelled.rows[0].cancel_requested).toBe(true);
    expect(await claim(TEST_LEASE_TOKEN)).toEqual([]);

    await expect(db.query(
      "select * from public.cancel_findog_agent_run($1, $2)",
      [queued.id, otherAdminId],
    )).rejects.toThrowError(/not found for this administrator/);

    const running = await enqueue({ key: "cancel-running", conversation: crypto.randomUUID() });
    await claim(TEST_LEASE_TOKEN);
    await db.query(
      "select public.save_findog_agent_run_partial_answer($1, $2, $3, 'halb')",
      [running.id, adminId, TEST_LEASE_TOKEN],
    );
    const partial = await db.query<{ is_partial: boolean }>(
      "select is_partial from public.findog_agent_messages where run_id = $1 and role = 'assistant'",
      [running.id],
    );
    expect(partial.rows).toHaveLength(1);

    const stopped = await db.query<RunRow>(
      "select * from public.cancel_findog_agent_run($1, $2)",
      [running.id, adminId],
    );
    expect(stopped.rows[0].state).toBe("cancelled");
    expect(stopped.rows[0].assistant_message_id).toBeNull();

    const remaining = await db.query<{ role: string; content: string }>(
      "select role, content from public.findog_agent_messages where conversation_id = $1 order by created_at",
      [running.conversation_id],
    );
    expect(remaining.rows).toEqual([{ role: "user", content: "Was ist neu?" }]);

    await expect(db.query(
      "select * from public.finish_findog_agent_run($1, $2, $3, 'succeeded', null, null, null, null, 'spät')",
      [running.id, adminId, TEST_LEASE_TOKEN],
    )).rejects.toThrowError(/stale or not active/);
  });

  it("rejects partial answers and events after cancellation", async () => {
    const run = await enqueue({ key: "post-cancel", conversation: crypto.randomUUID() });
    await claim(TEST_LEASE_TOKEN);
    await db.query("select * from public.cancel_findog_agent_run($1, $2)", [run.id, adminId]);

    await expect(db.query(
      "select public.save_findog_agent_run_partial_answer($1, $2, $3, 'halb')",
      [run.id, adminId, TEST_LEASE_TOKEN],
    )).rejects.toThrowError(/stale or not active/);
    await expect(db.query(
      "select * from public.append_findog_agent_run_event($1, $2, $3, 'step', '{}'::jsonb)",
      [run.id, adminId, TEST_LEASE_TOKEN],
    )).rejects.toThrowError(/stale or not active/);
  });

  it("enforces one active run per conversation in the database", async () => {
    const conversation = crypto.randomUUID();
    const first = await enqueue({ key: "unique-1", conversation });
    await expect(enqueue({ key: "unique-2", conversation })).rejects.toThrowError(/active run/);
    await db.query("select * from public.cancel_findog_agent_run($1, $2)", [first.id, adminId]);
    const second = await enqueue({ key: "unique-3", conversation });
    expect(second.state).toBe("queued");
    await db.query("select * from public.cancel_findog_agent_run($1, $2)", [second.id, adminId]);
  });

  it("rejects malformed lifecycle payloads", async () => {
    await expect(db.query(
      "select * from public.enqueue_findog_agent_run($1, $2, $3, $4, $5)",
      [adminId, crypto.randomUUID(), "blank", revision, "   "],
    )).rejects.toThrowError(/enqueue payload is invalid/);
    await expect(db.query(
      "select * from public.enqueue_findog_agent_run($1, $2, $3, $4, $5)",
      [adminId, crypto.randomUUID(), "missing-revision", 999999, "Frage"],
    )).rejects.toThrowError(/revision does not exist/);
    await expect(db.query(
      "select * from public.claim_findog_agent_runs(null, 60, 1)",
    )).rejects.toThrowError(/claim payload is invalid/);
  });
});
