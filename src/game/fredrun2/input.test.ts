// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXED_DT } from "./constants";
import {
  InputManager,
  JUMP_ASSIST_S,
  LEFT_ZONE,
  NAV_REPEAT_MS,
  SWIPE_DECIDE_MS,
  SWIPE_DRIFT_DY,
  SWIPE_EXTEND_MS,
  SWIPE_MIN_DY,
  type NavDir,
  type PointerKind,
} from "./input";
import { Sim, type SimInput } from "./sim";
import { WORLDS } from "./worlds";

/** Zeitquelle der Tests in ms (der Manager bekommt sie injiziert). */
let t = 0;
let mgr: InputManager;
let root: HTMLElement;
let stage: HTMLElement;
let rect = { left: 0, width: 1000 };

function makeRect(): DOMRect {
  return {
    x: rect.left,
    y: 0,
    left: rect.left,
    right: rect.left + rect.width,
    top: 0,
    bottom: 600,
    width: rect.width,
    height: 600,
    toJSON: () => ({}),
  } as DOMRect;
}

type PInit = { id?: number; type?: "touch" | "mouse" | "pen"; x?: number; y?: number; button?: number };

function fire(kind: "pointerdown" | "pointermove" | "pointerup" | "pointercancel", init: PInit = {}, target: Element = stage): void {
  target.dispatchEvent(
    new PointerEvent(kind, {
      bubbles: true,
      cancelable: true,
      pointerId: init.id ?? 1,
      pointerType: init.type ?? "touch",
      clientX: init.x ?? 200,
      clientY: init.y ?? 200,
      button: init.button ?? 0,
    }),
  );
}

function key(type: "keydown" | "keyup", code: string, repeat = false): void {
  window.dispatchEvent(new KeyboardEvent(type, { code, repeat, bubbles: true, cancelable: true }));
}

const step = (): SimInput => mgr.consume(FIXED_DT);

beforeEach(() => {
  t = 0;
  rect = { left: 0, width: 1000 };
  mgr = new InputManager({ clock: () => t });
  root = document.createElement("div");
  stage = document.createElement("div");
  root.appendChild(stage);
  document.body.appendChild(root);
  root.getBoundingClientRect = makeRect;
  mgr.attach(root);
  mgr.enabled = true;
});

afterEach(() => {
  mgr.detach();
  root.remove();
  Reflect.deleteProperty(navigator, "getGamepads");
  vi.restoreAllMocks();
});

