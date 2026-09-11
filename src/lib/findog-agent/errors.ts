/**
 * Feature-local error taxonomy for the Findog Agent runtime.
 *
 * The engine never throws raw upstream errors across its public boundary: every
 * failure is mapped to a stable code so the worker can persist an honest
 * terminal state instead of a stack trace.
 */

export type FindogAgentEngineErrorCode =
  | "invalid_request"
  | "agent_disabled"
  | "model_not_configured"
  | "credentials_missing"
  | "context_too_large"
  | "deadline_exceeded"
  | "cancelled"
  | "fence_failed"
  | "budget_unmeasurable"
  | "budget_exceeded"
  | "empty_output"
  | "incomplete_output"
  | "internal_error";

export class FindogAgentEngineError extends Error {
  readonly code: FindogAgentEngineErrorCode;
  readonly detail: Record<string, unknown> | null;

  constructor(
    code: FindogAgentEngineErrorCode,
    message: string,
    detail: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = "FindogAgentEngineError";
    this.code = code;
    this.detail = detail;
  }
}

export type FindogAgentAdapterErrorCode =
  | "invalid_request"
  | "scope_denied"
  | "not_found"
  | "unavailable"
  | "upstream_error"
  | "invalid_response"
  | "unknown_tool"
  | "tool_not_approved";

export class FindogAgentAdapterError extends Error {
  readonly code: FindogAgentAdapterErrorCode;
  readonly status: number | null;

  constructor(
    code: FindogAgentAdapterErrorCode,
    message: string,
    status: number | null = null,
  ) {
    super(message);
    this.name = "FindogAgentAdapterError";
    this.code = code;
    this.status = status;
  }
}

export type FindogAgentNetworkErrorCode =
  | "invalid_url"
  | "url_credentials"
  | "insecure_transport"
  | "blocked_destination"
  | "dns_failure"
  | "redirect_denied"
  | "redirect_limit"
  | "timeout"
  | "aborted"
  | "transport_failure";

export class FindogAgentNetworkError extends Error {
  readonly code: FindogAgentNetworkErrorCode;

  constructor(code: FindogAgentNetworkErrorCode, message: string) {
    super(message);
    this.name = "FindogAgentNetworkError";
    this.code = code;
  }
}

export type FindogAgentProviderErrorCode =
  | "model_http_error"
  | "model_invalid_response"
  | "model_aborted";

export class FindogAgentProviderError extends Error {
  readonly code: FindogAgentProviderErrorCode;
  readonly status: number | null;

  constructor(code: FindogAgentProviderErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = "FindogAgentProviderError";
    this.code = code;
    this.status = status;
  }
}

/** Narrowing helper that keeps unknown throwables readable in logs and events. */
export function findogAgentErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error) {
    return error;
  }
  return "Unbekannter Fehler";
}
