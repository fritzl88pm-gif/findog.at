import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateAdminRequest } from "@/lib/admin-users";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { DELETE } from "./route";

vi.mock("@/lib/admin-users", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin-users")>("@/lib/admin-users");
  return { ...actual, authenticateAdminRequest: vi.fn() };
});

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: vi.fn(),
}));

const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DOCUMENT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const STORAGE_PATH = `documents/${DOCUMENT_ID}.pdf`;

type StorageResult = { data: unknown; error: unknown };

function supabaseClient(download: StorageResult) {
  const update = vi.fn();
  const bucket = {
    download: vi.fn().mockResolvedValue(download),
    remove: vi.fn().mockResolvedValue({ data: [], error: null }),
    upload: vi.fn().mockResolvedValue({ data: {}, error: null }),
  };
  const from = vi.fn(() => {
    let updating = false;
    const query: Record<string, unknown> = {};
    query.select = vi.fn(() => query);
    query.eq = vi.fn(() => query);
    query.is = vi.fn(() => query);
    query.update = vi.fn((payload: unknown) => {
      updating = true;
      update(payload);
      return query;
    });
    query.maybeSingle = vi.fn(async () => (updating
      ? { data: { id: DOCUMENT_ID }, error: null }
      : {
        data: { id: DOCUMENT_ID, storage_path: STORAGE_PATH, mime_type: "application/pdf" },
        error: null,
      }));
    return query;
  });
  const client = { from, storage: { from: vi.fn(() => bucket) } };
  return { client, bucket, update };
}

function deleteRequest(): Request {
  return new Request("https://findog.at/api/admin/downloads/documents", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: DOCUMENT_ID }),
  });
}

describe("DELETE /api/admin/downloads/documents", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authenticateAdminRequest).mockResolvedValue({
      id: ADMIN_ID,
      email: "admin@example.at",
    } as never);
  });

  it("removes the stored file and soft-deletes the document", async () => {
    const supabase = supabaseClient({ data: new Blob(["%PDF-1.7"]), error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client as never);

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: DOCUMENT_ID });
    expect(supabase.bucket.remove).toHaveBeenCalledWith([STORAGE_PATH]);
    expect(supabase.update).toHaveBeenCalledWith(expect.objectContaining({
      deleted_by: ADMIN_ID,
      updated_by: ADMIN_ID,
    }));
  });

  it("soft-deletes a document whose stored file is already missing", async () => {
    const supabase = supabaseClient({
      data: null,
      error: { name: "StorageApiError", message: "Object not found", status: 400, statusCode: "404" },
    });
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client as never);

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: DOCUMENT_ID });
    expect(supabase.bucket.remove).not.toHaveBeenCalled();
    expect(supabase.update).toHaveBeenCalledWith(expect.objectContaining({
      deleted_at: expect.any(String),
      deleted_by: ADMIN_ID,
      updated_by: ADMIN_ID,
    }));
  });

  it("keeps the document when Storage cannot be checked for another reason", async () => {
    const supabase = supabaseClient({
      data: null,
      error: { name: "StorageApiError", message: "Internal Server Error", status: 500, statusCode: "500" },
    });
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client as never);

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Die Datei konnte vor dem Löschen nicht geprüft werden.",
    });
    expect(supabase.bucket.remove).not.toHaveBeenCalled();
    expect(supabase.update).not.toHaveBeenCalled();
  });
});