describe("Touch-Wisch links (feel-core-02)", () => {
  it("Konstanten", () => {
    expect(SWIPE_DECIDE_MS).toBe(28);
    expect(SWIPE_MIN_DY).toBe(10);
    expect(LEFT_ZONE).toBe(0.45);
  });

  it("Touch links, +14 px nach unten in 20 ms: nur Rutschen, kein Sprung", () => {
    fire("pointerdown", { x: 200, y: 200 });
    t = 10;
    expect(step().jumpPressed).toBe(false);
    t = 20;
    fire("pointermove", { x: 200, y: 214 });
    const a = step();
    expect(a.slidePressed).toBe(true);
    expect(a.jumpPressed).toBe(false);
    expect(a.slide).toBe(true);
    // auch nach Ablauf des Fensters und beim Loslassen kommt kein Sprung nach
    t = 60;
    expect(step().jumpPressed).toBe(false);
    fire("pointerup", { x: 200, y: 214 });
    t = 120;
    const b = step();
    expect(b.jumpPressed).toBe(false);
    expect(b.jump).toBe(false);
  });

  it("Wisch nach unten ist nur im Fenster nötig: auch erst beim ersten Zug nach 25 ms (im selben Frame vor consume)", () => {
    fire("pointerdown", { x: 200, y: 200 });
    t = 25;
    fire("pointermove", { x: 203, y: 230 });
    const o = step();
    expect(o.slidePressed).toBe(true);
    expect(o.jumpPressed).toBe(false);
  });

  it("Tippen ohne Bewegung: Sprung erst nach dem Entscheidungsfenster, genau einmal", () => {
    fire("pointerdown");
    t = 0;
    expect(step().jumpPressed).toBe(false);
    t = 27;
    expect(step().jumpPressed).toBe(false);
    t = SWIPE_DECIDE_MS;
    const o = step();
    expect(o.jumpPressed).toBe(true);
    expect(o.jump).toBe(true);
    t = 40;
    expect(step().jumpPressed).toBe(false);
  });

  it("Tippen mit Loslassen im Fenster: Sprung beim pointerup", () => {
    fire("pointerdown");
    t = 12;
    fire("pointerup");
    const o = step();
    expect(o.jumpPressed).toBe(true);
    t = 200;
    expect(step().jumpPressed).toBe(false);
  });

  it("während des Wartens gilt der Finger als gehalten (jump=true ohne Flanke)", () => {
    fire("pointerdown");
    t = 5;
    const o = step();
    expect(o.jump).toBe(true);
    expect(o.jumpPressed).toBe(false);
  });

  it("Bewegung in andere Richtung (nach oben/seitlich/schräg) löst den Sprung sofort aus", () => {
    fire("pointerdown", { x: 200, y: 200 });
    t = 6;
    fire("pointermove", { x: 200, y: 186 });
    expect(step().jumpPressed).toBe(true);
    fire("pointerup", { x: 200, y: 186 });
    fire("pointerdown", { id: 2, x: 200, y: 200 });
    t = 12;
    fire("pointermove", { id: 2, x: 216, y: 204 });
    expect(step().jumpPressed).toBe(true);
    fire("pointerup", { id: 2, x: 216, y: 204 });
    fire("pointerdown", { id: 3, x: 200, y: 200 });
    t = 18;
    // schräg: dy überwiegt dx nicht deutlich genug (Verhältnis 1,4)
    fire("pointermove", { id: 3, x: 210, y: 212 });
    const o = step();
    expect(o.jumpPressed).toBe(true);
    expect(o.slidePressed).toBe(false);
  });

  it("kleine Bewegung unter dem Mindestweg ändert nichts am Warten", () => {
    fire("pointerdown", { x: 200, y: 200 });
    t = 8;
    fire("pointermove", { x: 201, y: 205 });
    expect(step().jumpPressed).toBe(false);
    t = 20;
    fire("pointermove", { x: 201, y: 212 });
    const o = step();
    expect(o.slidePressed).toBe(true);
    expect(o.jumpPressed).toBe(false);
  });

  it("rechte Fläche: Sprung sofort (Wisch erst ab 46 px, dann Rutschen/Stampfen)", () => {
    fire("pointerdown", { x: 700, y: 200 });
    const a = step();
    expect(a.jumpPressed).toBe(true);
    t = 20;
    fire("pointermove", { x: 700, y: 214 });
    expect(step().slidePressed).toBe(false);
    t = 80;
    fire("pointermove", { x: 700, y: 262 });
    const b = step();
    expect(b.slidePressed).toBe(true);
    expect(b.jump).toBe(false);
  });

  it("Zonengrenze: knapp links wartet, ab 45 % sofort", () => {
    fire("pointerdown", { id: 1, x: 449, y: 200 });
    expect(step().jumpPressed).toBe(false);
    fire("pointerup", { id: 1, x: 449, y: 200 });
    expect(step().jumpPressed).toBe(true);
    fire("pointerdown", { id: 2, x: 450, y: 200 });
    expect(step().jumpPressed).toBe(true);
  });

  it("Maus und Stift springen sofort, auch links", () => {
    fire("pointerdown", { id: 1, type: "mouse", x: 100, y: 200 });
    expect(step().jumpPressed).toBe(true);
    fire("pointerup", { id: 1, type: "mouse", x: 100, y: 200 });
    fire("pointerdown", { id: 2, type: "pen", x: 100, y: 200 });
    expect(step().jumpPressed).toBe(true);
  });

  it("Maus-Wisch links bleibt bei der alten 46-px-Regel (kein Warten)", () => {
    fire("pointerdown", { type: "mouse", x: 100, y: 200 });
    expect(step().jumpPressed).toBe(true);
    t = 15;
    fire("pointermove", { type: "mouse", x: 100, y: 214 });
    expect(step().slidePressed).toBe(false);
    t = 60;
    fire("pointermove", { type: "mouse", x: 100, y: 260 });
    expect(step().slidePressed).toBe(true);
  });

  it("nach ausgelöstem Touch-Sprung gilt weiter die 46-px-Regel (Stampfen in der Luft)", () => {
    fire("pointerdown", { x: 200, y: 200 });
    t = 40;
    expect(step().jumpPressed).toBe(true);
    t = 120;
    fire("pointermove", { x: 200, y: 262 });
    const o = step();
    expect(o.slidePressed).toBe(true);
    expect(o.jump).toBe(false);
  });

  it("pointercancel räumt den wartenden Sprung", () => {
    fire("pointerdown");
    t = 10;
    fire("pointercancel");
    t = 100;
    const o = step();
    expect(o.jumpPressed).toBe(false);
    expect(o.jump).toBe(false);
    // und danach funktioniert ein neues Tippen normal
    fire("pointerdown", { id: 2 });
    fire("pointerup", { id: 2 });
    expect(step().jumpPressed).toBe(true);
  });

  it("releaseAll räumt den wartenden Sprung", () => {
    fire("pointerdown");
    mgr.releaseAll();
    t = 100;
    expect(step().jumpPressed).toBe(false);
  });

  it("die Frist gilt exakt 28 ms (Entscheidung im consume()-Takt)", () => {
    t = 1;
    fire("pointerdown");
    t = 28;
    expect(step().jumpPressed).toBe(false); // 27 ms alt
    t = 29;
    expect(step().jumpPressed).toBe(true);
  });

  it("Sprunghöhe eines kurzen Tippens bleibt gleich: die Wartezeit wird dem Halten gutgeschrieben", () => {
    fire("pointerdown");
    t = 12;
    fire("pointerup");
    const first = step();
    expect(first.jumpPressed).toBe(true);
    // 12 ms Wartezeit = 12 ms „gehalten“ nach dem Auslösen (statt sofort losgelassen)
    expect(first.jump).toBe(true);
    let held = 1;
    for (let i = 0; i < 6; i += 1) if (step().jump) held += 1;
    expect(held).toBeGreaterThanOrEqual(1);
    expect(held).toBeLessThanOrEqual(3);
  });

  it("Wisch-Folge im Takt der Sim: Rutschen, nie eine J-Folge", () => {
    let seq = "";
    for (let i = 0; i < 80; i += 1) {
      t = (i * 1000) / 120;
      if (i === 0) fire("pointerdown", { x: 220, y: 200 });
      if (i === 1) fire("pointermove", { x: 221, y: 208 });
      if (i === 3) fire("pointermove", { x: 222, y: 224 });
      if (i === 8) fire("pointermove", { x: 222, y: 260 });
      if (i === 40) fire("pointerup", { x: 222, y: 260 });
      const o = step();
      seq += o.jumpPressed ? "J" : o.slidePressed ? "S" : "-";
    }
    expect(seq).not.toContain("J");
    expect(seq.split("S").length - 1).toBe(1);
  });

  it("Tipp-Folge im Takt der Sim: genau ein Sprung", () => {
    let seq = "";
    for (let i = 0; i < 40; i += 1) {
      t = (i * 1000) / 120;
      if (i === 0) fire("pointerdown", { x: 220, y: 200 });
      if (i === 9) fire("pointerup", { x: 220, y: 200 });
      const o = step();
      seq += o.jumpPressed ? "J" : o.slidePressed ? "S" : "-";
    }
    expect(seq.split("J").length - 1).toBe(1);
    expect(seq).not.toContain("S");
  });

  it("zwei Finger: zweiter Wisch wartet unabhängig vom ersten", () => {
    fire("pointerdown", { id: 1, x: 100, y: 200 });
    t = 30;
    expect(step().jumpPressed).toBe(true); // erster Finger: Tippen
    fire("pointerdown", { id: 2, x: 120, y: 200 });
    t = 40;
    fire("pointermove", { id: 2, x: 121, y: 218 });
    const o = step();
    expect(o.slidePressed).toBe(true);
    expect(o.jumpPressed).toBe(false);
  });
});

