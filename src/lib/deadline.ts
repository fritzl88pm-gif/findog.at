import { UserVisibleError } from "./errors";

export const ROUTE_TIMEOUT_MESSAGE =
  "Die Anfrage hat zu lange gedauert. Bitte die Frage etwas eingrenzen oder es erneut versuchen.";

export type Deadline = {
  readonly signal: AbortSignal;
  readonly expiresAt: number;
  remainingMs(): number;
  throwIfExpired(message?: string): void;
  dispose(): void;
};

type DeadlineOptions = {
  parentSignal?: AbortSignal;
  timeoutMessage?: string;
  status?: number;
};

type TimeoutOptions = {
  deadline?: Deadline;
  signal?: AbortSignal;
  timeoutMs: number;
  timeoutMessage: string;
  reserveMs?: number;
  status?: number;
};

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === "object" && "unref" in timer && typeof timer.unref === "function") {
    timer.unref();
  }
}

function timeoutError(message: string, status = 504): UserVisibleError {
  return new UserVisibleError(message, status);
}

function abortReasonError(signal: AbortSignal, fallbackMessage: string, status = 504): UserVisibleError {
  return signal.reason instanceof UserVisibleError
    ? signal.reason
    : timeoutError(fallbackMessage, status);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function createDeadline(durationMs: number, options: DeadlineOptions = {}): Deadline {
  const timeoutMessage = options.timeoutMessage ?? ROUTE_TIMEOUT_MESSAGE;
  const status = options.status ?? 504;
  const controller = new AbortController();
  const expiresAt = Date.now() + Math.max(0, durationMs);

  const abort = (reason?: unknown) => {
    if (!controller.signal.aborted) {
      controller.abort(reason instanceof Error ? reason : timeoutError(timeoutMessage, status));
    }
  };

  const timeout = setTimeout(() => abort(timeoutError(timeoutMessage, status)), Math.max(0, durationMs));
  unrefTimer(timeout);

  const onParentAbort = () => abort(options.parentSignal?.reason ?? timeoutError("Die Anfrage wurde abgebrochen.", 499));
  if (options.parentSignal?.aborted) {
    onParentAbort();
  } else {
    options.parentSignal?.addEventListener("abort", onParentAbort, { once: true });
  }

  return {
    signal: controller.signal,
    expiresAt,
    remainingMs() {
      return Math.max(0, expiresAt - Date.now());
    },
    throwIfExpired(message = timeoutMessage) {
      if (controller.signal.aborted) {
        throw abortReasonError(controller.signal, message, status);
      }
      if (Date.now() >= expiresAt) {
        abort(timeoutError(message, status));
        throw timeoutError(message, status);
      }
    },
    dispose() {
      clearTimeout(timeout);
      options.parentSignal?.removeEventListener("abort", onParentAbort);
    },
  };
}

export function hasDeadlineTime(deadline: Deadline | undefined, minimumMs: number): boolean {
  return !deadline || deadline.remainingMs() > minimumMs;
}

export async function runWithTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: TimeoutOptions,
): Promise<T> {
  const status = options.status ?? 504;
  options.deadline?.throwIfExpired();

  const reserveMs = options.reserveMs ?? 0;
  const availableMs = options.deadline ? options.deadline.remainingMs() - reserveMs : options.timeoutMs;
  const boundedTimeoutMs = Math.min(options.timeoutMs, availableMs);

  if (boundedTimeoutMs <= 0) {
    throw timeoutError(options.timeoutMessage, status);
  }

  const controller = new AbortController();
  const abort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) {
      controller.abort(signal.reason ?? timeoutError(options.timeoutMessage, status));
    }
  };
  const onDeadlineAbort = () => {
    if (options.deadline) {
      abort(options.deadline.signal);
    }
  };
  const onSignalAbort = () => {
    if (options.signal) {
      abort(options.signal);
    }
  };

  if (options.deadline?.signal.aborted) {
    onDeadlineAbort();
  } else {
    options.deadline?.signal.addEventListener("abort", onDeadlineAbort, { once: true });
  }
  if (options.signal?.aborted) {
    onSignalAbort();
  } else {
    options.signal?.addEventListener("abort", onSignalAbort, { once: true });
  }

  const timeout = setTimeout(
    () => controller.abort(timeoutError(options.timeoutMessage, status)),
    boundedTimeoutMs,
  );
  unrefTimer(timeout);

  try {
    return await operation(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw abortReasonError(controller.signal, options.timeoutMessage, status);
    }
    if (isAbortError(error)) {
      throw timeoutError(options.timeoutMessage, status);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    options.deadline?.signal.removeEventListener("abort", onDeadlineAbort);
    options.signal?.removeEventListener("abort", onSignalAbort);
  }
}
