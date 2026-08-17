export const FREDRUN_ACCESS_BLOCK_CODE = "fredrun_blocked";
export const FREDRUN_ACCESS_MESSAGE_MAX_LENGTH = 240;

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export function normalizeFredRunAccessMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (
    !normalized
    || normalized !== value
    || Array.from(normalized).length > FREDRUN_ACCESS_MESSAGE_MAX_LENGTH
    || CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function parseFredRunAccessBlockedResponse(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.code !== FREDRUN_ACCESS_BLOCK_CODE) return null;
  return normalizeFredRunAccessMessage(candidate.error);
}

export class FredRunAccessBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FredRunAccessBlockedError";
  }
}
