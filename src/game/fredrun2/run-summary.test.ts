import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultProfile, recordRun } from "./profile";
import { bankRun, countdownDisplay, isBankable, newRunId, QUICK_COUNTDOWN_S, QUICK_MENU_RUNS, QUIT_CAUSE, summarizeRun, toRunResult, wantsQuickCountdown, type SimSummarySource } from "./run-summary";

/** Minimale Sim-Attrappe: summarizeRun liest nur diese Felder. */
function fakeSim(over: Partial<Omit<SimSummarySource, "cfg" | "stats">> & { stats?: Partial<SimSummarySource["stats"]>; cfg?: Partial<SimSummarySource["cfg"]> } = {}): SimSummarySource {
  const { stats, cfg, ...rest } = over;
  return {
    cfg: { mode: "world", world: "wien", character: "fred", ...cfg },
    score: 3004,
    meters: 412.6,
    time: 61.5,
    deathCause: "",
    stats: { coins: 80, gems: 2, stomps: 5, nearMisses: 7, dashes: 3, maxCombo: 6, worldsVisited: ["wien"], ...stats },
    ...rest,
  };
}

describe("summarizeRun", () => {
  it("übernimmt Werte und Konfiguration der Sim", () => {
    const s = summarizeRun(fakeSim({ cfg: { world: "alpen", character: "frida" } }), { dailyKey: "" });
    expect(s).toMatchObject({ mode: "world", world: "alpen", character: "frida", score: 3004, meters: 412.6, coins: 80, stomps: 5, nearMisses: 7, seconds: 61.5, gems: 2, maxCombo: 6, dashes: 3, dailyKey: "" });
  });

  it("setzt die Todesursache „quit“ nur, wenn die Sim noch keine kennt", () => {
    expect(summarizeRun(fakeSim(), { dailyKey: "", quit: true }).deathCause).toBe(QUIT_CAUSE);
    expect(summarizeRun(fakeSim(), { dailyKey: "" }).deathCause).toBe("");
    expect(summarizeRun(fakeSim({ deathCause: "drone" }), { dailyKey: "", quit: true }).deathCause).toBe("drone");
  });

  it("kopiert die Weltenliste (spätere Sim-Änderungen wirken nicht zurück)", () => {
    const sim = fakeSim({ stats: { worldsVisited: ["wien", "alpen"] } });
    const s = summarizeRun(sim, { dailyKey: "2026-10-08" });
    sim.stats.worldsVisited.push("prater");
    expect(s.worldsVisited).toEqual(["wien", "alpen"]);
    expect(s.dailyKey).toBe("2026-10-08");
  });
});

describe("isBankable", () => {
  it("bucht nur, wenn ganze Punkte oder Münzen erreicht wurden", () => {
    expect(isBankable({ score: 0, coins: 0 })).toBe(false);
    expect(isBankable({ score: 0.4, coins: 0 })).toBe(false);
    expect(isBankable({ score: 1, coins: 0 })).toBe(true);
    expect(isBankable({ score: 0, coins: 3 })).toBe(true);
    expect(isBankable({ score: 3004, coins: 80 })).toBe(true);
  });
});

describe("bankRun", () => {
  it("addiert Münzen, zählt genau einen Lauf und setzt den Bestwert", () => {
    const p = { ...defaultProfile(), coins: 100 };
    const rec = bankRun(p, summarizeRun(fakeSim(), { dailyKey: "" }));
    expect(rec.profile.coins).toBe(180);
    expect(rec.profile.lifetime.runs).toBe(1);
    expect(rec.profile.lifetime.coins).toBe(80);
    expect(rec.profile.lifetime.meters).toBe(412);
    expect(rec.profile.lifetime.playSeconds).toBe(61);
    expect(rec.profile.best["world:wien"]).toBe(3004);
    expect(rec.isNewBest).toBe(true);
    expect(rec.rank).toBe(1);
    expect(rec.key).toBe("world:wien");
  });

  it("setzt den Bestwert nur bei höherem Punktestand", () => {
    const p = { ...defaultProfile(), best: { "world:wien": 5000 } };
    const rec = bankRun(p, summarizeRun(fakeSim({ score: 3004 }), { dailyKey: "" }));
    expect(rec.profile.best["world:wien"]).toBe(5000);
    expect(rec.isNewBest).toBe(false);
    expect(rec.previousBest).toBe(5000);
    expect(rec.profile.lifetime.runs).toBe(1);
    expect(rec.profile.coins).toBe(80);
  });

  it("zählt jede Buchung genau einmal (zwei Läufe = zwei) und verändert das Eingabeprofil nicht", () => {
    const p = defaultProfile();
    const a = bankRun(p, summarizeRun(fakeSim({ score: 1000, stats: { coins: 10 } }), { dailyKey: "" }));
    const b = bankRun(a.profile, summarizeRun(fakeSim({ score: 2000, stats: { coins: 5 } }), { dailyKey: "" }));
    expect(p.lifetime.runs).toBe(0);
    expect(p.coins).toBe(0);
    expect(a.profile.lifetime.runs).toBe(1);
    expect(b.profile.lifetime.runs).toBe(2);
    expect(b.profile.coins).toBe(15);
    expect(b.profile.top["world:wien"]?.map((e) => e.score)).toEqual([2000, 1000]);
  });

  it("ist gleichwertig zu recordRun (gleiche Eingabe, gleiches Datum)", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    const s = summarizeRun(fakeSim(), { dailyKey: "" });
    expect(bankRun(defaultProfile(), s, now)).toEqual(recordRun(defaultProfile(), s, now));
  });

  it("nutzt den Tageslauf-Schlüssel für das Board", () => {
    const rec = bankRun(defaultProfile(), summarizeRun(fakeSim({ cfg: { mode: "daily" } }), { dailyKey: "2026-10-08" }));
    expect(rec.key).toBe("daily:2026-10-08");
    expect(rec.profile.best["daily:2026-10-08"]).toBe(3004);
  });
});

