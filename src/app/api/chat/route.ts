import { NextResponse } from "next/server";

import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL,
  DEFAULT_SYSTEM_PROMPT,
  isSupportedModel,
  MAX_DEEPSEEK_KEY_CHARS,
  MAX_MCP_TOKEN_CHARS,
  MAX_MESSAGE_CHARS,
  MAX_MESSAGES,
  MAX_REQUEST_BYTES,
  MAX_SYSTEM_PROMPT_CHARS,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from "@/lib/config";
import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { type AppChatMessage } from "@/lib/deepseek";
import { UserVisibleError } from "@/lib/errors";
import { persistConversationTurn } from "@/lib/persistence";
import { runAgent } from "@/lib/agent";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type ChatRequestBody = {
  deepSeekApiKey?: unknown;
  mcpBearerToken?: unknown;
  model?: unknown;
  systemPrompt?: unknown;
  messages?: unknown;
  conversationId?: unknown;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const rateLimit = new Map<string, RateLimitEntry>();

function pruneExpiredRateLimitEntries(now: number): void {
  for (const [key, entry] of rateLimit) {
    if (entry.resetAt <= now) {
      rateLimit.delete(key);
    }
  }
}

function clientKey(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function enforceRateLimit(request: Request): void {
  const now = Date.now();
  pruneExpiredRateLimitEntries(now);
  const key = clientKey(request);
  const current = rateLimit.get(key);

  if (!current || current.resetAt <= now) {
    rateLimit.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return;
  }

  if (current.count >= RATE_LIMIT_MAX_REQUESTS) {
    throw new UserVisibleError("Zu viele Anfragen. Bitte in einigen Minuten erneut versuchen.", 429);
  }

  current.count += 1;
}

function enforceRequestSize(request: Request): void {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_REQUEST_BYTES) {
    throw new UserVisibleError("Die Anfrage ist zu groß.", 413);
  }
}

function asOptionalString(value: unknown, maxLength: number, label: string): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new UserVisibleError(`${label} ist zu lang.`, 400);
  }

  return trimmed;
}

function parseMessages(value: unknown): AppChatMessage[] {
  if (!Array.isArray(value)) {
    throw new UserVisibleError("Die Chat-Anfrage enthält keine gültigen Nachrichten.", 400);
  }
  if (value.length > MAX_MESSAGES) {
    throw new UserVisibleError(`Bitte maximal ${MAX_MESSAGES} Nachrichten mitsenden.`, 400);
  }

  const messages = value.map((message): AppChatMessage => {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      throw new UserVisibleError("Eine Chat-Nachricht ist ungültig.", 400);
    }
    const item = message as Record<string, unknown>;
    if ((item.role !== "user" && item.role !== "assistant") || typeof item.content !== "string") {
      throw new UserVisibleError("Eine Chat-Nachricht hat eine ungültige Rolle oder keinen Text.", 400);
    }
    const content = item.content.trim();
    if (content.length > MAX_MESSAGE_CHARS) {
      throw new UserVisibleError(`Eine Chat-Nachricht ist länger als ${MAX_MESSAGE_CHARS} Zeichen.`, 400);
    }
    return {
      role: item.role,
      content,
    };
  });

  if (!messages.some((message) => message.role === "user" && message.content.trim())) {
    throw new UserVisibleError("Bitte zuerst eine Frage eingeben.", 400);
  }

  return messages;
}

export async function POST(request: Request) {
  try {
    enforceRateLimit(request);
    enforceRequestSize(request);

    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Anmeldung kann derzeit nicht geprüft werden.", 503);
    }
    const authenticatedUser = await authenticateSupabaseRequest(request, supabase);

    const body = (await request.json()) as ChatRequestBody;
    const deepSeekApiKey = asOptionalString(body.deepSeekApiKey, MAX_DEEPSEEK_KEY_CHARS, "DeepSeek API Key");
    if (!deepSeekApiKey) {
      throw new UserVisibleError("DeepSeek API Key fehlt. Bitte in den Einstellungen eintragen.", 400);
    }

    const requestedModel = asOptionalString(body.model, 80, "Modell") ?? DEFAULT_MODEL;
    const model = isSupportedModel(requestedModel) ? requestedModel : DEFAULT_MODEL;
    const systemPrompt =
      asOptionalString(body.systemPrompt, MAX_SYSTEM_PROMPT_CHARS, "System Prompt") ??
      DEFAULT_SYSTEM_PROMPT;
    const messages = parseMessages(body.messages);
    const mcpBearerToken = asOptionalString(body.mcpBearerToken, MAX_MCP_TOKEN_CHARS, "MCP Bearer Token");

    const answer = await runAgent({
      apiKey: deepSeekApiKey,
      model,
      systemPrompt,
      messages,
      mcpBearerToken,
    });

    const latestUserMessage = messages.findLast((message) => message.role === "user");
    await persistConversationTurn({
      conversationId: asOptionalString(body.conversationId, 80, "Conversation ID"),
      clientId: authenticatedUser.id,
      userMessage: latestUserMessage?.content,
      assistantMessage: answer,
    });

    return NextResponse.json({
      answer,
      model,
      availableModels: AVAILABLE_MODELS,
    });
  } catch (error) {
    if (error instanceof UserVisibleError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("Chat route failed");
    return NextResponse.json(
      {
        error: "Unerwarteter Serverfehler. Bitte später erneut versuchen.",
      },
      {
        status: 500,
      },
    );
  }
}
