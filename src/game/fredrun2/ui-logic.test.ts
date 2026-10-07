import { describe, expect, it } from "vitest";
import { CHARACTERS } from "./characters";
import { ARM_DELAY_MS, armed, countUpValue, fitText, formatNumber, gameOverSummary, PAUSE_ARM_MS, type MeasureText, type RunResultLike } from "./ui-logic";

describe("formatNumber", () => {
  it("gruppiert mit Punkt (wie das bisherige HUD)", () => {
    expect(formatNumber(4210)).toBe("4.210");
    expect(formatNumber(1234567)).toBe("1.234.567");
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(7)).toBe("7");
    expect(formatNumber(999)).toBe("999");
    expect(formatNumber(1000)).toBe("1.000");
    expect(formatNumber(100000)).toBe("100.000");
  });

  it("negative Zahlen, NaN, Infinity, -0", () => {
    expect(formatNumber(-5)).toBe("-5");
    expect(formatNumber(-1234)).toBe("-1.234");
    expect(formatNumber(NaN)).toBe("0");
    expect(formatNumber(Infinity)).toBe("0");
    expect(formatNumber(-Infinity)).toBe("0");
    expect(formatNumber(-0)).toBe("0");
    expect(formatNumber(-0.7)).toBe("0");
  });

  it("schneidet Nachkommastellen ab (kein Runden)", () => {
    expect(formatNumber(4210.9)).toBe("4.210");
    expect(formatNumber(0.99)).toBe("0");
    expect(formatNumber(-12.8)).toBe("-12");
  });

  it("liefert nie Leerschritte oder Exponenten, auch bei riesigen Werten", () => {
    for (const n of [1, 12, 1234, 1e6, 1e12, 1e21, 1e300, Number.MAX_SAFE_INTEGER]) expect(formatNumber(n)).toMatch(/^\d{1,3}(\.\d{3})*$/);
    expect(formatNumber(Number.MAX_SAFE_INTEGER)).toBe("9.007.199.254.740.991");
  });

  it("stimmt mit dem bisherigen HUD-Muster überein", () => {
    const hud = (v: number) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    for (const n of [0, 5, 99, 100, 1000, 12345, 987654, 1234567, 20000000]) expect(formatNumber(n)).toBe(hud(n));
  });
});

describe("Eingabesperre", () => {
  it("Konstanten", () => {
    expect(ARM_DELAY_MS).toBe(450);
    expect(PAUSE_ARM_MS).toBe(250);
  });

  it("armed: erst nach delayMs", () => {
    expect(armed(1000 + 449, 1000, ARM_DELAY_MS)).toBe(false);
    expect(armed(1000 + 450, 1000, ARM_DELAY_MS)).toBe(true);
    expect(armed(1000 + 451, 1000, ARM_DELAY_MS)).toBe(true);
    expect(armed(1000, 1000, ARM_DELAY_MS)).toBe(false);
    expect(armed(1000 + 249, 1000, PAUSE_ARM_MS)).toBe(false);
    expect(armed(1000 + 250, 1000, PAUSE_ARM_MS)).toBe(true);
    // Standard = ARM_DELAY_MS
    expect(armed(1449, 1000)).toBe(false);
    expect(armed(1450, 1000)).toBe(true);
    // Uhr vor dem Einblenden (z. B. nach Zeitsprung) gilt nicht als scharf
    expect(armed(900, 1000, ARM_DELAY_MS)).toBe(false);
  });
});

