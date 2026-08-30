import { UserVisibleError } from "@/lib/errors";

const DEFAULT_HEAVY_ATTACHMENT_CONCURRENCY = 1;
const MAX_CONFIGURED_HEAVY_ATTACHMENT_CONCURRENCY = 8;

export type HeavyAttachmentRequestLease = {
  release(): void;
};

export class HeavyAttachmentRequestAdmission {
  readonly capacity: number;
  #active = 0;

  constructor(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new TypeError("capacity must be a positive safe integer");
    }
    this.capacity = capacity;
  }

  get active(): number {
    return this.#active;
  }

  tryAcquire(): HeavyAttachmentRequestLease | null {
    if (this.#active >= this.capacity) return null;
    this.#active += 1;
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.#active -= 1;
      },
    };
  }
}

function configuredCapacity(): number {
  const raw = process.env.FINDOG_HEAVY_ATTACHMENT_CONCURRENCY?.trim() ?? "";
  if (!/^\d+$/u.test(raw)) return DEFAULT_HEAVY_ATTACHMENT_CONCURRENCY;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed)
    && parsed >= 1
    && parsed <= MAX_CONFIGURED_HEAVY_ATTACHMENT_CONCURRENCY
    ? parsed
    : DEFAULT_HEAVY_ATTACHMENT_CONCURRENCY;
}

const globalAdmissionKey = "__findogHeavyAttachmentRequestAdmission";
type AdmissionGlobal = typeof globalThis & {
  [globalAdmissionKey]?: HeavyAttachmentRequestAdmission;
};
const admissionGlobal = globalThis as AdmissionGlobal;
const processAdmission = admissionGlobal[globalAdmissionKey]
  ?? new HeavyAttachmentRequestAdmission(configuredCapacity());
admissionGlobal[globalAdmissionKey] = processAdmission;

/** Fail fast instead of queuing more large request bodies in application memory. */
export function acquireHeavyAttachmentRequest(): HeavyAttachmentRequestLease {
  const lease = processAdmission.tryAcquire();
  if (!lease) {
    throw new UserVisibleError(
      "Die Anhangverarbeitung ist derzeit ausgelastet. Bitte versuche es in Kürze erneut.",
      503,
    );
  }
  return lease;
}
