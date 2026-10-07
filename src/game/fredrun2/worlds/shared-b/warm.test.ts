import { describe, expect, it } from "vitest";
import { WarmQueue } from "./warm";

describe("WarmQueue", () => {
  function clocked(): { q: WarmQueue; clock: { t: number } } {
    const clock = { t: 0 };
    return { q: new WarmQueue(() => clock.t), clock };
  }

  it("leer: nichts zu tun", () => {
    const { q } = clocked();
    expect(q.run(3)).toBe(true);
    expect(q.pending).toBe(0);
  });

  it("der erste Schritt läuft auch bei Budget 0 (sonst verhungert ein großer Schritt)", () => {
    const { q, clock } = clocked();
    let n = 0;
    q.add(() => {
      n += 1;
      clock.t += 9;
      return n >= 2;
    }, 9);
    expect(q.run(0)).toBe(false);
    expect(n).toBe(1);
    expect(q.run(0)).toBe(true);
    expect(n).toBe(2);
  });

  it("weitere Schritte laufen nur, wenn sie nach Schätzung noch ins Budget passen", () => {
    const { q, clock } = clocked();
    const done: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      q.add(() => {
        done.push(i);
        clock.t += 1;
        return true;
      }, 1);
    }
    // Budget 3 ms, Schritte kosten 1 ms: nach drei Schritten ist Schluss (3 + 1 > 3)
    expect(q.run(3)).toBe(false);
    expect(done).toEqual([0, 1, 2]);
    expect(q.pending).toBe(3);
    expect(q.run(3)).toBe(true); // die restlichen drei passen genau ins Budget
    expect(done).toEqual([0, 1, 2, 3, 4, 5]);
    expect(q.run(3)).toBe(true);
  });

  it("ein Auftrag mit mehreren Schritten bleibt vorn, bis er fertig meldet; Aufträge laufen der Reihe nach", () => {
    const { q, clock } = clocked();
    const log: string[] = [];
    let a = 0;
    q.add(() => {
      a += 1;
      log.push(`a${a}`);
      clock.t += 1;
      return a === 3;
    }, 1);
    q.add(() => {
      log.push("b");
      clock.t += 1;
      return true;
    }, 1);
    while (!q.run(10)) {
      /* weiter */
    }
    expect(log).toEqual(["a1", "a2", "a3", "b"]);
  });

  it("die Kostenschätzung folgt der gemessenen Dauer (teure Schritte werden auf mehrere Aufrufe verteilt)", () => {
    const { q, clock } = clocked();
    const log: string[] = [];
    // Schätzung 1 ms, tatsächlich 4 ms: nach dem ersten (immer erlaubten) Schritt lernt die Queue und pausiert
    for (let i = 0; i < 4; i += 1) {
      q.add(() => {
        log.push(`j${i}`);
        clock.t += 4;
        return true;
      }, 1);
    }
    expect(q.run(5)).toBe(false);
    expect(log.length).toBeGreaterThanOrEqual(1);
    const first = log.length;
    for (let r = 0; r < 10 && !q.run(5); r += 1) {
      /* weiter */
    }
    expect(log.length).toBe(4);
    expect(first).toBeLessThan(4);
  });

  it("clear verwirft offene Aufträge", () => {
    const { q } = clocked();
    q.add(() => false);
    q.clear();
    expect(q.pending).toBe(0);
    expect(q.run(1)).toBe(true);
  });
});
