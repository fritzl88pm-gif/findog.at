import { after, NextResponse } from "next/server";

import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL,
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_IMAGE_UPLOADS,
  MAX_MESSAGES,
  MAX_MULTIPART_REQUEST_BYTES,
  MAX_PDF_UPLOAD_BYTES,
  MAX_PDF_UPLOADS,
  MAX_REQUEST_BYTES,
  MAX_SYSTEM_PROMPT_CHARS,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
  isSupportedModel,
  type ChatModel,
} from "@/lib/config";
import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { type AppChatMessage } from "@/lib/deepseek";
import { resolveDeepSeekApiKey } from "@/lib/deepseek-key";
import { UserVisibleError } from "@/lib/errors";
import { persistConversationTurn, resolveConversationContextForClient } from "@/lib/persistence";
import { runAgent, type AttachmentContext } from "@/lib/agent";
import type { AgentStep } from "@/lib/agent-steps";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getServerMcpBearerToken } from "@/lib/mcp/server-token";
import { CHAT_STREAM_CONTENT_TYPE, encodeChatStreamEvent } from "@/lib/chat-stream";
import { extractImageContext, extractPdfContext } from "@/lib/pdf-context";
import { createUnboundedDeadline, type Deadline } from "@/lib/deadline";
import { generateConversationTitle } from "@/lib/conversation-title";
import { getGlobalSystemPrompt } from "@/lib/admin-settings";
import { recordAdminRequest } from "@/lib/admin-request-history";

export const runtime = "nodejs";

type ChatRequestBody = {
  systemPrompt?: unknown;
  usesGlobalDefault?: unknown;
  messages?: unknown;
  conversationId?: unknown;
  model?: unknown;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

type PdfUpload = {
  type: "pdf";
  filename: string;
  mimeType: "application/pdf";
  bytes: Uint8Array;
};

type ImageUpload = {
  type: "image";
  filename: string;
  mimeType: `image/${string}`;
  bytes: Uint8Array;
};

type AttachmentUpload = PdfUpload | ImageUpload;

type ParsedChatRequest = {
  body: ChatRequestBody;
  attachmentUploads: AttachmentUpload[];
};

const rateLimit = new Map<string, RateLimitEntry>();
const MAX_ATTACHMENT_EXTRACTION_CONCURRENCY = 3;

function sanitizeLogText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9._-]{8,}/giu, "sk-[redacted]")
    .slice(0, 2_000);
}

function safeErrorDetails(error: unknown): Record<string, string> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: sanitizeLogText(error.message),
    };
  }

  return { message: sanitizeLogText(String(error)) };
}

function scheduleConversationPersistence(options: Parameters<typeof persistConversationTurn>[0]): void {
  after(() => {
    void persistConversationTurn(options).catch((error) => {
      console.error("Chat persistence failed", safeErrorDetails(error));
    });
  });
}

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

function parseModel(value: unknown): ChatModel {
  if (value === undefined) {
    return DEFAULT_MODEL;
  }
  if (typeof value !== "string" || !isSupportedModel(value)) {
    throw new UserVisibleError("Das ausgewählte Modell wird nicht unterstützt.", 400);
  }
  return value;
}

