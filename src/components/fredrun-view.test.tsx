// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FREDRUN_HIGH_SCORE_KEY } from "@/lib/fredrun";
import {
  FREDRUN_PROFILE_KEY,
  createDefaultFredRunProfile,
  type FredRunProfile,
} from "@/lib/fredrun-profile";
import FredRunView from "./fredrun-view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class LoadedImage {
  decoding = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_source: string) {
    queueMicrotask(() => this.onload?.());
  }
}

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

type FetchCall = { url: string; init: RequestInit; reply: Deferred<Response> };

let calls: FetchCall[];
let frames: FrameRequestCallback[];
let frameTime: number;
let mounted: { container: HTMLDivElement; root: Root }[];

async function flush() {
  for (let index = 0; index < 10; index += 1) await act(async () => { await Promise.resolve(); });
}

async function mount(accessToken: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ container, root });
  await act(async () => root.render(<FredRunView accessToken={accessToken} standalone={!accessToken} />));
  await flush();
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  return { container, root };
}

function button(container: HTMLElement, label: string | RegExp): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll("button")).find((candidate) => (
    typeof label === "string" ? candidate.textContent?.trim() === label : label.test(candidate.textContent ?? "")
  ));
  if (!match) throw new Error(`Button ${String(label)} not found in: ${container.textContent}`);
  return match;
}

async function click(container: HTMLElement, label: string | RegExp) {
  await act(async () => button(container, label).click());
}

// Runs the animation loops until the current run hits its first obstacle.
async function playUntilGameOver(container: HTMLElement) {
  await click(container, "Run starten");
  for (let frame = 0; frame < 4_000 && !container.textContent?.includes("Runde beendet"); frame += 1) {
    frameTime += 50;
    const pending = frames;
    frames = [];
    act(() => pending.forEach((callback) => callback(frameTime)));
  }
  expect(container.textContent).toContain("Runde beendet");
  await flush();
}

function storedProfile(): FredRunProfile {
  return JSON.parse(window.localStorage.getItem(FREDRUN_PROFILE_KEY) ?? "null") as FredRunProfile;
}

beforeEach(() => {
  calls = [];
  frames = [];
  frameTime = performance.now() + 1_000_000;
  mounted = [];
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("Image", LoadedImage);
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit) => {
    const reply = deferred<Response>();
    calls.push({ url, init, reply });
    return reply.promise;
  }));
});

afterEach(async () => {
  for (const { root, container } of mounted) {
    await act(async () => root.unmount());
    container.remove();
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("standalone FredRun progress in two tabs", () => {
  beforeEach(() => {
    window.localStorage.setItem(FREDRUN_PROFILE_KEY, JSON.stringify({
      ...createDefaultFredRunProfile(),
      coinBalance: 1_000,
    }));
  });

  async function buyFinanzamtNight(container: HTMLElement) {
    await click(container, "Levels");
    await click(container, /Für 500 freischalten/);
    await click(container, "Jetzt freischalten");
    expect(storedProfile()).toMatchObject({ coinBalance: 500, selectedWorld: "finanzamt-night" });
  }

  it("keeps another tab's purchase when this tab selects a character", async () => {
    const tabA = await mount("");
    const tabB = await mount("");
    await buyFinanzamtNight(tabA.container);

    // Tab B still shows the 1,000 coins it read when it mounted.
    await click(tabB.container, "Charaktere");
    await click(tabB.container, "Auswählen");

    expect(storedProfile()).toMatchObject({ coinBalance: 500, selectedCharacter: "frida" });
    expect(storedProfile().unlockedWorlds).toContain("finanzamt-night");
    expect(tabB.container.querySelector('[aria-label="500 Münzen verfügbar"]')).not.toBeNull();
  });

  it("settles a run onto the stored coins and never lowers another tab's best score", async () => {
    const tabA = await mount("");
    const tabB = await mount("");
    await buyFinanzamtNight(tabA.container);
    window.localStorage.setItem(FREDRUN_HIGH_SCORE_KEY, "999999");

    await playUntilGameOver(tabB.container);

    const summary = tabB.container.querySelector(".fredrun-game-over-coins span")?.textContent ?? "";
    const collected = Number(/^(\d+) Run-Münzen/.exec(summary)?.[1]);
    expect(storedProfile().coinBalance).toBe(500 + collected);
    expect(storedProfile().unlockedWorlds).toContain("finanzamt-night");
    expect(window.localStorage.getItem(FREDRUN_HIGH_SCORE_KEY)).toBe("999999");
    expect(tabB.container.textContent).toContain("Bestwert: 999999");
  });
});
