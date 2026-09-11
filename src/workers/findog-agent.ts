/**
 * Standalone Findog Agent worker entrypoint.
 *
 * It is a real process boundary: an HTTP request (or its disconnect) can never
 * own research execution. The worker only claims queued runs, executes them
 * against their captured settings revision and records terminal state in SQL.
 *
 * Startup deliberately performs no migration and writes no configuration. The
 * readiness log states that the worker loop is ready; it does not claim that the
 * database schema was verified, because it is not probed here.
 */

import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { isAdminUser } from "@/lib/admin-auth";
import {
  decryptFindogAgentSecretMap,
  parseFindogAgentCredentialsKey,
} from "@/lib/findog-agent/credentials";
import {
  FINDOG_AGENT_ALLOWED_PRIVATE_ORIGINS_ENV,
  createFindogAgentHttpTransport,
  parseFindogAgentAllowedPrivateOrigins,
} from "@/lib/findog-agent/network";
import { createFindogAgentStore } from "@/lib/findog-agent/store";
import { runFindogAgentWorkerLoop } from "@/lib/findog-agent/worker";

const SHUTDOWN_GRACE_MS = 30_000;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} ist nicht gesetzt.`);
  }
  return value;
}

function parseBoundedInteger(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} muss eine ganze Zahl zwischen ${min} und ${max} sein.`);
  }
  return parsed;
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, "0.0.0.0", () => {
      server.off("error", onError);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

function logger(event: string, detail?: Record<string, unknown>): void {
  console.info(event, detail ?? {});
}

async function main(): Promise<void> {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  // Fail before serving anything if the runtime key is missing or malformed.
  parseFindogAgentCredentialsKey(requireEnv("FINDOG_AGENT_CREDENTIALS_KEY"));

  const port = parseBoundedInteger("FINDOG_AGENT_WORKER_PORT", 3002, 1, 65_535);
  const concurrency = parseBoundedInteger("FINDOG_AGENT_WORKER_CONCURRENCY", 1, 1, 4);
  const leaseSeconds = parseBoundedInteger("FINDOG_AGENT_WORKER_LEASE_SECONDS", 90, 15, 3600);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const controller = new AbortController();
  let ready = false;
  let shuttingDown = false;
  let forceTimer: ReturnType<typeof setTimeout> | null = null;

  const requestShutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    ready = false;
    logger("findog_agent_worker_shutdown", { signal });
    controller.abort();
    forceTimer = setTimeout(() => {
      console.error("findog_agent_worker_shutdown_timeout", {});
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    forceTimer.unref?.();
  };

  const server = createServer((request, response) => {
    if (request.url === "/health" || request.url === "/") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        status: ready ? "ready" : "stopping",
        databaseProbed: false,
      }));
      return;
    }
    response.statusCode = 404;
    response.end("not found");
  });
  await listen(server, port);

  process.once("SIGTERM", () => requestShutdown("SIGTERM"));
  process.once("SIGINT", () => requestShutdown("SIGINT"));

  const store = createFindogAgentStore(supabase);
  const transport = createFindogAgentHttpTransport({
    allowedPrivateOrigins: parseFindogAgentAllowedPrivateOrigins(
      process.env[FINDOG_AGENT_ALLOWED_PRIVATE_ORIGINS_ENV],
    ),
  });

  ready = true;
  // Truthful readiness: the message states the loop is ready. It does not claim
  // that the database schema or the configured connections were verified.
  logger("findog_agent_worker_ready", {
    port,
    concurrency,
    leaseSeconds,
    databaseProbed: false,
  });

  try {
    await runFindogAgentWorkerLoop({
      store,
      isAdmin: (ownerId) => isAdminUser(supabase, ownerId),
      decryptCredentials: decryptFindogAgentSecretMap,
      transport,
      logger,
      leaseSeconds,
      concurrency,
      signal: controller.signal,
    });
  } finally {
    ready = false;
    if (forceTimer) {
      clearTimeout(forceTimer);
    }
    await closeServer(server);
  }
}

// Direct-execution guard: only start when this module is the entrypoint.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    const code = error instanceof Error ? error.message.slice(0, 120) : "UNKNOWN_FATAL";
    console.error("findog_agent_worker_fatal", { code });
    process.exitCode = 1;
  });
}
