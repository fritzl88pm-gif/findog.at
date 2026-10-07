import { afterEach, describe, expect, it, vi } from "vitest";
import { installCanvasStub, installTouchStub } from "./test-kit";
import { paint, recycled } from "./canvas";
import { StageCache, StagePrep, Staged, gradedCache, prepareStaged, stageProgress, tinted } from "./layers";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Fläche mit Größe (für Caches ohne DOM) */
function fakeCanvas(w = 8, h = 8): HTMLCanvasElement {
  return { width: w, height: h } as unknown as HTMLCanvasElement;
}

/** zählt Bakes je Stufe */
function counting(opts: ConstructorParameters<typeof StageCache>[1] = {}): { cache: StageCache; calls: number[] } {
  const calls: number[] = [];
  const cache = new StageCache((s) => {
    calls.push(s);
    return fakeCanvas();
  }, opts);
  return { cache, calls };
}

describe("stageProgress", () => {
  it("Anteil innerhalb der Stufe, robust gegen ungültige Werte", () => {
    expect(stageProgress(0, 260)).toBe(0);
    expect(stageProgress(130, 260)).toBeCloseTo(0.5, 6);
    expect(stageProgress(260, 260)).toBe(0);
    expect(stageProgress(390, 260)).toBeCloseTo(0.5, 6);
    expect(stageProgress(100, 0)).toBe(0);
    expect(stageProgress(Number.NaN, 260)).toBe(0);
  });
});

describe("StageCache", () => {
  it("bäckt jede Stufe genau einmal und merkt sich die Dauer", () => {
    const { cache, calls } = counting();
    const a = cache.get(2);
    expect(cache.get(2)).toBe(a);
    expect(calls).toEqual([2]);
    expect(cache.baked).toBe(1);
    expect(cache.has(2)).toBe(true);
    expect(cache.has(3)).toBe(false);
  });

  it("get rastert die frisch gebackene Fläche sofort (touchCanvas) – jede Variante nur einmal", () => {
    const rec = installTouchStub();
    const { cache } = counting();
    const a = cache.get(1);
    expect(cache.get(1)).toBe(a);
    const b = cache.get(2);
    expect(rec.touched).toEqual([a, b]);
  });

  it("keep verwirft alles außer a und b (mit und ohne Treffer)", () => {
    const { cache } = counting();
    cache.get(0);
    cache.get(1);
    cache.get(2);
    cache.keep(1, 2);
    expect([cache.has(0), cache.has(1), cache.has(2)]).toEqual([false, true, true]);
    cache.keep(1, 1);
    expect([cache.has(1), cache.has(2)]).toEqual([true, false]);
    cache.keep(5, 6); // alles weg
    expect(cache.has(1)).toBe(false);
  });

  it("recycle: die verworfene Fläche wird dem nächsten Bake angeboten; ohne Option nie", () => {
    const offered: Array<HTMLCanvasElement | null> = [];
    const first = fakeCanvas();
    const cache = new StageCache(
      (s, reuse) => {
        offered.push(reuse);
        return s === 0 ? first : fakeCanvas();
      },
      { recycle: true },
    );
    cache.get(0);
    cache.keep(1, 2); // Stufe 0 fliegt raus → Ersatzfläche
    cache.get(1);
    expect(offered).toEqual([null, first]);
    // ein zweites Angebot gibt es erst nach der nächsten Verdrängung
    cache.get(2);
    expect(offered[2]).toBeNull();

    const plain: Array<HTMLCanvasElement | null> = [];
    const c2 = new StageCache((s, reuse) => {
      plain.push(reuse);
      return fakeCanvas();
    });
    c2.get(0);
    c2.keep(1, 2);
    c2.get(1);
    expect(plain).toEqual([null, null]);
  });

  it("clear bewahrt die Flächen zur Wiederverwendung, dropSpare gibt sie frei", () => {
    const offers: Array<HTMLCanvasElement | null> = [];
    const cache = new StageCache(
      (_s, reuse) => {
        offers.push(reuse);
        return fakeCanvas();
      },
      { recycle: true },
    );
    cache.get(0);
    cache.clear();
    cache.get(0);
    expect(offers[1]).not.toBeNull();
    cache.clear();
    cache.dropSpare();
    cache.get(0);
    expect(offers[2]).toBeNull();
  });

  it("step: erst Vorarbeit (prep), dann Bake; false, wenn die Variante schon vorliegt", () => {
    const log: string[] = [];
    let prepared = false;
    const cache = new StageCache(
      (s) => {
        log.push(`bake${s}`);
        return fakeCanvas();
      },
      {
        prep: (s) => {
          if (prepared) return false;
          prepared = true;
          log.push(`prep${s}`);
          return true;
        },
      },
    );
    expect(cache.step(3)).toBe(true);
    expect(cache.has(3)).toBe(false);
    expect(cache.step(3)).toBe(true);
    expect(cache.has(3)).toBe(true);
    expect(cache.step(3)).toBe(false);
    expect(log).toEqual(["prep3", "bake3"]);
  });
});

