import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import {
  isFormImageMimeType,
  MAX_FORM_IMAGE_BYTES,
  MAX_FORM_MULTIPART_BYTES,
  MAX_SALDO_INPUT_CHARS,
  VERF5_FORM_ID,
} from "@/lib/forms/config";
import { renderVerf5Document } from "@/lib/forms/docx";
import { extractVerf5ImageFields } from "@/lib/forms/extraction";
import { formatViennaDate, normalizeManualSaldo } from "@/lib/forms/values";
import { FORM_TEMPLATE_BUCKET, VERF5_TEMPLATE_PATH } from "@/lib/forms/server-config";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function safeErrorDetails(error: unknown): Record<string, string> {
  if (error instanceof Error) {
    return { name: error.name.slice(0, 100), message: error.message.slice(0, 500) };
  }
  return { message: String(error).slice(0, 500) };
}

function requireMultipartRequest(request: Request): void {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    throw new UserVisibleError("Die Formularanfrage ist ungültig.", 400);
  }

  const rawContentLength = request.headers.get("content-length");
  if (rawContentLength === null || !/^\d+$/.test(rawContentLength)) {
    throw new UserVisibleError("Die Formularanfrage ist ungültig.", 400);
  }

  const contentLength = Number(rawContentLength);
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
    throw new UserVisibleError("Die Formularanfrage ist ungültig.", 400);
  }
  if (contentLength > MAX_FORM_MULTIPART_BYTES) {
    throw new UserVisibleError("Die Formularanfrage ist zu groß.", 413);
  }
}

function singleTextField(formData: FormData, name: string, required: boolean): string {
  const values = formData.getAll(name);
  if (values.length !== 1 || typeof values[0] !== "string") {
    if (!required && values.length === 0) {
      return "";
    }
    throw new UserVisibleError("Die Formularanfrage ist ungültig.", 400);
  }
  return values[0];
}

function isUploadedFile(value: FormDataEntryValue): value is File {
  return typeof File !== "undefined" && value instanceof File;
}

async function parseFormRequest(request: Request): Promise<{
  imageBytes: Uint8Array;
  imageMimeType: "image/jpeg" | "image/png" | "image/webp";
  saldo: string;
}> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    throw new UserVisibleError("Die Formularanfrage ist ungültig.", 400);
  }

  let measuredBytes = 0;
  for (const [name, value] of formData.entries()) {
    measuredBytes += Buffer.byteLength(name);
    measuredBytes += typeof value === "string" ? Buffer.byteLength(value) : value.size;
  }
  if (measuredBytes > MAX_FORM_MULTIPART_BYTES) {
    throw new UserVisibleError("Die Formularanfrage ist zu groß.", 413);
  }

  const formId = singleTextField(formData, "formId", true);
  if (formId !== VERF5_FORM_ID) {
    throw new UserVisibleError("Das ausgewählte Formular wird nicht unterstützt.", 400);
  }

  const rawSaldo = singleTextField(formData, "saldo", false);
  if (rawSaldo.length > MAX_SALDO_INPUT_CHARS) {
    throw new UserVisibleError("Der Saldo ist ungültig.", 400);
  }
  const saldo = normalizeManualSaldo(rawSaldo);

  const images = formData.getAll("image");
  if (images.length !== 1 || !isUploadedFile(images[0]) || images[0].size === 0) {
    throw new UserVisibleError("Bitte genau ein Bild hochladen.", 400);
  }
  const image = images[0];
  const mimeType = image.type.toLowerCase();
  if (!isFormImageMimeType(mimeType)) {
    throw new UserVisibleError("Bitte nur JPEG-, PNG- oder WebP-Bilder hochladen.", 400);
  }
  if (image.size > MAX_FORM_IMAGE_BYTES) {
    throw new UserVisibleError("Das Bild ist zu groß. Maximal 5 MB sind erlaubt.", 413);
  }

  const allowedFields = new Set(["formId", "saldo", "image"]);
  if ([...formData.keys()].some((name) => !allowedFields.has(name))) {
    throw new UserVisibleError("Die Formularanfrage ist ungültig.", 400);
  }

  return {
    imageBytes: new Uint8Array(await image.arrayBuffer()),
    imageMimeType: mimeType,
    saldo,
  };
}

export async function POST(request: Request) {
  try {
    requireMultipartRequest(request);

    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError(
        "Die Formularerstellung ist serverseitig nicht konfiguriert. Bitte Administrator kontaktieren.",
        503,
      );
    }
    await authenticateSupabaseRequest(request, supabase);

    const parsedRequest = await parseFormRequest(request);
    const { data: template, error: templateError } = await supabase.storage
      .from(FORM_TEMPLATE_BUCKET)
      .download(VERF5_TEMPLATE_PATH);
    if (templateError || !template) {
      console.error(
        "Form template download failed",
        safeErrorDetails(templateError ?? new Error("Template data is missing")),
      );
      throw new UserVisibleError(
        "Die Formularvorlage ist derzeit nicht verfügbar. Bitte Administrator kontaktieren.",
        503,
      );
    }

    const extractedFields = await extractVerf5ImageFields({
      bytes: parsedRequest.imageBytes,
      mimeType: parsedRequest.imageMimeType,
    });
    const datum = formatViennaDate();
    const templateBytes = new Uint8Array(await template.arrayBuffer());

    let renderedDocument: Uint8Array;
    try {
      renderedDocument = renderVerf5Document(templateBytes, {
        ...extractedFields,
        datum,
        saldo: parsedRequest.saldo,
      });
    } catch (error) {
      console.error("Form document rendering failed", safeErrorDetails(error));
      throw new UserVisibleError(
        "Das Formular konnte nicht erstellt werden. Bitte später erneut versuchen.",
        500,
      );
    }

    const responseBuffer = Uint8Array.from(renderedDocument).buffer;
    return new Response(new Blob([responseBuffer], { type: DOCX_CONTENT_TYPE }), {
      status: 200,
      headers: {
        "Content-Type": DOCX_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="Verf5_${datum}.docx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof UserVisibleError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    console.error("Form generation route failed", safeErrorDetails(error));
    return NextResponse.json(
      { error: "Das Formular konnte nicht erstellt werden. Bitte später erneut versuchen." },
      { status: 500 },
    );
  }
}
