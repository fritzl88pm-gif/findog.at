import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { sanitizedFilename } from "../attachments/validation";
import {
  isAllowedProviderImageUri,
  type FredTrustedEmbedImage,
} from "../weknora/fred-native";

const MARKDOWN_IMAGE_PATTERN = /!\[([^\]\r\n]*)\]\(\s*([^)\s]+)(?:\s+(?:"[^"\r\n]*"|'[^'\r\n]*'|\([^\)\r\n]*\)))?\s*\)/gu;
const ALLOWED_IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export type NativeImageMaterializationResult = {
  displayContent: string;
  artifactMap: Map<string, string>;
};

export function sanitizeAltText(rawAlt: string): string {
  return rawAlt
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .replace(/[()[\]`\\]/gu, "")
    .trim()
    .slice(0, 255);
}

export function sanitizeProviderImageMarkupToAlt(content: string): string {
  if (!content || !content.includes("![")) {
    return content;
  }
  return content.replace(
    MARKDOWN_IMAGE_PATTERN,
    (_match, alt: string) => sanitizeAltText(alt),
  );
}

function extractProviderImageUrisFromMarkdown(markdown: string): Array<{ alt: string; uri: string }> {
  const references: Array<{ alt: string; uri: string }> = [];
  for (const match of markdown.matchAll(MARKDOWN_IMAGE_PATTERN)) {
    const alt = match[1];
    const uri = match[2];
    if (isAllowedProviderImageUri(uri)) {
      references.push({ alt, uri });
    }
  }
  return references;
}

export async function materializeNativeImageArtifacts(options: {
  supabase: SupabaseClient;
  userId: string;
  conversationId: string;
  userMessageId: number;
  rawContent: string;
  trustedImages: readonly FredTrustedEmbedImage[];
  userAttachments?: ReadonlyArray<{
    kind: string;
    name?: string;
    mimeType?: string;
  }>;
}): Promise<NativeImageMaterializationResult> {
  const { rawContent, trustedImages, userAttachments = [] } = options;

  if (!rawContent || !rawContent.includes("![")) {
    return { displayContent: rawContent, artifactMap: new Map() };
  }

  try {
    const references = extractProviderImageUrisFromMarkdown(rawContent);
    if (references.length === 0) {
      return {
        displayContent: sanitizeProviderImageMarkupToAlt(rawContent),
        artifactMap: new Map(),
      };
    }

    const trustedUriSet = new Set(trustedImages.map((img) => img.url));
    const matchedUris = [...new Set(references.map((r) => r.uri).filter((uri) => trustedUriSet.has(uri)))];

    const artifactMap = new Map<string, string>();

    if (matchedUris.length > 0) {
      const imageAttachments = userAttachments.filter((a) => a.kind === "image");

      const rowsToInsert = matchedUris.map((uri, index) => {
        const trusted = trustedImages.find((img) => img.url === uri);
        const matchedAttachment = (trusted?.caption
          ? imageAttachments.find((a) => a.name === trusted.caption)
          : undefined)
          ?? imageAttachments[index]
          ?? imageAttachments[0];

        const rawMime = matchedAttachment?.mimeType?.toLowerCase() ?? "";
        const mimeType = ALLOWED_IMAGE_MIMES.has(rawMime) ? rawMime : "image/jpeg";
        const rawName = matchedAttachment?.name ?? trusted?.caption ?? "image";
        const originalName = sanitizedFilename(rawName);

        return {
          conversation_id: options.conversationId,
          client_id: options.userId,
          user_message_id: options.userMessageId,
          source_uri: uri,
          mime_type: mimeType,
          original_name: originalName,
        };
      });

      const { data, error } = await options.supabase
        .from("fred_native_image_artifacts")
        .insert(rowsToInsert)
        .select("id, source_uri");

      if (error || !data) {
        return {
          displayContent: sanitizeProviderImageMarkupToAlt(rawContent),
          artifactMap: new Map(),
        };
      }

      for (const row of data as Array<{ id: string; source_uri: string }>) {
        artifactMap.set(row.source_uri, row.id);
      }
    }

    const rewrittenContent = rawContent.replace(MARKDOWN_IMAGE_PATTERN, (_match, alt: string, uri: string) => {
      if (isAllowedProviderImageUri(uri)) {
        const artifactId = artifactMap.get(uri);
        const safeAlt = sanitizeAltText(alt);
        if (artifactId) {
          return `![${safeAlt}](findog-artifact://${artifactId})`;
        }
        return safeAlt;
      }
      return sanitizeAltText(alt);
    });

    return {
      displayContent: rewrittenContent,
      artifactMap,
    };
  } catch {
    return {
      displayContent: sanitizeProviderImageMarkupToAlt(rawContent),
      artifactMap: new Map(),
    };
  }
}