function sanitizeAttachmentFilename(value: string): string {
  const cleaned = value
    .replace(/[\\/\0<>:"|?*]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 255);

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

function isImageMimeType(value: string): value is `image/${string}` {
  return value.toLowerCase().startsWith("image/");
}

async function parseMultipartChatRequest(request: Request): Promise<ParsedChatRequest> {
  const formData = await request.formData();
  const body = parseJsonPayload(formData.get("payload"));
  const pdfFiles = formData
    .getAll("pdf")
    .filter((value): value is File => isUploadedFile(value) && value.size > 0);
  const imageFiles = formData
    .getAll("image")
    .filter((value): value is File => isUploadedFile(value) && value.size > 0);

  if (pdfFiles.length > MAX_PDF_UPLOADS) {
    throw new UserVisibleError(`Bitte maximal ${MAX_PDF_UPLOADS} PDF-Dateien pro Anfrage hochladen.`, 400);
  }
  if (imageFiles.length > MAX_IMAGE_UPLOADS) {
    throw new UserVisibleError(`Bitte maximal ${MAX_IMAGE_UPLOADS} Bilder pro Anfrage hochladen.`, 400);
  }

  const pdfUploads: PdfUpload[] = [];
  for (const pdf of pdfFiles) {
    if (pdf.type !== "application/pdf") {
      throw new UserVisibleError("Bitte nur PDF-Dateien hochladen.", 400);
    }
    if (pdf.size > MAX_PDF_UPLOAD_BYTES) {
      throw new UserVisibleError("Das PDF ist zu groß. Maximal 50 MB sind erlaubt.", 413);
    }

    pdfUploads.push({
      type: "pdf",
      filename: sanitizeAttachmentFilename(pdf.name),
      mimeType: "application/pdf",
      bytes: new Uint8Array(await pdf.arrayBuffer()),
    });
  }

  const imageUploads: ImageUpload[] = [];
  for (const image of imageFiles) {
    if (!isImageMimeType(image.type)) {
      throw new UserVisibleError("Bitte nur Bilddateien hochladen.", 400);
    }
    if (image.size > MAX_IMAGE_UPLOAD_BYTES) {
      throw new UserVisibleError("Das Bild ist zu groß. Maximal 5 MB sind erlaubt.", 413);
    }

    imageUploads.push({
      type: "image",
      filename: sanitizeAttachmentFilename(image.name),
      mimeType: image.type,
      bytes: new Uint8Array(await image.arrayBuffer()),
    });
  }

  return {
    body,
    attachmentUploads: [...pdfUploads, ...imageUploads],
  };
}

async function parseChatRequest(request: Request): Promise<ParsedChatRequest> {
  if (isMultipartRequest(request)) {
    return parseMultipartChatRequest(request);
  }

  return { body: (await request.json()) as ChatRequestBody, attachmentUploads: [] };
}

async function prepareAttachmentContexts(
  attachmentUploads: AttachmentUpload[],
  onStep?: (step: AgentStep) => void | Promise<void>,
  deadline?: Deadline,
): Promise<{ attachmentContexts?: AttachmentContext[]; initialSteps: AgentStep[] }> {
  if (attachmentUploads.length === 0) {
    return { initialSteps: [] };
  }

  const attachmentContexts: AttachmentContext[] = [];
  const initialSteps: AgentStep[] = [];

  for (const upload of attachmentUploads) {
    const label = upload.type === "pdf" ? "PDF" : "Bild";
    const readingStep: AgentStep = {
      type: "attachment_context",
      title: `${label} wird gelesen`,
      content: `${upload.filename} wird ausgelesen.`,
    };
    initialSteps.push(readingStep);
    await onStep?.(readingStep);
  }

  const results: Array<{ context: AttachmentContext; extractedStep: AgentStep }> = [];
  let nextIndex = 0;

  async function extractNextAttachment(): Promise<void> {
    while (nextIndex < attachmentUploads.length) {
      const index = nextIndex;
      nextIndex += 1;
      const upload = attachmentUploads[index];
      if (!upload) {
        continue;
      }

      const label = upload.type === "pdf" ? "PDF" : "Bild";
      const content =
        upload.type === "pdf"
          ? await extractPdfContext({ ...upload, deadline })
          : await extractImageContext({ ...upload, deadline });
      const extractedStep: AgentStep = {
        type: "attachment_context",
        title: `${label}-Kontext extrahiert`,
        content: `${upload.filename}: ${content.length.toLocaleString("de-AT")} Zeichen ${label}-Inhalt wurden für die Antwort berücksichtigt.`,
      };
      await onStep?.(extractedStep);

      results[index] = {
        extractedStep,
        context: {
          type: upload.type,
          filename: upload.filename,
          content,
        },
      };
    }
  }

  const workerCount = Math.min(MAX_ATTACHMENT_EXTRACTION_CONCURRENCY, attachmentUploads.length);
  await Promise.all(Array.from({ length: workerCount }, () => extractNextAttachment()));

  for (const result of results) {
    initialSteps.push(result.extractedStep);
    attachmentContexts.push(result.context);
  }

  return {
    attachmentContexts,
    initialSteps,
  };
}

export async function POST(request: Request) {
  const deadline = createUnboundedDeadline({ parentSignal: request.signal });
  let disposeDeadline = true;

  try {
    enforceRateLimit(request);
    enforceRequestSize(request);

    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Anmeldung kann derzeit nicht geprüft werden.", 503);
    }
    const authenticatedUser = await authenticateSupabaseRequest(request, supabase);

    const { body, attachmentUploads } = await parseChatRequest(request);
    const model = parseModel(body.model);
    const deepSeekApiKey = resolveDeepSeekApiKey();
    const personalSystemPrompt = asOptionalString(
      body.systemPrompt,
      MAX_SYSTEM_PROMPT_CHARS,
      "System Prompt",
    );
    const usesGlobalDefault = body.usesGlobalDefault === true || !personalSystemPrompt;
    const systemPrompt = usesGlobalDefault
      ? await getGlobalSystemPrompt(supabase)
      : personalSystemPrompt;
    const messages = parseMessages(body.messages);
    const mcpBearerToken = getServerMcpBearerToken();
    const requestedConversationId = asOptionalString(body.conversationId, 80, "Conversation ID");
    const conversationContext = await resolveConversationContextForClient({
      conversationId: requestedConversationId,
      clientId: authenticatedUser.id,
      supabase,
    });
    const conversationId = conversationContext.id;

    const latestUserMessage = messages.findLast(
      (message) => message.role === "user" && Boolean(message.content),
    );
    if (!latestUserMessage) {
      throw new UserVisibleError("Bitte zuerst eine Frage eingeben.", 400);
    }
    await recordAdminRequest({
      supabase,
      userId: authenticatedUser.id,
      conversationId,
      content: latestUserMessage.content,
    });

    const isNewConversation = conversationContext.isNew;
    const titlePromise = isNewConversation && latestUserMessage
      ? generateConversationTitle({
          apiKey: deepSeekApiKey,
          model,
          userRequest: latestUserMessage.content,
          deadline,
        })
      : Promise.resolve(conversationContext.title);

    if (wantsStreamingResponse(request)) {
      disposeDeadline = false;
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: Parameters<typeof encodeChatStreamEvent>[0]) => {
            controller.enqueue(encoder.encode(encodeChatStreamEvent(event)));
          };

          try {
            const attachmentAgentContext = await prepareAttachmentContexts(
              attachmentUploads,
              (step) => send({ type: "step", step }),
              deadline,
            );
            const startedAt = new Date().toISOString();
            const [agentResult, title] = await Promise.all([
              runAgent({
                apiKey: deepSeekApiKey,
                model,
                systemPrompt,
                messages,
                mcpBearerToken,
                attachmentContexts: attachmentAgentContext.attachmentContexts,
                initialSteps: attachmentAgentContext.initialSteps,
                deadline,
                onStep: (step) => send({ type: "step", step }),
              }),
              titlePromise,
            ]);
            const completedAt = new Date().toISOString();

            send({
              type: "final",
              answer: agentResult.answer,
              ...(title ? { title } : {}),
              steps: agentResult.steps,
              tools: agentResult.tools,
              conversationId,
              model,
              availableModels: AVAILABLE_MODELS,
            });

            scheduleConversationPersistence({
              conversationId,
              clientId: authenticatedUser.id,
              userMessage: latestUserMessage?.content,
              assistantMessage: agentResult.answer,
              title,
              model,
              steps: agentResult.steps,
              startedAt,
              completedAt,
            });
          } catch (streamError) {
            if (!(streamError instanceof UserVisibleError)) {
              console.error("Chat stream failed", safeErrorDetails(streamError));
            }
            send({
              type: "error",
              error:
                streamError instanceof UserVisibleError
                  ? streamError.message
                  : "Unerwarteter Serverfehler. Bitte später erneut versuchen.",
            });
          } finally {
            deadline.dispose();
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

    const attachmentAgentContext = await prepareAttachmentContexts(attachmentUploads, undefined, deadline);
    const startedAt = new Date().toISOString();
    const [agentResult, title] = await Promise.all([
      runAgent({
        apiKey: deepSeekApiKey,
        model,
        systemPrompt,
        messages,
        mcpBearerToken,
        attachmentContexts: attachmentAgentContext.attachmentContexts,
        initialSteps: attachmentAgentContext.initialSteps,
        deadline,
      }),
      titlePromise,
    ]);
    const completedAt = new Date().toISOString();

    scheduleConversationPersistence({
      conversationId,
      clientId: authenticatedUser.id,
      userMessage: latestUserMessage?.content,
      assistantMessage: agentResult.answer,
      title,
      model,
      steps: agentResult.steps,
      startedAt,
      completedAt,
    });

    return NextResponse.json({
      answer: agentResult.answer,
      ...(title ? { title } : {}),
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

    console.error("Chat route failed", safeErrorDetails(error));
    return NextResponse.json(
      {
        error: "Unerwarteter Serverfehler. Bitte später erneut versuchen.",
      },
      {
        status: 500,
      },
    );
  } finally {
    if (disposeDeadline) {
      deadline.dispose();
    }
  }
}
