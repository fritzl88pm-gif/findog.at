import { UserVisibleError } from "@/lib/errors";

type RateEntry = { startedAt: number; count: number };

type ScanningRateLimiterOptions = {
  now?: () => number;
  maxRequests: number;
  windowMs: number;
  sweepEvery?: number;
  maxSweepEntries?: number;
};

export class ScanningRateLimiter {
  private readonly entries = new Map<string, RateEntry>();
  private readonly now: () => number;
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly sweepEvery: number;
  private readonly maxSweepEntries: number;
  private requestsSinceSweep = 0;

  constructor(options: ScanningRateLimiterOptions) {
    this.now = options.now ?? Date.now;
    this.maxRequests = options.maxRequests;
    this.windowMs = options.windowMs;
    this.sweepEvery = options.sweepEvery ?? 64;
    this.maxSweepEntries = options.maxSweepEntries ?? 64;
  }

  get size(): number {
    return this.entries.size;
  }

  has(userId: string): boolean {
    return this.entries.has(userId);
  }

  consume(userId: string): void {
    const now = this.now();
    this.requestsSinceSweep += 1;
    if (this.requestsSinceSweep >= this.sweepEvery) {
      this.sweep(now);
      this.requestsSinceSweep = 0;
    }

    const current = this.entries.get(userId);
    if (!current || now - current.startedAt >= this.windowMs) {
      this.entries.set(userId, { startedAt: now, count: 1 });
      return;
    }
    if (current.count >= this.maxRequests) {
      throw new UserVisibleError("Zu viele Scanning-Anfragen. Bitte kurz warten.", 429);
    }
    current.count += 1;
  }

  private sweep(now: number): void {
    const candidates = [...this.entries.entries()].slice(0, this.maxSweepEntries);
    for (const [userId, entry] of candidates) {
      this.entries.delete(userId);
      if (now - entry.startedAt < this.windowMs) {
        this.entries.set(userId, entry);
      }
    }
  }
}
