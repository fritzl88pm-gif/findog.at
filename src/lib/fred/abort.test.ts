import { describe, expect, it, vi } from "vitest";

import {
  abortFredRequest,
  beginFredRun,
  invalidateFredRun,
  isCurrentFredRun,
} from "./abort";

describe("abortFredRequest", () => {
  it("aborts the active request and clears the reference", () => {
    const abort = vi.fn();
    const ref = { current: { abort } as unknown as AbortController };

    abortFredRequest(ref);

    expect(abort).toHaveBeenCalledOnce();
    expect(ref.current).toBeNull();
  });

  it("is a no-op when no request is active", () => {
    const ref: { current: AbortController | null } = { current: null };

    expect(() => abortFredRequest(ref)).not.toThrow();
    expect(ref.current).toBeNull();
  });
});

describe("Fred run lifecycle", () => {
  it("invalidates stale asynchronous handlers when a new run starts", () => {
    const ref = { current: 0 };
    const firstRun = beginFredRun(ref);
    const secondRun = beginFredRun(ref);

    expect(isCurrentFredRun(ref, firstRun)).toBe(false);
    expect(isCurrentFredRun(ref, secondRun)).toBe(true);
  });

  it("invalidates the current run when a chat is reset", () => {
    const ref = { current: 0 };
    const run = beginFredRun(ref);

    invalidateFredRun(ref);

    expect(isCurrentFredRun(ref, run)).toBe(false);
  });
});
