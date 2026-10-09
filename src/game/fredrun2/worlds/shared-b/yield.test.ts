import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { yieldBetweenBakes } from "./yield";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** MessageChannel-Ersatz: postMessage an port2 löst onmessage von port1 asynchron aus. */
class FakeChannel {
  static created = 0;
  static last: FakeChannel | null = null;
  port1 = { onmessage: null as null | (() => void), close: vi.fn() };
  port2 = {
    postMessage: (): void => {
      queueMicrotask(() => this.port1.onmessage?.());
    },
  };
  constructor() {
    FakeChannel.created++;
    FakeChannel.last = this;
  }
}

describe("yieldBetweenBakes", () => {
  it("ist ohne window sofort erfüllt – auch unter Fake-Timern (hängt nicht)", async () => {
    vi.useFakeTimers();
    let done = false;
    void yieldBetweenBakes().then(() => (done = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toBe(true);
  });

  it("nimmt MessageChannel und lässt scheduler.yield aus (Chromium gibt damit kaum rAF-Frames frei)", async () => {
    FakeChannel.created = 0;
    const yieldFn = vi.fn(() => Promise.resolve());
    vi.stubGlobal("window", { scheduler: { yield: yieldFn } });
    vi.stubGlobal("MessageChannel", FakeChannel);
    await yieldBetweenBakes();
    expect(yieldFn).not.toHaveBeenCalled();
    expect(FakeChannel.created).toBe(1);
    expect(FakeChannel.last?.port1.close).toHaveBeenCalledTimes(1); // Port wird aufgeräumt
  });

  it("wartet auf die Nachricht, läuft nicht synchron durch", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("MessageChannel", FakeChannel);
    let done = false;
    const p = yieldBetweenBakes().then(() => (done = true));
    expect(done).toBe(false);
    await p;
    expect(done).toBe(true);
  });

  it("nutzt setTimeout 0, wenn es kein MessageChannel gibt", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {});
    vi.stubGlobal("MessageChannel", undefined);
    let done = false;
    void yieldBetweenBakes().then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });

  it("fällt bei werfendem MessageChannel auf setTimeout zurück", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {});
    vi.stubGlobal(
      "MessageChannel",
      class {
        constructor() {
          throw new Error("gesperrt");
        }
      },
    );
    let done = false;
    void yieldBetweenBakes().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });
});

describe("Weltladen nutzt die Pause zwischen den Bakes", () => {
  it.each(["wien", "prater", "alpen"])("%s/renderer.ts ruft yieldBetweenBakes statt yieldToMain (scheduler.yield)", (id) => {
    const src = readFileSync(new URL(`../${id}/renderer.ts`, import.meta.url), "utf8");
    expect(src).toContain('from "../shared-b/yield"');
    expect(src).not.toMatch(/\byieldToMain\b/);
  });
});
