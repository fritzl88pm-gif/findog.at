/**
 * Fred's deliverable allowlist — deliberately in one place.
 *
 * Three layers have to agree on which generated files may reach the user, and
 * each one used to carry its own copy of the same regex:
 *
 * - `parseGeneratedArtifacts` (`./fred-generated-artifacts`) is the parse gate.
 *   Whatever it rejects is never persisted, so it can never be shown.
 * - the download route (`/api/fred/conversations/.../artifacts/[index]`) re-checks
 *   the set for its own authorization decision.
 * - the Telegram worker (`@/workers/telegram`) re-checks it before uploading.
 *
 * A narrowed copy in only one of them silently costs a legitimately produced
 * file its download card, which is exactly what happened to PowerPoint, Excel
 * and CSV artifacts. Import the shared pattern instead of writing a new one.
 *
 * WeKnora's artifact contract carries `file_type` as a *file extension*
 * (".pptx"), not a MIME type, so the match is strict and anchored: LibreOffice
 * lock files (".pptx#", ".~lock.foo.pptx#"), editor temporaries and code
 * artifacts (".js", ".py") cannot match by construction — no blocklist needed.
 */
export const GENERATED_ARTIFACT_EXTENSIONS = [
  ".txt",
  ".md",
  ".pdf",
  ".doc",
  ".docx",
  ".csv",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
] as const;

const EXTENSION_ALTERNATIVES = GENERATED_ARTIFACT_EXTENSIONS.map((extension) => extension.slice(1)).join("|");

/** Anchored extension pattern derived from {@link GENERATED_ARTIFACT_EXTENSIONS}. */
export const GENERATED_ARTIFACT_FILE_TYPE = new RegExp(`^\\.(?:${EXTENSION_ALTERNATIVES})$`, "u");

/** Whether a WeKnora `file_type` value names a deliverable file. */
export function isGeneratedArtifactFileType(value: unknown): boolean {
  return typeof value === "string" && GENERATED_ARTIFACT_FILE_TYPE.test(value.trim().toLowerCase());
}

export type GeneratedArtifactKind = { label: string; icon: string };

const KIND_BY_EXTENSION: Record<string, GeneratedArtifactKind> = {
  ".pdf": { label: "PDF", icon: "PDF" },
  ".md": { label: "Markdown", icon: "MD" },
  ".txt": { label: "Text", icon: "TXT" },
  ".csv": { label: "CSV", icon: "CSV" },
  ".doc": { label: "Word", icon: "W" },
  ".docx": { label: "Word", icon: "W" },
  ".xls": { label: "Excel", icon: "X" },
  ".xlsx": { label: "Excel", icon: "X" },
  ".ppt": { label: "PowerPoint", icon: "P" },
  ".pptx": { label: "PowerPoint", icon: "P" },
};

/** Card label and icon for one artifact; "Datei" for anything unexpected. */
export function generatedArtifactKind(fileName: string, fileType: string): GeneratedArtifactKind {
  const extension = /\.[^.]+$/u.exec(fileName.trim().toLowerCase())?.[0] ?? fileType.trim().toLowerCase();
  return KIND_BY_EXTENSION[extension] ?? { label: "Datei", icon: "FILE" };
}
