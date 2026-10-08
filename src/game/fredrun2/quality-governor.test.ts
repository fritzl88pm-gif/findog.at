import { describe, expect, it } from "vitest";
import { QUALITY_STORAGE_KEY, QualityGovernor, type GovernorStorage, type QualityLevel } from "./quality-governor";

/** Minimaler Storage-Ersatz; optional mit werfendem getItem/setItem. */
function mockStore(init: Record<string, string> = {}, opts: { throwGet?: boolean; throwSet?: boolean } = {}) {
  const m = new Map(Object.entries(init));
  const store: GovernorStorage & { m: Map<string, string>; sets: string[] } = {
    m,
    sets: [],
    getItem(k: string): string | null {
      if (opts.throwGet) throw new Error("gesperrt");
      return m.has(k) ? (m.get(k) as string) : null;
    },
    setItem(k: string, v: string): void {
      if (opts.throwSet) throw new DOMException("voll", "QuotaExceededError");
      m.set(k, v);
      store.sets.push(v);
    },
  };
  return store;
}

interface Change {
  t: number;
  level: QualityLevel;
}

/**
 * Modell eines Geräts (wie governor.mjs): Kosten je Stufe, vsync-gedeckeltes Intervall = Vielfaches des Display-Intervalls
 * (CPU-gebunden: busy = Kosten). Gibt alle Stufenwechsel mit Zeitstempel zurück.
 */
function simulate(gov: QualityGovernor, costMs: readonly [number, number, number], hz: number, seconds: number, opts: { busyFn?: (cost: number, dt: number) => number } = {}): Change[] {
  const interval = 1000 / hz;
  const changes: Change[] = [];
  let t = 0;
  while (t < seconds * 1000) {
    const cost = costMs[gov.level];
    const dt = Math.ceil(cost / interval - 1e-9) * interval;
    t += dt;
    const busy = opts.busyFn ? opts.busyFn(cost, dt) : cost;
    const r = gov.feed(dt, busy, t);
    if (r !== null) changes.push({ t, level: r });
  }
  return changes;
}

/** Konstante Frames (dt, busy) über `seconds`; liefert die Wechsel. */
function constant(gov: QualityGovernor, dt: number, busy: number, seconds: number, t0 = 0): { changes: Change[]; end: number } {
  const changes: Change[] = [];
  let t = t0;
  while (t < t0 + seconds * 1000) {
    t += dt;
    const r = gov.feed(dt, busy, t);
    if (r !== null) changes.push({ t, level: r });
  }
  return { changes, end: t };
}

