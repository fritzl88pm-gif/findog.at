import { afterEach, describe, expect, it, vi } from "vitest";

import { createDeadline, createUnboundedDeadline, hasDeadlineTime, runWithTimeout } from "./deadline";

describe("deadline helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("expires and throws the configured user-visible timeout", () => {
    vi.useFakeTimers();
    const deadline = createDeadline(100, { timeoutMessage: "Zeitbudget überschritten." });

    expect(deadline.signal.aborted).toBe(false);
    expect(hasDeadlineTime(deadline, 50)).toBe(true);

    vi.advanceTimersByTime(101);

    expect(deadline.signal.aborted).toBe(true);
    expect(() => deadline.throwIfExpired()).toThrow("Zeitbudget überschritten.");
    expect(hasDeadlineTime(deadline, 1)).toBe(false);
    deadline.dispose();
  });

  it("tracks remaining time from the deadline expiry", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const deadline = createDeadline(1_000);

    expect(deadline.remainingMs()).toBe(1_000);

    vi.setSystemTime(400);

    expect(deadline.remainingMs()).toBe(600);
    deadline.dispose();
  });

  it("keeps an unbounded deadline unlimited without scheduling an expiration timer", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const deadline = createUnboundedDeadline();

    expect(deadline.expiresAt).toBe(Number.POSITIVE_INFINITY);
    expect(deadline.remainingMs()).toBe(Number.POSITIVE_INFINITY);
    expect(vi.getTimerCount()).toBe(0);

    vi.advanceTimersByTime(240_000);

    expect(deadline.signal.aborted).toBe(false);
    expect(deadline.remainingMs()).toBe(Number.POSITIVE_INFINITY);
    expect(hasDeadlineTime(deadline, Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    deadline.dispose();
  });

  it("propagates parent aborts through an unbounded deadline", () => {
    const parent = new AbortController();
    const deadline = createUnboundedDeadline({ parentSignal: parent.signal });

    parent.abort();

    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.signal.reason).toBe(parent.signal.reason);
    expect(() => deadline.throwIfExpired()).toThrow();
    deadline.dispose();
  });

  it("fails immediately when reserve time exhausts the available deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const deadline = createDeadline(50);

    await expect(
      runWithTimeout(() => Promise.resolve("unreached"), {
        deadline,
        timeoutMs: 100,
        reserveMs: 60,
        timeoutMessage: "Kein Zeitbudget für diesen Aufruf.",
      }),
    ).rejects.toMatchObject({
      message: "Kein Zeitbudget für diesen Aufruf.",
      status: 504,
    });

    deadline.dispose();
  });

  it("aborts in-flight work while the operation is still reading the response body", async () => {
    vi.useFakeTimers();
    const promise = runWithTimeout(
      (signal) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
      {
        timeoutMs: 100,
        timeoutMessage: "Externer Aufruf dauerte zu lange.",
      },
    );

    const expectation = expect(promise).rejects.toMatchObject({
      message: "Externer Aufruf dauerte zu lange.",
      status: 504,
    });

    await vi.advanceTimersByTimeAsync(100);

    await expectation;
  });

  it("retains the per-call timeout when the shared deadline is unbounded", async () => {
    vi.useFakeTimers();
    const deadline = createUnboundedDeadline();
    const promise = runWithTimeout(
      (signal) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
      {
        deadline,
        timeoutMs: 100,
        timeoutMessage: "Externer Aufruf dauerte zu lange.",
      },
    );

    const expectation = expect(promise).rejects.toMatchObject({
      message: "Externer Aufruf dauerte zu lange.",
      status: 504,
    });

    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(100);

    await expectation;
    deadline.dispose();
  });
});