describe("prepareStaged (einfache Variante)", () => {
  it("backt höchstens `budget` Varianten je Aufruf: erst die Stufe, dann die Folgestufe", () => {
    const a = counting();
    const b = counting();
    prepareStaged([a.cache, b.cache], 0, 4, 1);
    expect([a.calls, b.calls]).toEqual([[0], []]);
    prepareStaged([a.cache, b.cache], 0, 4, 1);
    expect([a.calls, b.calls]).toEqual([[0, 1], []]);
    prepareStaged([a.cache, b.cache], 0, 4, 99);
    expect([a.calls, b.calls]).toEqual([[0, 1], [0, 1]]);
  });
});

describe("StagePrep", () => {
  function setup(n = 3, maxStage = 4): { prep: StagePrep; list: Array<ReturnType<typeof counting>>; clock: { t: number } } {
    const list = Array.from({ length: n }, () => counting());
    const clock = { t: 1000 };
    const prep = new StagePrep(list.map((x) => x.cache), maxStage, { now: () => clock.t });
    return { prep, list, clock };
  }

  it("die aktuelle Stufe liegt sofort vor (alle Caches)", () => {
    const { prep, list } = setup();
    expect(prep.step(2, 0, 0)).toBe(3);
    for (const x of list) expect(x.calls).toEqual([2]);
  });

  it("die Folgestufe wird NICHT am Stufenanfang gebacken, erst ab 28 % des Fortschritts", () => {
    const { prep, list } = setup();
    prep.step(0, 0, 0);
    prep.step(0, 0.1, 0);
    prep.step(0, 0.27, 0);
    for (const x of list) expect(x.calls).toEqual([0]);
    prep.step(0, 0.3, 0);
    expect(list.map((x) => x.calls)).toEqual([[0, 1], [0], [0]]);
  });

  it("höchstens ein Bake-Schritt je gapMs, danach der nächste Cache", () => {
    const { prep, list, clock } = setup();
    prep.step(0, 0.3, 0);
    expect(list.map((x) => x.calls.length)).toEqual([2, 1, 1]);
    clock.t += 50; // innerhalb der Lücke: nichts
    expect(prep.step(0, 0.3, 0)).toBe(0);
    expect(list.map((x) => x.calls.length)).toEqual([2, 1, 1]);
    clock.t += 60; // 110 ms seit dem letzten Schritt
    expect(prep.step(0, 0.3, 0)).toBe(1);
    expect(list.map((x) => x.calls.length)).toEqual([2, 2, 1]);
    clock.t += 100;
    prep.step(0, 0.3, 0);
    expect(list.map((x) => x.calls.length)).toEqual([2, 2, 2]);
    clock.t += 100;
    expect(prep.step(0, 0.3, 0)).toBe(0); // alles da
  });

  it("während der Überblendung wird Fehlendes sofort nachgeholt (es würde ohnehin gezeichnet)", () => {
    const { prep, list } = setup();
    prep.step(0, 0.9, 0.2);
    for (const x of list) expect(x.calls).toEqual([0, 1]);
  });

  it("Vorarbeit und Bake zählen als getrennte Schritte (je ein Schritt je Lücke)", () => {
    const clock = { t: 0 };
    let prepped = false;
    const calls: number[] = [];
    const cache = new StageCache(
      (s) => {
        calls.push(s);
        return fakeCanvas();
      },
      { prep: (s) => (s === 1 && !prepped ? (prepped = true) : false) },
    );
    const prep = new StagePrep([cache], 4, { now: () => clock.t });
    prep.step(0, 0.5, 0);
    expect(calls).toEqual([0]);
    expect(prepped).toBe(true); // Vorarbeit für Stufe 1 war der erste Schritt
    expect(cache.has(1)).toBe(false);
    clock.t += 150;
    prep.step(0, 0.5, 0);
    expect(cache.has(1)).toBe(true);
  });

  it("letzte Stufe: keine Folgestufe; alte Stufen werden verworfen", () => {
    const { prep, list } = setup(1, 2);
    prep.step(1, 0.5, 0);
    prep.step(2, 0.5, 0);
    expect(list[0].cache.has(0)).toBe(false);
    expect(list[0].cache.has(1)).toBe(false);
    expect(list[0].cache.has(2)).toBe(true);
    expect(list[0].calls.filter((s) => s === 3)).toEqual([]);
  });

  it("eine zurückgesetzte Uhr sperrt das Backen nicht dauerhaft", () => {
    const { prep, list, clock } = setup(1);
    clock.t = 5000;
    prep.step(0, 0.5, 0); // Schritt bei t = 5000
    clock.t = 10; // Uhr springt zurück (neuer Lauf)
    prep.step(0, 0.5, 0); // darf nicht bis 5100 warten
    expect(list[0].cache.has(1)).toBe(true);
  });

  it("add/remove nehmen Caches in die Verwaltung auf bzw. heraus", () => {
    const { prep, list } = setup(1);
    const extra = counting();
    prep.add(extra.cache);
    prep.add(extra.cache); // doppelt ist egal
    prep.step(0, 0, 0);
    expect(extra.calls).toEqual([0]);
    prep.remove(extra.cache);
    prep.step(1, 0, 0);
    expect(extra.calls).toEqual([0]);
    expect(list[0].calls).toEqual([0, 1]);
  });

  it("warm: hält das Zeitbudget (erster Schritt läuft immer), true erst wenn alles da ist", () => {
    const clock = { t: 0 };
    const list = Array.from({ length: 3 }, () => {
      const calls: number[] = [];
      const cache = new StageCache((s) => {
        calls.push(s);
        clock.t += 2; // jeder Bake kostet 2 ms
        return fakeCanvas();
      });
      cache.costMs = 2;
      return { cache, calls };
    });
    const prep = new StagePrep(list.map((x) => x.cache), 4, { now: () => clock.t });
    // Budget 3 ms: Stufe 0 des ersten Caches (2 ms), das nächste würde 4 ms > 3 ms ergeben → Pause
    expect(prep.warm(0, 3)).toBe(false);
    expect(list.map((x) => x.calls.length)).toEqual([1, 0, 0]);
    // Budget 0: der erste Schritt läuft trotzdem, sonst verhungert ein großer Bake
    expect(prep.warm(0, 0)).toBe(false);
    expect(list.map((x) => x.calls.length)).toEqual([1, 1, 0]);
    let rounds = 0;
    while (!prep.warm(0, 3) && rounds < 20) rounds += 1;
    expect(rounds).toBeLessThan(20);
    for (const x of list) expect(x.calls.sort()).toEqual([0, 1]);
    expect(prep.warm(0, 3)).toBe(true);
    // am letzten Stufenindex gibt es keine Folgestufe
    const last = counting();
    const p2 = new StagePrep([last.cache], 4);
    expect(p2.warm(4, 100)).toBe(true);
    expect(last.calls).toEqual([4]);
  });
});

