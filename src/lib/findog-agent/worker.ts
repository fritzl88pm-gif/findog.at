/**
 * Durable Findog Agent worker.
 *
 * The worker is the only place that turns a queued run into real research. It
 * claims at most one run per slot with a fresh random lease token, loads the
 * *captured* immutable settings revision, decrypts the secrets in server memory
 * and drives {@link runFindogAgentTurn} with a fenced event/heartbeat bridge.
 *
 * Guarantees:
 * - a run is never retried against a paid provider: an expired lease becomes a
 *   terminal failure, and this worker stops working on it;
 * - every external call is preceded by a fence that re-reads the run, the
 *   current administrator membership and the locally verified lease deadline,
 *   so a Stop, a revoked role or an expired lease aborts the next socket;
 * - a hung or failed heartbeat can never keep paid work running past the last
 *   verified lease expiry, and shutdown is bounded even when heartbeat, setup
 *   read or terminal write never settle;
 * - the final answer is only ever accepted through the atomic `finish`
 *   transaction, so a Stop that wins the race can never leak a late answer.
 */

import { randomUUID } from "node:crypto";

import { findogAgentErrorMessage } from "./errors";
import { runFindogAgentTurn, type FindogAgentEngineResult } from "./engine";
import type { FindogAgentTransport } from "./network";
import type { FindogAgentStore, FindogAgentStoreError } from "./store";
import type { FindogAgentRun } from "./types";

/** The exact slice of the store the worker depends on. */
export type FindogAgentWorkerStore = Pick<
  FindogAgentStore,
  | "getSettingsSnapshotByRevision"
  | "getMessage"
  | "listMessages"
  | "getRun"
  | "claimRuns"
  | "heartbeatRun"
  | "appendRunEvent"
  | "finishRun"
>;

export type FindogAgentWorkerLogger = (
  event: string,
  detail?: Record<string, unknown>,
) => void;

export type FindogAgentWorkerOptions = {
  store: FindogAgentWorkerStore;
  /** Current administrator-registry check; never trusted from the run row. */
  isAdmin: (ownerId: string) => Promise<boolean>;
  /** Decrypts the captured revision's ciphertext map in server memory only. */
  decryptCredentials: (encrypted: Record<string, string>) => Record<string, string>;
  transport: FindogAgentTransport;
  /** Injectable for tests; defaults to the real engine. */
  runTurn?: typeof runFindogAgentTurn;
  now?: () => number;
  logger?: FindogAgentWorkerLogger;
  leaseSeconds?: number;
  heartbeatIntervalMs?: number;
  /** Maximum number of prior messages handed to the engine (bound, explicit). */
  historyLimit?: number;
  /** Hard bound (ms) after a shutdown abort before the lease is failed. */
  shutdownGraceMs?: number;
};

export type FindogAgentWorkerOutcome = {
  claimed: boolean;
  runId?: string;
  status?: "succeeded" | "failed" | "stopped" | "abandoned";
};

const DEFAULT_LEASE_SECONDS = 90;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 20_000;
const DEFAULT_HISTORY_LIMIT = 40;
const DEFAULT_SHUTDOWN_GRACE_MS = 15_000;

/** A heartbeat must be several times faster than the lease it renews. */
const HEARTBEAT_LEASE_DIVISOR = 3;
/** Upper bounds for the post-abort steps, so shutdown stays bounded overall. */
const MAX_HEARTBEAT_CLEANUP_MS = 1_000;
const MAX_FINISH_ATTEMPT_MS = 5_000;

/**
 * Derives the heartbeat interval from the lease. An explicit interval (tests)
 * may only make the heartbeat faster, never slower than the lease allows: the
 * entrypoint permits a 15 s lease, which the 20 s default would outlive.
 */
export function deriveFindogAgentHeartbeatIntervalMs(
  leaseSeconds: number,
  requestedMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
): number {
  const leaseMs = Math.max(1, leaseSeconds) * 1_000;
  const leaseBound = Math.max(250, Math.floor(leaseMs / HEARTBEAT_LEASE_DIVISOR));
  return Math.max(1, Math.min(requestedMs, leaseBound));
}

