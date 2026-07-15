import { describe, expect, it, vi } from "vitest";

import {
  MAX_MODEL_IMAGE_BYTES,
  MODEL_IMAGE_BUCKET,
  modelImageAssetDtos,
  uploadModelImageAsset,
} from "./model-images";

function pngFile(name = "modell.png"): File {
  return new File([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]),
  ], name, { type: "image/png" });
}

function uploadClient() {
  const upload = vi.fn().mockResolvedValue({ error: null });
  const remove = vi.fn().mockResolvedValue({ error: null });
  const getPublicUrl = vi.fn((path: string) => ({ data: { publicUrl: `https://assets.example/${path}` } }));
  let inserted: Record<string, unknown> = {};
  const single = vi.fn().mockImplementation(async () => ({
    data: {
      id: inserted.id,
      storage_path: inserted.storage_path,
      original_filename: inserted.original_filename,
      mime_type: "image/png",
      byte_size: 12,
      created_at: "2026-07-15T12:00:00Z",
      created_by: "00000000-0000-4000-8000-000000000001",
    },
    error: null,
  }));
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn((value: Record<string, unknown>) => {
    inserted = value;
    return { select };
  });
  const bucket = { upload, remove, getPublicUrl };
  const client = {
    storage: { from: vi.fn(() => bucket) },
    from: vi.fn(() => ({ insert })),
  };
  return { client, upload, remove, getPublicUrl, insert };
}

describe("model image assets", () => {
  it("validates the actual file signature before any storage write", async () => {
    const fake = uploadClient();
    const spoofed = new File(["not a png"], "spoofed.png", { type: "image/png" });

    await expect(uploadModelImageAsset({
      supabase: fake.client as never,
      adminUserId: "00000000-0000-4000-8000-000000000001",
      file: spoofed,
    })).rejects.toMatchObject({ status: 400 });
    expect(fake.upload).not.toHaveBeenCalled();
  });

  it("rejects files above the database and bucket limit", async () => {
    const fake = uploadClient();
    const oversized = new File(
      [new Uint8Array(MAX_MODEL_IMAGE_BYTES + 1)],
      "gross.png",
      { type: "image/png" },
    );
    await expect(uploadModelImageAsset({
      supabase: fake.client as never,
      adminUserId: "00000000-0000-4000-8000-000000000001",
      file: oversized,
    })).rejects.toMatchObject({ status: 413 });
    expect(fake.upload).not.toHaveBeenCalled();
  });

  it("stores a validated immutable asset and returns its audited metadata", async () => {
    const fake = uploadClient();
    const asset = await uploadModelImageAsset({
      supabase: fake.client as never,
      adminUserId: "00000000-0000-4000-8000-000000000001",
      file: pngFile(),
    });

    expect(fake.client.storage.from).toHaveBeenCalledWith(MODEL_IMAGE_BUCKET);
    expect(fake.upload).toHaveBeenCalledWith(
      expect.stringMatching(/^[0-9a-f-]+[.]png$/),
      expect.any(Uint8Array),
      expect.objectContaining({ contentType: "image/png", upsert: false }),
    );
    expect(fake.insert).toHaveBeenCalledWith(expect.objectContaining({
      id: asset.id,
      storage_path: asset.storagePath,
      created_by: "00000000-0000-4000-8000-000000000001",
    }));
  });

  it("derives public presentation URLs without exposing storage credentials", () => {
    const fake = uploadClient();
    const dtos = modelImageAssetDtos(fake.client as never, [{
      id: "00000000-0000-4000-8000-000000000002",
      storagePath: "00000000-0000-4000-8000-000000000002.png",
      originalFilename: "modell.png",
      mimeType: "image/png",
      byteSize: 12,
      createdAt: "2026-07-15T12:00:00Z",
      createdBy: null,
    }]);
    expect(dtos[0]?.url).toBe("https://assets.example/00000000-0000-4000-8000-000000000002.png");
  });
});
