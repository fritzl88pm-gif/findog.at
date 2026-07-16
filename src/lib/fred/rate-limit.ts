export const FRED_RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
export const FRED_RATE_LIMIT_MAX_REQUESTS = 20;

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

export type RateLimiter = {
  check(key: string): boolean;
};

export function createRateLimiter(options?: {
  windowMs?: number;
  maxRequests?: number;
  nowFn?: () => number;
}): RateLimiter {
  const windowMs = options?.windowMs ?? FRED_RATE_LIMIT_WINDOW_MS;
  const maxRequests = options?.maxRequests ?? FRED_RATE_LIMIT_MAX_REQUESTS;
  const nowFn = options?.nowFn ?? Date.now;
  const entries = new Map<string, RateLimitEntry>();

  function prune(): void {
    const now = nowFn();
    for (const [key, entry] of entries) {
      if (entry.resetAt <= now) {
        entries.delete(key);
      }
    }
  }

  return {
    check(key: string): boolean {
      prune();
      const now = nowFn();
      const current = entries.get(key);

      if (!current || current.resetAt <= now) {
        entries.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }

      if (current.count >= maxRequests) {
        return false;
      }

      current.count += 1;
      return true;
    },
  };
}