/** Min-Jerk-Profil (Wisch aus dem Stand): Weg in px nach `ms` bei Gesamtweg `dist` und Dauer `dur`. */
const minJerk =
  (dist: number, dur: number) =>
  (ms: number): number => {
    const u = Math.min(1, Math.max(0, ms / dur));
    return dist * (10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5);
  };

/**
 * Berührung im Frame-Takt wie im Browser: Zeiger-Ereignisse zwischen den Frames zum eigenen Zeitpunkt, die Bewegung gebündelt
 * zu Frame-Beginn, danach die 120-Hz-Sim-Schritte des Frames. `phase` verschiebt die Berührung gegen den Frame-Takt.
 */
function touchRun(hz: number, phase: number, dyAt: (ms: number) => number, upAfter: number): { jumps: number; slides: number } {
  const period = 1000 / hz;
  const steps = Math.max(1, Math.round(period / (1000 / 120)));
  const down = 10 * period + phase;
  const up = down + upAfter;
  let isDown = false;
  let isUp = false;
  let lastY = 0;
  let jumps = 0;
  let slides = 0;
  for (let k = 0; k < 160; k += 1) {
    const frame = k * period;
    if (!isDown && down <= frame) {
      t = down;
      fire("pointerdown", { x: 200, y: 200 });
      isDown = true;
    }
    if (isDown && !isUp && up <= frame) {
      t = up;
      fire("pointerup", { x: 200, y: 200 + lastY });
      isUp = true;
    }
    t = frame;
    if (isDown && !isUp) {
      const dy = dyAt(frame - down);
      if (dy > 0 && dy !== lastY) {
        fire("pointermove", { x: 200, y: 200 + dy });
        lastY = dy;
      }
    }
    mgr.poll();
    for (let i = 0; i < steps; i += 1) {
      const o = step();
      if (o.jumpPressed) jumps += 1;
      if (o.slidePressed) slides += 1;
    }
  }
  return { jumps, slides };
}

