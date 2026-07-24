import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { FindokUpstreamError } from "@/lib/findok/bfg-decisions";
import { BfgProModelError, runBfgProSearch } from "@/lib/findok/bfg-pro";
import {
  BFG_PRO_STREAM_CONTENT_TYPE,
  encodeBfgProStreamEvent,
  type BfgProStreamEvent,
} from "@/lib/findok/bfg-pro-stream";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
const MAX_BFG_PRO_SCENARIO_CHARS = 2_000;
const BFG_PRO_RATE_LIMIT_MAX_REQUESTS = 5;
const BFG_PRO_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1_000;

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const rateLimit = new Map<string, RateLimitEntry>();

function json(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function invalidRequest(): UserVisibleError {
  return new UserVisibleError("Die PRO-Suchanfrage ist ungültig.", 400);
}

async function parseScenario(request: Request): Promise<string> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw invalidRequest();
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw invalidRequest();
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw invalidRequest();
  }
  const record = body as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !("scenario" in record) || typeof record.scenario !== "string") {
    throw invalidRequest();
  }
  const scenario = record.scenario.trim();
  if (!scenario || scenario.length > MAX_BFG_PRO_SCENARIO_CHARS) {
    throw invalidRequest();
  }
  return scenario;
}

function clientAddress(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown";
}

function enforceRateLimit(request: Request, userId: string): void {
  const now = Date.now();
  for (const [key, entry] of rateLimit) {
    if (entry.resetAt <= now) {
      rateLimit.delete(key);
    }
  }
  const key = `${userId}:${clientAddress(request)}`;
  const current = rateLimit.get(key);
  if (!current) {
    rateLimit.set(key, { count: 1, resetAt: now + BFG_PRO_RATE_LIMIT_WINDOW_MS });
    return;
  }
  if (current.count >= BFG_PRO_RATE_LIMIT_MAX_REQUESTS) {
    throw new UserVisibleError("Zu viele PRO-Suchanfragen. Bitte in einigen Minuten erneut versuchen.", 429);
  }
  current.count += 1;
}

function searchErrorMessage(error: unknown): string {
  if (error instanceof UserVisibleError) {
    return error.message;
  }
  if (error instanceof FindokUpstreamError) {
    return "Findok ist derzeit nicht erreichbar. Bitte später erneut versuchen.";
  }
  if (error instanceof BfgProModelError) {
    return "Die KI-Reihung konnte nicht durchgeführt werden. Bitte erneut versuchen.";
  }
  return "Die BFG Suche PRO konnte nicht durchgeführt werden.";
}

export async function POST(request: Request) {
  let scenario: string;
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Die BFG Suche PRO ist derzeit nicht verfügbar.", 503);
    }
    const user = await authenticateSupabaseRequest(request, supabase);
    scenario = await parseScenario(request);
    enforceRateLimit(request, user.id);
  } catch (error) {
    return json(
      { error: searchErrorMessage(error) },
      error instanceof UserVisibleError ? error.status : 500,
    );
  }

  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: BfgProStreamEvent) => {
        if (!open) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(encodeBfgProStreamEvent(event)));
        } catch {
          open = false;
        }
      };
      try {
        const { results } = await runBfgProSearch(scenario, {
          onProgress: (progress) => send({ type: "status", ...progress }),
        });
        send({ type: "result", results });
      } catch (error) {
        send({ type: "error", error: searchErrorMessage(error) });
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      open = false;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": `${BFG_PRO_STREAM_CONTENT_TYPE}; charset=utf-8`,
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
      Vary: "Authorization",
    },
  });
}
