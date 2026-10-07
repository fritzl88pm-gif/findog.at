import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IMAGE_RETRY_MS, IMAGE_TIMEOUT_MS, WarmQueue, warmImage, type WarmDeps } from "./assets";

type Assets = typeof import("./assets");

// --- Fakes -------------------------------------------------------------------------------------------------------------

type Behavior = "ok" | "fail" | "hang";

/** Image-Ersatz: je nach Verhalten feuert onload/onerror (asynchron) oder nie (hängende Anfrage). */
class FakeImage {
  static instances: FakeImage[] = [];
  static behavior: (url: string) => Behavior = () => "ok";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  decoding = "";
  width = 1536;
  height = 1536;
  naturalWidth = 1536;
  naturalHeight = 1536;
  srcLog: string[] = [];
  private current = "";
  get src(): string {
    return this.current;
  }
  set src(v: string) {
    this.current = v;
    this.srcLog.push(v);
    FakeImage.instances.push(this);
    if (v === "") return; // Abbruch
    const b = FakeImage.behavior(v);
    if (b === "hang") return;
    queueMicrotask(() => (b === "ok" ? this.onload?.() : this.onerror?.()));
  }
}

function requestsFor(fragment: string): FakeImage[] {
  return FakeImage.instances.filter((i) => i.srcLog.some((s) => s.includes(fragment)));
}

/** Frisches Modul (leere Caches/Warteschlange) mit installiertem Image-Ersatz. */
async function freshAssets(): Promise<Assets> {
  vi.resetModules();
  vi.stubGlobal("Image", FakeImage);
  return import("./assets");
}

type BitmapMode = "resolve" | "hang" | "reject" | "throw";

/** createImageBitmap-Ersatz: protokolliert die Aufrufe, liefert Bitmaps mit close(); "hang" erfüllt erst auf release(). */
function installFakeBitmap(mode: BitmapMode = "resolve") {
  const calls: unknown[][] = [];
  const bitmaps: Array<{ close: ReturnType<typeof vi.fn> }> = [];
  const gates: Array<() => void> = [];
  const fn = vi.fn((...args: unknown[]) => {
    calls.push(args);
    if (mode === "throw") throw new Error("InvalidStateError");
    if (mode === "reject") return Promise.reject(new Error("kaputt"));
    const bmp = { close: vi.fn() };
    bitmaps.push(bmp);
    if (mode === "hang") return new Promise((resolve) => gates.push(() => resolve(bmp)));
    return Promise.resolve(bmp);
  });
  vi.stubGlobal("createImageBitmap", fn);
  return { fn, calls, bitmaps, release: () => gates.shift()?.(), pending: () => gates.length };
}

/**
 * Fake-Dokument: createElement("canvas") liefert eine Canvas, deren drawImage-Aufrufe protokolliert werden.
 * bitmap: createImageBitmap vorhanden (Flush asynchron, wie in allen aktuellen Browsern) oder nicht (Rückfall getImageData).
 */
function installFakeDocument(opts: { throwOnDraw?: boolean; drawCostMs?: number; bitmap?: boolean | BitmapMode } = {}) {
  const draws: unknown[] = [];
  const clock = { t: 0 };
  if (opts.drawCostMs) vi.stubGlobal("performance", { now: () => clock.t }); // jeder Warm-Draw kostet virtuelle Zeit → ein Sheet je Slot
  const bitmap = opts.bitmap ? installFakeBitmap(opts.bitmap === true ? "resolve" : opts.bitmap) : null;
  const ctx = {
    drawImage: vi.fn((img: unknown) => {
      if (opts.throwOnDraw) throw new Error("InvalidStateError");
      draws.push(img);
      clock.t += opts.drawCostMs ?? 0;
    }),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
  };
  const canvases: Array<{ width: number; height: number; getContext: ReturnType<typeof vi.fn> }> = [];
  const doc = {
    hidden: false,
    createElement: vi.fn(() => {
      const c = { width: 0, height: 0, getContext: vi.fn(() => ctx) };
      canvases.push(c);
      return c;
    }),
  };
  vi.stubGlobal("document", doc);
  return { draws, ctx, doc, canvases, bitmap };
}

const ANIMS = ["run", "jump", "fall", "slide", "dash", "stomp", "doublejump", "hurt", "idle", "victory"] as const;

function atlasFor(names: readonly string[]) {
  const anims: Record<string, { file: string; cols: number; rows: number; frames: number; cw: number; ch: number }> = {};
  for (const n of names) anims[n] = { file: `${n}.webp`, cols: 8, rows: 8, frames: 64, cw: 192, ch: 192 };
  return { id: "fred", runHeight: 214, anims };
}