describe("QualityGovernor – Abstieg", () => {
  it("30-Hz-Gerät (rAF 33 ms, 8 ms busy) bleibt auf Q2", () => {
    const gov = new QualityGovernor({ storage: null, initial: 2 });
    const { changes } = constant(gov, 1000 / 30, 8, 120);
    expect(changes).toEqual([]);
    expect(gov.level).toBe(2);
  });

  it("konstant 45 ms: Abstieg binnen 1,5 s, Q0 binnen 3 s (unabhängig von busy)", () => {
    for (const busy of [45, 10]) {
      const gov = new QualityGovernor({ storage: null, initial: 2 });
      const { changes } = constant(gov, 45, busy, 10);
      expect(changes[0]).toMatchObject({ level: 1 });
      expect(changes[0].t).toBeLessThanOrEqual(1500);
      expect(changes[1]).toMatchObject({ level: 0 });
      expect(changes[1].t).toBeLessThanOrEqual(3000);
      expect(changes).toHaveLength(2);
    }
  });

  it("konstant 33 ms mit hoher Auslastung (kein 30-Hz-Display) senkt", () => {
    const gov = new QualityGovernor({ storage: null, initial: 2 });
    const { changes } = constant(gov, 33.3, 28, 10);
    expect(changes[0]).toMatchObject({ level: 1 });
    expect(changes[0].t).toBeLessThanOrEqual(1600);
  });

  it("Dauerruckeln über 60 ms: sofort auf Q0 (nach ca. 0,8 s)", () => {
    const gov = new QualityGovernor({ storage: null, initial: 2 });
    const { changes } = constant(gov, 100, 90, 5);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ level: 0 });
    expect(changes[0].t).toBeLessThanOrEqual(900);
  });

  it("einzelne Hänger zählen nicht als Dauerruckeln", () => {
    const gov = new QualityGovernor({ storage: null, initial: 2 });
    let t = 0;
    // vier 200-ms-Frames (Welt laden) mitten im flüssigen Lauf
    for (let i = 0; i < 300; i++) {
      const dt = i >= 100 && i < 104 ? 200 : 16.7;
      t += dt;
      expect(gov.feed(dt, 6, t)).toBeNull();
    }
    expect(gov.level).toBe(2);
  });

  it("ein Ausreißerframe von 80 ms unter 30 Hz ändert nichts", () => {
    for (const at of [3, 40, 61, 130]) {
      const gov = new QualityGovernor({ storage: null, initial: 2 });
      let t = 0;
      for (let i = 0; i < 400; i++) {
        const dt = i === at ? 80 : 1000 / 30;
        t += dt;
        expect(gov.feed(dt, i === at ? 60 : 8, t)).toBeNull();
      }
      expect(gov.level).toBe(2);
    }
  });

  it("isolierte Frames > 250 ms (Tab-Rückkehr, Laden) werden ignoriert", () => {
    const gov = new QualityGovernor({ storage: null, initial: 2 });
    let t = 0;
    for (let i = 0; i < 600; i++) {
      const dt = i % 100 === 99 ? 1500 + i : 16.7;
      t += dt;
      expect(gov.feed(dt, 5, t)).toBeNull();
    }
    expect(gov.level).toBe(2);
  });

  it("auch zwei lange Frames in Folge (Rückkehr + Nachlade-Hänger) werden ignoriert, jeder normale Frame setzt den Zähler zurück", () => {
    for (const long of [260, 400, 2000, 30_000]) {
      const gov = new QualityGovernor({ storage: null, initial: 2 });
      let t = 0;
      for (let i = 0; i < 3000; i++) {
        const dt = i % 50 === 10 || i % 50 === 11 ? long : 16.7;
        t += dt;
        expect(gov.feed(dt, 5, t), `${long} ms`).toBeNull();
      }
      expect(gov.level).toBe(2);
    }
  });

  it("drei Frames in Folge über 250 ms sind Dauerlast und senken; ein normaler Frame dazwischen setzt den Zähler zurück", () => {
    const gov = new QualityGovernor({ storage: null, initial: 2 });
    expect(gov.feed(2000, 40, 2000)).toBeNull();
    expect(gov.feed(2000, 40, 4000)).toBeNull();
    expect(gov.feed(2000, 40, 6000)).toBe(1);

    const gov2 = new QualityGovernor({ storage: null, initial: 2 });
    expect(gov2.feed(2000, 40, 2000)).toBeNull();
    expect(gov2.feed(2000, 40, 4000)).toBeNull();
    expect(gov2.feed(16.7, 5, 4016.7)).toBeNull(); // wieder normal: Zähler zurück auf 0
    expect(gov2.feed(2000, 40, 6016.7)).toBeNull();
    expect(gov2.feed(2000, 40, 8016.7)).toBeNull();
    expect(gov2.level).toBe(2);
    expect(gov2.feed(2000, 40, 10_016.7)).toBe(1);
  });

  it("ungültige Frames dazwischen (NaN, < 2 ms) verändern den Zähler der langen Frames nicht", () => {
    const gov = new QualityGovernor({ storage: null, initial: 2 });
    expect(gov.feed(2000, 40, 2000)).toBeNull();
    expect(gov.feed(NaN, 40, 2001)).toBeNull();
    expect(gov.feed(2000, 40, 4001)).toBeNull();
    expect(gov.feed(0, 40, 4002)).toBeNull();
    expect(gov.feed(2000, 40, 6002)).toBe(1);
  });

  it("reset() setzt den Zähler der langen Frames zurück", () => {
    const gov = new QualityGovernor({ storage: null, initial: 2 });
    expect(gov.feed(2000, 40, 2000)).toBeNull();
    expect(gov.feed(2000, 40, 4000)).toBeNull();
    gov.reset(2);
    expect(gov.feed(2000, 40, 6000)).toBeNull(); // wäre sonst der dritte in Folge
    expect(gov.level).toBe(2);
  });

  it("Dauerlast über 250 ms senkt ohne Klippe an der Schwelle (200 bis 1000 ms: Q0 binnen 4 s)", () => {
    for (const dt of [200, 249, 250, 251, 260, 300, 500, 1000]) {
      for (const busy of [0.9 * dt, 10]) {
        const gov = new QualityGovernor({ storage: null, initial: 2 });
        const { changes } = constant(gov, dt, busy, 120);
        expect(gov.level, `${dt} ms, busy ${busy}`).toBe(0);
        expect(changes.at(-1)?.level, `${dt} ms, busy ${busy}`).toBe(0);
        expect(changes.at(-1)?.t, `${dt} ms, busy ${busy}`).toBeLessThanOrEqual(4000);
        expect(changes.length, `${dt} ms, busy ${busy}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it("Dauerlast knapp über der Schwelle (251 ms) senkt nach etwa 2 s auf Q0, nicht nie", () => {
    const gov = new QualityGovernor({ storage: null, initial: 2 });
    const { changes } = constant(gov, 251, 230, 30);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ level: 0 });
    expect(changes[0].t).toBeLessThanOrEqual(2100);
  });

  it("Software-Rasterung (Q2 300 ms, Q1 150 ms, Q0 40 ms) endet auf Q0 statt auf der Startstufe", () => {
    const gov = new QualityGovernor({ storage: null, initial: 2 });
    const changes = simulate(gov, [40, 150, 300], 60, 120);
    expect(gov.level).toBe(0);
    expect(changes.map((c) => c.level)).toEqual([1, 0]);
    expect(changes[1].t).toBeLessThanOrEqual(4000);
  });

  it("noch langsameres Gerät (Q2 600 ms, Q1 300 ms, Q0 100 ms): höchstens 3 Wechsel, endet auf Q0", () => {
    const gov = new QualityGovernor({ storage: null, initial: 2 });
    const changes = simulate(gov, [100, 300, 600], 60, 300);
    expect(changes.length).toBeLessThanOrEqual(3);
    expect(gov.level).toBe(0);
  });

  it("nicht endliche Intervalle (Infinity) zählen nie, auch nicht als Dauerlast, und vergiften das Fenster nicht", () => {
    const gov = new QualityGovernor({ storage: null, initial: 2 });
    for (let i = 0; i < 6; i++) expect(gov.feed(Infinity, 5, 100 + i)).toBeNull();
    expect(gov.level).toBe(2);
    const { changes } = constant(gov, 16.7, 5, 30, 1000);
    expect(changes).toEqual([]);
    expect(gov.level).toBe(2);
  });

  it("ungültige Eingaben ändern nichts und werfen nicht", () => {
    const gov = new QualityGovernor({ storage: null, initial: 2 });
    for (const dt of [NaN, -5, 0, 1, Infinity, undefined as unknown as number]) expect(gov.feed(dt, 5, 100)).toBeNull();
    expect(gov.level).toBe(2);
  });

  it("120 Hz bzw. stabile 60 fps: kein Wechsel", () => {
    for (const hz of [60, 90, 120, 144]) {
      const gov = new QualityGovernor({ storage: null, initial: 2 });
      const changes = simulate(gov, [4, 5, 6], hz, 120);
      expect(changes, `${hz} Hz`).toEqual([]);
    }
  });

  it("90 Hz mit 14 ms (45 fps, Schleife nicht ausgelastet) bleibt, ausgelastet mit 20 ms senkt", () => {
    const calm = new QualityGovernor({ storage: null, initial: 2 });
    expect(simulate(calm, [7, 10, 14], 90, 120)).toEqual([]);
    const busy = new QualityGovernor({ storage: null, initial: 2 });
    const changes = simulate(busy, [8, 12, 20], 90, 60);
    expect(changes[0]).toMatchObject({ level: 1 });
    expect(changes[0].t).toBeLessThan(2000);
  });

  it("gelegentliche Ausreißer (5 % lange Frames) lösen keinen Abstieg aus", () => {
    const gov = new QualityGovernor({ storage: null, initial: 2 });
    let t = 0;
    for (let i = 0; i < 2000; i++) {
      const dt = i % 20 === 0 ? 33.3 : 16.7;
      t += dt;
      expect(gov.feed(dt, 8, t)).toBeNull();
    }
  });

  it("Abstieg nach einem Aufstieg frühestens nach 3 s (Mindestverweildauer)", () => {
    // Q1 gut, Q2 sofort schlecht (30 ms Kosten) – kurz nach dem Aufstieg darf nicht gleich wieder gesenkt werden
    const gov = new QualityGovernor({ storage: null, initial: 1 });
    const changes = simulate(gov, [4, 5, 30], 60, 40);
    const up = changes.find((c) => c.level === 2);
    expect(up).toBeDefined();
    const down = changes.find((c) => c.level === 1 && c.t > (up as Change).t);
    expect(down).toBeDefined();
    expect((down as Change).t - (up as Change).t).toBeGreaterThanOrEqual(3000);
  });
});

describe("QualityGovernor – Aufstieg und Backoff", () => {
  it("60 fps stabil mit Reserve: Aufstieg erst nach >= 20 s", () => {
    const gov = new QualityGovernor({ storage: null, initial: 1 });
    const changes = simulate(gov, [4, 5, 6], 60, 60);
    expect(changes).toHaveLength(1);
    expect(changes[0].level).toBe(2);
    expect(changes[0].t).toBeGreaterThanOrEqual(20_000);
    expect(changes[0].t).toBeLessThan(25_000);
  });

  it("ohne Reserve (busy >= 0,5 · Ziel) kein Aufstieg", () => {
    const gov = new QualityGovernor({ storage: null, initial: 0 });
    const changes = simulate(gov, [10, 14, 28], 60, 200);
    expect(changes).toEqual([]);
  });

  it("unbekanntes busy (NaN/negativ) führt nie zum Aufstieg", () => {
    const gov = new QualityGovernor({ storage: null, initial: 0 });
    const { changes } = constant(gov, 16.7, NaN, 100);
    expect(changes).toEqual([]);
    const gov2 = new QualityGovernor({ storage: null, initial: 0 });
    expect(constant(gov2, 16.7, -1, 100).changes).toEqual([]);
  });

  it("Aufstieg braucht ≤ 2 % schlechte Frames: 5 % lange Frames verhindern ihn", () => {
    const gov = new QualityGovernor({ storage: null, initial: 1 });
    let t = 0;
    for (let i = 0; i < 6000; i++) {
      const dt = i % 20 === 0 ? 33.3 : 16.7;
      t += dt;
      expect(gov.feed(dt, 4, t)).toBeNull();
    }
    expect(gov.level).toBe(1);
  });

  it("Mittelklasse-Handy (Q2 28 ms, Q1 14 ms, Q0 10 ms): höchstens 2 Wechsel in 300 s", () => {
    const gov = new QualityGovernor({ storage: null, initial: 2 });
    const changes = simulate(gov, [10, 14, 28], 60, 300);
    expect(changes.length).toBeLessThanOrEqual(2);
    expect(changes[0]).toMatchObject({ level: 1 });
    expect(changes[0].t).toBeLessThan(2000);
    expect(gov.level).toBe(1);
  });

  it("Schwaches Handy (Q2 45, Q1 30, Q0 14): höchstens 3 Wechsel, endet auf Q0", () => {
    const gov = new QualityGovernor({ storage: null, initial: 2 });
    const changes = simulate(gov, [14, 30, 45], 60, 300);
    expect(changes.length).toBeLessThanOrEqual(3);
    expect(gov.level).toBe(0);
  });

  it("gescheiterter Aufstieg: 120 s lang kein neuer Aufstieg, danach 240 s", () => {
    // Q1 hat Reserve (busy 4 ms), Q2 ist zu langsam (30 ms) → jeder Aufstieg scheitert
    const gov = new QualityGovernor({ storage: null, initial: 1 });
    const changes = simulate(gov, [3, 4, 30], 60, 900);
    const ups = changes.filter((c) => c.level === 2).map((c) => c.t);
    expect(ups.length).toBeGreaterThanOrEqual(3);
    const downs = changes.filter((c) => c.level === 1).map((c) => c.t);
    // jeder Abstieg folgt binnen 10 s auf einen Aufstieg (gescheitert); der nächste Aufstieg erst nach der Sperre
    expect(downs[0] - ups[0]).toBeLessThanOrEqual(10_000);
    expect(ups[1] - downs[0]).toBeGreaterThanOrEqual(120_000);
    expect(ups[2] - downs[1]).toBeGreaterThanOrEqual(240_000);
  });

  it("gelingender Aufstieg wird nicht gedeckelt: später wieder Aufstieg möglich", () => {
    // Q0 → Q1 → Q2, alles mit Reserve
    const gov = new QualityGovernor({ storage: null, initial: 0 });
    const changes = simulate(gov, [3, 4, 5], 60, 70);
    expect(changes.map((c) => c.level)).toEqual([1, 2]);
    expect(changes[1].t - changes[0].t).toBeGreaterThanOrEqual(20_000);
  });

  it("Zeitbasiert: 120-Hz-Gerät steigt ebenfalls nach ca. 20 s auf, nicht nach 1500 Frames", () => {
    const gov = new QualityGovernor({ storage: null, initial: 1 });
    const changes = simulate(gov, [2, 3, 4], 120, 40);
    expect(changes).toHaveLength(1);
    expect(changes[0].t).toBeGreaterThanOrEqual(20_000);
    expect(changes[0].t).toBeLessThan(25_000);
  });
});

describe("QualityGovernor – Persistenz", () => {
  it("liest die gespeicherte Stufe (Vorrang vor initial)", () => {
    const store = mockStore({ [QUALITY_STORAGE_KEY]: "0" });
    expect(new QualityGovernor({ storage: store, initial: 2 }).level).toBe(0);
    expect(new QualityGovernor({ storage: mockStore({ [QUALITY_STORAGE_KEY]: "1" }) }).level).toBe(1);
  });

  it("ohne gespeicherten Wert: initial, sonst 2; Müll wird ignoriert", () => {
    expect(new QualityGovernor({ storage: mockStore(), initial: 1 }).level).toBe(1);
    expect(new QualityGovernor({ storage: mockStore() }).level).toBe(2);
    for (const junk of ["", "3", "-1", "abc", "1.5", " 1"]) {
      expect(new QualityGovernor({ storage: mockStore({ [QUALITY_STORAGE_KEY]: junk }), initial: 1 }).level).toBe(1);
    }
  });

  it("schreibt Abstiege sofort und eine stabile Stufe nach 30 s", () => {
    const store = mockStore();
    const gov = new QualityGovernor({ storage: store, initial: 2 });
    constant(gov, 45, 40, 5);
    expect(store.m.get(QUALITY_STORAGE_KEY)).toBe("0");
    // stabil auf Q0 ohne Reserve: nach 30 s ist der Wert schon gespeichert (kein neuer Schreibzugriff nötig)
    const n = store.sets.length;
    constant(gov, 16.7, 15, 40, 10_000);
    expect(store.sets.length).toBe(n);

    const store2 = mockStore();
    const gov2 = new QualityGovernor({ storage: store2, initial: 1 });
    simulate(gov2, [3, 4, 5], 60, 25); // Aufstieg nach ~20 s, noch nicht 30 s stabil
    expect(gov2.level).toBe(2);
    expect(store2.m.get(QUALITY_STORAGE_KEY)).toBeUndefined();
    constant(gov2, 16.7, 5, 40, 25_000);
    expect(store2.m.get(QUALITY_STORAGE_KEY)).toBe("2");
  });

  it("werfendes Storage (Lesen und Schreiben) bricht nichts", () => {
    const gov = new QualityGovernor({ storage: mockStore({}, { throwGet: true, throwSet: true }), initial: 2 });
    expect(gov.level).toBe(2);
    const { changes } = constant(gov, 45, 40, 5);
    expect(changes.map((c) => c.level)).toEqual([1, 0]);
  });

  it("storage: null speichert nichts, undefined nutzt kein kaputtes localStorage", () => {
    const gov = new QualityGovernor({ storage: null, initial: 1 });
    expect(gov.level).toBe(1);
    // Node-Umgebung ohne localStorage: kein Fehler, Standardstufe
    expect(new QualityGovernor().level).toBe(2);
  });
});

describe("QualityGovernor – Hilfen", () => {
  it("initialLevel: schwaches Touch-Gerät mit hoher Pixeldichte startet auf Q1", () => {
    expect(QualityGovernor.initialLevel({ coarse: true, hardwareConcurrency: 4, dpr: 3 })).toBe(1);
    expect(QualityGovernor.initialLevel({ coarse: true, deviceMemory: 3, hardwareConcurrency: 8, dpr: 2 })).toBe(1);
    expect(QualityGovernor.initialLevel({ coarse: true, deviceMemory: 2, dpr: 2.625 })).toBe(1);
    expect(QualityGovernor.initialLevel({ coarse: true, hardwareConcurrency: 6, deviceMemory: 4, dpr: 3 })).toBe(2);
    expect(QualityGovernor.initialLevel({ coarse: true, hardwareConcurrency: 8, deviceMemory: 8, dpr: 3 })).toBe(2);
    expect(QualityGovernor.initialLevel({ coarse: true, hardwareConcurrency: 4, dpr: 1 })).toBe(2);
    expect(QualityGovernor.initialLevel({ coarse: false, hardwareConcurrency: 2, deviceMemory: 2, dpr: 2 })).toBe(2);
    expect(QualityGovernor.initialLevel({ coarse: true, deviceMemory: null, hardwareConcurrency: null, dpr: 3 })).toBe(2);
    expect(QualityGovernor.initialLevel({})).toBe(2);
  });

  it("reset setzt Fenster und Backoff zurück und kann eine Stufe vorgeben", () => {
    const gov = new QualityGovernor({ storage: null, initial: 2 });
    constant(gov, 45, 40, 5);
    expect(gov.level).toBe(0);
    gov.reset(2);
    expect(gov.level).toBe(2);
    const { changes } = constant(gov, 16.7, 5, 10, 100_000);
    expect(changes).toEqual([]);
  });

  it("allokiert in feed() nichts Auffälliges (lange Läufe bleiben stabil)", () => {
    const gov = new QualityGovernor({ storage: null, initial: 2 });
    let t = 0;
    let changes = 0;
    for (let i = 0; i < 400_000; i++) {
      t += 16.7;
      if (gov.feed(16.7 + (i % 7) * 0.1, 6, t) !== null) changes++;
    }
    expect(changes).toBe(0);
  });
});
