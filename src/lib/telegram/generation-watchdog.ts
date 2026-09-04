import type { FredTurnEvent } from "../fred/turn-types";

export class TelegramGenerationTimeoutError extends Error {
  constructor(readonly code: "GENERATION_TIMEOUT" | "GENERATION_IDLE_TIMEOUT") {
    super(code);
    this.name = "TelegramGenerationTimeoutError";
  }
}

/** Network keepalives and repeated status events are not generation progress. */
export function createGenerationWatchdog(options: {
  timeoutMs?: number;
  idleTimeoutMs?: number;
  onTimeout: (error: TelegramGenerationTimeoutError) => void;
  onUnresponsive?: () => void;
}) {
  let expired = false;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  const expire = (code: "GENERATION_TIMEOUT" | "GENERATION_IDLE_TIMEOUT") => {
    if (expired) return;
    expired = true;
    clearTimeout(totalTimer);
    clearTimeout(idleTimer);
    // Do not release the slot while an uncooperative generator could still write.
    // Fail the worker instead so its leases can be safely reclaimed after exit.
    graceTimer = setTimeout(() => options.onUnresponsive?.(), 30_000);
    options.onTimeout(new TelegramGenerationTimeoutError(code));
  };
  const totalTimer = setTimeout(() => expire("GENERATION_TIMEOUT"), options.timeoutMs ?? 720_000);
  const idleMs = options.idleTimeoutMs ?? 300_000;
  let idleTimer = setTimeout(() => expire("GENERATION_IDLE_TIMEOUT"), idleMs);
  const steps = new Map<string, string>();
  return {
    observe(event: FredTurnEvent) {
      if (expired) return;
      let progressed = event.type === "delta" && event.content.length > 0;
      if (event.type === "research" || event.type === "execution") {
        const key = `${event.type}:${event.step.id}`;
        const signature = JSON.stringify({ ...event.step, durationMs: undefined });
        progressed = steps.get(key) !== signature;
        if (steps.size < 1_000 || steps.has(key)) steps.set(key, signature);
      }
      if (progressed) {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => expire("GENERATION_IDLE_TIMEOUT"), idleMs);
      }
    },
    dispose() {
      clearTimeout(totalTimer);
      clearTimeout(idleTimer);
      if (graceTimer) clearTimeout(graceTimer);
    },
  };
}