describe("recycled / paint mit Wiederverwendung", () => {
  it("gleiche Größe: dieselbe Fläche, gelöscht (reset); andere Größe: null", () => {
    const stub = installCanvasStub();
    const c = paint(10, 6, () => undefined);
    expect(stub.created).toBe(1);
    const same = recycled(c, 10, 6);
    expect(same).toBe(c);
    expect((c as unknown as { resets: number }).resets).toBe(1);
    expect(recycled(c, 11, 6)).toBeNull();
    expect(recycled(null, 10, 6)).toBeNull();
    // paint mit reuse legt keine neue Fläche an
    const again = paint(10, 6, () => undefined, c);
    expect(again).toBe(c);
    expect(stub.created).toBe(1);
    // andere Größe: neue Fläche
    const other = paint(12, 6, () => undefined, c);
    expect(other).not.toBe(c);
    expect(stub.created).toBe(2);
  });

  it("Staged/tinted: wiederverwendete Stufenflächen erzeugen keine neuen Canvases", () => {
    const stub = installCanvasStub();
    const src = paint(32, 16, () => undefined);
    const staged = new Staged(src, () => ({ night: { color: "#000", a: 0.5 }, haze: { color: "#123456", aTop: 0.1, aBottom: 0.2 } }), true);
    staged.get(0);
    staged.get(1);
    const before = stub.created;
    staged.keep(1, 2);
    staged.get(2); // nutzt die verworfene Stufe 0
    expect(stub.created).toBe(before);
    staged.keep(2, 3);
    staged.get(3);
    expect(stub.created).toBe(before);
    // ohne recycle: jede Stufe eine neue Fläche
    const plain = new Staged(src, () => ({}));
    plain.get(0);
    plain.keep(1, 2);
    const n = stub.created;
    plain.get(1);
    expect(stub.created).toBe(n + 1);
    expect(tinted(src, {}).width).toBe(32);
  });
});

