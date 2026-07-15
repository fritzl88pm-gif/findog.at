import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { UserVisibleError } from "./errors";

export const MODEL_IMAGE_BUCKET = "model-icons";
export const MAX_MODEL_IMAGE_BYTES = 1_000_000;

const MODEL_IMAGE_COLUMNS = "id,storage_path,original_filename,mime_type,byte_size,created_at,created_by";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/avif"] as const;
type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export type ModelImageAsset = {
  id: string;
  storagePath: string;
  originalFilename: string;
  mimeType: AllowedMimeType;
  byteSize: number;
  createdAt: string;
  createdBy: string | null;
};

export type ModelImageAssetDto = ModelImageAsset & { url: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAllowedMimeType(value: unknown): value is AllowedMimeType {
  return typeof value === "string" && ALLOWED_MIME_TYPES.includes(value as AllowedMimeType);
}

function normalizeAsset(value: unknown): ModelImageAsset | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" || !UUID_PATTERN.test(value.id)
    || typeof value.storage_path !== "string"
    || typeof value.original_filename !== "string"
    || !isAllowedMimeType(value.mime_type)
    || typeof value.byte_size !== "number" || !Number.isSafeInteger(value.byte_size)
    || value.byte_size < 1 || value.byte_size > MAX_MODEL_IMAGE_BYTES
    || typeof value.created_at !== "string"
    || (value.created_by !== null && typeof value.created_by !== "string")
  ) return null;
  return {
    id: value.id,
    storagePath: value.storage_path,
    originalFilename: value.original_filename,
    mimeType: value.mime_type,
    byteSize: value.byte_size,
    createdAt: value.created_at,
    createdBy: value.created_by,
  };
}

function unavailableError(): UserVisibleError {
  return new UserVisibleError("Die Modellbilder konnten nicht geladen werden.", 503);
}

export async function readModelImageAssets(supabase: SupabaseClient): Promise<ModelImageAsset[]> {
  const { data, error } = await supabase
    .from("model_image_assets")
    .select(MODEL_IMAGE_COLUMNS)
    .order("created_at", { ascending: false });
  if (error || !Array.isArray(data)) throw unavailableError();
  const assets = data.map(normalizeAsset);
  if (assets.some((asset) => asset === null)) throw unavailableError();
  return assets as ModelImageAsset[];
}

export function modelImagePublicUrl(supabase: SupabaseClient, storagePath: string): string {
  return supabase.storage.from(MODEL_IMAGE_BUCKET).getPublicUrl(storagePath).data.publicUrl;
}

export function modelImageAssetDtos(
  supabase: SupabaseClient,
  assets: readonly ModelImageAsset[],
): ModelImageAssetDto[] {
  return assets.map((asset) => ({ ...asset, url: modelImagePublicUrl(supabase, asset.storagePath) }));
}

export function modelImageUrlMap(
  supabase: SupabaseClient,
  assets: readonly ModelImageAsset[],
): Map<string, string> {
  return new Map(assets.map((asset) => [asset.id, modelImagePublicUrl(supabase, asset.storagePath)]));
}

function sniffMimeType(bytes: Uint8Array): AllowedMimeType | null {
  if (bytes.length >= 8 && bytes.slice(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index])) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) return "image/webp";
  if (
    bytes.length >= 12
    && String.fromCharCode(...bytes.slice(4, 8)) === "ftyp"
    && ["avif", "avis"].includes(String.fromCharCode(...bytes.slice(8, 12)))
  ) return "image/avif";
  return null;
}

function cleanFilename(value: string): string {
  return value.replace(/[\x00-\x1f\x7f]/gu, "").trim().slice(0, 160) || "modellbild";
}

export async function uploadModelImageAsset(options: {
  supabase: SupabaseClient;
  adminUserId: string;
  file: File;
}): Promise<ModelImageAsset> {
  const { file } = options;
  if (file.size < 1 || file.size > MAX_MODEL_IMAGE_BYTES) {
    throw new UserVisibleError("Das Modellbild darf maximal 1 MB groß sein.", 413);
  }
  if (!isAllowedMimeType(file.type)) {
    throw new UserVisibleError("Erlaubt sind PNG-, JPEG-, WebP- und AVIF-Bilder.", 400);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (sniffMimeType(bytes) !== file.type) {
    throw new UserVisibleError("Der Inhalt der Bilddatei entspricht nicht ihrem Dateityp.", 400);
  }

  const id = randomUUID();
  const extension = file.type === "image/jpeg" ? "jpg" : file.type.slice("image/".length);
  const storagePath = `${id}.${extension}`;
  const { error: uploadError } = await options.supabase.storage.from(MODEL_IMAGE_BUCKET).upload(
    storagePath,
    bytes,
    { cacheControl: "31536000", contentType: file.type, upsert: false },
  );
  if (uploadError) throw new UserVisibleError("Das Modellbild konnte nicht hochgeladen werden.", 503);

  const { data, error } = await options.supabase
    .from("model_image_assets")
    .insert({
      id,
      storage_path: storagePath,
      original_filename: cleanFilename(file.name),
      mime_type: file.type,
      byte_size: file.size,
      created_by: options.adminUserId,
    })
    .select(MODEL_IMAGE_COLUMNS)
    .single();
  if (error) {
    await options.supabase.storage.from(MODEL_IMAGE_BUCKET).remove([storagePath]);
    throw new UserVisibleError("Das Modellbild konnte nicht gespeichert werden.", 503);
  }
  const asset = normalizeAsset(data);
  if (!asset) throw unavailableError();
  return asset;
}
