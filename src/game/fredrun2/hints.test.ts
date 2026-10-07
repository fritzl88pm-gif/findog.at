import { describe, expect, it } from "vitest";
import { DASH_HINT_AFTER_S, HINT_GAP_S, HINT_IDS, HINT_LOOKAHEAD_PX, HINT_SHOW_S, HintScheduler, hintText, pickHint, type ActiveHint, type HintContext, type HintId } from "./hints";

const ctx = (over: Partial<HintContext> = {}): HintContext => ({ time: 5, touch: false, runs: 0, hintsEnabled: true, energyReady: false, ...over });

describe("hintText", () => {
  it("jede Mechanik hat auf Tastatur und Touch einen Text", () => {
    for (const id of HINT_IDS) {
      expect(hintText(id, false).length).toBeGreaterThan(5);
      expect(hintText(id, true).length).toBeGreaterThan(5);
    }
  });

  it("Touch-Texte nennen weder Leertaste noch Shift noch Tasten", () => {
    for (const id of HINT_IDS) {
      const t = hintText(id, true);
      expect(t).not.toMatch(/Leertaste|Shift|Taste/);
    }
  });

  it("Touch-Wortlaut laut Plan", () => {
    expect(hintText("jump", true)).toBe("Tippen = springen · halten = höher · nochmal = Doppelsprung");
    expect(hintText("slide", true)).toBe("Rutschen: ↓-Knopf unten links oder links nach unten wischen");
    expect(hintText("stomp", true)).toBe("Auf Gegner springen = besiegen");
    expect(hintText("dash", true)).toBe("⚡-Knopf rechts: Dash, wenn der Ring voll ist");
  });

  it("Tastatur-Texte nennen die Tasten", () => {
    expect(hintText("jump", false)).toContain("Leertaste");
    expect(hintText("dash", false)).toContain("Shift");
    expect(hintText("slide", false)).toContain("↓");
    expect(hintText("stomp", false)).toBe("Auf Gegner springen = besiegen");
  });
});

describe("pickHint", () => {
  it("Überhang unter 1100 px ergibt slide, bei 1500 px keinen Hinweis", () => {
    expect(pickHint(ctx({ overheadDist: 1000 }))).toBe("slide");
    expect(pickHint(ctx({ overheadDist: 1500 }))).toBeNull();
    expect(pickHint(ctx({ overheadDist: HINT_LOOKAHEAD_PX - 1 }))).toBe("slide");
    expect(pickHint(ctx({ overheadDist: HINT_LOOKAHEAD_PX }))).toBeNull();
  });

  it("nichts voraus (fehlend, null, negativ) ergibt keinen Hinweis", () => {
    expect(pickHint(ctx())).toBeNull();
    expect(pickHint(ctx({ overheadDist: null, stompDist: null, pitDist: null }))).toBeNull();
    expect(pickHint(ctx({ overheadDist: -50, stompDist: -1, pitDist: -300 }))).toBeNull();
    expect(pickHint(ctx({ overheadDist: Infinity, stompDist: Infinity, pitDist: Infinity }))).toBeNull();
    expect(pickHint(ctx({ overheadDist: NaN }))).toBeNull();
  });

  it("stompbarer Gegner und Grube", () => {
    expect(pickHint(ctx({ stompDist: 800 }))).toBe("stomp");
    expect(pickHint(ctx({ stompDist: 1400 }))).toBeNull();
    expect(pickHint(ctx({ pitDist: 600 }))).toBe("doublejump");
    expect(pickHint(ctx({ pitDist: 1400 }))).toBeNull();
  });

  it("Priorität: Rutschen vor Stampfen vor Doppelsprung", () => {
    expect(pickHint(ctx({ overheadDist: 900, stompDist: 500, pitDist: 300 }))).toBe("slide");
    expect(pickHint(ctx({ stompDist: 500, pitDist: 300 }))).toBe("stomp");
    expect(pickHint(ctx({ overheadDist: 900, stompDist: 500, pitDist: 300, used: new Set<HintId>(["slide"]) }))).toBe("stomp");
    expect(pickHint(ctx({ overheadDist: 900, stompDist: 500, pitDist: 300, used: new Set<HintId>(["slide", "stomp"]) }))).toBe("doublejump");
  });

  it("benutzte Mechanik erzeugt keinen Hinweis", () => {
    const used = (id: HintId) => new Set<HintId>([id]);
    expect(pickHint(ctx({ overheadDist: 1000, used: used("slide") }))).toBeNull();
    expect(pickHint(ctx({ stompDist: 1000, used: used("stomp") }))).toBeNull();
    expect(pickHint(ctx({ pitDist: 1000, used: used("doublejump") }))).toBeNull();
    expect(pickHint(ctx({ energyReady: true, time: 20, used: used("dash") }))).toBeNull();
    expect(pickHint(ctx({ time: 1, used: used("jump") }))).toBeNull();
  });

  it("Dash-Hinweis nie bei energyReady=false, sonst erst nach der Startphase", () => {
    for (const time of [0, 0.2, 3, 7, 12, 60]) {
      for (const dist of [undefined, 100, 1000, 2000]) {
        const h = pickHint(ctx({ time, energyReady: false, overheadDist: dist, stompDist: dist, pitDist: dist }));
        expect(h).not.toBe("dash");
      }
    }
    expect(pickHint(ctx({ time: 3, energyReady: true }))).toBeNull();
    expect(pickHint(ctx({ time: DASH_HINT_AFTER_S - 0.01, energyReady: true }))).toBeNull();
    expect(pickHint(ctx({ time: DASH_HINT_AFTER_S, energyReady: true }))).toBe("dash");
    expect(pickHint(ctx({ time: 30, energyReady: true }))).toBe("dash");
  });

  it("Sprung-Hinweis ab 0,2 s, nur in der Startphase", () => {
    expect(pickHint(ctx({ time: 0 }))).toBeNull();
    expect(pickHint(ctx({ time: 0.19 }))).toBeNull();
    expect(pickHint(ctx({ time: 0.2 }))).toBe("jump");
    expect(pickHint(ctx({ time: 1.5 }))).toBe("jump");
    expect(pickHint(ctx({ time: 12 }))).toBeNull();
    expect(pickHint(ctx({ time: NaN }))).toBeNull();
  });

  it("runs >= 3 oder hintsEnabled=false liefert immer null", () => {
    const rich: Partial<HintContext> = { overheadDist: 500, stompDist: 500, pitDist: 500, energyReady: true };
    for (const time of [0, 0.2, 1, 8, 40]) {
      for (const runs of [3, 4, 100]) expect(pickHint(ctx({ ...rich, time, runs }))).toBeNull();
      expect(pickHint(ctx({ ...rich, time, hintsEnabled: false }))).toBeNull();
      expect(pickHint(ctx({ ...rich, time, runs: 5, hintsEnabled: false }))).toBeNull();
    }
    for (const runs of [0, 1, 2]) expect(pickHint(ctx({ ...rich, runs }))).not.toBeNull();
  });
});