describe("gradedCache", () => {
  it("zwei Schritte (Rohbild, Färbung) ergeben dasselbe wie ein Schritt am Stück", () => {
    const log: string[] = [];
    const make = (s: number, _reuse: HTMLCanvasElement | null, grade: boolean): HTMLCanvasElement => {
      log.push(`base${s}${grade ? "+grade" : ""}`);
      return fakeCanvas();
    };
    const gradeFn = (_c: HTMLCanvasElement, s: number): void => {
      log.push(`grade${s}`);
    };
    const cache = gradedCache(make, gradeFn);
    cache.step(1);
    expect(cache.has(1)).toBe(false);
    cache.step(1);
    expect(cache.has(1)).toBe(true);
    expect(log).toEqual(["base1", "grade1"]);
    // direkter get (z.B. im Draw) malt alles auf einmal
    cache.get(2);
    expect(log.slice(2)).toEqual(["base2+grade"]);
  });

  it("mehrere Einfärbe-Schritte: alle bis auf den letzten sind Vorarbeit; ein Schritt ohne Wirkung (false) kostet kein Zeitfenster", () => {
    const log: string[] = [];
    const make = (s: number, _reuse: HTMLCanvasElement | null, grade: boolean): HTMLCanvasElement => {
      log.push(`base${s}${grade ? "+grade" : ""}`);
      return fakeCanvas();
    };
    const mood = (_c: HTMLCanvasElement, s: number): boolean => {
      log.push(`mood${s}`);
      return s !== 5; // Stufe 5 hat keine Stimmung
    };
    const finish = (_c: HTMLCanvasElement, s: number): void => {
      log.push(`finish${s}`);
    };
    const cache = gradedCache(make, [mood, finish]);
    // Stufe 1: Rohbild, Stimmung, Abschluss = drei Schritte
    expect(cache.step(1)).toBe(true);
    expect(cache.step(1)).toBe(true);
    expect(cache.has(1)).toBe(false);
    expect(cache.step(1)).toBe(true);
    expect(cache.has(1)).toBe(true);
    expect(log).toEqual(["base1", "mood1", "finish1"]);
    // Stufe 5: die wirkungslose Stimmung wird im selben Schritt übersprungen → nur zwei Schritte
    log.length = 0;
    cache.step(5);
    cache.step(5);
    expect(cache.has(5)).toBe(true);
    expect(log).toEqual(["base5", "mood5", "finish5"]);
    // Direktweg (z.B. im Draw): alles am Stück über paintBase(…, true), die Schritte laufen nicht extra
    log.length = 0;
    cache.get(7);
    expect(log).toEqual(["base7+grade"]);
  });

  it("jeder Schritt rastert die Fläche gleich (touchCanvas): Rohbild, Zwischenschritt und Bake; ein Schritt ohne Wirkung nicht", () => {
    const rec = installTouchStub();
    const canvases: HTMLCanvasElement[] = [];
    const make = (): HTMLCanvasElement => {
      const c = fakeCanvas();
      canvases.push(c);
      return c;
    };
    const cache = gradedCache(make, [(_c, s) => s !== 5, () => undefined]);
    cache.step(1); // Rohbild
    expect(rec.touched).toHaveLength(1);
    cache.step(1); // Stimmung
    expect(rec.touched).toHaveLength(2);
    cache.step(1); // Abschluss = Bake (StageCache.get)
    expect(rec.touched).toHaveLength(3);
    expect(new Set(rec.touched).size).toBe(1); // immer dieselbe Fläche
    rec.touched.length = 0;
    cache.step(5); // Rohbild
    cache.step(5); // Stimmung wirkungslos → übersprungen, gleich der Bake
    expect(cache.has(5)).toBe(true);
    expect(rec.touched).toHaveLength(2);
  });

  it("ein einzelner Schritt (Funktion statt Liste) verhält sich wie bisher", () => {
    const log: string[] = [];
    const cache = gradedCache(
      (s, _r, g) => {
        log.push(`base${s}${g ? "+grade" : ""}`);
        return fakeCanvas();
      },
      (_c, s) => {
        log.push(`grade${s}`);
      },
    );
    cache.step(3);
    cache.step(3);
    expect(log).toEqual(["base3", "grade3"]);
    expect(cache.has(3)).toBe(true);
  });
});
