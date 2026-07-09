import { afterEach, describe, expect, it, vi } from "vitest";

import { createDeadline, hasDeadlineTime, runWithTimeout } from "./deadline";

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
});