interface Frame {
  t: number;
  hint: ActiveHint | null;
}

/** Spielt `seconds` mit Schrittweite dt durch; `make` liefert den Kontext je Zeitpunkt. */
function simulate(sched: HintScheduler, seconds: number, make: (t: number) => HintContext, dt = 1 / 60): Frame[] {
  const out: Frame[] = [];
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i += 1) {
    const t = i * dt;
    out.push({ t, hint: sched.update(dt, make(t)) });
  }
  return out;
}

/** Aufeinanderfolgende Anzeigen je Hinweis-Objekt: [{id, from, to}] */
function spans(frames: Frame[]): Array<{ id: HintId; from: number; to: number; frames: number }> {
  const res: Array<{ id: HintId; from: number; to: number; frames: number }> = [];
  let cur: ActiveHint | null = null;
  for (const f of frames) {
    if (f.hint !== cur) {
      cur = f.hint;
      if (cur) res.push({ id: cur.id, from: f.t, to: f.t, frames: 1 });
    } else if (cur) {
      const last = res[res.length - 1];
      last.to = f.t;
      last.frames += 1;
    }
  }
  return res;
}

describe("HintScheduler", () => {
  it("Überhang bei 1000 px: slide genau einmal, 3,5 s lang", () => {
    const s = new HintScheduler();
    const frames = simulate(s, 20, (t) => ctx({ time: 3 + t, overheadDist: 1000 }));
    const sp = spans(frames).filter((x) => x.id === "slide");
    expect(sp).toHaveLength(1);
    expect(sp[0].frames / 60).toBeGreaterThan(HINT_SHOW_S - 0.05);
    expect(sp[0].frames / 60).toBeLessThan(HINT_SHOW_S + 0.05);
    expect(frames[0].hint?.id).toBe("slide");
    expect(frames[0].hint?.text).toBe(hintText("slide", false));
  });

  it("Überhang bei 1500 px: nie ein Hinweis", () => {
    const s = new HintScheduler();
    const frames = simulate(s, 30, (t) => ctx({ time: 3 + t, overheadDist: 1500 }));
    expect(frames.every((f) => f.hint === null)).toBe(true);
  });

  it("zeigt 3,5 s, nie zwei gleichzeitig, danach (nach kurzer Pause) den nächsten", () => {
    const s = new HintScheduler();
    // Überhang, stompbarer Gegner und Grube gleichzeitig voraus: nacheinander slide, stomp, doublejump
    const frames = simulate(s, 30, (t) => ctx({ time: 3 + t, overheadDist: 800, stompDist: 800, pitDist: 800 }));
    const sp = spans(frames);
    expect(sp.map((x) => x.id)).toEqual(["slide", "stomp", "doublejump"]);
    for (const x of sp) {
      expect(x.frames / 60).toBeGreaterThan(HINT_SHOW_S - 0.05);
      expect(x.frames / 60).toBeLessThan(HINT_SHOW_S + 0.05);
    }
    // Pause zwischen zwei Hinweisen
    for (let i = 1; i < sp.length; i += 1) {
      const gap = sp[i].from - sp[i - 1].to;
      expect(gap).toBeGreaterThanOrEqual(HINT_GAP_S - 0.05);
      expect(gap).toBeLessThan(HINT_GAP_S + 0.1);
    }
    // je Frame höchstens ein Hinweis (Rückgabe ist ein einzelnes Objekt oder null)
    expect(frames.every((f) => f.hint === null || typeof f.hint.id === "string")).toBe(true);
  });

  it("gibt solange ein Hinweis steht dasselbe Objekt zurück (keine Allokation pro Frame)", () => {
    const s = new HintScheduler();
    const a = s.update(0.1, ctx({ overheadDist: 800 }));
    const b = s.update(0.1, ctx({ overheadDist: 800 }));
    expect(a).not.toBeNull();
    expect(b).toBe(a);
  });

  it("einmal gezeigter Hinweis kommt im selben Lauf nicht wieder", () => {
    const s = new HintScheduler();
    const frames = simulate(s, 40, (t) => ctx({ time: 3 + t, stompDist: 900 }));
    expect(spans(frames).filter((x) => x.id === "stomp")).toHaveLength(1);
    // nach reset() wieder
    s.reset();
    expect(s.update(1 / 60, ctx({ stompDist: 900 }))?.id).toBe("stomp");
  });

  it("markUsed: benutzte Mechanik erzeugt keinen Hinweis", () => {
    const s = new HintScheduler();
    s.markUsed("slide");
    const frames = simulate(s, 10, (t) => ctx({ time: 3 + t, overheadDist: 800 }));
    expect(frames.every((f) => f.hint === null)).toBe(true);
  });

  it("markUsed blendet den gerade sichtbaren Hinweis dieser Mechanik sofort aus, andere bleiben stehen", () => {
    const s = new HintScheduler();
    expect(s.update(1 / 60, ctx({ overheadDist: 800 }))?.id).toBe("slide");
    s.markUsed("stomp");
    expect(s.update(1 / 60, ctx({ overheadDist: 800 }))?.id).toBe("slide");
    s.markUsed("slide");
    expect(s.update(1 / 60, ctx({ overheadDist: 800 }))).toBeNull();
  });

  it("Sprung-Hinweis zum Start (0,2 s), Touch-Wortlaut auf Touch-Geräten", () => {
    const s = new HintScheduler();
    const frames = simulate(s, 6, (t) => ctx({ time: t, touch: true }));
    const sp = spans(frames);
    expect(sp).toHaveLength(1);
    expect(sp[0].id).toBe("jump");
    expect(sp[0].from).toBeGreaterThanOrEqual(0.19);
    expect(sp[0].from).toBeLessThan(0.25);
    const shown = frames.find((f) => f.hint)?.hint;
    expect(shown?.text).toBe(hintText("jump", true));
    expect(shown?.text).not.toMatch(/Leertaste|Shift/);
  });

  it("wer vor 0,2 s springt, bekommt keinen Sprung-Hinweis", () => {
    const s = new HintScheduler();
    s.markUsed("jump");
    const frames = simulate(s, 6, (t) => ctx({ time: t }));
    expect(frames.every((f) => f.hint === null)).toBe(true);
  });

  it("Dash-Hinweis nur bei energyReady", () => {
    const off = new HintScheduler();
    expect(simulate(off, 30, (t) => ctx({ time: t, energyReady: false })).some((f) => f.hint?.id === "dash")).toBe(false);
    const on = new HintScheduler();
    const frames = simulate(on, 30, (t) => ctx({ time: t, energyReady: true }));
    const dash = spans(frames).filter((x) => x.id === "dash");
    expect(dash).toHaveLength(1);
    expect(dash[0].from).toBeGreaterThanOrEqual(DASH_HINT_AFTER_S - 0.05);
  });

  it("runs >= 3 oder hintsEnabled=false: nie ein Hinweis, ein laufender verschwindet", () => {
    const a = new HintScheduler();
    expect(simulate(a, 20, (t) => ctx({ time: t, runs: 3, overheadDist: 500, stompDist: 500, energyReady: true })).every((f) => f.hint === null)).toBe(true);
    const b = new HintScheduler();
    expect(simulate(b, 20, (t) => ctx({ time: t, hintsEnabled: false, overheadDist: 500, stompDist: 500, energyReady: true })).every((f) => f.hint === null)).toBe(true);
    const c = new HintScheduler();
    expect(c.update(0.1, ctx({ overheadDist: 500 }))).not.toBeNull();
    expect(c.update(0.1, ctx({ overheadDist: 500, hintsEnabled: false }))).toBeNull();
  });

  it("stabil bei großem dt (z. B. nach einem Ruckler)", () => {
    const s = new HintScheduler();
    expect(s.update(0.05, ctx({ overheadDist: 800 }))?.id).toBe("slide");
    // der lange Frame überspringt Restanzeige und Pause: der nächste Hinweis steht sofort, genau einer
    const next = s.update(5, ctx({ overheadDist: 800, stompDist: 800 }));
    expect(next?.id).toBe("stomp");
    expect(s.update(0.6, ctx({ overheadDist: 800, stompDist: 800 }))).toBe(next);
  });
});
