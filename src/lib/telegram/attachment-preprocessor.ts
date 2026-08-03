import { TelegramFileTooLargeError, type BotApi } from "./bot-api";
import type { AttachmentPreprocessResult } from "./worker";
import { buildAttachmentContext } from "@/lib/attachments/context";
import {
  validateAttachmentBytes,
  attachmentMetadata,
  attachmentKindFromMime,
} from "@/lib/attachments/validation";
import { UserVisibleError } from "@/lib/errors";
import type { MineruProvider, GeminiProvider, DocumentFallbackProvider } from "@/lib/attachments/context";

const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024; // 20 MiB
const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MiB

const IMAGE_MIME_SET = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const DEFAULT_EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "text/plain": ".txt",
  "text/markdown": ".md",
  "text/csv": ".csv",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

function filenameWithMimeExtension(fileName: string | undefined, mimeType: string): string {
  const name = fileName?.trim() || "datei";
  if (/\.[^.]+$/u.test(name)) return name;
  return `${name}${DEFAULT_EXTENSION_BY_MIME[mimeType] ?? ""}`;
}

export interface AttachmentPreprocessorProviders {
  mineru: MineruProvider;
  gemini: GeminiProvider;
  documentFallback: DocumentFallbackProvider;
}

/**
 * Create a preprocessor that downloads a Telegram file, validates it,
 * and builds attachment context using the configured providers.
 */
export function createAttachmentPreprocessor(
  providers: AttachmentPreprocessorProviders,
): (
  botApi: BotApi,
  fileId: string,
  fileName: string | undefined,
  mimeType: string | undefined,
  fileSize: number | undefined,
  caption: string | undefined,
  signal?: AbortSignal,
) => Promise<AttachmentPreprocessResult> {
  return async (botApi, fileId, fileName, mimeType, fileSize, caption, signal) => {
    const resolvedMime = mimeType?.toLowerCase() ?? "application/octet-stream";
    const isImage = IMAGE_MIME_SET.has(resolvedMime);

    // 1. Get file info from Telegram
    let filePath: string;
    try {
      const fileInfo = await botApi.getFile({ file_id: fileId }, signal ? { signal } : undefined);
      if (!fileInfo.file_path) {
        throw new UserVisibleError("Telegram-Datei konnte nicht gefunden werden.", 400);
      }
      filePath = fileInfo.file_path;
      // Prefer the file_size from getFile response
      if (fileInfo.file_size !== undefined && fileInfo.file_size > 0) {
        fileSize = fileInfo.file_size;
      }
    } catch (error) {
      if (error instanceof UserVisibleError) throw error;
      if (error instanceof TelegramFileTooLargeError) {
        throw new UserVisibleError(
          isImage
            ? "Ein Bild darf maximal 10 MB groß sein."
            : "Eine Datei darf maximal 20 MB groß sein.",
          413,
        );
      }
      throw new Error("Anhang-Metadaten konnten nicht geladen werden.");
    }

    // 2. Determine kind and size limit
    const kind = isImage ? "image" as const : "file" as const;
    const maxBytes = isImage ? MAX_PHOTO_BYTES : MAX_DOCUMENT_BYTES;
    const effectiveName = filenameWithMimeExtension(fileName, resolvedMime);

    // 3. Preflight size check
    if (fileSize !== undefined && fileSize > maxBytes) {
      if (isImage) {
        throw new UserVisibleError("Ein Bild darf maximal 10 MB groß sein.", 413);
      }
      throw new UserVisibleError("Eine Datei darf maximal 20 MB groß sein.", 413);
    }

    // 4. Download with bounded streaming
    let bytes: Uint8Array;
    try {
      bytes = await botApi.downloadFile(filePath, { maxBytes, signal });
    } catch (error) {
      if (error instanceof UserVisibleError) throw error;
      if (error instanceof TelegramFileTooLargeError) {
        throw new UserVisibleError(
          isImage
            ? "Ein Bild darf maximal 10 MB groß sein."
            : "Eine Datei darf maximal 20 MB groß sein.",
          413,
        );
      }
      throw new Error("Anhang konnte nicht heruntergeladen werden.");
    }

    // 5. Validate
    const validated = validateAttachmentBytes({
      kind,
      name: effectiveName,
      mimeType: resolvedMime,
      sizeBytes: bytes.length,
      bytes,
    });

    // 6. Map to attachment kind for context builder
    const attachmentKind = attachmentKindFromMime(validated.mimeType);

    // 7. Build context
    const question = caption?.trim() || "Bitte analysiere diesen Anhang.";
    const upstreamQuery = await buildAttachmentContext(
      question,
      [{
        kind: attachmentKind,
        name: validated.name,
        mimeType: validated.mimeType,
        sizeBytes: validated.sizeBytes,
        sha256: validated.sha256,
        bytes: validated.bytes,
      }],
      {
        mineruProvider: signal
          ? (files) => providers.mineru(files, { signal })
          : providers.mineru,
        geminiProvider: signal
          ? (uri) => providers.gemini(uri, { signal })
          : providers.gemini,
        documentFallbackProvider: signal
          ? (files) => providers.documentFallback(files, { signal })
          : providers.documentFallback,
      },
    );

    // 8. Build metadata
    const meta = attachmentMetadata(validated);

    return { upstreamQuery, metadata: meta };
  };
}
