import { afterEach, describe, expect, it, vi } from "vitest";
import { yieldToMain } from "./yield";

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

describe("yieldToMain", () => {
  it("ist ohne window sofort erfüllt – auch unter Fake-Timern (hängt nicht)", async () => {
    vi.useFakeTimers();
    let done = false;
    void yieldToMain().then(() => (done = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toBe(true);
  });

  it("nutzt scheduler.yield, wenn vorhanden", async () => {
    const yieldFn = vi.fn(() => Promise.resolve());
    vi.stubGlobal("window", { scheduler: { yield: yieldFn } });
    await yieldToMain();
    expect(yieldFn).toHaveBeenCalledTimes(1);
  });

  it("fällt ohne scheduler.yield auf MessageChannel zurück und räumt den Port auf", async () => {
    FakeChannel.created = 0;
    vi.stubGlobal("window", {});
    vi.stubGlobal("MessageChannel", FakeChannel);
    await yieldToMain();
    expect(FakeChannel.created).toBe(1);
    expect(FakeChannel.last?.port1.close).toHaveBeenCalledTimes(1);
  });

  it("nutzt setTimeout 0, wenn es kein MessageChannel gibt", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {});
    vi.stubGlobal("MessageChannel", undefined);
    let done = false;
    void yieldToMain().then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false); // wartet auf den Timer, läuft nicht synchron durch
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });

  it("fällt bei werfendem MessageChannel/scheduler auf setTimeout zurück", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      get scheduler(): never {
        throw new Error("gesperrt");
      },
    });
    vi.stubGlobal(
      "MessageChannel",
      class {
        constructor() {
          throw new Error("gesperrt");
        }
      },
    );
    let done = false;
    void yieldToMain().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });
});