describe("Wisch aus dem Stand und Tippen mit Drift (Fix-Runde 1)", () => {
  it("Konstanten der Verlängerung", () => {
    expect(SWIPE_EXTEND_MS).toBe(60);
    expect(SWIPE_DRIFT_DY).toBe(2);
    expect(SWIPE_EXTEND_MS).toBeGreaterThan(SWIPE_DECIDE_MS);
  });

  it("beschleunigender Wisch (1 px bei 8 ms, 4 px bei 16 ms, 9 px bei 24 ms, 18 px bei 40 ms): nur Rutschen, kein Sprung", () => {
    fire("pointerdown", { x: 200, y: 200 });
    const seq: string[] = [];
    const frame = (ms: number, dy?: number): void => {
      t = ms;
      if (dy !== undefined) fire("pointermove", { x: 200, y: 200 + dy });
      const o = step();
      seq.push(o.jumpPressed ? "J" : o.slidePressed ? "S" : "-");
    };
    frame(8, 1);
    frame(16, 4);
    frame(24, 9);
    frame(32); // das 28-ms-Fenster ist um, der Finger zieht aber sichtbar nach unten: weiter warten
    frame(40, 18);
    frame(48);
    frame(60);
    frame(80);
    expect(seq.join("")).toBe("----S---");
    fire("pointerup", { x: 200, y: 218 });
    t = 200;
    expect(step().jumpPressed).toBe(false);
  });

  const profiles: Array<[number, number]> = [
    [100, 140],
    [120, 200],
    [150, 150],
    [200, 200],
  ];
  for (const hz of [60, 120]) {
    it(`Min-Jerk-Wische (100 px/140 ms bis 200 px/200 ms) bei ${hz} Hz: je genau ein Rutschen, nie ein Sprung`, () => {
      for (const [dist, dur] of profiles) {
        for (let i = 0; i < 12; i += 1) {
          mgr.releaseAll();
          const r = touchRun(hz, (i / 12) * (1000 / hz), minJerk(dist, dur), dur + 40);
          expect({ dist, dur, phase: i, ...r }).toEqual({ dist, dur, phase: i, jumps: 0, slides: 1 });
        }
      }
    });
  }

  it("Tippen mit 4 px Drift nach unten: Sprung nach spätestens SWIPE_EXTEND_MS (nicht schon nach 28 ms)", () => {
    fire("pointerdown", { x: 200, y: 200 });
    t = 10;
    fire("pointermove", { x: 200, y: 204 });
    t = SWIPE_DECIDE_MS + 4;
    expect(step().jumpPressed).toBe(false);
    t = SWIPE_EXTEND_MS - 1;
    expect(step().jumpPressed).toBe(false);
    t = SWIPE_EXTEND_MS;
    const o = step();
    expect(o.jumpPressed).toBe(true);
    expect(o.jump).toBe(true);
    t = SWIPE_EXTEND_MS + 8;
    expect(step().jumpPressed).toBe(false);
  });

  it("Tippen mit Drift und Loslassen im verlängerten Fenster: Sprung sofort beim pointerup", () => {
    fire("pointerdown", { x: 200, y: 200 });
    t = 12;
    fire("pointermove", { x: 200, y: 205 });
    t = 40;
    expect(step().jumpPressed).toBe(false);
    fire("pointerup", { x: 200, y: 205 });
    const o = step();
    expect(o.jumpPressed).toBe(true);
    // die Wartezeit wird weiter als Haltezeit gutgeschrieben (Sprunghöhe des Tippens bleibt)
    expect(o.jump).toBe(true);
  });

  it("ohne erkennbaren Drift nach unten bleibt die Latenz bei SWIPE_DECIDE_MS", () => {
    // 1 px (unter SWIPE_DRIFT_DY), seitlich, schräg, nach oben, nach unten und wieder zurück
    const cases: Array<[string, number, number, Array<[number, number]>]> = [
      ["1 px nach unten", 200, 201, []],
      ["5 px seitlich", 205, 200, []],
      ["3 px nach unten, 2 px seitlich (dy nicht doppelt so groß)", 202, 203, []],
      ["4 px nach oben", 200, 196, []],
      ["4 px nach unten und zurück", 200, 200, [[200, 204]]],
    ];
    cases.forEach(([name, x, y, via], i) => {
      mgr.releaseAll();
      t = 1000 * (i + 1);
      const base = t;
      fire("pointerdown", { id: 10 + i, x: 200, y: 200 });
      t = base + 5;
      for (const [vx, vy] of via) fire("pointermove", { id: 10 + i, x: vx, y: vy });
      fire("pointermove", { id: 10 + i, x, y });
      t = base + SWIPE_DECIDE_MS - 1;
      expect(step().jumpPressed, name).toBe(false);
      t = base + SWIPE_DECIDE_MS;
      expect(step().jumpPressed, name).toBe(true);
    });
  });

  it("Wisch, der erst nach dem verlängerten Fenster einsetzt: Sprung war schon ausgelöst, Rutschen erst über die 46-px-Regel", () => {
    fire("pointerdown", { x: 200, y: 200 });
    t = 10;
    fire("pointermove", { x: 200, y: 203 });
    t = SWIPE_EXTEND_MS;
    expect(step().jumpPressed).toBe(true);
    t = SWIPE_EXTEND_MS + 10;
    fire("pointermove", { x: 200, y: 216 });
    expect(step().slidePressed).toBe(false);
    t = SWIPE_EXTEND_MS + 40;
    fire("pointermove", { x: 200, y: 250 });
    expect(step().slidePressed).toBe(true);
  });

  it("zwei Finger: nur der Finger mit Drift wartet länger, jeder löst genau eine Sprung-Flanke aus", () => {
    fire("pointerdown", { id: 1, x: 100, y: 200 });
    fire("pointerdown", { id: 2, x: 140, y: 200 });
    t = 8;
    fire("pointermove", { id: 1, x: 100, y: 205 });
    t = SWIPE_DECIDE_MS;
    expect(step().jumpPressed).toBe(true); // Finger 2: Tippen ohne Drift
    t = SWIPE_DECIDE_MS + 10;
    expect(step().jumpPressed).toBe(false); // Finger 1 wartet noch
    t = SWIPE_EXTEND_MS;
    expect(step().jumpPressed).toBe(true);
    t = SWIPE_EXTEND_MS + 20;
    expect(step().jumpPressed).toBe(false);
  });

  it("pointercancel im verlängerten Fenster räumt den Sprung (und die Zählung für spätere Berührungen)", () => {
    fire("pointerdown", { x: 200, y: 200 });
    t = 10;
    fire("pointermove", { x: 200, y: 205 });
    t = 40;
    fire("pointercancel", { x: 200, y: 205 });
    t = 100;
    expect(step().jumpPressed).toBe(false);
    fire("pointerdown", { id: 2, x: 200, y: 200 });
    t = 100 + SWIPE_DECIDE_MS;
    expect(step().jumpPressed).toBe(true);
  });

  it("Drift ohne Folgebewegung nach unten: ein Wisch im verlängerten Fenster bleibt ein Wisch, auch wenn er erst zwischen zwei consume() eintrifft", () => {
    fire("pointerdown", { x: 200, y: 200 });
    t = 10;
    fire("pointermove", { x: 200, y: 203 });
    t = 50;
    fire("pointermove", { x: 201, y: 215 });
    const o = step();
    expect(o.slidePressed).toBe(true);
    expect(o.jumpPressed).toBe(false);
  });
});

