import type { FredGeneratedArtifact } from "./fred-native-stream";

const MAX_GENERATED_ARTIFACTS = 10;
const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;
const ARTIFACT_EXTENSION = /^\.(?:txt|md|pdf)$/u;

export type ParsedGeneratedArtifact = Omit<FredGeneratedArtifact, "id"> & { sourceUri: string };

/** Parse WeKnora's native artifact contract (file_type is an extension, not a MIME type). */
export function parseGeneratedArtifacts(value: unknown): ParsedGeneratedArtifact[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const data = (value as Record<string, unknown>).data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const raw = (data as Record<string, unknown>).artifacts;
  if (!Array.isArray(raw)) return [];

  const seenIndexes = new Set<number>();
  return raw.slice(0, MAX_GENERATED_ARTIFACTS).flatMap((candidate, arrayIndex) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const item = candidate as Record<string, unknown>;
    const fileName = typeof item.file_name === "string" ? item.file_name.trim() : "";
    const fileType = typeof item.file_type === "string" ? item.file_type.trim().toLowerCase() : "";
    const fileSize = Number(item.file_size);
    const sourceUri = typeof item.handle === "string" ? item.handle.trim() : "";
    const suppliedIndex = item.index;
    const upstreamIndex = suppliedIndex === undefined ? arrayIndex : Number(suppliedIndex);
    if (!fileName || fileName.length > 255 || /[\u0000-\u001f\u007f]/u.test(fileName)
      || !ARTIFACT_EXTENSION.test(fileType) || !Number.isSafeInteger(fileSize) || fileSize < 0
      || fileSize > MAX_ARTIFACT_BYTES || !Number.isSafeInteger(upstreamIndex) || upstreamIndex < 0
      || upstreamIndex > 99 || seenIndexes.has(upstreamIndex)
      || !/^resource:\/\/[^\u0000-\u001f\u007f]+$/u.test(sourceUri)) return [];
    seenIndexes.add(upstreamIndex);
    return [{ fileName, fileSize, fileType, upstreamIndex, sourceUri }];
  });
}

/** Keep provider pseudo-links inert unless they name an artifact that has a genuine card. */
export function normalizeGeneratedArtifactLinks(content: string, artifacts: ParsedGeneratedArtifact[]): string {
  if (artifacts.length === 0) return content;
  const names = new Set(artifacts.map((artifact) => artifact.fileName.toLowerCase()));
  return content.replace(/\[([^\]]+)\]\(((?:sandbox|resource):[^)\s]+)\)/giu, (whole, label: string, href: string) => {
    const pathName = href.split(/[\\/]/u).at(-1)?.toLowerCase() ?? "";
    const cleanLabel = label.trim();
    return names.has(pathName) || names.has(cleanLabel.toLowerCase()) ? cleanLabel || pathName : whole;
  });
}