/**
 * Previous answers are fed back as plain history. Any citation marker from an
 * earlier run is stripped so a model can never mistake an old, unrelated source
 * id for evidence in the current turn.
 */
export function sanitizeFindogAgentHistoryContent(content: string): string {
  return content.replace(/\s*\[(?:src_\d+\s*[,;]?\s*)+\]/g, "").trim();
}

function isStaleLeaseError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && (error as Partial<FindogAgentStoreError>).code === "stale_lease",
  );
}

/**
 * Bounded await. Resolves `null` when `promise` did not settle within `ms`;
 * otherwise wraps the settled value. Never rejects, so a late rejection of an
 * abandoned cleanup or terminal write can never become an unhandled rejection.
 */
async function settledValueWithin<T>(
  promise: Promise<T>,
  ms: number,
): Promise<{ value: T } | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
    timer.unref?.();
  });
  const outcome = await Promise.race([
    promise.then((value) => ({ value }), () => null),
    timeout,
  ]);
  if (timer !== null) {
    clearTimeout(timer);
  }
  return outcome;
}

type LeaseMonitor = {
  start(): void;
  /** Applies the lease of the claimed run; an unusable lease aborts at once. */
  claimLease(leaseExpiresAt: string | null | undefined): void;
  /** True while the last verified lease is still in the future. */
  isFresh(): boolean;
  /** Bounded, non-overlapping teardown. Never waits past `boundMs`. */
  stop(boundMs: number): Promise<void>;
};

/**
 * Owns the lease side of a run: the non-overlapping heartbeat, the clock-aware
 * watchdog and a bounded teardown.
 *
 * The watchdog aborts the run when the *last verified* expiry passes, so a
 * database renewal that hangs forever cannot keep paid work running: the SQL
 * lease is authoritative, but the worker never trusts a renewal it has not seen.
 */
function createFindogAgentLeaseMonitor(input: {
  runId: string;
  leaseSeconds: number;
  heartbeatIntervalMs: number;
  now: () => number;
  heartbeat: () => Promise<FindogAgentRun>;
  onLeaseLost: (reason: string) => void;
  log: FindogAgentWorkerLogger;
}): LeaseMonitor {
  let deadlineMs: number | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<void> | null = null;
  let stopped = false;
  let lost = false;

  const lose = (reason: string) => {
    if (lost || stopped) {
      return;
    }
    lost = true;
    input.onLeaseLost(reason);
  };

  const clearWatchdog = () => {
    if (watchdog !== null) {
      clearTimeout(watchdog);
      watchdog = null;
    }
  };

  const scheduleWatchdog = () => {
    clearWatchdog();
    if (stopped || deadlineMs === null) {
      return;
    }
    watchdog = setTimeout(() => lose("lease_expired"), Math.max(0, deadlineMs - input.now()));
    watchdog.unref?.();
  };

  const tick = async () => {
    try {
      const renewed = await input.heartbeat();
      const parsed = typeof renewed?.leaseExpiresAt === "string"
        ? Date.parse(renewed.leaseExpiresAt)
        : Number.NaN;
      // Only a parseable renewal extends the verified deadline; otherwise the
      // previous verified expiry stays in force.
      if (Number.isFinite(parsed)) {
        deadlineMs = parsed;
        scheduleWatchdog();
      }
    } catch (error) {
      if (!isStaleLeaseError(error)) {
        input.log("findog_agent_heartbeat_failed", {
          runId: input.runId,
          code: findogAgentErrorMessage(error),
        });
      }
      lose("heartbeat_failed");
    }
  };

  return {
    start() {
      // Non-overlapping: a slow heartbeat never stacks a second probe.
      timer = setInterval(() => {
        if (inFlight) {
          return;
        }
        inFlight = tick().finally(() => {
          inFlight = null;
        });
      }, input.heartbeatIntervalMs);
      timer.unref?.();
    },

    claimLease(leaseExpiresAt) {
      const parsed = typeof leaseExpiresAt === "string" ? Date.parse(leaseExpiresAt) : Number.NaN;
      if (!Number.isFinite(parsed)) {
        lose("lease_invalid");
        return;
      }
      if (parsed <= input.now()) {
        lose("lease_expired");
        return;
      }
      deadlineMs = parsed;
      scheduleWatchdog();
    },

    isFresh() {
      if (deadlineMs === null || input.now() >= deadlineMs) {
        lose("lease_expired");
        return false;
      }
      return true;
    },

    async stop(boundMs) {
      stopped = true;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      clearWatchdog();
      const pending = inFlight;
      inFlight = null;
      if (!pending) {
        return;
      }
      if (await settledValueWithin(pending, boundMs) === null) {
        input.log("findog_agent_heartbeat_cleanup_timeout", { runId: input.runId });
      }
    },
  };
}