describe("countUpValue", () => {
  it("startet bei 0 und endet exakt beim Ziel", () => {
    expect(countUpValue(0, 4210)).toBe(0);
    expect(countUpValue(1, 4210)).toBe(4210);
    expect(countUpValue(1.5, 4210)).toBe(4210);
    expect(countUpValue(-0.2, 4210)).toBe(0);
    expect(countUpValue(0.5, 0)).toBe(0);
    expect(countUpValue(NaN, 100)).toBe(0);
    expect(countUpValue(0.5, NaN)).toBe(0);
  });

  it("ist monoton steigend, ganzzahlig und überschreitet das Ziel nie", () => {
    for (const target of [1, 7, 99, 1672, 4210, 123456]) {
      let prev = -1;
      for (let i = 0; i <= 1000; i += 1) {
        const v = countUpValue(i / 1000, target);
        expect(v).toBeGreaterThanOrEqual(prev);
        expect(v).toBeLessThanOrEqual(target);
        expect(Number.isInteger(v)).toBe(true);
        prev = v;
      }
      expect(prev).toBe(target);
    }
  });

  it("easeOut: die erste Hälfte der Zeit bringt mehr als die Hälfte des Wertes", () => {
    expect(countUpValue(0.5, 1000)).toBeGreaterThan(800);
  });
});

/** Mock: jedes Zeichen ist 0,6 * px breit */
const measure: MeasureText = (s, px) => s.length * px * 0.6;

describe("fitText", () => {
  it("passt der Text bei maxPx, bleibt es eine Zeile in maxPx", () => {
    const r = fitText(measure, "Kurz", 400, 28, 18);
    expect(r).toEqual({ px: 28, lines: ["Kurz"] });
  });

  it("schrumpft die Schrift, bis der Text in die Breite passt", () => {
    const text = "Gestoppt von Straßenbahn";
    const r = fitText(measure, text, 300, 28, 18);
    expect(r.lines).toEqual([text]);
    expect(r.px).toBeLessThan(28);
    expect(r.px).toBeGreaterThanOrEqual(18);
    expect(measure(text, r.px)).toBeLessThanOrEqual(300);
    // die nächstgrößere Schrift würde nicht mehr passen
    expect(measure(text, r.px + 1)).toBeGreaterThan(300);
  });

  it("bricht bei minPx auf genau zwei Zeilen um, wenn es sonst nicht passt", () => {
    const text = "Neuer Rekord auf der Weltreise durch alle Welten";
    const r = fitText(measure, text, 300, 28, 18);
    expect(r.px).toBe(18);
    expect(r.lines).toHaveLength(2);
    for (const l of r.lines) expect(measure(l, r.px)).toBeLessThanOrEqual(300);
    expect(r.lines.join(" ")).toBe(text);
  });

  it("liefert immer entweder eine Zeile <= maxW oder genau zwei Zeilen", () => {
    const texts = ["", "A", "Kurz", "Ein etwas längerer Hinweistext", "Ein wirklich sehr langer Hinweistext mit vielen Wörtern drin, der nie passt", "Donaudampfschifffahrtsgesellschaftskapitänsmütze", "x".repeat(200)];
    for (const text of texts) {
      for (const maxW of [60, 150, 300, 600]) {
        const r = fitText(measure, text, maxW, 30, 16);
        expect(r.px).toBeGreaterThanOrEqual(16);
        expect(r.px).toBeLessThanOrEqual(30);
        if (r.lines.length === 1) {
          if (text) expect(measure(r.lines[0], r.px)).toBeLessThanOrEqual(maxW);
        } else {
          expect(r.lines).toHaveLength(2);
          for (const l of r.lines) expect(measure(l, r.px)).toBeLessThanOrEqual(maxW);
        }
      }
    }
  });

  it("langes Einzelwort wird nach Zeichen getrennt, Überlanges bekommt eine Ellipse", () => {
    const word = "x".repeat(50);
    const r = fitText(measure, word, 300, 28, 18); // 300 / (18*0.6) = 27 Zeichen pro Zeile
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toBe("x".repeat(27));
    expect(r.lines[1].length).toBeGreaterThan(0);
    const huge = fitText(measure, "x".repeat(200), 300, 28, 18);
    expect(huge.lines).toHaveLength(2);
    expect(huge.lines[1].endsWith("…")).toBe(true);
    expect(measure(huge.lines[1], 18)).toBeLessThanOrEqual(300);
  });

  it("degenerierte Eingaben werfen nicht", () => {
    expect(fitText(measure, "Text", 0, 28, 18).lines).toEqual(["Text"]);
    expect(fitText(measure, "Text", NaN, 28, 18).lines).toEqual(["Text"]);
    expect(fitText(measure, "Text", 100, 18, 18).px).toBe(18);
    // vertauschte Grenzen
    expect(fitText(measure, "Kurz", 400, 18, 28).px).toBe(28);
  });

  it("nicht ganzzahlige Grenzen: minPx selbst wird geprüft", () => {
    const m: MeasureText = (s, px) => s.length * px;
    // 10 Zeichen, maxW 100 → passt erst bei px = 10 (lo)
    const r = fitText(m, "abcdefghij", 100, 14.5, 10);
    expect(r.lines).toEqual(["abcdefghij"]);
    expect(r.px).toBe(10);
  });
});

