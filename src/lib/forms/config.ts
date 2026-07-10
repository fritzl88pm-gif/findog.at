export const VERF5_FORM_ID = "verf5";
export const VERF5_FORM_NAME = "Verf 5";

export const FORM_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_FORM_IMAGE_BYTES = 5_000_000;
export const MAX_FORM_MULTIPART_BYTES = MAX_FORM_IMAGE_BYTES + 100_000;
export const MAX_SALDO_INPUT_CHARS = 100;

export type FormImageMimeType = (typeof FORM_IMAGE_MIME_TYPES)[number];

export function isFormImageMimeType(value: string): value is FormImageMimeType {
  return FORM_IMAGE_MIME_TYPES.includes(value as FormImageMimeType);
}
