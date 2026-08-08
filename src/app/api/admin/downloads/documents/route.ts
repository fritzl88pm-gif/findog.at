import { Buffer } from "node:buffer";

import { NextResponse } from "next/server";

import { authenticateAdminRequest } from "@/lib/admin-users";
import { validateAttachmentBytes } from "@/lib/attachments/validation";
import {
  DOWNLOAD_BUCKET,
  mapDownloadDocument,
  parseDownloadDeleteInput,
  parseDownloadDocumentInput,
  requireDownloadUuid,
} from "@/lib/downloads";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type DocumentRow = Parameters<typeof mapDownloadDocument>[0];
type StoredDocumentRow = {
  id: string;
  storage_path: string;
  mime_type: string;
};

function json(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

async function requestJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new UserVisibleError("Die Anfrage enthält kein gültiges JSON.", 400);
  }
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof UserVisibleError) {
    return json({ error: error.message }, error.status);
  }
  return json({ error: "Das Download-Dokument konnte nicht verarbeitet werden." }, 500);
}

async function requireActiveCategory(
  supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  categoryId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("download_categories")
    .select("id")
    .eq("id", categoryId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    throw new UserVisibleError("Die Kategorie konnte nicht geprüft werden.", 503);
  }
  if (!data) {
    throw new UserVisibleError("Die gewählte Kategorie ist nicht verfügbar.", 400);
  }
}

export async function POST(request: Request) {
  let uploadedPath = "";
  let metadataCreated = false;
  let cleanupClient: NonNullable<ReturnType<typeof getSupabaseServerClient>> | null = null;
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Administration ist derzeit nicht verfügbar.", 503);
    }
    cleanupClient = supabase;
    const user = await authenticateAdminRequest(request, supabase);
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      throw new UserVisibleError("Die Upload-Anfrage ist ungültig.", 400);
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new UserVisibleError("Bitte eine Dokumentdatei auswählen.", 400);
    }
    const input = parseDownloadDocumentInput({
      categoryId: formData.get("categoryId"),
      title: formData.get("title"),
      description: formData.get("description"),
      sortOrder: formData.get("sortOrder"),
    });
    await requireActiveCategory(supabase, input.categoryId);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const validated = validateAttachmentBytes({
      kind: "file",
      name: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      bytes,
    });
    const extension = /\.([^.]+)$/u.exec(validated.name.toLowerCase())?.[1];
    if (!extension) {
      throw new UserVisibleError("Der Dateityp konnte nicht bestimmt werden.", 400);
    }

    uploadedPath = `documents/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from(DOWNLOAD_BUCKET)
      .upload(uploadedPath, Buffer.from(validated.bytes), {
        cacheControl: "3600",
        contentType: validated.mimeType,
        upsert: false,
      });
    if (uploadError) {
      throw new UserVisibleError("Die Datei konnte nicht gespeichert werden.", 503);
    }

    const { data, error } = await supabase
      .from("download_documents")
      .insert({
        category_id: input.categoryId,
        title: input.title,
        description: input.description,
        storage_path: uploadedPath,
        original_filename: validated.name,
        mime_type: validated.mimeType,
        file_extension: extension,
        file_size: validated.sizeBytes,
        content_sha256: validated.sha256,
        sort_order: input.sortOrder,
        created_by: user.id,
        updated_by: user.id,
      })
      .select("id,category_id,title,description,original_filename,mime_type,file_extension,file_size,sort_order,created_at,updated_at")
      .single();
    if (error || !data) {
      await supabase.storage.from(DOWNLOAD_BUCKET).remove([uploadedPath]);
      uploadedPath = "";
      throw new UserVisibleError("Das Dokument konnte nicht angelegt werden.", 503);
    }
    metadataCreated = true;
    return json({ document: mapDownloadDocument(data as DocumentRow) }, 201);
  } catch (error) {
    if (uploadedPath && cleanupClient && !metadataCreated) {
      await cleanupClient.storage.from(DOWNLOAD_BUCKET).remove([uploadedPath]);
    }
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Administration ist derzeit nicht verfügbar.", 503);
    }
    const user = await authenticateAdminRequest(request, supabase);
    const body = await requestJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new UserVisibleError("Die Dokumentangaben sind ungültig.", 400);
    }
    const fields = body as Record<string, unknown>;
    const keys = Object.keys(fields).sort();
    if (keys.join(",") !== "categoryId,description,id,sortOrder,title") {
      throw new UserVisibleError("Die Dokumentangaben enthalten ungültige Felder.", 400);
    }
    const id = requireDownloadUuid(fields.id, "Die Dokument-ID");
    const input = parseDownloadDocumentInput({
      categoryId: fields.categoryId,
      title: fields.title,
      description: fields.description,
      sortOrder: fields.sortOrder,
    });
    await requireActiveCategory(supabase, input.categoryId);

    const { data, error } = await supabase
      .from("download_documents")
      .update({
        category_id: input.categoryId,
        title: input.title,
        description: input.description,
        sort_order: input.sortOrder,
        updated_by: user.id,
      })
      .eq("id", id)
      .is("deleted_at", null)
      .select("id,category_id,title,description,original_filename,mime_type,file_extension,file_size,sort_order,created_at,updated_at")
      .maybeSingle();
    if (error) {
      throw new UserVisibleError("Das Dokument konnte nicht gespeichert werden.", 503);
    }
    if (!data) {
      throw new UserVisibleError("Das Dokument wurde nicht gefunden.", 404);
    }
    return json({ document: mapDownloadDocument(data as DocumentRow) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Administration ist derzeit nicht verfügbar.", 503);
    }
    const user = await authenticateAdminRequest(request, supabase);
    const id = parseDownloadDeleteInput(await requestJson(request), "Die Dokument-ID");
    const { data, error } = await supabase
      .from("download_documents")
      .select("id,storage_path,mime_type")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) {
      throw new UserVisibleError("Das Dokument konnte nicht geladen werden.", 503);
    }
    if (!data) {
      throw new UserVisibleError("Das Dokument wurde nicht gefunden.", 404);
    }
    const document = data as StoredDocumentRow;

    const { data: backup, error: backupError } = await supabase.storage
      .from(DOWNLOAD_BUCKET)
      .download(document.storage_path);
    if (backupError || !backup) {
      throw new UserVisibleError("Die Datei konnte vor dem Löschen nicht geprüft werden.", 503);
    }
    const backupBytes = Buffer.from(await backup.arrayBuffer());
    const { error: removeError } = await supabase.storage
      .from(DOWNLOAD_BUCKET)
      .remove([document.storage_path]);
    if (removeError) {
      throw new UserVisibleError("Die Datei konnte nicht entfernt werden.", 503);
    }

    const { data: deleted, error: deleteError } = await supabase
      .from("download_documents")
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: user.id,
        updated_by: user.id,
      })
      .eq("id", id)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    if (deleteError) {
      const { error: restoreError } = await supabase.storage
        .from(DOWNLOAD_BUCKET)
        .upload(document.storage_path, backupBytes, {
          cacheControl: "3600",
          contentType: document.mime_type,
          upsert: false,
        });
      if (restoreError) {
        throw new UserVisibleError(
          "Die Metadaten konnten nicht gelöscht und die Speicherdatei nicht wiederhergestellt werden.",
          503,
        );
      }
      throw new UserVisibleError("Das Dokument konnte nicht gelöscht werden.", 503);
    }
    if (!deleted) {
      throw new UserVisibleError("Das Dokument wurde nicht gefunden.", 404);
    }
    return json({ id });
  } catch (error) {
    return errorResponse(error);
  }
}