function installFetch(handlers: Record<string, unknown>) {
  const f = vi.fn(async (url: string) => {
    for (const [frag, body] of Object.entries(handlers)) {
      if (url.includes(frag)) return { ok: true, json: async () => body };
    }
    return { ok: false, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", f);
  return f;
}

beforeEach(() => {
  FakeImage.instances = [];
  FakeImage.behavior = () => "ok";
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// --- loadImage: Timeout, Fehlschlag, Retry -------------------------------------------------------------------------------

describe("loadImage", () => {
  it("liefert null ohne Image (SSR/Node)", async () => {
    vi.resetModules();
    const { loadImage } = await import("./assets");
    await expect(loadImage("/fredrun2/props/x.webp")).resolves.toBeNull();
  });

  it("lädt, cached und feuert nur eine Anfrage", async () => {
    const { loadImage } = await freshAssets();
    const a = await loadImage("/fredrun2/props/a.webp");
    const b = await loadImage("/fredrun2/props/a.webp");
    expect(a).not.toBeNull();
    expect(b).toBe(a);
    expect(requestsFor("props/a.webp")).toHaveLength(1);
  });

  it("onerror: null, Eintrag bleibt nicht dauerhaft null (nächster Aufruf fragt neu an)", async () => {
    vi.useFakeTimers();
    FakeImage.behavior = () => "fail";
    const { loadImage } = await freshAssets();
    await expect(loadImage("/fredrun2/props/b.webp")).resolves.toBeNull();
    FakeImage.behavior = () => "ok";
    const img = await loadImage("/fredrun2/props/b.webp");
    expect(img).not.toBeNull();
    expect(requestsFor("props/b.webp").length).toBeGreaterThanOrEqual(2);
    await expect(loadImage("/fredrun2/props/b.webp")).resolves.toBe(img); // jetzt gecached
  });

  it("Timeout nach 20 s liefert null, bricht die Anfrage ab und wird beim nächsten Aufruf erneut angefragt", async () => {
    vi.useFakeTimers();
    FakeImage.behavior = () => "hang";
    const { loadImage } = await freshAssets();
    let result: unknown = "offen";
    void loadImage("/fredrun2/props/c.webp").then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(IMAGE_TIMEOUT_MS - 1);
    expect(result).toBe("offen");
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBeNull();
    const first = requestsFor("props/c.webp")[0];
    expect(first.srcLog.at(-1)).toBe(""); // abgebrochen
    expect(first.onload).toBeNull();

    FakeImage.behavior = () => "ok";
    const again = await loadImage("/fredrun2/props/c.webp");
    expect(again).not.toBeNull();
    expect(requestsFor("props/c.webp").length).toBeGreaterThanOrEqual(2);
  });

  it("Retry nach 1,5 s genau einmal (Aufrufer bekommen sofort null, der Cache wird gefüllt)", async () => {
    vi.useFakeTimers();
    let n = 0;
    FakeImage.behavior = () => (n++ === 0 ? "fail" : "ok");
    const { loadImage } = await freshAssets();
    await expect(loadImage("/fredrun2/props/d.webp")).resolves.toBeNull();
    expect(requestsFor("props/d.webp")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(IMAGE_RETRY_MS - 1);
    expect(requestsFor("props/d.webp")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(requestsFor("props/d.webp")).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(requestsFor("props/d.webp")).toHaveLength(2); // kein weiterer Versuch
    // der Retry hat das Bild gecached: kein dritter Request
    const img = await loadImage("/fredrun2/props/d.webp");
    expect(img).not.toBeNull();
    expect(requestsFor("props/d.webp")).toHaveLength(2);
  });

  it("scheitert auch der Retry, gibt es keine Endlosschleife; ein neuer Aufruf versucht es erneut", async () => {
    vi.useFakeTimers();
    FakeImage.behavior = () => "fail";
    const { loadImage } = await freshAssets();
    await loadImage("/fredrun2/props/e.webp");
    await vi.advanceTimersByTimeAsync(IMAGE_RETRY_MS + 100);
    expect(requestsFor("props/e.webp")).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(requestsFor("props/e.webp")).toHaveLength(2);
    await loadImage("/fredrun2/props/e.webp");
    expect(requestsFor("props/e.webp")).toHaveLength(3);
  });

  it("kein Retry, wenn inzwischen jemand anderes neu geladen hat", async () => {
    vi.useFakeTimers();
    let n = 0;
    FakeImage.behavior = () => (n++ === 0 ? "fail" : "ok");
    const { loadImage } = await freshAssets();
    await loadImage("/fredrun2/props/f.webp"); // scheitert
    const img = await loadImage("/fredrun2/props/f.webp"); // sofort neu → ok
    expect(img).not.toBeNull();
    await vi.advanceTimersByTimeAsync(IMAGE_RETRY_MS + 100);
    expect(requestsFor("props/f.webp")).toHaveLength(2); // der Retry-Timer fand den Cache gefüllt
  });

  it("ein spätes onload nach dem Timeout ändert nichts mehr", async () => {
    vi.useFakeTimers();
    FakeImage.behavior = () => "hang";
    const { loadImage } = await freshAssets();
    const p = loadImage("/fredrun2/props/g.webp");
    await vi.advanceTimersByTimeAsync(IMAGE_TIMEOUT_MS + 1);
    await expect(p).resolves.toBeNull();
    FakeImage.instances[0].onload?.(); // Handler wurden abgemeldet → kein Fehler
  });
});

// --- warmImage ---------------------------------------------------------------------------------------------------------

const BIG_IMG = { naturalWidth: 1536, naturalHeight: 1536 } as unknown as HTMLImageElement;

describe("warmImage", () => {
  it("wirft nie: undefined, null, kaputte Bilder, kein DOM – nichts zu warten", () => {
    expect(warmImage(undefined)).toBeUndefined();
    expect(warmImage(null)).toBeUndefined();
    expect(warmImage({} as unknown as HTMLImageElement)).toBeUndefined();
    expect(warmImage(BIG_IMG)).toBeUndefined(); // kein document
    const { ctx } = installFakeDocument({ bitmap: true });
    expect(warmImage({ naturalWidth: 0, naturalHeight: 0 } as unknown as HTMLImageElement)).toBeUndefined(); // kaputtes Bild
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it("wirft nicht, wenn drawImage/getContext/createElement/createImageBitmap wirft", async () => {
    installFakeDocument({ throwOnDraw: true, bitmap: true });
    expect(warmImage(BIG_IMG)).toBeUndefined();
    vi.stubGlobal("document", {
      createElement: () => {
        throw new Error("kein Canvas");
      },
    });
    expect(warmImage(BIG_IMG)).toBeUndefined();
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => null }) });
    expect(warmImage(BIG_IMG)).toBeUndefined();
    // createImageBitmap wirft synchron
    installFakeDocument({ bitmap: "throw" });
    expect(warmImage(BIG_IMG)).toBeUndefined();
    // createImageBitmap wird abgelehnt: das Promise wird trotzdem erfüllt (nie abgelehnt)
    installFakeDocument({ bitmap: "reject" });
    await expect(warmImage(BIG_IMG)).resolves.toBeUndefined();
  });

  it("scheitert das Anlegen der Canvas, wird nicht in die Canvas des vorigen Dokuments gezeichnet und der nächste Aufruf versucht es neu", async () => {
    const { ctx } = installFakeDocument({ bitmap: true });
    await warmImage(BIG_IMG); // Canvas des ersten Dokuments
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    const ctx2 = { drawImage: vi.fn(), getImageData: vi.fn() };
    let fail = true;
    const doc2 = {
      createElement: vi.fn(() => {
        if (fail) throw new Error("kein Canvas");
        return { width: 0, height: 0, getContext: vi.fn(() => ctx2) };
      }),
    };
    vi.stubGlobal("document", doc2); // neues Dokument (z. B. Navigation): createElement scheitert zunächst
    expect(warmImage(BIG_IMG)).toBeUndefined();
    expect(ctx.drawImage).toHaveBeenCalledTimes(1); // kein Rest der alten Canvas
    fail = false;
    await warmImage(BIG_IMG);
    expect(doc2.createElement).toHaveBeenCalledTimes(2);
    expect(ctx2.drawImage).toHaveBeenCalledTimes(1);
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
  });

  it("zeichnet im Backend der Spielfläche: Canvas OHNE willReadFrequently, 1x1-Ausschnitt, Flush per createImageBitmap statt Rücklesen", async () => {
    const { ctx, doc, canvases, bitmap } = installFakeDocument({ bitmap: true });
    const a = { naturalWidth: 1536, naturalHeight: 1536 } as unknown as HTMLImageElement;
    const b = { naturalWidth: 1536, naturalHeight: 1536 } as unknown as HTMLImageElement;
    const pa = warmImage(a);
    expect(pa).toBeInstanceOf(Promise);
    await pa;
    await warmImage(b);
    expect(doc.createElement).toHaveBeenCalledTimes(1); // Canvas wird wiederverwendet
    expect(canvases[0].getContext).toHaveBeenCalledTimes(1);
    // wie render.ts: getContext("2d", { alpha: false }); willReadFrequently würde das Software-Backend erzwingen
    expect(canvases[0].getContext).toHaveBeenCalledWith("2d", { alpha: false });
    const opts = canvases[0].getContext.mock.calls[0][1] as Record<string, unknown>;
    expect(opts.willReadFrequently).toBeUndefined();
    // klein, aber nicht so klein, dass Chrome sie nicht mehr beschleunigt (ältere Versionen: < 128×129 px)
    expect(canvases[0].width).toBeGreaterThanOrEqual(129);
    expect(canvases[0].height).toBeGreaterThanOrEqual(129);
    expect(ctx.drawImage).toHaveBeenNthCalledWith(1, a, 0, 0, 1, 1, 0, 0, 1, 1);
    expect(ctx.drawImage).toHaveBeenNthCalledWith(2, b, 0, 0, 1, 1, 0, 0, 1, 1);
    expect(bitmap?.fn).toHaveBeenCalledTimes(2);
    expect(bitmap?.calls[0]).toEqual([canvases[0], 0, 0, 1, 1]); // nur der 1x1-Ausschnitt wird gesnapshottet
    expect(ctx.getImageData).not.toHaveBeenCalled(); // kein Rücklesen (würde eine GPU-Canvas auf Software umstellen)
    for (const bmp of bitmap?.bitmaps ?? []) expect(bmp.close).toHaveBeenCalledTimes(1); // Ergebnis sofort freigegeben
  });

  it("das Promise ist erst mit dem Flush erfüllt; ein spät eintreffendes Bitmap wird trotzdem geschlossen", async () => {
    const { bitmap } = installFakeDocument({ bitmap: "hang" });
    let done = false;
    void warmImage(BIG_IMG)?.then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    expect(bitmap?.bitmaps[0].close).not.toHaveBeenCalled();
    bitmap?.release();
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toBe(true);
    expect(bitmap?.bitmaps[0].close).toHaveBeenCalledTimes(1);
  });

  it("ohne createImageBitmap (alter Browser): Rückfall auf eine willReadFrequently-Canvas mit getImageData, synchron ohne Promise", () => {
    const { ctx, doc, canvases } = installFakeDocument();
    const a = { naturalWidth: 1536, naturalHeight: 1536 } as unknown as HTMLImageElement;
    const b = { naturalWidth: 1536, naturalHeight: 1536 } as unknown as HTMLImageElement;
    expect(warmImage(a)).toBeUndefined();
    expect(warmImage(b)).toBeUndefined();
    expect(canvases[0].getContext).toHaveBeenCalledWith("2d", { willReadFrequently: true });
    expect(ctx.drawImage).toHaveBeenNthCalledWith(1, a, 0, 0, 1, 1, 0, 0, 1, 1);
    expect(ctx.getImageData).toHaveBeenCalledTimes(2);
    expect(doc.createElement).toHaveBeenCalledTimes(1);
  });
});

// --- WarmQueue ---------------------------------------------------------------------------------------------------------

/** Steuerbare Abhängigkeiten: Slots werden von Hand ausgelöst. */
function manualDeps(opts: { warmCost?: number } = {}) {
  let clock = 0;
  const warmed: string[] = [];
  const slots: Array<(avail: number) => void> = [];
  const hints: number[] = [];
  const urgentFlags: boolean[] = [];
  const deps: WarmDeps = {
    warm: (img) => {
      warmed.push((img as unknown as { id: string }).id);
      clock += opts.warmCost ?? 30;
    },
    schedule: (cb, hint, urgent) => {
      slots.push(cb);
      hints.push(hint);
      urgentFlags.push(urgent);
    },
    now: () => clock,
  };
  const img = (id: string) => ({ id }) as unknown as HTMLImageElement;
  const runSlot = (avail = 50): boolean => {
    const cb = slots.shift();
    if (!cb) return false;
    cb(avail);
    return true;
  };
  return { deps, warmed, slots, hints, urgentFlags, img, runSlot, advance: (ms: number) => (clock += ms) };
}

describe("WarmQueue", () => {
  it("arbeitet nach Priorität ab, bei Gleichstand in Eingangsreihenfolge, je Slot ein Sheet bei 30 ms Kosten", () => {
    const m = manualDeps();
    const q = new WarmQueue(m.deps);
    q.add(m.img("idle"), 20);
    q.add(m.img("prop1"), 10);
    q.add(m.img("run"), 0);
    q.add(m.img("prop2"), 10);
    q.add(m.img("jump"), 1);
    expect(m.slots).toHaveLength(1); // nur ein Slot geplant, nicht je add()
    m.runSlot();
    expect(m.warmed).toEqual(["run"]); // 30 ms > 24 ms Budget → Slot endet
    while (m.runSlot());
    expect(m.warmed).toEqual(["run", "jump", "prop1", "prop2", "idle"]);
  });

  it("mehrere billige Sheets passen in ein Budget", () => {
    const m = manualDeps({ warmCost: 5 });
    const q = new WarmQueue(m.deps);
    for (const id of ["a", "b", "c", "d", "e", "f", "g"]) q.add(m.img(id), 0);
    m.runSlot();
    expect(m.warmed).toEqual(["a", "b", "c", "d", "e"]); // 5 × 5 ms = 25 ms ≥ 24 ms Budget
    m.runSlot();
    expect(m.warmed).toHaveLength(7);
  });

  it("whenIdle: ohne Bilder sofort erfüllt", async () => {
    const q = new WarmQueue(manualDeps().deps);
    await expect(q.whenIdle()).resolves.toBeUndefined();
  });

  it("whenIdle: wartet auf alle eingereihten Bilder", async () => {
    const m = manualDeps();
    const q = new WarmQueue(m.deps);
    q.add(m.img("a"), 0);
    q.add(m.img("b"), 1);
    let done = false;
    void q.whenIdle().then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    m.runSlot();
    await Promise.resolve();
    expect(done).toBe(false);
    m.runSlot();
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toBe(true);
  });

  it("whenIdle: wartet auch auf laufende Ladevorgänge (track), egal ob sie gelingen oder scheitern", async () => {
    const m = manualDeps();
    const q = new WarmQueue(m.deps);
    let resolveLoad: () => void = () => {};
    const load = new Promise<void>((r) => (resolveLoad = r));
    q.track(load);
    let rejectLoad: (e: Error) => void = () => {};
    const bad = new Promise<void>((_, rej) => (rejectLoad = rej));
    q.track(bad).catch(() => undefined);
    let done = false;
    void q.whenIdle().then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    q.add(m.img("a"), 0); // der Ladevorgang reiht ein, bevor er endet
    resolveLoad();
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toBe(false); // zweiter Ladevorgang und Warmup offen
    rejectLoad(new Error("kaputt"));
    m.runSlot();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toBe(true);
  });

  it("jedes Bild nur einmal; null/undefined werden ignoriert", () => {
    const m = manualDeps();
    const q = new WarmQueue(m.deps);
    const a = m.img("a");
    q.add(a, 0);
    q.add(a, 0);
    q.add(null, 0);
    q.add(undefined, 0);
    while (m.runSlot());
    expect(m.warmed).toEqual(["a"]);
  });

  it("zu wenig Leerlauf: wartet, läuft nach 1 s trotzdem (Warmup verhungert im laufenden Spiel nicht)", () => {
    const m = manualDeps();
    const q = new WarmQueue(m.deps);
    q.add(m.img("a"), 0);
    m.runSlot(3); // Spiel läuft: nur 3 ms frei
    expect(m.warmed).toEqual([]);
    expect(m.slots).toHaveLength(1); // neu geplant
    m.advance(500);
    m.runSlot(3);
    expect(m.warmed).toEqual([]);
    m.advance(600);
    m.runSlot(3); // > 1000 ms gewartet → trotzdem
    expect(m.warmed).toEqual(["a"]);
  });

  it("urgent: läuft auch ohne Leerlauf sofort Slot an Slot, löst den wartenden Leerlauf-Slot ab und endet mit der Warteschlange", async () => {
    const m = manualDeps();
    const q = new WarmQueue(m.deps);
    q.add(m.img("a"), 0);
    q.add(m.img("b"), 1);
    expect(m.urgentFlags).toEqual([false]);
    let done = false;
    void q.whenIdle(true).then(() => (done = true));
    expect(m.urgentFlags).toEqual([false, true]); // neuer, eiliger Slot
    m.runSlot(0); // der alte Leerlauf-Slot ist abgelöst und tut nichts
    expect(m.warmed).toEqual([]);
    m.runSlot(0); // eiliger Slot: läuft trotz 0 ms Leerlauf
    expect(m.warmed).toEqual(["a"]);
    m.runSlot(0);
    expect(m.warmed).toEqual(["a", "b"]);
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toBe(true);
    // danach wieder normaler Leerlauf-Betrieb
    q.add(m.img("c"), 0);
    expect(m.urgentFlags.at(-1)).toBe(false);
  });

  it("urgent ohne Warteschlange/Ladevorgänge ist sofort erfüllt", async () => {
    const q = new WarmQueue(manualDeps().deps);
    await expect(q.whenIdle(true)).resolves.toBeUndefined();
  });

  it("ein werfendes warm() blockiert die Warteschlange nicht", () => {
    const m = manualDeps();
    const calls: string[] = [];
    const q = new WarmQueue({
      ...m.deps,
      warm: (img) => {
        calls.push((img as unknown as { id: string }).id);
        if (calls.length === 1) throw new Error("kaputt");
      },
    });
    q.add(m.img("a"), 0);
    q.add(m.img("b"), 0);
    while (m.runSlot());
    expect(calls).toEqual(["a", "b"]);
  });

  it("gibt dem Planer die Dauer des letzten Slots als Abstandshinweis", () => {
    const m = manualDeps({ warmCost: 40 });
    const q = new WarmQueue(m.deps);
    q.add(m.img("a"), 0);
    q.add(m.img("b"), 0);
    m.runSlot();
    expect(m.hints).toEqual([0, 40]);
    expect(m.urgentFlags).toEqual([false, false]);
  });

  it("supersede verwirft wartende Jobs fremder Gruppen, behält die eigene Gruppe und gruppenlose Props", () => {
    const m = manualDeps();
    const q = new WarmQueue(m.deps);
    q.add(m.img("fred-run"), 0, "fred");
    q.add(m.img("fred-idle"), 20, "fred");
    q.add(m.img("prop"), 10); // gruppenlos
    q.add(m.img("frida-run"), 0, "frida");
    expect(q.supersede("frida")).toBe(2);
    while (m.runSlot());
    expect(m.warmed).toEqual(["frida-run", "prop"]);
  });

  it("supersede: verworfene Bilder dürfen später erneut eingereiht werden, gewärmte nicht", () => {
    const m = manualDeps();
    const q = new WarmQueue(m.deps);
    const a = m.img("fred-run");
    const b = m.img("fred-jump");
    q.add(a, 0, "fred");
    q.add(b, 1, "fred");
    m.runSlot(); // a gewärmt (30 ms > Budget → Slot endet), b wartet noch
    expect(m.warmed).toEqual(["fred-run"]);
    expect(q.supersede("frida")).toBe(1); // nur b war noch offen
    q.add(a, 0, "fred"); // schon gewärmt → bleibt draußen
    q.add(b, 1, "fred"); // verworfen → darf wieder rein
    while (m.runSlot());
    expect(m.warmed).toEqual(["fred-run", "fred-jump"]);
  });

  it("supersede ohne Treffer ändert nichts; leert es die Warteschlange, werden wartende whenIdle() erfüllt", async () => {
    const m = manualDeps();
    const q = new WarmQueue(m.deps);
    expect(q.supersede("fred")).toBe(0);
    q.add(m.img("fred-run"), 0, "fred");
    let done = false;
    void q.whenIdle().then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    expect(q.supersede("fred")).toBe(0); // eigene Gruppe bleibt
    expect(q.supersede("frida")).toBe(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toBe(true);
    m.runSlot(); // der noch geplante Slot findet nichts mehr und tut nichts
    expect(m.warmed).toEqual([]);
  });
});

/** Wie manualDeps, aber warm() liefert ein Promise, das erst auf finish() erfüllt wird (asynchroner Flush wie createImageBitmap). */
function asyncDeps(opts: { warmCost?: number; reject?: boolean } = {}) {
  const m = manualDeps(opts);
  const gates: Array<() => void> = [];
  const deps: WarmDeps = {
    ...m.deps,
    warm: (img) => {
      m.warmed.push((img as unknown as { id: string }).id);
      m.advance(opts.warmCost ?? 30);
      return new Promise<void>((resolve, reject) => gates.push(opts.reject ? () => reject(new Error("Flush kaputt")) : resolve));
    },
  };
  return { ...m, deps, finish: () => gates.shift()?.(), open: () => gates.length };
}

describe("WarmQueue mit asynchronem Flush", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("startet das nächste Bild erst, wenn der Flush des vorigen durch ist – auch wenn das Budget noch reicht", async () => {
    const m = asyncDeps({ warmCost: 5 });
    const q = new WarmQueue(m.deps);
    for (const id of ["a", "b", "c"]) q.add(m.img(id), 0);
    m.runSlot();
    expect(m.warmed).toEqual(["a"]); // sonst wären es 3 × 5 ms < 24 ms in einem Zug
    await vi.advanceTimersByTimeAsync(10);
    expect(m.warmed).toEqual(["a"]); // Flush noch offen
    m.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(m.warmed).toEqual(["a", "b"]); // gleicher Slot: Budget (24 ms Wanduhr) noch nicht aufgebraucht
    m.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(m.warmed).toEqual(["a", "b", "c"]);
  });

  it("prüft das Budget nach dem Flush erneut: ist es verbraucht, endet der Slot und das nächste Bild kommt im nächsten", async () => {
    const m = asyncDeps({ warmCost: 30 });
    const q = new WarmQueue(m.deps);
    q.add(m.img("a"), 0);
    q.add(m.img("b"), 1);
    m.runSlot();
    expect(m.slots).toHaveLength(0); // solange der Flush läuft, ist kein neuer Slot geplant
    m.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(m.warmed).toEqual(["a"]);
    expect(m.slots).toHaveLength(1); // 30 ms ≥ 24 ms Budget: neuer Slot statt Weitermachen
    expect(m.hints).toEqual([0, 30]);
    m.runSlot();
    m.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(m.warmed).toEqual(["a", "b"]);
  });

  it("whenIdle bleibt offen, bis auch der Flush des letzten Bildes durch ist", async () => {
    const m = asyncDeps();
    const q = new WarmQueue(m.deps);
    q.add(m.img("a"), 0);
    m.runSlot(); // Warteschlange leer, Flush läuft
    let done = false;
    void q.whenIdle().then(() => (done = true)); // ein neuer Aufruf mitten im Flush darf nicht sofort erfüllt werden
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toBe(false);
    m.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });

  it("add() während des Flushs plant keinen zweiten Slot; nach dem Flush läuft es weiter", async () => {
    const m = asyncDeps({ warmCost: 30 });
    const q = new WarmQueue(m.deps);
    q.add(m.img("a"), 0);
    m.runSlot();
    q.add(m.img("b"), 0);
    q.add(m.img("c"), 0);
    expect(m.slots).toHaveLength(0);
    m.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(m.slots).toHaveLength(1);
    expect(m.warmed).toEqual(["a"]);
  });

  it("whenIdle(true) während des Flushs: der nächste Slot ist eilig", async () => {
    const m = asyncDeps({ warmCost: 30 });
    const q = new WarmQueue(m.deps);
    q.add(m.img("a"), 0);
    q.add(m.img("b"), 0);
    m.runSlot();
    void q.whenIdle(true);
    expect(m.slots).toHaveLength(0);
    m.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(m.urgentFlags.at(-1)).toBe(true);
    expect(m.slots).toHaveLength(1);
  });

  it("supersede mitten im Flush erfüllt whenIdle nicht vorzeitig", async () => {
    const m = asyncDeps({ warmCost: 30 });
    const q = new WarmQueue(m.deps);
    q.add(m.img("fred-run"), 0, "fred");
    q.add(m.img("fred-jump"), 1, "fred");
    m.runSlot(); // fred-run im Flush, fred-jump wartet
    let done = false;
    void q.whenIdle().then(() => (done = true));
    expect(q.supersede("frida")).toBe(1); // fred-jump entfällt; fred-run ist aber noch nicht fertig
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toBe(false);
    m.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
    expect(m.warmed).toEqual(["fred-run"]);
  });

  it("ein hängender Flush stoppt das Warmup nicht: nach 500 ms geht es weiter, ein spätes Ende löst nichts doppelt aus", async () => {
    const m = asyncDeps({ warmCost: 1 });
    const q = new WarmQueue(m.deps);
    for (const id of ["a", "b", "c"]) q.add(m.img(id), 0);
    m.runSlot();
    expect(m.warmed).toEqual(["a"]);
    await vi.advanceTimersByTimeAsync(499);
    expect(m.warmed).toEqual(["a"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(m.warmed).toEqual(["a", "b"]); // Wächter hat ausgelöst, b ist im Flush
    m.finish(); // endlich der Flush von a: darf nicht noch einmal fortsetzen (sonst liefen b und c gleichzeitig)
    await vi.advanceTimersByTimeAsync(0);
    expect(m.warmed).toEqual(["a", "b"]);
    m.finish(); // b regulär durch → c
    await vi.advanceTimersByTimeAsync(0);
    expect(m.warmed).toEqual(["a", "b", "c"]);
  });

  it("ein abgelehnter Flush blockiert die Warteschlange nicht, und der Wächter-Timer wird abgeräumt", async () => {
    const m = asyncDeps({ warmCost: 1, reject: true });
    const q = new WarmQueue(m.deps);
    q.add(m.img("a"), 0);
    q.add(m.img("b"), 0);
    let done = false;
    void q.whenIdle().then(() => (done = true));
    m.runSlot();
    m.finish(); // lehnt ab
    await vi.advanceTimersByTimeAsync(0);
    expect(m.warmed).toEqual(["a", "b"]);
    m.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ein Promise liefernder, aber werfender Nachfolger (warm wirft nach Flush) bricht nichts ab", async () => {
    const m = asyncDeps({ warmCost: 1 });
    const calls: string[] = [];
    const q = new WarmQueue({
      ...m.deps,
      warm: (img) => {
        calls.push((img as unknown as { id: string }).id);
        if (calls.length === 2) throw new Error("kaputt");
        return Promise.resolve();
      },
    });
    for (const id of ["a", "b", "c"]) q.add(m.img(id), 0);
    m.runSlot();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(["a", "b", "c"]);
  });
});

// --- Integration: loadCharacter / warmCharacter / PropLib + warmed() ----------------------------------------------------

const HEROES = ["fred", "frida", "superfred", "cyberfred", "superfrida"] as const;

/** Atlas-Antworten für alle Helden (gleiche Anim-Liste, Dateien liegen je Held in chars/<id>/). */
function installHeroFetch(names: readonly string[] = ANIMS, extra: Record<string, unknown> = {}) {
  const handlers: Record<string, unknown> = { ...extra };
  for (const id of HEROES) handlers[`chars/${id}/atlas.json`] = atlasFor(names);
  return installFetch(handlers);
}

/** Bild-Objekte aller Anims, in Reihenfolge der Dateinamen-Liste. */
function imagesOf(sprites: { anims: Map<string, { img: HTMLImageElement }> }, names: readonly string[]): HTMLImageElement[] {
  return names.map((n) => sprites.anims.get(n)?.img as HTMLImageElement);
}

// Alle Integrationstests laufen in beiden Flush-Varianten: createImageBitmap (alle aktuellen Browser, asynchroner Flush) und
// dem getImageData-Rückfall (synchron).
describe.each([
  { name: "createImageBitmap-Flush", bitmap: true },
  { name: "getImageData-Rückfall", bitmap: false },
])("Warmup im Ladepfad ($name)", ({ bitmap }) => {
  const fakeDoc = (o: { throwOnDraw?: boolean; drawCostMs?: number } = {}) => installFakeDocument({ ...o, bitmap });

  it("warmed()/warmCharacter ohne Bilder und ohne DOM sofort erfüllt", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const { warmed, warmCharacter, createAssetLoader } = await import("./assets");
    await expect(warmed()).resolves.toBeUndefined();
    await expect(warmCharacter(null)).resolves.toBeUndefined();
    await expect(warmCharacter(undefined, true)).resolves.toBeUndefined();
    await expect(createAssetLoader().warmed()).resolves.toBeUndefined();
    await expect(createAssetLoader().warmCharacter(null)).resolves.toBeUndefined();
  });

  it("warmCharacter ohne DOM (SSR) wirft nicht und reiht nichts ein", async () => {
    vi.useFakeTimers();
    installHeroFetch();
    const { loadCharacter, warmCharacter } = await freshAssets(); // Image-Ersatz, aber kein document
    const sprites = await loadCharacter("fred");
    await expect(warmCharacter(sprites)).resolves.toBeUndefined();
  });

  it("Menü-Vorschau: loadCharacter wärmt NICHTS – kein Warm-Draw, kein Idle-Slot, warmed() sofort erfüllt", async () => {
    vi.useFakeTimers();
    const { draws } = fakeDoc();
    const ric = vi.fn();
    vi.stubGlobal("requestIdleCallback", ric);
    installHeroFetch();
    const { loadCharacter, warmed, createAssetLoader } = await freshAssets();
    // wie characterStage.loadSprites: zuerst idle+run, danach vollständig; wie CharacterSelect: nur idle
    for (const id of HEROES) {
      await loadCharacter(id, ["idle"]);
      await loadCharacter(id, ["idle", "run"]);
      const full = await loadCharacter(id);
      expect(full.anims.size).toBe(ANIMS.length);
    }
    await expect(warmed()).resolves.toBeUndefined(); // nichts offen → sofort
    await expect(createAssetLoader().warmed(true)).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(draws).toHaveLength(0); // kein einziges Sheet dekodiert erzwungen
    expect(ric).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0); // und auch kein wartender Slot
  });

  it("warmCharacter wärmt nur den angeforderten Helden in der Plan-Reihenfolge; warmed() wartet bis alle gewärmt sind", async () => {
    vi.useFakeTimers();
    const { draws } = fakeDoc();
    // Gesamtreihenfolge der Anfragen absichtlich vertauscht (idle zuerst): die Priorität entscheidet, nicht die Ladereihenfolge
    installHeroFetch([...ANIMS].reverse());
    const { loadCharacter, warmCharacter, createAssetLoader } = await freshAssets();
    const other = await loadCharacter("frida"); // in der Vorschau gesehen, nicht gespielt
    const sprites = await loadCharacter("fred");
    expect(sprites.anims.size).toBe(ANIMS.length);
    await vi.advanceTimersByTimeAsync(5000);
    expect(draws).toHaveLength(0); // erst die Anforderung wärmt
    let done = false;
    void warmCharacter(sprites).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(done).toBe(true);
    await expect(createAssetLoader().warmed()).resolves.toBeUndefined();
    expect(draws).toEqual(imagesOf(sprites, ["run", "jump", "fall", "slide", "dash", "stomp", "doublejump", "hurt", "idle", "victory"]));
    for (const img of imagesOf(other, ANIMS)) expect(draws).not.toContain(img);
  });

  it("warmCharacter(sprites, true) arbeitet sofort Slot an Slot ab, auch wenn requestIdleCallback nie Leerlauf meldet", async () => {
    vi.useFakeTimers();
    const { draws } = fakeDoc();
    vi.stubGlobal(
      "requestIdleCallback",
      vi.fn((cb: (d: { didTimeout: boolean; timeRemaining: () => number }) => void) => {
        setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 2 }), 16); // Spiel läuft: kaum Leerlauf
        return 1;
      }),
    );
    installHeroFetch();
    const { loadCharacter, createAssetLoader } = await freshAssets();
    const assets = createAssetLoader();
    const sprites = await loadCharacter("fred");
    let done = false;
    void assets.warmCharacter(sprites, true).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(50);
    expect(done).toBe(true); // ohne urgent bräuchte das ca. 1 s je Sheet
    expect(draws).toHaveLength(ANIMS.length);
  });

  it("warmed(true) beschleunigt auch ein bereits angefordertes Warmup", async () => {
    vi.useFakeTimers();
    const { draws } = fakeDoc();
    vi.stubGlobal(
      "requestIdleCallback",
      vi.fn((cb: (d: { didTimeout: boolean; timeRemaining: () => number }) => void) => {
        setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 2 }), 16);
        return 1;
      }),
    );
    installHeroFetch();
    const { loadCharacter, warmCharacter, createAssetLoader } = await freshAssets();
    const sprites = await loadCharacter("fred");
    void warmCharacter(sprites); // im Hintergrund angefordert (Leerlauf)
    let done = false;
    void createAssetLoader()
      .warmed(true) // Countdown: jetzt eilig
      .then(() => (done = true));
    await vi.advanceTimersByTimeAsync(50);
    expect(done).toBe(true);
    expect(draws).toHaveLength(ANIMS.length);
  });

  it("Kern-Anims zuerst, Rest später: teilweise geladene Figur anfordern, später die vollständige – jedes Bild nur einmal gewärmt", async () => {
    vi.useFakeTimers();
    const { draws } = fakeDoc();
    installHeroFetch();
    const { loadCharacter, warmCharacter, warmed } = await freshAssets();
    const core = await loadCharacter("fred", ["run", "jump", "fall", "idle"]);
    expect(core.anims.size).toBe(4);
    void warmCharacter(core);
    const full = await loadCharacter("fred"); // Rest im Hintergrund
    expect(full.anims.size).toBe(ANIMS.length);
    void warmCharacter(full); // gleiche Bilder aus dem Cache für die Kern-Anims
    await vi.advanceTimersByTimeAsync(5000);
    await warmed();
    expect(draws).toHaveLength(ANIMS.length);
    expect(new Set(draws).size).toBe(ANIMS.length);
  });

  it("scheitert ein Sheet, wird es nicht dauerhaft gemerkt: der nächste loadCharacter fragt es neu an", async () => {
    vi.useFakeTimers();
    fakeDoc();
    installFetch({ "chars/fred/atlas.json": atlasFor(["run", "slide"]) });
    FakeImage.behavior = (url) => (url.includes("slide.webp") ? "fail" : "ok");
    const { loadCharacter } = await freshAssets();
    const first = await loadCharacter("fred");
    expect(first.has("run")).toBe(true);
    expect(first.has("slide")).toBe(false);
    FakeImage.behavior = () => "ok";
    const second = await loadCharacter("fred");
    expect(second.has("slide")).toBe(true);
    expect(await loadCharacter("fred")).toBe(second); // vollständig → gecached
  });

  it("Heldenwechsel: wartende Jobs des früheren Helden entfallen, nur der zuletzt angeforderte wird fertig gewärmt", async () => {
    vi.useFakeTimers();
    const { draws } = fakeDoc();
    installHeroFetch();
    const { loadCharacter, warmCharacter, warmed } = await freshAssets();
    const fred = await loadCharacter("fred");
    const frida = await loadCharacter("frida");
    void warmCharacter(fred); // Held A gewählt ...
    void warmCharacter(frida); // ... und sofort B, bevor ein Slot lief
    await vi.advanceTimersByTimeAsync(5000);
    await warmed();
    expect(draws).toEqual(imagesOf(frida, ["run", "jump", "fall", "slide", "dash", "stomp", "doublejump", "hurt", "idle", "victory"]));
    for (const img of imagesOf(fred, ANIMS)) expect(draws).not.toContain(img);
    // zurück zu A: seine Bilder waren nur verworfen, nicht vergessen
    void warmCharacter(fred);
    await vi.advanceTimersByTimeAsync(5000);
    await warmed();
    expect(draws).toHaveLength(ANIMS.length * 2);
    expect(draws.slice(ANIMS.length)).toEqual(imagesOf(fred, ["run", "jump", "fall", "slide", "dash", "stomp", "doublejump", "hurt", "idle", "victory"]));
  });

  it("Heldenwechsel mitten im Warmup: der begonnene Held behält das Gewärmte, sein Rest entfällt, Props bleiben", async () => {
    // Slot kostet ein Sheet (30 ms virtuell > 24 ms Budget): so lässt sich "halb fertig" gezielt herstellen
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { draws } = fakeDoc({ drawCostMs: 30 });
    const manifest = { props: { odo: { file: "odo.webp", cols: 4, rows: 4, frames: 16, cw: 96, ch: 96, ax: 0.5, ay: 1, fps: 12, loop: true } } };
    installHeroFetch(ANIMS, { "props/manifest.json": manifest });
    const { loadCharacter, warmCharacter, warmed, createAssetLoader } = await freshAssets();
    const assets = createAssetLoader();
    const fred = await loadCharacter("fred");
    const frida = await loadCharacter("frida");
    void warmCharacter(fred);
    await assets.props.preload(["odo"]); // gruppenloser Prop, Prio 10 (vor idle/victory)
    await vi.advanceTimersByTimeAsync(4); // erster Slot: nur fred/run
    expect(draws).toEqual(imagesOf(fred, ["run"]));
    void warmCharacter(frida); // Wechsel: fred-Rest (9 Sheets) entfällt
    await vi.advanceTimersByTimeAsync(20_000);
    await warmed();
    const fridaOrder = ["run", "jump", "fall", "slide", "dash", "stomp", "doublejump", "hurt"];
    const odoImg = draws.find((d) => !imagesOf(fred, ANIMS).includes(d as HTMLImageElement) && !imagesOf(frida, ANIMS).includes(d as HTMLImageElement));
    expect(odoImg).toBeDefined(); // der Prop wurde trotz Wechsel gewärmt
    expect(draws).toEqual([...imagesOf(fred, ["run"]), ...imagesOf(frida, fridaOrder), odoImg, ...imagesOf(frida, ["idle", "victory"])]);
  });

  it("PropLib.preload reiht Props ein (Priorität nach den Figuren-Bewegungen, vor idle) und lädt gescheiterte neu", async () => {
    vi.useFakeTimers();
    const { draws } = fakeDoc();
    const manifest = {
      props: {
        odo: { file: "odo.webp", cols: 4, rows: 4, frames: 16, cw: 96, ch: 96, ax: 0.5, ay: 1, fps: 12, loop: true },
        coin: { file: "coin.webp", cols: 4, rows: 4, frames: 16, cw: 96, ch: 96, ax: 0.5, ay: 0.5, fps: 12, loop: true },
      },
    };
    installFetch({ "chars/fred/atlas.json": atlasFor(["run", "idle"]), "props/manifest.json": manifest });
    FakeImage.behavior = (url) => (url.includes("coin.webp") ? "fail" : "ok");
    const { loadCharacter, warmCharacter, createAssetLoader } = await freshAssets();
    const assets = createAssetLoader();
    const s = await loadCharacter("fred", ["idle"]);
    void warmCharacter(s); // idle (Prio 20) vor den Props eingereiht ...
    await assets.props.preload(["odo", "coin"]);
    await vi.advanceTimersByTimeAsync(5000);
    await assets.warmed();
    expect(assets.props.has("odo")).toBe(true);
    expect(assets.props.has("coin")).toBe(false);
    const idleImg = s.anims.get("idle")?.img;
    expect(draws).toHaveLength(2);
    expect(draws[1]).toBe(idleImg); // ... aber nach dem Prop gewärmt
    FakeImage.behavior = () => "ok";
    await assets.props.preload(["coin"]); // gescheitert → erneuter Versuch erlaubt
    expect(assets.props.has("coin")).toBe(true);
  });

  it("verwendet requestIdleCallback, wenn vorhanden, und weicht im Hintergrund-Tab auf setTimeout aus", async () => {
    vi.useFakeTimers();
    const { doc } = fakeDoc();
    const ric = vi.fn((cb: (d: { didTimeout: boolean; timeRemaining: () => number }) => void) => {
      setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 40 }), 0);
      return 1;
    });
    vi.stubGlobal("requestIdleCallback", ric);
    installHeroFetch(["run"]);
    const { loadCharacter, warmCharacter, warmed } = await freshAssets();
    void warmCharacter(await loadCharacter("fred"));
    await vi.advanceTimersByTimeAsync(100);
    await warmed();
    expect(ric).toHaveBeenCalled();

    // Hintergrund-Tab: kein requestIdleCallback (würde dort nicht zuverlässig laufen)
    ric.mockClear();
    doc.hidden = true;
    void warmCharacter(await loadCharacter("frida"));
    await vi.advanceTimersByTimeAsync(100);
    await warmed();
    expect(ric).not.toHaveBeenCalled();
  });
});

