const STATUS_TITLE_PREFIX = "LLM-Arbeitsstatus: ";
const MODEL_STATUS_PREFIX = "STATUS: ";
const MAX_STATUS_LENGTH = 96;
const ACTION_PREFIX = /^(?:Analysiere|Bewerte|Durchsuche|Ermittle|Fasse|Gleiche|Kläre|Lese|Ordne|Prüfe|Recherchiere|Sichte|Suche|Untersuche|Vergleiche|Verifiziere|Werte)\b/u;
const INTERNAL_TERM_PATTERN = /\b(?:chunk|function|kb|knowledge|mcp|reasoning|tool)(?:s|en)?\b/iu;
const RESULT_ASSERTION_PATTERN = /\b(?:belegt|bestätigt|beträgt|ergab|ergibt|gefunden|gilt|ist|kein|keine|keinen|liegt|sind|steht|treffer|ergebnis)\b/iu;

export function sanitizeLlmProgressStatus(value: unknown): string | undefined {
  if (typeof value !== "string" || /[\r\n]/u.test(value)) {
    return undefined;
  }

  const compact = value.replace(/\s+/gu, " ").trim();
  if (!compact || !ACTION_PREFIX.test(compact)) {
    return undefined;
  }
  const withoutFinalPeriod = compact.endsWith(".") ? compact.slice(0, -1) : compact;
  if (/[.!?]/u.test(withoutFinalPeriod)) {
    return undefined;
  }
  if (!/^[\p{L}\s,'’„“&/-]+$/u.test(withoutFinalPeriod)) {
    return undefined;
  }
  if (
    INTERNAL_TERM_PATTERN.test(withoutFinalPeriod)
    || RESULT_ASSERTION_PATTERN.test(withoutFinalPeriod)
  ) {
    return undefined;
  }

  const normalized = `${withoutFinalPeriod}.`;
  return normalized.length <= MAX_STATUS_LENGTH ? normalized : undefined;
}

export function createLlmProgressStepTitle(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith(MODEL_STATUS_PREFIX)) {
    return undefined;
  }

  const status = sanitizeLlmProgressStatus(value.slice(MODEL_STATUS_PREFIX.length));
  return status ? `${STATUS_TITLE_PREFIX}${status}` : undefined;
}

export function readLlmProgressStepTitle(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith(STATUS_TITLE_PREFIX)) {
    return undefined;
  }

  const storedStatus = value.slice(STATUS_TITLE_PREFIX.length);
  const safeStatus = sanitizeLlmProgressStatus(storedStatus);
  return safeStatus === storedStatus ? safeStatus : undefined;
}