describe("Wurzelfläche (mobile-robust-02)", () => {
  it("Ziele mit data-fr2-ui, [role=alert], button, [role=dialog] lösen keine Flanke aus", () => {
    const mk = (setup: (el: HTMLElement) => void): HTMLElement => {
      const el = document.createElement("div");
      setup(el);
      const child = document.createElement("span");
      el.appendChild(child);
      root.appendChild(el);
      return child;
    };
    const targets = [
      mk((el) => el.setAttribute("data-fr2-ui", "")),
      mk((el) => el.setAttribute("role", "alert")),
      mk((el) => el.setAttribute("role", "dialog")),
      (() => {
        const b = document.createElement("button");
        const s = document.createElement("span");
        b.appendChild(s);
        root.appendChild(b);
        return s;
      })(),
    ];
    for (const target of targets) {
      fire("pointerdown", { type: "mouse", x: 700, y: 100 }, target);
      t += 100;
      const o = step();
      expect(o.jumpPressed).toBe(false);
      expect(o.jump).toBe(false);
      fire("pointerup", { type: "mouse", x: 700, y: 100 }, target);
    }
  });

  it("Tipp auf den Seitenbalken (x=20, Ziel = Wurzel) springt", () => {
    fire("pointerdown", { type: "mouse", x: 20, y: 300 }, root);
    expect(step().jumpPressed).toBe(true);
    fire("pointerup", { type: "mouse", x: 20, y: 300 }, root);
    // Touch an gleicher Stelle: Tippen löst den Sprung innerhalb des Fensters aus
    fire("pointerdown", { id: 2, x: 20, y: 300 }, root);
    fire("pointerup", { id: 2, x: 20, y: 300 }, root);
    expect(step().jumpPressed).toBe(true);
  });

  it("Touch-Zone links bezieht sich auf die Breite der angehängten Fläche", () => {
    rect = { left: 100, width: 800 };
    // Zonenende bei 100 + 0,45 * 800 = 460
    fire("pointerdown", { id: 1, x: 459, y: 200 }, root);
    expect(step().jumpPressed).toBe(false);
    fire("pointerup", { id: 1, x: 459, y: 200 }, root);
    step();
    fire("pointerdown", { id: 2, x: 461, y: 200 }, root);
    expect(step().jumpPressed).toBe(true);
  });

  it("ohne Layout (Breite 0) springt Touch sofort", () => {
    rect = { left: 0, width: 0 };
    fire("pointerdown", { x: 5, y: 5 });
    expect(step().jumpPressed).toBe(true);
  });

  it("setPointerCapture geht an die angehängte Fläche", () => {
    const cap = vi.fn();
    root.setPointerCapture = cap;
    fire("pointerdown", { id: 7, type: "mouse", x: 20, y: 300 }, root);
    expect(cap).toHaveBeenCalledWith(7);
  });

  it("attach an ein anderes Element zieht die Listener um", () => {
    const other = document.createElement("div");
    document.body.appendChild(other);
    other.getBoundingClientRect = makeRect;
    mgr.attach(other);
    fire("pointerdown", { type: "mouse" }, root);
    expect(step().jumpPressed).toBe(false);
    fire("pointerup", { type: "mouse" }, root);
    fire("pointerdown", { id: 2, type: "mouse" }, other);
    expect(step().jumpPressed).toBe(true);
    other.remove();
  });
});

describe("discardEdges (feel-core-06)", () => {
  it("verwirft Flanken, behält gehaltene Zustände", () => {
    key("keydown", "Space");
    key("keydown", "ArrowDown");
    key("keydown", "ShiftLeft");
    mgr.discardEdges();
    const o = step();
    expect(o.jumpPressed).toBe(false);
    expect(o.slidePressed).toBe(false);
    expect(o.dashPressed).toBe(false);
    expect(o.jump).toBe(true);
    expect(o.slide).toBe(true);
  });

  it("räumt wartenden Touch-Sprung (Finger bleibt gehalten, kein Sprung später)", () => {
    fire("pointerdown");
    mgr.discardEdges();
    t = 100;
    const o = step();
    expect(o.jumpPressed).toBe(false);
    expect(o.jump).toBe(true);
  });

  it("nach discardEdges funktionieren neue Eingaben normal", () => {
    key("keydown", "Space");
    mgr.discardEdges();
    key("keyup", "Space");
    key("keydown", "Space");
    expect(step().jumpPressed).toBe(true);
  });
});

