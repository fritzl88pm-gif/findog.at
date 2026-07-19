import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { renderChatPdf } from "@/lib/documents/pdf";
import { UserVisibleError } from "@/lib/errors";
import { formatViennaDate } from "@/lib/forms/values";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MAX_PDF_TITLE_CHARS = 160;
const MAX_PDF_CONTENT_CHARS = 60_000;
const MAX_PDF_JSON_BYTES = 100_000;

type PdfRequestBody = {
  title: string;
  content: string;
};

function invalidRequest(status = 400): UserVisibleError {
  return new UserVisibleError("Die PDF-Anfrage ist ungültig.", status);
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    throw invalidRequest();
  }

  const rawLength = request.headers.get("content-length");
  if (rawLength !== null) {
    if (!/^\d+$/.test(rawLength)) {
      throw invalidRequest();
    }
    const contentLength = Number(rawLength);
    if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
      throw invalidRequest();
    }
    if (contentLength > MAX_PDF_JSON_BYTES) {
      throw invalidRequest(413);
    }
  }

  if (!request.body) {
    throw invalidRequest();
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > MAX_PDF_JSON_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw invalidRequest(413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw invalidRequest();
  }
}

function validatePayload(value: unknown): PdfRequestBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidRequest();
  }
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).length !== 2
    || typeof body.title !== "string"
    || typeof body.content !== "string"
  ) {
    throw invalidRequest();
  }

  const title = body.title.trim();
  const content = body.content.trim();
  if (
    !title
    || !content
    || title.length > MAX_PDF_TITLE_CHARS
    || content.length > MAX_PDF_CONTENT_CHARS
  ) {
    throw invalidRequest();
  }
  return { title, content };
}

function safeFilename(title: string, date: string): string {
  const stem = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 70) || "Berechnung";
  return `${stem}_${date}.pdf`;
}

function safeErrorDetails(error: unknown): Record<string, string> {
  if (error instanceof Error) {
    return { name: error.name.slice(0, 100), message: error.message.slice(0, 500) };
  }
  return { message: String(error).slice(0, 500) };
}

export async function POST(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError(
        "Die PDF-Erstellung ist serverseitig nicht konfiguriert. Bitte Administrator kontaktieren.",
        503,
      );
    }
    await authenticateSupabaseRequest(request, supabase);

    const payload = validatePayload(await readBoundedJson(request));
    const date = formatViennaDate();
    let pdf: Uint8Array;
    try {
      pdf = await renderChatPdf({ ...payload, date });
    } catch (error) {
      console.error("Tool PDF rendering failed", safeErrorDetails(error));
      throw new UserVisibleError(
        "Das PDF konnte nicht erstellt werden. Bitte später erneut versuchen.",
        500,
      );
    }

    return new Response(Uint8Array.from(pdf).buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeFilename(payload.title, date)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof UserVisibleError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("Tool PDF route failed", safeErrorDetails(error));
    return NextResponse.json(
      { error: "Das PDF konnte nicht erstellt werden. Bitte später erneut versuchen." },
      { status: 500 },
    );
  }
}