// --- Integration mit asynchronem Flush (nur createImageBitmap) ------------------------------------------------------------

describe("Warmup mit asynchronem createImageBitmap-Flush", () => {
  it("ein Sheet nach dem anderen: kein weiterer Warm-Draw, solange der Flush offen ist; warmed() erst nach dem letzten Flush", async () => {
    vi.useFakeTimers();
    const { draws, bitmap } = installFakeDocument({ bitmap: "hang" });
    installHeroFetch();
    const { loadCharacter, warmCharacter } = await freshAssets();
    const sprites = await loadCharacter("fred");
    let done = false;
    void warmCharacter(sprites, true).then(() => (done = true));
    for (let i = 1; i <= ANIMS.length; i++) {
      await vi.advanceTimersByTimeAsync(100); // weit unter dem 500-ms-Wächter
      expect(draws).toHaveLength(i); // das i-te Sheet läuft, kein weiteres, solange sein Flush offen ist
      expect(done).toBe(false);
      bitmap?.release();
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(done).toBe(true);
    expect(draws).toEqual(imagesOf(sprites, ["run", "jump", "fall", "slide", "dash", "stomp", "doublejump", "hurt", "idle", "victory"]));
    expect(bitmap?.fn).toHaveBeenCalledTimes(ANIMS.length);
    for (const bmp of bitmap?.bitmaps ?? []) expect(bmp.close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("hängt createImageBitmap dauerhaft, kommt das Warmup nach dem Wächter-Timeout je Sheet trotzdem voran und warmed() wird erfüllt", async () => {
    vi.useFakeTimers();
    const { draws } = installFakeDocument({ bitmap: "hang" });
    installHeroFetch();
    const { loadCharacter, warmCharacter } = await freshAssets();
    const sprites = await loadCharacter("fred");
    let done = false;
    void warmCharacter(sprites, true).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(2000);
    expect(done).toBe(false);
    expect(draws.length).toBeGreaterThan(1);
    expect(draws.length).toBeLessThan(ANIMS.length);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(done).toBe(true);
    expect(draws).toHaveLength(ANIMS.length);
  });

  it("abgelehnte createImageBitmap-Aufrufe lassen alle Sheets trotzdem durchlaufen", async () => {
    vi.useFakeTimers();
    const { draws } = installFakeDocument({ bitmap: "reject" });
    installHeroFetch();
    const { loadCharacter, warmCharacter } = await freshAssets();
    const sprites = await loadCharacter("fred");
    let done = false;
    void warmCharacter(sprites, true).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(1000);
    expect(done).toBe(true);
    expect(draws).toHaveLength(ANIMS.length);
  });
});