describe("Sprung-Assistent (comfort-a11y-07)", () => {
  /** Tipp von 60 ms: Anzahl Schritte mit jump=true und letzter Zeitpunkt (s). */
  function tap(): { held: number; lastJump: number; edges: number } {
    let held = 0;
    let lastJump = 0;
    let edges = 0;
    const tapSteps = Math.round(0.06 / FIXED_DT);
    for (let i = 0; i < Math.round(0.6 / FIXED_DT); i += 1) {
      if (i === 0) key("keydown", "Space");
      if (i === tapSteps) key("keyup", "Space");
      const o = step();
      if (o.jumpPressed) edges += 1;
      if (o.jump) {
        held += 1;
        lastJump = (i + 1) * FIXED_DT;
      }
    }
    return { held, lastJump, edges };
  }

  it("ohne Assistent: jump nur während des Tippens (60 ms)", () => {
    const r = tap();
    expect(r.edges).toBe(1);
    expect(r.lastJump).toBeLessThanOrEqual(0.07);
  });

  it("mit Assistent: jump bleibt bis 0,38 s", () => {
    mgr.setJumpAssist(true);
    const r = tap();
    expect(r.edges).toBe(1);
    expect(r.lastJump).toBeGreaterThanOrEqual(JUMP_ASSIST_S - 2 * FIXED_DT);
    expect(r.lastJump).toBeLessThanOrEqual(JUMP_ASSIST_S + 2 * FIXED_DT);
  });

  it("Doppelsprung-Flanke bleibt separat und verlängert das Halten", () => {
    mgr.setJumpAssist(true);
    key("keydown", "Space");
    expect(step().jumpPressed).toBe(true);
    key("keyup", "Space");
    for (let i = 0; i < 20; i += 1) {
      const o = step();
      expect(o.jumpPressed).toBe(false);
      expect(o.jump).toBe(true);
    }
    key("keydown", "Space");
    const second = step();
    expect(second.jumpPressed).toBe(true);
    key("keyup", "Space");
    // Fenster beginnt neu: nach weiteren 0,3 s noch gehalten
    for (let i = 0; i < Math.round(0.3 / FIXED_DT); i += 1) expect(step().jump).toBe(true);
  });

  it("aus ist der Standard; Ausschalten beendet ein laufendes Fenster", () => {
    key("keydown", "Space");
    key("keyup", "Space");
    expect(step().jump).toBe(false);
    mgr.setJumpAssist(true);
    key("keydown", "Space");
    key("keyup", "Space");
    expect(step().jump).toBe(true);
    mgr.setJumpAssist(false);
    expect(step().jump).toBe(false);
  });

  it("wirkt auch für Touch rechts und Gamepad", () => {
    mgr.setJumpAssist(true);
    fire("pointerdown", { x: 800, y: 200 });
    expect(step().jumpPressed).toBe(true);
    fire("pointerup", { x: 800, y: 200 });
    expect(step().jump).toBe(true);
    for (let i = 0; i < Math.round(0.45 / FIXED_DT); i += 1) step();
    expect(step().jump).toBe(false);

    const pad = padWith([0]);
    pads = [pad];
    installPads();
    mgr.enabled = true;
    mgr.poll();
    const o = step();
    expect(o.jumpPressed).toBe(true);
    pads = [padWith([])];
    mgr.poll();
    expect(step().jump).toBe(true);
  });

  /** Scheitelhöhe (px) eines Sprungs mit den Eingaben des Managers in einer echten Sim. */
  function apex(tapSeconds: number, assist: boolean): number {
    const m = new InputManager({ clock: () => 0 });
    m.attach(root);
    m.enabled = true;
    m.setJumpAssist(assist);
    const s = new Sim({ mode: "world", world: "wien", character: "fred", seed: 1234 }, WORLDS);
    s.begin();
    s.noSpawn = true;
    s.ents = [];
    for (let i = 0; i < 60; i += 1) s.step(FIXED_DT, m.consume(FIXED_DT));
    expect(s.player.grounded).toBe(true);
    const n = Math.round(1 / FIXED_DT);
    const releaseAt = Math.round(tapSeconds / FIXED_DT);
    let max = 0;
    for (let i = 0; i < n; i += 1) {
      if (i === 0) key("keydown", "Space");
      if (i === releaseAt) key("keyup", "Space");
      s.step(FIXED_DT, m.consume(FIXED_DT));
      max = Math.max(max, s.player.hgt);
      s.ents = [];
    }
    key("keyup", "Space");
    m.detach();
    return max;
  }

  it("Integration mit Sim: Scheitelhöhe nach Tipp mit Assistent = nach 0,4 s Halten (±3 %)", () => {
    const held = apex(0.4, false);
    const assisted = apex(0.06, true);
    const plain = apex(0.06, false);
    expect(held).toBeGreaterThan(200);
    expect(Math.abs(assisted - held) / held).toBeLessThan(0.03);
    // ohne Assistent bleibt das Tippen deutlich niedriger
    expect(plain).toBeLessThan(held * 0.6);
  });
});

describe("Mehrere Sprungtasten und Zeiger (feel-core-05)", () => {
  it("Leertaste gehalten + Pfeil hoch: zweite Flanke (Doppelsprung)", () => {
    key("keydown", "Space");
    expect(step().jumpPressed).toBe(true);
    key("keydown", "ArrowUp");
    const o = step();
    expect(o.jumpPressed).toBe(true);
    expect(o.jump).toBe(true);
  });

  it("Tasten-Wiederholung erzeugt keine Flanke", () => {
    key("keydown", "Space");
    expect(step().jumpPressed).toBe(true);
    key("keydown", "Space", true);
    key("keydown", "Space", true);
    expect(step().jumpPressed).toBe(false);
    // auch ein doppeltes keydown ohne repeat-Flag derselben gehaltenen Taste nicht
    key("keydown", "Space");
    expect(step().jumpPressed).toBe(false);
  });

  it("zweiter Zeiger erzeugt eine Flanke, auch bei gehaltenem ersten", () => {
    fire("pointerdown", { id: 1, type: "mouse", x: 700 });
    expect(step().jumpPressed).toBe(true);
    fire("pointerdown", { id: 2, type: "touch", x: 800 });
    expect(step().jumpPressed).toBe(true);
    fire("pointerdown", { id: 3, type: "touch", x: 900 });
    expect(step().jumpPressed).toBe(true);
  });

  it("Taste gehalten + zweiter Finger: Flanke", () => {
    key("keydown", "Space");
    step();
    fire("pointerdown", { id: 5, x: 800 });
    expect(step().jumpPressed).toBe(true);
  });

  it("nach Loslassen aller Tasten löst jede Taste wieder eine Flanke aus", () => {
    key("keydown", "Space");
    step();
    key("keyup", "Space");
    key("keydown", "KeyW");
    expect(step().jumpPressed).toBe(true);
  });
});