/**
 * Claims and executes a single run. Returns `{ claimed: false }` when the queue
 * is empty so the caller can idle.
 */
export async function claimAndExecuteFindogAgentRun(
  options: FindogAgentWorkerOptions,
  input: { signal: AbortSignal },
): Promise<FindogAgentWorkerOutcome> {
  const leaseSeconds = options.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
  const leaseToken = randomUUID();

  const claimed = await options.store.claimRuns({ leaseToken, leaseSeconds, limit: 1 });
  if (claimed.length === 0) {
    return { claimed: false };
  }

  return executeFindogAgentRun(options, claimed[0], leaseToken, input.signal);
}

async function executeFindogAgentRun(
  options: FindogAgentWorkerOptions,
  run: FindogAgentRun,
  leaseToken: string,
  shutdownSignal: AbortSignal,
): Promise<FindogAgentWorkerOutcome> {
  const log = options.logger ?? (() => undefined);
  const clock = options.now ?? (() => Date.now());
  const leaseSeconds = options.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
  const heartbeatIntervalMs = deriveFindogAgentHeartbeatIntervalMs(
    leaseSeconds,
    options.heartbeatIntervalMs,
  );
  const historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
  const shutdownGraceMs = options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;
  // Bounds for the two post-abort steps. The overall shutdown of one run is
  // therefore bounded by shutdownGraceMs + heartbeatCleanupMs + finishAttemptMs.
  const heartbeatCleanupMs = Math.min(Math.max(shutdownGraceMs, 1), MAX_HEARTBEAT_CLEANUP_MS);
  const finishAttemptMs = Math.min(Math.max(shutdownGraceMs, 250), MAX_FINISH_ATTEMPT_MS);

  const runAbort = new AbortController();
  let shutdownRequested = false;
  let stopRequested = false;
  let leaseLost = false;

  let resolveHardStop: (() => void) | null = null;
  const hardStop = new Promise<void>((resolve) => {
    resolveHardStop = resolve;
  });
  let graceTimer: ReturnType<typeof setTimeout> | null = null;

  const abortForLeaseLoss = (reason: string) => {
    if (!leaseLost) {
      leaseLost = true;
      log("findog_agent_lease_lost", { runId: run.id, reason });
    }
    runAbort.abort();
  };

  const onShutdown = () => {
    shutdownRequested = true;
    runAbort.abort();
    if (graceTimer === null) {
      graceTimer = setTimeout(() => resolveHardStop?.(), shutdownGraceMs);
      graceTimer.unref?.();
    }
  };

  if (shutdownSignal.aborted) {
    onShutdown();
  } else {
    shutdownSignal.addEventListener("abort", onShutdown, { once: true });
  }

  const monitor = createFindogAgentLeaseMonitor({
    runId: run.id,
    leaseSeconds,
    heartbeatIntervalMs,
    now: clock,
    heartbeat: () => options.store.heartbeatRun({
      runId: run.id,
      ownerId: run.ownerId,
      leaseToken,
      leaseSeconds,
    }),
    onLeaseLost: abortForLeaseLoss,
    log,
  });

  const appendEvent = async (
    kind: string,
    payload: Record<string, unknown>,
  ): Promise<void> => {
    // The accepted answer is only ever written by the atomic finish transaction.
    if (kind === "output") {
      return;
    }
    try {
      await options.store.appendRunEvent({
        runId: run.id,
        ownerId: run.ownerId,
        leaseToken,
        kind: kind as Parameters<FindogAgentWorkerStore["appendRunEvent"]>[0]["kind"],
        payload,
      });
    } catch (error) {
      // A failed fenced append means we no longer own the run: stop the run
      // rather than continue working (and paying) on a lost lease.
      if (!isStaleLeaseError(error)) {
        log("findog_agent_event_append_failed", {
          runId: run.id,
          code: findogAgentErrorMessage(error),
        });
      }
      abortForLeaseLoss("event_append_failed");
      throw error;
    }
  };

  const beforeExternalCall = async (): Promise<void> => {
    if (shutdownRequested) {
      throw new Error("Der Worker wird beendet.");
    }
    if (leaseLost) {
      throw new Error("Die Lease des Laufs ist verloren.");
    }
    if (!monitor.isFresh()) {
      throw new Error("Die Lease des Laufs ist abgelaufen.");
    }

    // Re-check the *current* administrator registry, not the captured row: a
    // revoked role must stop the run before the next external call.
    let admin = false;
    try {
      admin = await options.isAdmin(run.ownerId);
    } catch (error) {
      abortForLeaseLoss("admin_check_failed");
      throw error;
    }
    if (!admin) {
      abortForLeaseLoss("admin_revoked");
      throw new Error("Der Auftraggeber ist kein Administrator mehr.");
    }

    let current: FindogAgentRun;
    try {
      current = await options.store.getRun({ ownerId: run.ownerId, runId: run.id });
    } catch (error) {
      abortForLeaseLoss("run_read_failed");
      throw error;
    }

    // Re-check the local abort state after the async checks: a shutdown or a
    // lease expiry during those awaits must still stop the next socket.
    if (shutdownRequested) {
      throw new Error("Der Worker wird beendet.");
    }
    if (leaseLost || !monitor.isFresh()) {
      throw new Error("Die Lease des Laufs ist abgelaufen.");
    }
    // The row is the authoritative expiry: reject it on the clock, not only in
    // SQL, so an expired running row can never pass the fence.
    const rowDeadline = typeof current.leaseExpiresAt === "string"
      ? Date.parse(current.leaseExpiresAt)
      : Number.NaN;
    if (!Number.isFinite(rowDeadline) || clock() >= rowDeadline) {
      abortForLeaseLoss("lease_expired");
      throw new Error("Die Lease des Laufs ist abgelaufen.");
    }

    if (
      current.state !== "running"
      || current.leaseToken !== leaseToken
      || current.cancelRequested
    ) {
      if (current.cancelRequested || current.state === "cancelled") {
        stopRequested = true;
      }
      abortForLeaseLoss("run_inactive");
      throw new Error("Der Lauf ist nicht mehr aktiv.");
    }
  };

  const finishRun = async (
    status: "succeeded" | "failed",
    body: {
      result?: Record<string, unknown> | null;
      error?: Record<string, unknown> | null;
      usage?: Record<string, unknown> | null;
      cost?: Record<string, unknown> | null;
      assistantContent?: string | null;
    },
  ): Promise<boolean> => {
    try {
      await options.store.finishRun({
        runId: run.id,
        ownerId: run.ownerId,
        leaseToken,
        status,
        result: body.result ?? null,
        error: body.error ?? null,
        usage: body.usage ?? null,
        cost: body.cost ?? null,
        assistantContent: body.assistantContent ?? null,
      });
      return true;
    } catch (error) {
      // A rejected finish means the run was already cancelled/terminalised (or
      // the lease expired): a stale worker writes nothing. Expected race.
      if (!isStaleLeaseError(error)) {
        log("findog_agent_finish_failed", {
          runId: run.id,
          code: findogAgentErrorMessage(error),
        });
      }
      return false;
    }
  };

  /**
   * Terminal write. During shutdown it is bounded: a stalled database write
   * must not hang the process, and a write that did not settle is reported as
   * "abandoned" instead of being claimed as a persisted failure.
   */
  const finalize = async (
    status: "succeeded" | "failed",
    body: Parameters<typeof finishRun>[1],
  ): Promise<boolean> => {
    if (!shutdownRequested) {
      return finishRun(status, body);
    }
    const attempt = await settledValueWithin(finishRun(status, body), finishAttemptMs);
    if (attempt === null) {
      log("findog_agent_finish_timeout", { runId: run.id });
      return false;
    }
    return attempt.value;
  };

  const stopHeartbeat = () => monitor.stop(heartbeatCleanupMs);

  const shutdownOutcome = async (): Promise<FindogAgentWorkerOutcome> => {
    await stopHeartbeat();
    const owned = await finalize("failed", {
      error: {
        code: "worker_shutdown",
        message: "Der Worker wurde während des Laufs beendet.",
      },
    });
    return { claimed: true, runId: run.id, status: owned ? "failed" : "abandoned" };
  };

  const failedOutcome = async (
    error: Record<string, unknown>,
    extra: Parameters<typeof finishRun>[1] = {},
  ): Promise<FindogAgentWorkerOutcome> => {
    const owned = await finalize("failed", { ...extra, error });
    return { claimed: true, runId: run.id, status: owned ? "failed" : "abandoned" };
  };

  monitor.start();
  monitor.claimLease(run.leaseExpiresAt);

  // Every setup read is bounded by the shutdown hard stop too: a stalled
  // settings/message read must not outlive the shutdown grace window.
  const hardStopMarker = hardStop.then(() => ({ kind: "hard_stop" as const }));
  const boundedByHardStop = async <T>(
    work: Promise<T>,
  ): Promise<{ kind: "ready"; value: T } | { kind: "hard_stop" }> => Promise.race([
    work.then((value) => ({ kind: "ready" as const, value })),
    hardStopMarker,
  ]);

  try {
    const snapshotAttempt = await boundedByHardStop(
      options.store.getSettingsSnapshotByRevision({ revision: run.settingsRevision }),
    );
    if (snapshotAttempt.kind === "hard_stop") {
      return await shutdownOutcome();
    }
    const snapshot = snapshotAttempt.value;
    const credentials = options.decryptCredentials(snapshot.encryptedCredentials);

    if (!run.userMessageId) {
      return await failedOutcome({
        code: "run_question_missing",
        message: "Der Lauf hat keine Frage.",
      });
    }

    const questionAttempt = await boundedByHardStop(
      options.store.getMessage({ ownerId: run.ownerId, messageId: run.userMessageId }),
    );
    if (questionAttempt.kind === "hard_stop") {
      return await shutdownOutcome();
    }
    const questionMessage = questionAttempt.value;
    if (
      questionMessage.role !== "user"
      || questionMessage.conversationId !== run.conversationId
    ) {
      return await failedOutcome({
        code: "run_question_invalid",
        message: "Die Frage des Laufs ist ungültig.",
      });
    }

    // Prior history is strictly older than the exact question message, so the
    // current question can never be dropped by a bounded window.
    const historyAttempt = await boundedByHardStop(
      options.store.listMessages({
        ownerId: run.ownerId,
        conversationId: run.conversationId,
        limit: historyLimit,
        before: { createdAt: questionMessage.createdAt, messageId: questionMessage.id },
      }),
    );
    if (historyAttempt.kind === "hard_stop") {
      return await shutdownOutcome();
    }
    const historyWindow = historyAttempt.value;
    if (historyWindow.hasMore) {
      try {
        await appendEvent("status", {
          phase: "history_truncated",
          retainedMessages: historyWindow.messages.length,
        });
      } catch {
        // The run is already being terminated; the engine abort below handles it.
      }
    }

    const history = historyWindow.messages.map((message) => ({
      role: message.role,
      content: message.role === "assistant"
        ? sanitizeFindogAgentHistoryContent(message.content)
        : message.content,
    }));

    const runTurn = options.runTurn ?? runFindogAgentTurn;
    const enginePromise = runTurn({
      settings: snapshot.settings,
      credentials,
      history,
      question: questionMessage.content,
      signal: runAbort.signal,
      onEvent: (event) => appendEvent(event.kind, event.payload),
      beforeExternalCall,
      transport: options.transport,
      now: options.now,
    }).then(
      (result) => ({ kind: "result" as const, result }),
      (error: unknown) => ({ kind: "threw" as const, error }),
    );

    const settled = await Promise.race([
      enginePromise,
      hardStop.then(() => ({ kind: "hard_stop" as const })),
    ]);

    await stopHeartbeat();

    if (stopRequested) {
      // The administrator pressed Stop: SQL already cancelled the run, removed
      // partial output and kept the question. A stale worker writes nothing.
      return { claimed: true, runId: run.id, status: "stopped" };
    }

    if (settled.kind === "hard_stop") {
      // The engine did not settle inside the shutdown grace window, but we may
      // still own the lease: record a truthful shutdown failure, never a success.
      return await shutdownOutcome();
    }

    if (settled.kind === "threw") {
      const code = shutdownRequested
        ? "worker_shutdown"
        : leaseLost
          ? "lease_lost"
          : "internal_error";
      const message = shutdownRequested
        ? "Der Worker wurde während des Laufs beendet."
        : findogAgentErrorMessage(settled.error);
      return await failedOutcome({ code, message });
    }

    const engineResult: FindogAgentEngineResult = settled.result;
    const resultPayload = {
      answer: engineResult.answer,
      citations: engineResult.citations,
      sources: engineResult.sources,
      plan: engineResult.plan,
      notices: engineResult.notices,
      context: engineResult.context,
      webResearchPerformed: engineResult.webResearchPerformed,
      trace: engineResult.trace,
    };
    const usageAndCost = {
      usage: { ...engineResult.usage },
      cost: { ...engineResult.cost },
    };

    if (
      engineResult.status === "succeeded"
      && engineResult.answer
      && !shutdownRequested
      && !leaseLost
    ) {
      const owned = await finalize("succeeded", {
        result: resultPayload,
        ...usageAndCost,
        assistantContent: engineResult.answer,
      });
      return { claimed: true, runId: run.id, status: owned ? "succeeded" : "abandoned" };
    }

    if (engineResult.status === "cancelled" && !shutdownRequested && !leaseLost) {
      // A user Stop won the race; the database already holds the terminal state.
      return { claimed: true, runId: run.id, status: "stopped" };
    }

    const error = shutdownRequested
      ? {
        code: "worker_shutdown",
        message: "Der Worker wurde während des Laufs beendet.",
      }
      : leaseLost
        ? {
          code: "lease_lost",
          message: "Die Lease des Laufs ging verloren, bevor die Antwort fertig war.",
        }
        : engineResult.error ?? {
          code: "internal_error",
          message: "Der Lauf ist fehlgeschlagen.",
        };
    return await failedOutcome(error, { result: resultPayload, ...usageAndCost });
  } catch (error) {
    // Setup failures (snapshot/history read) are terminal for this attempt.
    const code = shutdownRequested ? "worker_shutdown" : "internal_error";
    return await failedOutcome({ code, message: findogAgentErrorMessage(error) });
  } finally {
    shutdownSignal.removeEventListener("abort", onShutdown);
    if (graceTimer !== null) {
      clearTimeout(graceTimer);
      graceTimer = null;
    }
    await stopHeartbeat();
  }
}

