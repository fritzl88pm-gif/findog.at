import { type Deadline, hasDeadlineTime } from "./deadline";
import { UserVisibleError } from "./errors";

export type ToolFailureKind =
  | "timeout"
  | "transport"
  | "rate_limit"
  | "authentication"
  | "protocol"
  | "tool_error"
  | "invalid_arguments"
  | "cancelled";

export type ToolOutcome<T> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly attempts: number;
    }
  | {
      readonly ok: false;
      readonly kind: ToolFailureKind;
      readonly retryable: boolean;
      readonly message: string;
      readonly status?: number;
      readonly attempts: number;
    };

export type ClassifiedToolFailure = Extract<ToolOutcome<never>, { ok: false }>;

type ExecuteToolOptions = {
  deadline?: Deadline;
  reserveMs?: number;
};

const SOFT_ERROR_PREFIX = "Datenbankfehler:";
const RETRYABLE_KINDS = new Set<ToolFailureKind>([
  "timeout",
  "transport",
  "rate_limit",
]);
const MAX_SAFE_MESSAGE_LENGTH = 1_000;

function normalizeMessage(message: string): string {
  return message.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").trim().slice(0, MAX_SAFE_MESSAGE_LENGTH);
}

function genericMessage(kind: ToolFailureKind): string {
  switch (kind) {
    case "timeout":
      return "Die Recherchefunktion hat nicht rechtzeitig geantwortet.";
    case "transport":
      return "Die Recherchefunktion ist derzeit nicht erreichbar.";
    case "rate_limit":
      return "Die Recherchefunktion ist derzeit ausgelastet.";
    case "authentication":
      return "Die Recherchefunktion konnte nicht authentifiziert werden.";
    case "protocol":
      return "Die Recherchefunktion lieferte keine gültige Antwort.";
    case "invalid_arguments":
      return "Die Recherchefunktion erhielt ungültige Argumente.";
    case "cancelled":
      return "Der Rechercheaufruf wurde abgebrochen.";
    case "tool_error":
      return "Die Recherchefunktion ist fehlgeschlagen.";
  }
}

function readStatus(value: unknown): number | undefined {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return undefined;
  const status = Reflect.get(value, "status");
  return typeof status === "number" && Number.isInteger(status) ? status : undefined;
}

function statusFromMessage(message: string): number | undefined {
  const match = message.match(/(?:HTTP|Status|Fehler)\s*[:#-]?\s*(400|401|403|408|429|502|503|504)\b/i);
  return match ? Number(match[1]) : undefined;
}

function kindFromStatus(status: number): ToolFailureKind {
  if (status === 429) return "rate_limit";
  if (status === 401 || status === 403) return "authentication";
  if (status === 400) return "invalid_arguments";
  if (status === 408 || status === 504) return "timeout";
  if (status === 502 || status === 503) return "transport";
  return "tool_error";
}

function kindFromMessage(message: string, fallback: ToolFailureKind): ToolFailureKind {
  if (/abgebrochen|aborted|cancel(?:led|ed|ation)?/i.test(message)) return "cancelled";
  if (/rate.?limit|too many requests|ausgelastet/i.test(message)) return "rate_limit";
  if (/authent|unauthori[sz]ed|forbidden|berechtigung/i.test(message)) return "authentication";
  if (/timeout|timed out|zeit(?:limit|überschreitung|überschritten)|nicht rechtzeitig/i.test(message)) return "timeout";
  if (/invalid arguments?|ungültige argumente?|bad request/i.test(message)) return "invalid_arguments";
  if (/json.?rpc|protokoll|protocol|invalid (?:json|response)|ungültige antwort/i.test(message)) return "protocol";
  if (/fetch failed|network|netzwerk|ECONN|ENOTFOUND|socket|verbindung/i.test(message)) return "transport";
  return fallback;
}

function failure(
  kind: ToolFailureKind,
  attempts: number,
  options: { message?: string; status?: number } = {},
): ClassifiedToolFailure {
  const safeMessage = options.message ? normalizeMessage(options.message) : "";
  return {
    ok: false,
    kind,
    retryable: RETRYABLE_KINDS.has(kind),
    message: safeMessage || genericMessage(kind),
    ...(options.status === undefined ? {} : { status: options.status }),
    attempts,
  };
}

export function isSoftToolError(value: unknown): value is string {
  return typeof value === "string" && value.trimStart().startsWith(SOFT_ERROR_PREFIX);
}

/**
 * Turns thrown and MCP-style soft errors into one safe, deterministic shape.
 * Unknown Error messages are deliberately not exposed because they may contain
 * request headers, URLs or provider response bodies.
 */
export function classifyToolFailure(error: unknown, attempts = 1): ClassifiedToolFailure {
  if (isSoftToolError(error)) {
    const message = normalizeMessage(error);
    const status = statusFromMessage(message);
    const kind = status === undefined ? kindFromMessage(message, "tool_error") : kindFromStatus(status);
    return failure(kind, attempts, { message, status });
  }

  const status = readStatus(error);
  const rawMessage = error instanceof Error ? error.message : "";
  const messageStatus = status ?? statusFromMessage(rawMessage);
  const kind =
    error instanceof Error && error.name === "AbortError"
      ? "cancelled"
      : messageStatus === undefined
        ? kindFromMessage(rawMessage, "tool_error")
        : kindFromStatus(messageStatus);

  const safeMessage = error instanceof UserVisibleError ? error.message : undefined;
  return failure(kind, attempts, { message: safeMessage, status: messageStatus });
}

export async function executeToolWithOutcome<T>(
  operation: (attempt: number) => Promise<T>,
  options: ExecuteToolOptions = {},
): Promise<ToolOutcome<T>> {
  const reserveMs = options.reserveMs ?? 0;

  const mayRetry = (outcome: ClassifiedToolFailure, attempts: number): boolean => (
    outcome.retryable
    && attempts === 1
    && !options.deadline?.signal.aborted
    && hasDeadlineTime(options.deadline, reserveMs)
  );

  for (let attempts = 1; attempts <= 2; attempts += 1) {
    try {
      const value = await operation(attempts);
      if (isSoftToolError(value)) {
        const outcome = classifyToolFailure(value, attempts);
        if (mayRetry(outcome, attempts)) continue;
        return outcome;
      }
      return { ok: true, value, attempts };
    } catch (error) {
      const outcome = classifyToolFailure(error, attempts);
      if (mayRetry(outcome, attempts)) continue;
      return outcome;
    }
  }

  // The loop always returns. Keeping a total fallback makes the function
  // exhaustive even if its fixed attempt bound is refactored later.
  return failure("tool_error", 2);
}