describe("Zeigerart (visuals-ui-04)", () => {
  it("meldet nur beim Wechsel: touch einmal, dann mouse, dann pen", () => {
    const calls: PointerKind[] = [];
    mgr.onPointerKind = (k) => calls.push(k);
    fire("pointerdown", { id: 1, type: "touch", x: 800 });
    fire("pointerup", { id: 1, type: "touch", x: 800 });
    fire("pointerdown", { id: 2, type: "touch", x: 810 });
    fire("pointerup", { id: 2, type: "touch", x: 810 });
    expect(calls).toEqual(["touch"]);
    fire("pointerdown", { id: 3, type: "mouse", x: 800 });
    fire("pointerup", { id: 3, type: "mouse", x: 800 });
    fire("pointerdown", { id: 4, type: "mouse", x: 800 });
    expect(calls).toEqual(["touch", "mouse"]);
    fire("pointerdown", { id: 5, type: "pen", x: 800 });
    expect(calls).toEqual(["touch", "mouse", "pen"]);
    fire("pointerdown", { id: 6, type: "touch", x: 800 });
    expect(calls).toEqual(["touch", "mouse", "pen", "touch"]);
  });

  it("auch ein Tap auf ein Ausschluss-Element (button) und bei enabled=false meldet die Art", () => {
    const calls: PointerKind[] = [];
    mgr.onPointerKind = (k) => calls.push(k);
    const b = document.createElement("button");
    root.appendChild(b);
    fire("pointerdown", { type: "touch" }, b);
    expect(calls).toEqual(["touch"]);
    expect(step().jumpPressed).toBe(false);
    mgr.enabled = false;
    fire("pointerdown", { id: 2, type: "mouse" }, b);
    expect(calls).toEqual(["touch", "mouse"]);
  });

  it("ohne Callback kein Fehler; unbekannte Art wird ignoriert", () => {
    expect(() => fire("pointerdown", { type: "touch" })).not.toThrow();
    const calls: PointerKind[] = [];
    mgr.onPointerKind = (k) => calls.push(k);
    fire("pointerdown", { id: 2, type: "touch" });
    expect(calls).toEqual([]); // „touch“ war schon bekannt
    target().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 9, pointerType: "" }));
    expect(calls).toEqual([]);
  });

  function target(): HTMLElement {
    return stage;
  }
});

// --- Gamepad -----------------------------------------------------------------

let pads: (Gamepad | null)[] = [];

function installPads(): void {
  Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => pads });
}

function padWith(pressed: number[], axes: number[] = [0, 0, 0, 0], extra: Record<string, unknown> = {}): Gamepad {
  const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), touched: false, value: pressed.includes(i) ? 1 : 0 }));
  return { connected: true, buttons, axes, ...extra } as unknown as Gamepad;
}