export type FindogAgentWorkerLoopOptions = FindogAgentWorkerOptions & {
  signal: AbortSignal;
  concurrency?: number;
  idleDelayMs?: number;
  errorDelayMs?: number;
};

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(finish, ms);
    timer.unref?.();
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}

/**
 * Runs the claim loop until the signal aborts. The idle delay is abortable, so
 * shutdown is prompt and never waits for a full poll interval.
 */
export async function runFindogAgentWorkerLoop(
  options: FindogAgentWorkerLoopOptions,
): Promise<void> {
  const log = options.logger ?? (() => undefined);
  const concurrency = Math.max(1, Math.min(8, options.concurrency ?? 1));
  const idleDelayMs = options.idleDelayMs ?? 1_000;
  const errorDelayMs = options.errorDelayMs ?? 5_000;

  const slot = async (): Promise<void> => {
    while (!options.signal.aborted) {
      try {
        const outcome = await claimAndExecuteFindogAgentRun(options, { signal: options.signal });
        if (outcome.claimed) {
          log("findog_agent_run_finished", {
            runId: outcome.runId,
            status: outcome.status,
          });
        } else {
          await abortableDelay(idleDelayMs, options.signal);
        }
      } catch (error) {
        log("findog_agent_worker_iteration_failed", {
          code: findogAgentErrorMessage(error),
        });
        await abortableDelay(errorDelayMs, options.signal);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => slot()));
}