const heroes = Object.values(CHARACTERS);
const prof = (coins: number, unlocked: string[] = ["fred", "frida"]) => ({ coins, unlocked });
const res = (over: Partial<RunResultLike> = {}): RunResultLike => ({ score: 1672, previousBest: 4210, coins: 36, rank: 3, isNewBest: false, ...over });

describe("gameOverSummary", () => {
  it("Erstlauf (previousBest 0): weicher Text statt Neuer Rekord", () => {
    const s = gameOverSummary(res({ score: 40, previousBest: 0, isNewBest: true, rank: 1 }), prof(40), heroes);
    expect(s.firstRun).toBe(true);
    expect(s.recordLine).toBe("Erster Lauf! Dein erster Rekord");
    expect(s.recordLine).not.toMatch(/Neuer Rekord/);
    expect(s.progress).toBe(1);
  });

  it("neuer Rekord: Vorsprung vor dem alten Rekord", () => {
    const s = gameOverSummary(res({ score: 5000, previousBest: 4210, isNewBest: true }), prof(100), heroes);
    expect(s.firstRun).toBe(false);
    expect(s.recordLine).toBe("+790 über deinem alten Rekord (4.210)");
    expect(s.progress).toBe(1);
    const big = gameOverSummary(res({ score: 1234567, previousBest: 1000000, isNewBest: true }), prof(0), heroes);
    expect(big.recordLine).toBe("+234.567 über deinem alten Rekord (1.000.000)");
  });

  it("kein Rekord: Abstand und Fortschritt score/best", () => {
    const s = gameOverSummary(res(), prof(486), heroes);
    expect(s.recordLine).toBe("Rekord 4.210 · noch 2.538 Punkte");
    expect(s.progress).toBeCloseTo(1672 / 4210, 10);
    expect(s.firstRun).toBe(false);
  });

  it("isNewBest fehlt: wird aus score > previousBest abgeleitet", () => {
    const s = gameOverSummary({ score: 300, previousBest: 100, coins: 5, rank: 1 }, prof(5), heroes);
    expect(s.recordLine).toBe("+200 über deinem alten Rekord (100)");
    const t = gameOverSummary({ score: 50, previousBest: 100, coins: 5, rank: 4 }, prof(5), heroes);
    expect(t.recordLine).toBe("Rekord 100 · noch 50 Punkte");
  });

  it("Randfälle: Gleichstand, Nullpunkte im ersten Lauf, Score 0 mit Rekord", () => {
    const tie = gameOverSummary(res({ score: 4210, previousBest: 4210 }), prof(0), heroes);
    expect(tie.recordLine).toBe("Rekord 4.210 eingestellt");
    expect(tie.progress).toBe(1);
    const zeroFirst = gameOverSummary(res({ score: 0, previousBest: 0, isNewBest: false, rank: null }), prof(0), heroes);
    expect(zeroFirst.firstRun).toBe(true);
    expect(zeroFirst.recordLine).not.toMatch(/Erster Lauf/);
    expect(zeroFirst.progress).toBe(0);
    const zero = gameOverSummary(res({ score: 0 }), prof(0), heroes);
    expect(zero.recordLine).toBe("Rekord 4.210 · noch 4.210 Punkte");
    expect(zero.progress).toBe(0);
    // progress bleibt in 0..1
    for (const score of [0, 1, 4209, 4210, 99999]) {
      const p = gameOverSummary(res({ score, isNewBest: score > 4210 }), prof(0), heroes).progress;
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it("Platz in der Bestenliste, null ohne Platz", () => {
    expect(gameOverSummary(res({ rank: 3 }), prof(0), heroes).rankLine).toBe("Platz 3 deiner Bestenliste");
    expect(gameOverSummary(res({ rank: 10 }), prof(0), heroes).rankLine).toBe("Platz 10 deiner Bestenliste");
    expect(gameOverSummary(res({ rank: null }), prof(0), heroes).rankLine).toBeNull();
  });

  it("Münzzeile: Lauf-Münzen und Guthaben mit Tausenderpunkt", () => {
    expect(gameOverSummary(res({ coins: 36 }), prof(486), heroes).coinsLine).toBe("+36 Münzen · Guthaben 486");
    expect(gameOverSummary(res({ coins: 1500 }), prof(12345), heroes).coinsLine).toBe("+1.500 Münzen · Guthaben 12.345");
    expect(gameOverSummary(res({ coins: 0 }), prof(0), heroes).coinsLine).toBe("+0 Münzen · Guthaben 0");
  });

  it("Münzziel: günstigster gesperrter Held minus Guthaben, null wenn alle freigeschaltet", () => {
    const price = (id: string) => CHARACTERS[id as keyof typeof CHARACTERS].price;
    const cheapest = heroes.filter((h) => h.price > 0).sort((a, b) => a.price - b.price)[0];
    const s = gameOverSummary(res(), prof(price(cheapest.id) - 214), heroes);
    expect(s.nextGoalLine).toBe(`Noch 214 bis ${cheapest.name}`);
    // der günstigste ist schon im Besitz → nächstteurer Held
    const second = heroes.filter((h) => h.price > cheapest.price).sort((a, b) => a.price - b.price)[0];
    const s2 = gameOverSummary(res(), prof(0, ["fred", "frida", cheapest.id]), heroes);
    expect(s2.nextGoalLine).toBe(`Noch ${second.price} bis ${second.name}`);
    // alle freigeschaltet
    expect(gameOverSummary(res(), prof(0, heroes.map((h) => h.id)), heroes).nextGoalLine).toBeNull();
  });

  it("Münzziel: Guthaben reicht schon → kein irreführendes 'Noch 0'", () => {
    const cheapest = heroes.filter((h) => h.price > 0).sort((a, b) => a.price - b.price)[0];
    const s = gameOverSummary(res(), prof(cheapest.price + 50), heroes);
    expect(s.nextGoalLine).toBe(`${cheapest.name} ist jetzt freischaltbar`);
    expect(s.nextGoalLine).not.toMatch(/Noch 0/);
  });

  it("akzeptiert Liste oder Record der Helden und ändert die Eingaben nicht", () => {
    const list = [
      { id: "a", name: "Anna", price: 0 },
      { id: "b", name: "Bert", price: 800 },
      { id: "c", name: "Cleo", price: 400 },
    ];
    const rec = Object.fromEntries(list.map((h) => [h.id, h]));
    const before = JSON.stringify([list, rec]);
    const p = prof(100, ["a"]);
    const fromList = gameOverSummary(res(), p, list);
    const fromRecord = gameOverSummary(res(), p, rec);
    expect(fromList).toEqual(fromRecord);
    expect(fromList.nextGoalLine).toBe("Noch 300 bis Cleo");
    expect(JSON.stringify([list, rec])).toBe(before);
    // Gratis-Held ohne Eintrag in unlocked zählt nicht als Ziel
    expect(gameOverSummary(res(), prof(0, []), [{ id: "a", name: "Anna", price: 0 }]).nextGoalLine).toBeNull();
  });
});
