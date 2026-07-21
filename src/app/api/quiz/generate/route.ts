import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { generateQuiz, CATEGORIES } from "@/lib/quiz/generate";

export const runtime = "nodejs";

const MAX_JSON_BODY_BYTES = 2_048;
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 120_000;

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();
let nextRateLimitSweepAt = 0;

function safeErrorDetails(error: unknown): Record<string, string> {
  if (error instanceof Error) {
    return { name: error.name.slice(0, 100), message: error.message.slice(0, 500) };
  }
  return { message: String(error).slice(0, 500) };
}

function getRateLimitKey(userId: string): string {
  return `quiz:${userId}`;
}

function checkRateLimit(userId: string): void {
  const now = Date.now();
  if (now >= nextRateLimitSweepAt) {
    for (const [storedKey, storedEntry] of rateLimitStore) {
      if (now >= storedEntry.resetAt) {
        rateLimitStore.delete(storedKey);
      }
    }
    nextRateLimitSweepAt = now + RATE_LIMIT_WINDOW_MS;
  }
  const key = getRateLimitKey(userId);
  const entry = rateLimitStore.get(key);

  if (entry && now < entry.resetAt) {
    if (entry.count >= RATE_LIMIT_MAX) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      throw new UserVisibleError(
        `Du hast das Quiz-Limit erreicht. Bitte warte ${retryAfter} Sekunden.`,
        429,
      );
    }
    entry.count += 1;
  } else {
    rateLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
  }
}

async function readBoundedJsonBody(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const length = Number(contentLength);
    if (!Number.isSafeInteger(length) || length <= 0) {
      throw new UserVisibleError("Die Anfrage ist ungültig.", 400);
    }
    if (length > MAX_JSON_BODY_BYTES) {
      throw new UserVisibleError("Die Anfrage ist zu groß.", 413);
    }
  }

  if (!request.body) {
    throw new UserVisibleError("Die Anfrage ist ungültig.", 400);
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_JSON_BODY_BYTES) {
        await reader.cancel();
        throw new UserVisibleError("Die Anfrage ist zu groß.", 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new UserVisibleError("Die Anfrage enthält kein gültiges JSON.", 400);
  }
}

function validateRequestBody(body: unknown): { category: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new UserVisibleError("Die Anfrage ist ungültig.", 400);
  }

  const obj = body as Record<string, unknown>;
  const allowedKeys = new Set(["category"]);
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.has(key)) {
      throw new UserVisibleError("Die Anfrage enthält unbekannte Felder.", 400);
    }
  }

  if (typeof obj.category !== "string" || !obj.category.trim()) {
    throw new UserVisibleError("Bitte eine gültige Kategorie angeben.", 400);
  }

  const category = obj.category.trim();
  if (!CATEGORIES.includes(category as typeof CATEGORIES[number])) {
    throw new UserVisibleError(
      `Ungültige Kategorie. Erlaubt: ${CATEGORIES.join(", ")}.`,
      400,
    );
  }

  return { category };
}

export async function POST(request: Request) {
  try {
    if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
      throw new UserVisibleError("Diese Quiz-Anfrage ist nicht erlaubt.", 403);
    }

    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError(
        "Der Quiz-Dienst ist serverseitig nicht konfiguriert.",
        503,
      );
    }

    const user = await authenticateSupabaseRequest(request, supabase);

    const body = await readBoundedJsonBody(request);
    const { category } = validateRequestBody(body);

    checkRateLimit(user.id);

    const quiz = await generateQuiz(category);

    return NextResponse.json(quiz, {
      status: 200,
      headers: {
        "Cache-Control": "no-store, private",
      },
    });
  } catch (error) {
    if (error instanceof UserVisibleError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("Quiz generation route failed", safeErrorDetails(error));
    return NextResponse.json(
      { error: "Das Quiz konnte nicht erstellt werden. Bitte später erneut versuchen." },
      { status: 500 },
    );
  }
}