describe("toRunResult", () => {
  it("baut die Ergebnis-Karte eines abgebrochenen Laufs", () => {
    const summary = summarizeRun(fakeSim(), { dailyKey: "", quit: true });
    const rec = bankRun(defaultProfile(), summary);
    const r = toRunResult(summary, rec, "run-1");
    expect(r).toMatchObject({ score: 3004, coins: 80, gems: 2, maxCombo: 6, dashes: 3, deathCause: "quit", isNewBest: true, rank: 1, previousBest: 0, board: "world:wien", runId: "run-1", worldsVisited: ["wien"] });
    expect(r.top).toHaveLength(1);
  });

  it("wertet 0 Punkte nie als neuen Bestwert", () => {
    const summary = summarizeRun(fakeSim({ score: 0, stats: { coins: 4 } }), { dailyKey: "" });
    const r = toRunResult(summary, bankRun(defaultProfile(), summary), "x");
    expect(r.isNewBest).toBe(false);
    expect(r.rank).toBeNull();
  });
});

describe("wantsQuickCountdown", () => {
  const base = { quickRestart: true, runs: 1, fromMenu: false, sameAsLast: true };

  it("kurz nach Game-Over/Pause ab dem ersten gewerteten Lauf, wenn alles wie zuletzt ist", () => {
    expect(wantsQuickCountdown(base)).toBe(true);
    expect(wantsQuickCountdown({ ...base, runs: 40 })).toBe(true);
  });

  it("voll im Erstlauf (noch kein gewerteter Lauf)", () => {
    expect(wantsQuickCountdown({ ...base, runs: 0 })).toBe(false);
  });

  it("voll bei Wechsel von Welt/Modus/Held und bei ausgeschalteter Einstellung", () => {
    expect(wantsQuickCountdown({ ...base, sameAsLast: false })).toBe(false);
    expect(wantsQuickCountdown({ ...base, quickRestart: false })).toBe(false);
  });

  it("aus dem Menü erst ab dem dritten Lauf", () => {
    expect(wantsQuickCountdown({ ...base, fromMenu: true, runs: QUICK_MENU_RUNS - 1 })).toBe(false);
    expect(wantsQuickCountdown({ ...base, fromMenu: true, runs: QUICK_MENU_RUNS })).toBe(true);
  });

  it("der kurze Countdown ist eine Zahl lang (1 s)", () => {
    expect(QUICK_COUNTDOWN_S).toBe(1);
    expect(countdownDisplay(QUICK_COUNTDOWN_S)).toBe(1);
  });
});

describe("countdownDisplay", () => {
  it("zeigt nie 4: die ersten 0,2 s von 3,2 s zeigen schon 3", () => {
    expect(countdownDisplay(3.2)).toBe(3);
    expect(countdownDisplay(3.01)).toBe(3);
    expect(countdownDisplay(3)).toBe(3);
  });

  it("zählt 3, 2, 1 herunter und endet bei 0 (auch bei negativer Restzeit)", () => {
    expect(countdownDisplay(2.5)).toBe(3);
    expect(countdownDisplay(2)).toBe(2);
    expect(countdownDisplay(1.2)).toBe(2);
    expect(countdownDisplay(1)).toBe(1);
    expect(countdownDisplay(0.01)).toBe(1);
    expect(countdownDisplay(0)).toBe(0);
    expect(countdownDisplay(-0.02)).toBe(0);
    expect(Object.is(countdownDisplay(-0.02), -0)).toBe(false);
  });
});

describe("newRunId", () => {
  afterEach(() => vi.unstubAllGlobals());

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it("liefert eine UUID v4", () => {
    expect(newRunId()).toMatch(UUID);
    expect(newRunId()).not.toBe(newRunId());
  });

  it("fällt ohne crypto auf Math.random zurück und bleibt eine gültige UUID v4", () => {
    vi.stubGlobal("crypto", undefined);
    expect(newRunId()).toMatch(UUID);
  });
});
