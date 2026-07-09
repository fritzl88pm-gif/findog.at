import { NextResponse } from "next/server";

import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL,
  DEFAULT_SYSTEM_PROMPT,
  isSupportedModel,
  MAX_MESSAGE_CHARS,
  MAX_MESSAGES,
  MAX_MULTIPART_REQUEST_BYTES,
  MAX_PDF_UPLOAD_BYTES,
  MAX_REQUEST_BYTES,
  MAX_SYSTEM_PROMPT_CHARS,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from "@/lib/config";
import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { type AppChatMessage } from "@/lib/deepseek";
import { resolveDeepSeekApiKey } from "@/lib/deepseek-key";
import { UserVisibleError } from "@/lib/errors";
import { persistConversationTurn, resolveConversationIdForClient } from "@/lib/persistence";
import { runAgent, type PdfContext } from "@/lib/agent";
import type { AgentStep } from "@/lib/agent-steps";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getServerMcpBearerToken } from "@/lib/mcp/server-token";
import { CHAT_STREAM_CONTENT_TYPE, encodeChatStreamEvent } from "@/lib/chat-stream";
import { extractPdfContext } from "@/lib/pdf-context";

export const runtime = "nodejs";

type ChatRequestBody = {
  deepSeekApiKey?: unknown;
  model?: unknown;
  systemPrompt?: unknown;
  messages?: unknown;
  conversationId?: unknown;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

type PdfUpload = {
  filename: string;
  mimeType: "application/pdf";
  bytes: Uint8Array;
};

type ParsedChatRequest = {
  body: ChatRequestBody;
  pdfUpload?: PdfUpload;
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

function isMultipartRequest(request: Request): boolean {
  return request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data") ?? false;
}

function enforceRequestSize(request: Request): void {
  const contentLength = request.headers.get("content-length");
  const maxBytes = isMultipartRequest(request) ? MAX_MULTIPART_REQUEST_BYTES : MAX_REQUEST_BYTES;
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new UserVisibleError("Die Anfrage ist zu groß.", 413);
  }
}

function wantsStreamingResponse(request: Request): boolean {
  return request.headers
    .get("accept")
    ?.toLowerCase()
    .split(",")
    .some((value) => value.trim().startsWith(CHAT_STREAM_CONTENT_TYPE)) ?? false;
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

function sanitizePdfFilename(value: string): string {
  const cleaned = value
    .replace(/[\\/\0<>:"|?*]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

  return cleaned || "document.pdf";
}

function parseJsonPayload(value: unknown): ChatRequestBody {
  if (typeof value !== "string" || !value.trim()) {
    throw new UserVisibleError("Die Chat-Anfrage enthält kein gültiges Payload.", 400);
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ChatRequestBody;
    }
  } catch {
    throw new UserVisibleError("Die Chat-Anfrage enthält kein gültiges JSON-Payload.", 400);
  }

  throw new UserVisibleError("Die Chat-Anfrage enthält kein gültiges JSON-Payload.", 400);
}

function isUploadedFile(value: FormDataEntryValue): value is File {
  return typeof File !== "undefined" && value instanceof File;
}

async function parseMultipartChatRequest(request: Request): Promise<ParsedChatRequest> {
  const formData = await request.formData();
  const body = parseJsonPayload(formData.get("payload"));
  const pdfFiles = formData
    .getAll("pdf")
    .filter((value): value is File => isUploadedFile(value) && value.size > 0);

  if (pdfFiles.length === 0) {
    return { body };
  }
  if (pdfFiles.length > 1) {
    throw new UserVisibleError("Bitte nur ein PDF pro Anfrage hochladen.", 400);
  }

  const pdf = pdfFiles[0];
  if (!pdf) {
    return { body };
  }
  if (pdf.type !== "application/pdf") {
    throw new UserVisibleError("Bitte nur PDF-Dateien hochladen.", 400);
  }
  if (pdf.size > MAX_PDF_UPLOAD_BYTES) {
    throw new UserVisibleError("Das PDF ist zu groß. Maximal 50 MB sind erlaubt.", 413);
  }

  return {
    body,
    pdfUpload: {
      filename: sanitizePdfFilename(pdf.name),
      mimeType: "application/pdf",
      bytes: new Uint8Array(await pdf.arrayBuffer()),
    },
  };
}

async function parseChatRequest(request: Request): Promise<ParsedChatRequest> {
  if (isMultipartRequest(request)) {
    return parseMultipartChatRequest(request);
  }

  return { body: (await request.json()) as ChatRequestBody };
}

async function preparePdfContext(
  pdfUpload: PdfUpload | undefined,
  onStep?: (step: AgentStep) => void | Promise<void>,
): Promise<{ pdfContext?: PdfContext; initialSteps: AgentStep[] }> {
  if (!pdfUpload) {
    return { initialSteps: [] };
  }

  const readingStep: AgentStep = {
    type: "pdf_context",
    title: "PDF wird gelesen",
    content: `${pdfUpload.filename} wird ausgelesen.`,
  };
  await onStep?.(readingStep);

  const content = await extractPdfContext(pdfUpload);
  const extractedStep: AgentStep = {
    type: "pdf_context",
    title: "PDF-Kontext extrahiert",
    content: `${pdfUpload.filename}: ${content.length.toLocaleString("de-AT")} Zeichen PDF-Inhalt wurden für die Antwort berücksichtigt.`,
  };
  await onStep?.(extractedStep);

  return {
    pdfContext: {
      filename: pdfUpload.filename,
      content,
    },
    initialSteps: [readingStep, extractedStep],
  };
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

    const { body, pdfUpload } = await parseChatRequest(request);
    const requestedModel = asOptionalString(body.model, 80, "Modell") ?? DEFAULT_MODEL;
    const model = isSupportedModel(requestedModel) ? requestedModel : DEFAULT_MODEL;
    const deepSeekApiKey = resolveDeepSeekApiKey({
      model,
      userApiKey: typeof body.deepSeekApiKey === "string" ? body.deepSeekApiKey : undefined,
    });
    const systemPrompt =
      asOptionalString(body.systemPrompt, MAX_SYSTEM_PROMPT_CHARS, "System Prompt") ??
      DEFAULT_SYSTEM_PROMPT;
    const messages = parseMessages(body.messages);
    const mcpBearerToken = getServerMcpBearerToken();
    const conversationId = await resolveConversationIdForClient({
      conversationId: asOptionalString(body.conversationId, 80, "Conversation ID"),
      clientId: authenticatedUser.id,
      supabase,
    });

    const latestUserMessage = messages.findLast((message) => message.role === "user");

    if (wantsStreamingResponse(request)) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: Parameters<typeof encodeChatStreamEvent>[0]) => {
            controller.enqueue(encoder.encode(encodeChatStreamEvent(event)));
          };

          try {
            const pdfAgentContext = await preparePdfContext(pdfUpload, (step) => send({ type: "step", step }));
            const agentResult = await runAgent({
              apiKey: deepSeekApiKey,
              model,
              systemPrompt,
              messages,
              mcpBearerToken,
              pdfContext: pdfAgentContext.pdfContext,
              initialSteps: pdfAgentContext.initialSteps,
              onStep: (step) => send({ type: "step", step }),
            });

            await persistConversationTurn({
              conversationId,
              clientId: authenticatedUser.id,
              userMessage: latestUserMessage?.content,
              assistantMessage: agentResult.answer,
            });

            send({
              type: "final",
              answer: agentResult.answer,
              steps: agentResult.steps,
              tools: agentResult.tools,
              conversationId,
              model,
              availableModels: AVAILABLE_MODELS,
            });
          } catch (streamError) {
            if (!(streamError instanceof UserVisibleError)) {
              console.error("Chat stream failed");
            }
            send({
              type: "error",
              error:
                streamError instanceof UserVisibleError
                  ? streamError.message
                  : "Unerwarteter Serverfehler. Bitte später erneut versuchen.",
            });
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": `${CHAT_STREAM_CONTENT_TYPE}; charset=utf-8`,
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
        },
      });
    }

    const pdfAgentContext = await preparePdfContext(pdfUpload);
    const agentResult = await runAgent({
      apiKey: deepSeekApiKey,
      model,
      systemPrompt,
      messages,
      mcpBearerToken,
      pdfContext: pdfAgentContext.pdfContext,
      initialSteps: pdfAgentContext.initialSteps,
    });

    await persistConversationTurn({
      conversationId,
      clientId: authenticatedUser.id,
      userMessage: latestUserMessage?.content,
      assistantMessage: agentResult.answer,
    });

    return NextResponse.json({
      answer: agentResult.answer,
      steps: agentResult.steps,
      tools: agentResult.tools,
      conversationId,
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
