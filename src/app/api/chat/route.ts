import { NextResponse } from "next/server";

import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL,
  DEFAULT_SYSTEM_PROMPT,
  isSupportedModel,
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_MESSAGE_CHARS,
  MAX_IMAGE_UPLOADS,
  MAX_MESSAGES,
  MAX_MULTIPART_REQUEST_BYTES,
  MAX_PDF_UPLOAD_BYTES,
  MAX_PDF_UPLOADS,
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
import { runAgent, type AttachmentContext } from "@/lib/agent";
import type { AgentStep } from "@/lib/agent-steps";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getServerMcpBearerToken } from "@/lib/mcp/server-token";
import { CHAT_STREAM_CONTENT_TYPE, encodeChatStreamEvent } from "@/lib/chat-stream";
import { extractImageContext, extractPdfContext } from "@/lib/pdf-context";

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
      const content = upload.type === "pdf" ? await extractPdfContext(upload) : await extractImageContext(upload);
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
  try {
    enforceRateLimit(request);
    enforceRequestSize(request);

    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Anmeldung kann derzeit nicht geprüft werden.", 503);
    }
    const authenticatedUser = await authenticateSupabaseRequest(request, supabase);

    const { body, attachmentUploads } = await parseChatRequest(request);
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
            const attachmentAgentContext = await prepareAttachmentContexts(attachmentUploads, (step) => send({ type: "step", step }));
            const agentResult = await runAgent({
              apiKey: deepSeekApiKey,
              model,
              systemPrompt,
              messages,
              mcpBearerToken,
              attachmentContexts: attachmentAgentContext.attachmentContexts,
              initialSteps: attachmentAgentContext.initialSteps,
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

    const attachmentAgentContext = await prepareAttachmentContexts(attachmentUploads);
    const agentResult = await runAgent({
      apiKey: deepSeekApiKey,
      model,
      systemPrompt,
      messages,
      mcpBearerToken,
      attachmentContexts: attachmentAgentContext.attachmentContexts,
      initialSteps: attachmentAgentContext.initialSteps,
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
