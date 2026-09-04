import { afterEach, expect, it, vi } from "vitest";
import { createGenerationWatchdog } from "./generation-watchdog";
import { createWorkerHealth } from "./worker-health";

afterEach(() => vi.useRealTimers());

it("ignores repeated status and unchanged research events for idle detection", async () => {
  vi.useFakeTimers();
  const onTimeout = vi.fn();
  const watch = createGenerationWatchdog({ timeoutMs: 1_000, idleTimeoutMs: 100, onTimeout });
  watch.observe({ type: "research", step: { id: "1", kind: "tool", status: "running", label: "Suche" } });
  await vi.advanceTimersByTimeAsync(60);
  watch.observe({ type: "status", label: "Verbindung offen" });
  watch.observe({ type: "research", step: { id: "1", kind: "tool", status: "running", label: "Suche" } });
  await vi.advanceTimersByTimeAsync(40);
  expect(onTimeout).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: "GENERATION_IDLE_TIMEOUT" }));
  watch.dispose();
  expect(vi.getTimerCount()).toBe(0);
});

it("resets idle time on real progress but never extends the total deadline", async () => {
  vi.useFakeTimers();
  const onTimeout = vi.fn();
  const watch = createGenerationWatchdog({ timeoutMs: 250, idleTimeoutMs: 100, onTimeout });
  for (let i = 0; i < 3; i++) {
    await vi.advanceTimersByTimeAsync(80);
    watch.observe({ type: "delta", content: "Antwort" });
  }
  expect(onTimeout).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(10);
  expect(onTimeout).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: "GENERATION_TIMEOUT" }));
  watch.dispose();
});

it("escalates an uncooperative generator, and cancels escalation when cleanup finishes", async () => {
  vi.useFakeTimers();
  const onUnresponsive = vi.fn();
  const watch = createGenerationWatchdog({ idleTimeoutMs: 100, onTimeout: vi.fn(), onUnresponsive });
  await vi.advanceTimersByTimeAsync(30_100);
  expect(onUnresponsive).toHaveBeenCalledOnce();
  watch.dispose();
  onUnresponsive.mockClear();
  const cooperative = createGenerationWatchdog({ idleTimeoutMs: 100, onTimeout: vi.fn(), onUnresponsive });
  await vi.advanceTimersByTimeAsync(100);
  cooperative.dispose();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(onUnresponsive).not.toHaveBeenCalled();
});

it("reports unhealthy on claim failures, stale lanes and fatal generation stalls", () => {
  let now = 0;
  const health = createWorkerHealth(() => now);
  expect(health.isHealthy()).toBe(false);
  health.record("generation", true);
  health.record("control", true);
  expect(health.isHealthy()).toBe(true);
  health.record("control", false);
  expect(health.isHealthy()).toBe(false);
  health.record("control", true);
  now = 90_000;
  expect(health.isHealthy()).toBe(false);
  health.record("generation", true);
  health.record("control", true);
  health.fail();
  health.record("control", true);
  expect(health.isHealthy()).toBe(false);
});