describe("Gamepad-Navigation (comfort-a11y-04)", () => {
  let navs: NavDir[];
  beforeEach(() => {
    navs = [];
    mgr.onNav = (d) => navs.push(d);
    mgr.enabled = false;
    pads = [];
    installPads();
  });

  it("D-Pad rechts: genau einmal je Flanke, erneut nach Loslassen", () => {
    pads = [padWith([15])];
    mgr.poll();
    mgr.poll();
    mgr.poll();
    expect(navs).toEqual(["right"]);
    pads = [padWith([])];
    mgr.poll();
    pads = [padWith([15])];
    mgr.poll();
    expect(navs).toEqual(["right", "right"]);
  });

  it("alle vier Richtungen vom D-Pad", () => {
    for (const [btn, dir] of [
      [12, "up"],
      [13, "down"],
      [14, "left"],
      [15, "right"],
    ] as const) {
      navs.length = 0;
      pads = [padWith([btn])];
      mgr.poll();
      pads = [padWith([])];
      mgr.poll();
      expect(navs).toEqual([dir]);
    }
  });

  it("A = confirm, B = back, je einmal pro Flanke", () => {
    pads = [padWith([0])];
    mgr.poll();
    mgr.poll();
    expect(navs).toEqual(["confirm"]);
    pads = [padWith([1])];
    mgr.poll();
    mgr.poll();
    expect(navs).toEqual(["confirm", "back"]);
  });

  it("während enabled===true wird nichts gesendet", () => {
    mgr.enabled = true;
    pads = [padWith([0, 15])];
    mgr.poll();
    pads = [padWith([1, 12])];
    mgr.poll();
    pads = [padWith([], [0.9, 0])];
    mgr.poll();
    expect(navs).toEqual([]);
  });

  it("beim Wechsel zu enabled=false gehaltene A/Richtung löst erst nach dem Loslassen aus", () => {
    mgr.enabled = true;
    pads = [padWith([0, 13])];
    mgr.poll();
    mgr.enabled = false;
    t += 5000;
    mgr.poll();
    mgr.poll();
    expect(navs).toEqual([]);
    pads = [padWith([])];
    mgr.poll();
    pads = [padWith([0])];
    mgr.poll();
    expect(navs).toEqual(["confirm"]);
  });

  it("linker Stick: Deadzone 0,5, dominante Achse", () => {
    pads = [padWith([], [0.45, 0])];
    mgr.poll();
    expect(navs).toEqual([]);
    pads = [padWith([], [0.6, 0.1])];
    mgr.poll();
    expect(navs).toEqual(["right"]);
    pads = [padWith([], [0, 0])];
    mgr.poll();
    pads = [padWith([], [-0.3, -0.9])];
    mgr.poll();
    pads = [padWith([], [0, 0])];
    mgr.poll();
    pads = [padWith([], [-0.8, 0.2])];
    mgr.poll();
    pads = [padWith([], [0, 0])];
    mgr.poll();
    pads = [padWith([], [0.2, 0.7])];
    mgr.poll();
    expect(navs).toEqual(["right", "up", "left", "down"]);
  });

  it("gehaltene Richtung wiederholt nach 350 ms", () => {
    expect(NAV_REPEAT_MS).toBe(350);
    pads = [padWith([13])];
    mgr.poll();
    t = 349;
    mgr.poll();
    expect(navs).toEqual(["down"]);
    t = 350;
    mgr.poll();
    expect(navs).toEqual(["down", "down"]);
    t = 351;
    mgr.poll();
    expect(navs).toEqual(["down", "down"]);
    t = 700;
    mgr.poll();
    expect(navs).toEqual(["down", "down", "down"]);
  });

  it("Richtungswechsel löst sofort aus, confirm wiederholt nicht", () => {
    pads = [padWith([13])];
    mgr.poll();
    t = 100;
    pads = [padWith([12])];
    mgr.poll();
    expect(navs).toEqual(["down", "up"]);
    pads = [padWith([0])];
    mgr.poll();
    t = 2000;
    mgr.poll();
    expect(navs).toEqual(["down", "up", "confirm"]);
  });

  it("Start sendet keine Navigation (Pause bleibt über den Listener)", () => {
    const onPause = vi.fn();
    mgr.listener = { onPause };
    pads = [padWith([9])];
    mgr.poll();
    expect(navs).toEqual([]);
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it("ohne Callback und ohne Gamepad-API kein Fehler", () => {
    mgr.onNav = null;
    pads = [padWith([0, 15])];
    expect(() => mgr.poll()).not.toThrow();
    Reflect.deleteProperty(navigator, "getGamepads");
    expect(() => mgr.poll()).not.toThrow();
  });

  it("Spielverhalten bleibt: A springt, B rutscht, X dasht", () => {
    mgr.enabled = true;
    pads = [padWith([0])];
    mgr.poll();
    expect(step().jumpPressed).toBe(true);
    pads = [padWith([1])];
    mgr.poll();
    const o = step();
    expect(o.slidePressed).toBe(true);
    pads = [padWith([2])];
    mgr.poll();
    expect(step().dashPressed).toBe(true);
  });
});

describe("rumble", () => {
  it("wirft nicht ohne Gamepad-API, Gamepad oder vibrationActuator", () => {
    expect(() => mgr.rumble(1, 100)).not.toThrow();
    installPads();
    pads = [];
    expect(() => mgr.rumble(1, 100)).not.toThrow();
    pads = [null, padWith([])];
    expect(() => mgr.rumble(1, 100)).not.toThrow();
  });

  it("spielt dual-rumble mit begrenzten Werten", () => {
    const playEffect = vi.fn(() => Promise.resolve("complete"));
    installPads();
    pads = [padWith([], [0, 0], { vibrationActuator: { playEffect } })];
    mgr.rumble(0.8, 120);
    expect(playEffect).toHaveBeenCalledTimes(1);
    const args = playEffect.mock.calls[0] as unknown as [string, { duration: number; strongMagnitude: number; weakMagnitude: number }];
    expect(args[0]).toBe("dual-rumble");
    expect(args[1].duration).toBe(120);
    expect(args[1].strongMagnitude).toBeCloseTo(0.8);
    expect(args[1].weakMagnitude).toBeGreaterThan(0);
    expect(args[1].weakMagnitude).toBeLessThan(0.8);
    mgr.rumble(5, 99999);
    const big = playEffect.mock.calls[1] as unknown as [string, { duration: number; strongMagnitude: number }];
    expect(big[1].strongMagnitude).toBe(1);
    expect(big[1].duration).toBeLessThanOrEqual(5000);
  });

  it("schluckt Fehler und abgelehnte Promises", async () => {
    installPads();
    const rejecting = vi.fn(() => Promise.reject(new Error("nein")));
    pads = [padWith([], [0, 0], { vibrationActuator: { playEffect: rejecting } })];
    expect(() => mgr.rumble(1, 50)).not.toThrow();
    const throwing = vi.fn(() => {
      throw new Error("kaputt");
    });
    pads = [padWith([], [0, 0], { vibrationActuator: { playEffect: throwing } })];
    expect(() => mgr.rumble(1, 50)).not.toThrow();
    await Promise.resolve();
  });
});
