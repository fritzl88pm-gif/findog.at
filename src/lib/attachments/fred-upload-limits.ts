import { UserVisibleError } from "@/lib/errors";
import { MAX_FILE_BYTES, MAX_FILE_UPLOADS } from "@/lib/attachments/validation";
import { MAX_NATIVE_ATTACHMENT_TOTAL_BYTES } from "@/lib/weknora/fred-native";

const MAX_FRED_MULTIPART_TEXT_BYTES = 64 * 1_024;
const FRED_MULTIPART_BOUNDARY_AND_HEADERS_BYTES = 1_024 * 1_024;

export const MAX_FRED_NATIVE_MULTIPART_BYTES = MAX_NATIVE_ATTACHMENT_TOTAL_BYTES
  + MAX_FRED_MULTIPART_TEXT_BYTES
  + FRED_MULTIPART_BOUNDARY_AND_HEADERS_BYTES;

// Preprocessed attachments go through MinerU (batched) or the Luna fallback,
// not into the WeKnora request, so every file may use its full per-file limit.
export const MAX_FRED_PREPROCESSED_ATTACHMENT_BYTES =
  MAX_FILE_UPLOADS * MAX_FILE_BYTES;

export const MAX_FRED_PREPROCESSED_MULTIPART_BYTES = MAX_FRED_MULTIPART_TEXT_BYTES
  + MAX_FRED_PREPROCESSED_ATTACHMENT_BYTES
  + FRED_MULTIPART_BOUNDARY_AND_HEADERS_BYTES;

export function fredMultipartRequestByteLimit(useNativeAttachments: boolean): number {
  return useNativeAttachments
    ? MAX_FRED_NATIVE_MULTIPART_BYTES
    : MAX_FRED_PREPROCESSED_MULTIPART_BYTES;
}

export function fredAttachmentAggregateByteLimit(useNativeAttachments: boolean): number {
  return useNativeAttachments
    ? MAX_NATIVE_ATTACHMENT_TOTAL_BYTES
    : MAX_FRED_PREPROCESSED_ATTACHMENT_BYTES;
}

/** Recheck the streamed native aggregate before the provider request is built. */
export function assertFredNativeFileTotalSize(files: readonly { size: number }[]): void {
  let totalBytes = 0;
  for (const file of files) {
    if (!Number.isSafeInteger(file.size) || file.size < 0) {
      throw new UserVisibleError("Die Fred-Anhänge sind ungültig.", 400);
    }
    if (file.size > MAX_NATIVE_ATTACHMENT_TOTAL_BYTES - totalBytes) {
      throw new UserVisibleError(
        "Die Fred-Anhänge sind zusammen zu groß. Bitte reduziere die Gesamtgröße.",
        413,
      );
    }
    totalBytes += file.size;
  }
}
