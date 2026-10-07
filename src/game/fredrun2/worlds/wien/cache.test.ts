import { afterEach, describe, expect, it, vi } from "vitest";
import { installCanvasStub, installTouchStub } from "../shared-b/test-kit";
import { MirrorBackdrop, SizedSprites, canvas } from "./cache";

afterEach(() => {
  vi.unstubAllGlobals();
});

function fake(): HTMLCanvasElement {
  return { width: 4, height: 4 } as unknown as HTMLCanvasElement;
}

describe("SizedSprites", () => {
  it("get rundet auf die nächste feste Größe und backt jede Größe nur einmal", () => {
    const sizes: number[] = [];
    const sp = new SizedSprites(
      (s) => {
        sizes.push(s);
        return fake();
      },
      48,
      464,
      32,
    );
    const a = sp.get(100);
    expect(sp.get(98)).toBe(a); // gleiche Stufe (112)
    sp.get(10); // unter min → 48
    sp.get(9999); // über max → 464
    expect(sizes).toEqual([112, 48, 464]);
    expect(sp.baked).toBe(3);
  });

  it("count/sizeAt beschreiben alle erreichbaren Größen (Rauch: 14, Dampf: 12)", () => {
    const smoke = new SizedSprites(fake, 48, 464, 32);
    expect(smoke.count).toBe(14);
    expect(smoke.sizeAt(0)).toBe(48);
    expect(smoke.sizeAt(13)).toBe(464);
    const steam = new SizedSprites(fake, 32, 208, 16);
    expect(steam.count).toBe(12);
    expect(steam.sizeAt(11)).toBe(208);
  });

  it("prewarm backt jede Größe genau einmal vor (aufsteigend, höchstens n je Aufruf) – danach kostet get nichts mehr", () => {
    const sizes: number[] = [];
    const sp = new SizedSprites(
      (s) => {
        sizes.push(s);
        return fake();
      },
      48,
      464,
      32,
    );
    expect(sp.prewarm(5)).toBe(false);
    expect(sizes).toEqual([48, 80, 112, 144, 176]);
    sp.get(300); // bereits vor dem prewarm-Zeiger „dazwischen“ angefordert → darf nicht doppelt gebacken werden
    const mid = sizes.length;
    let calls = 0;
    while (!sp.prewarm(3)) calls += 1;
    expect(calls).toBeGreaterThan(0);
    expect(sizes.length).toBe(14); // genau eine Fläche je Größe
    expect(new Set(sizes).size).toBe(14);
    expect(sizes.length).toBeGreaterThan(mid);
    // alles liegt vor: weder get noch prewarm backen etwas
    for (let s = 20; s < 500; s += 7) sp.get(s);
    expect(sp.prewarm(99)).toBe(true);
    expect(sizes.length).toBe(14);
    expect(sp.baked).toBe(14);
  });

  it("prewarm(n, maxSize) backt nur bis zur Obergrenze; ein späterer Aufruf ohne Grenze setzt fort (jede Größe einmal)", () => {
    const sizes: number[] = [];
    const sp = new SizedSprites(
      (s) => {
        sizes.push(s);
        return fake();
      },
      48,
      464,
      32,
    );
    while (!sp.prewarm(2, 336)) {
      /* Leerlauf-Teil */
    }
    expect(sizes).toEqual([48, 80, 112, 144, 176, 208, 240, 272, 304, 336]);
    expect(sp.prewarm(5, 336)).toBe(true); // bis 336 ist nichts mehr zu tun
    expect(sizes).toHaveLength(10);
    // die großen Größen folgen später, eine je Aufruf
    expect(sp.prewarm(1)).toBe(false);
    expect(sizes.slice(10)).toEqual([368]);
    while (!sp.prewarm(1)) {
      /* Rest */
    }
    expect(sizes.slice(10)).toEqual([368, 400, 432, 464]);
    expect(sp.baked).toBe(14);
  });

  it("prewarm rastert jede gebackene Größe sofort (touchCanvas) – get tut das nicht zusätzlich", () => {
    const rec = installTouchStub();
    const made: HTMLCanvasElement[] = [];
    const sp = new SizedSprites(
      () => {
        const c = fake();
        made.push(c);
        return c;
      },
      10,
      40,
      10,
    );
    sp.prewarm(2);
    expect(rec.touched).toEqual(made.slice(0, 2));
    sp.get(30); // Lazy-Bake im Draw: das Zeichnen rastert ohnehin, keine zusätzliche Berührung nötig
    expect(rec.touched).toHaveLength(2);
    sp.prewarm(10);
    expect(rec.touched).toHaveLength(3); // Größe 30 war schon da: nur Größe 40 kam hinzu
  });

  it("prewarm(0) backt nichts und meldet, dass noch etwas fehlt", () => {
    const paint = vi.fn(fake);
    const sp = new SizedSprites(paint, 10, 40, 10);
    expect(sp.prewarm(0)).toBe(false);
    expect(paint).not.toHaveBeenCalled();
    expect(sp.prewarm(10)).toBe(true);
    expect(paint).toHaveBeenCalledTimes(4);
  });
});

describe("canvas() / MirrorBackdrop mit Wiederverwendung", () => {
  it("canvas(…, reuse) bemalt die übergebene Fläche statt eine neue anzulegen", () => {
    const stub = installCanvasStub();
    const c = canvas(20, 10, () => undefined);
    expect(stub.created).toBe(1);
    expect(canvas(20, 10, () => undefined, c)).toBe(c);
    expect(stub.created).toBe(1);
    expect(canvas(21, 10, () => undefined, c)).not.toBe(c);
    expect(stub.created).toBe(2);
  });

  it("MirrorBackdrop: die Stufenfläche der verworfenen Stufe wird für die nächste wiederverwendet", async () => {
    const stub = installCanvasStub();
    const img = { width: 100, height: 50 } as unknown as HTMLImageElement;
    const b = new MirrorBackdrop(["a", "b", "c", "d"], 0, 50, 40, () => ({ foot: "#000000" }));
    await b.load(async () => img);
    expect(b.ready).toBe(true);
    b.cache.get(0);
    b.cache.get(1);
    const n = stub.created;
    b.cache.keep(1, 2);
    b.cache.get(2); // Stufe 0 wird recycelt
    expect(stub.created).toBe(n);
    b.cache.keep(2, 3);
    b.cache.get(3);
    expect(stub.created).toBe(n);
  });
});
