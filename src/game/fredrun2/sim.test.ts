import { describe, expect, it } from "vitest";
import { FIXED_DT, JUMP_HEIGHT, METERS_PER_DIFFICULTY, PLAYER_SX, PX_PER_METER } from "./constants";
import { NO_INPUT, Sim, type SimInput } from "./sim";
import { WORLDS } from "./worlds";
import type { CharacterId, RunConfig, WorldId } from "./types";

function makeSim(over: Partial<RunConfig> = {}): Sim {
  const s = new Sim({ mode: "world", world: "wien", character: "fred", seed: 1234, ...over }, WORLDS);
  s.begin();
  return s;
}

/** Leere, feste Prüfstrecke (kein Nachspawnen, gleichmäßiges Tempo wie bei Schwierigkeit `diff`). */
function lab(diff = 3, over: Partial<RunConfig> = {}): Sim {
  const s = makeSim({ startMeters: diff * METERS_PER_DIFFICULTY, ...over });
  s.noSpawn = true;
  s.ents = [];
  s.speed = s.speedAtDiff(diff);
  s.player.hearts = 3;
  s.player.energy = 100;
  return s;
}

const inp = (o: Partial<SimInput> = {}): SimInput => ({ jump: false, jumpPressed: false, slide: false, slidePressed: false, dashPressed: false, ...o });

/** Eingabe-Schritte (Anzahl) laufen lassen und alle Ereignisse mit Zeitstempel sammeln. */
function runLog(sim: Sim, steps: number, f: (i: number) => SimInput = () => NO_INPUT): Array<{ t: number; type: string; value?: number }> {
  const log: Array<{ t: number; type: string; value?: number }> = [];
  for (let i = 0; i < steps; i += 1) {
    sim.step(FIXED_DT, f(i));
    for (const e of sim.events) log.push({ t: sim.time, type: e.type, value: e.value });
    sim.events.length = 0;
  }
  return log;
}

function run(sim: Sim, seconds: number, input: (t: number) => SimInput = () => NO_INPUT): void {
  const n = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < n; i += 1) sim.step(FIXED_DT, input(i * FIXED_DT));
}

describe("Sim: Grundphysik", () => {
  it("läuft vorwärts und beschleunigt", () => {
    const s = makeSim();
    const d0 = s.dist;
    run(s, 2);
    expect(s.dist).toBeGreaterThan(d0 + 600);
    expect(s.speed).toBeGreaterThan(300);
  });

  it("Sprung erreicht ≈ JUMP_HEIGHT und landet wieder", () => {
    const s = makeSim();
    // Hindernisse ausblenden, Isolierter Test
    s.ents = [];
    (s.spawner as unknown as { cursor: number }).cursor = 1e9;
    let maxH = 0;
    run(s, 1.6, (t) => ({ jump: t < 0.7, jumpPressed: t < FIXED_DT, slide: false, slidePressed: false, dashPressed: false }));
    s.ents = [];
    s.player.hgt = 0;
    s.player.grounded = true;
    s.player.vy = 0;
    s.player.jumpsUsed = 0;
    for (let i = 0; i < 240; i += 1) {
      s.step(FIXED_DT, { jump: true, jumpPressed: i === 0, slide: false, slidePressed: false, dashPressed: false });
      maxH = Math.max(maxH, s.player.hgt);
      s.ents = s.ents.filter((e) => e.kind === "pickup" || e.kind === "decor");
    }
    expect(maxH).toBeGreaterThan(JUMP_HEIGHT * 0.9);
    expect(maxH).toBeLessThan(JUMP_HEIGHT * 1.45);
    expect(s.player.grounded).toBe(true);
  });

  it("Doppelsprung nur einmal in der Luft", () => {
    const s = makeSim();
    s.ents = [];
    (s.spawner as unknown as { cursor: number }).cursor = 1e9;
    s.step(FIXED_DT, { jump: true, jumpPressed: true, slide: false, slidePressed: false, dashPressed: false });
    run(s, 0.2, () => ({ jump: true, jumpPressed: false, slide: false, slidePressed: false, dashPressed: false }));
    s.step(FIXED_DT, { jump: true, jumpPressed: true, slide: false, slidePressed: false, dashPressed: false });
    expect(s.player.jumpsUsed).toBe(2);
    const events = s.events.filter((e) => e.type === "doublejump");
    expect(events.length).toBe(1);
  });

  it("ist deterministisch bei gleichem Seed", () => {
    const a = makeSim({ seed: 42 });
    const b = makeSim({ seed: 42 });
    run(a, 5);
    run(b, 5);
    expect(a.ents.map((e) => [e.kind, Math.round(e.x)])).toEqual(b.ents.map((e) => [e.kind, Math.round(e.x)]));
  });

  it("Treffer kostet ein Herz, danach Unverwundbarkeit", () => {
    const s = makeSim();
    s.ents = [];
    (s.spawner as unknown as { cursor: number }).cursor = 1e9;
    const px = s.playerWorldX;
    s.spawn({ kind: "block", skin: "crate", x: px + 80, y: s.groundY - 80, w: 60, h: 80, harmful: true }, 0);
    const h0 = s.player.hearts;
    run(s, 0.6);
    expect(s.player.hearts).toBe(h0 - 1);
    expect(s.player.invuln).toBeGreaterThan(0.5);
  });

  it("Rutschen kommt unter Überkopf-Hindernissen durch, Stehen nicht", () => {
    const sA = makeSim();
    sA.ents = [];
    (sA.spawner as unknown as { cursor: number }).cursor = 1e9;
    sA.spawn({ kind: "overhead", skin: "bar", x: sA.playerWorldX + 200, y: sA.groundY - 72 - 260, w: 240, h: 260, harmful: true, hb: [0, 0, 240, 256] }, 0);
    const hearts = sA.player.hearts;
    run(sA, 1.5, (t) => ({ jump: false, jumpPressed: false, slide: t > 0.1 && t < 1.4, slidePressed: t > 0.1 && t < 0.1 + FIXED_DT * 1.5, dashPressed: false }));
    expect(sA.player.hearts).toBe(hearts);
    const sB = makeSim();
    sB.ents = [];
    (sB.spawner as unknown as { cursor: number }).cursor = 1e9;
    sB.spawn({ kind: "overhead", skin: "bar", x: sB.playerWorldX + 200, y: sB.groundY - 72 - 260, w: 240, h: 260, harmful: true, hb: [0, 0, 240, 256] }, 0);
    run(sB, 1.5);
    expect(sB.player.hearts).toBe(hearts - 1);
  });

  it("sammelt Münzen und vergibt Punkte", () => {
    const s = makeSim();
    s.ents = [];
    (s.spawner as unknown as { cursor: number }).cursor = 1e9;
    for (let i = 0; i < 5; i += 1) s.spawn({ kind: "pickup", pickup: "coin", skin: "coin", x: s.playerWorldX + 100 + i * 50, y: s.groundY - 80, w: 34, h: 34 }, 0);
    run(s, 1);
    expect(s.stats.coins).toBe(5);
    expect(s.bonus).toBeGreaterThan(40);
  });

  it("Gegner werden durch Draufspringen besiegt", () => {
    const s = makeSim();
    s.ents = [];
    (s.spawner as unknown as { cursor: number }).cursor = 1e9;
    s.spawn({ kind: "walker", skin: "w", x: s.playerWorldX + 380, y: s.groundY - 80, w: 56, h: 80, stompable: true, harmful: true }, 0);
    const hearts = s.player.hearts;
    // Sprung so timen, dass Landung auf Gegner erfolgt: einfach mit Bot-Idee → hier stampfen aus der Luft
    run(s, 1.2, (t) => ({ jump: t < 0.3, jumpPressed: t > 0.15 && t < 0.15 + FIXED_DT * 1.5, slide: t > 0.35, slidePressed: t > 0.35 && t < 0.35 + FIXED_DT * 1.5, dashPressed: false }));
    expect(s.player.hearts).toBeGreaterThanOrEqual(hearts - 1);
  });

  it("in einer Lücke kann man nicht endlos springen (kein Luft-Springen nach Coyote-Time)", () => {
    const s = makeSim();
    s.ents = [];
    (s.spawner as unknown as { cursor: number }).cursor = 1e9;
    s.spawn({ kind: "pit", skin: "pit", x: s.playerWorldX - 100, y: s.groundY, w: 900, h: 200 }, 0);
    run(s, 0.2); // fällt in die Lücke, Coyote abgelaufen
    expect(s.player.grounded).toBe(false);
    expect(s.player.hgt).toBeLessThan(0);
    const hearts = s.player.hearts;
    // wildes Springen darf nicht dauerhaft tragen
    run(s, 1.2, (t) => ({ jump: true, jumpPressed: Math.floor(t * 8) !== Math.floor((t - FIXED_DT) * 8), slide: false, slidePressed: false, dashPressed: false }));
    expect(s.player.hearts).toBe(hearts - 1);
  });

  it("Meter-Umrechnung", () => {
    const s = makeSim({ startMeters: 100 });
    expect(s.meters).toBeCloseTo(100, 0);
    expect(PLAYER_SX).toBeGreaterThan(0);
    expect(PX_PER_METER).toBe(60);
  });

  it("alle Charaktere und Welten starten fehlerfrei", () => {
    const chars: CharacterId[] = ["fred", "frida", "superfred", "cyberfred", "superfrida"];
    const worlds = Object.keys(WORLDS) as WorldId[];
    for (const c of chars) {
      for (const w of worlds) {
        const s = makeSim({ character: c, world: w });
        run(s, 1);
        expect(s.phase).toBe("running");
      }
    }
  });
});

describe("Sim: Sprungbrett und Startverzögerung", () => {
  const held = (jump: boolean): SimInput => ({ jump, jumpPressed: false, slide: false, slidePressed: false, dashPressed: false });

  function springApex(holdJump: boolean): number {
    const s = makeSim();
    s.ents = [];
    (s.spawner as unknown as { cursor: number }).cursor = 1e9;
    s.spawn({ kind: "spring", skin: "spring", x: s.playerWorldX - 10, y: s.groundY - 30, w: 60, h: 30 }, 0);
    let apex = 0;
    for (let i = 0; i < 180; i += 1) {
      s.step(FIXED_DT, held(holdJump));
      apex = Math.max(apex, s.player.hgt);
    }
    return apex;
  }

  it("Sprungbrett-Bounce hat immer volle Höhe – auch ohne gehaltene Sprungtaste", () => {
    const released = springApex(false);
    const holding = springApex(true);
    expect(released).toBeGreaterThan(380); // ≈ SPRING_V² / (2·g) ≈ 417 px, früher nur ≈ 256 px
    expect(Math.abs(released - holding)).toBeLessThan(25);
  });

  it("nach dem Bounce gilt die variable Sprunghöhe wieder (noCut wird am Scheitel zurückgesetzt)", () => {
    const s = makeSim();
    s.ents = [];
    (s.spawner as unknown as { cursor: number }).cursor = 1e9;
    s.spawn({ kind: "spring", skin: "spring", x: s.playerWorldX - 10, y: s.groundY - 30, w: 60, h: 30 }, 0);
    for (let i = 0; i < 400 && !(s.player.hgt > 100); i += 1) s.step(FIXED_DT, held(false));
    expect(s.player.noCut).toBe(true);
    for (let i = 0; i < 400 && !s.player.grounded; i += 1) s.step(FIXED_DT, held(false));
    expect(s.player.grounded).toBe(true);
    expect(s.player.noCut).toBe(false);
  });

  it("Entität mit p.delay ruht und ist harmlos, bis die Zeit um ist – dann fliegt sie los", () => {
    const s = makeSim();
    s.ents = [];
    (s.spawner as unknown as { cursor: number }).cursor = 1e9;
    const x0 = s.playerWorldX + 600;
    const e = s.spawn({ kind: "projectile", skin: "cork", x: x0, y: s.groundY - 200, w: 30, h: 20, harmful: true, vx: -500, p: { delay: 0.5 } }, 0);
    run(s, 0.4);
    expect(e.x).toBeCloseTo(x0, 5); // ruht in der Welt (scrollt nur mit dem Boden mit)
    run(s, 0.4); // 0.8 s: nach 0.5 s Start
    expect(e.x).toBeLessThan(x0 - 100);
  });

  it("wartende Entität verletzt nicht, auch wenn sie die Figur überdeckt", () => {
    const s = makeSim();
    s.ents = [];
    (s.spawner as unknown as { cursor: number }).cursor = 1e9;
    const hearts = s.player.hearts;
    s.spawn({ kind: "block", skin: "crate", x: s.playerWorldX - 20, y: s.groundY - 80, w: 60, h: 80, harmful: true, p: { delay: 0.3 } }, 0);
    run(s, 0.12);
    expect(s.player.hearts).toBe(hearts);
  });
});

/** Kompletter Sim-Zustand als Text (ohne die reinen Darstellungsfelder px/py) – für Determinismus-Vergleiche. */
function stateKey(sim: Sim): string {
  const player = { ...sim.player, onPlatform: sim.player.onPlatform?.id ?? null };
  const o = { time: sim.time, dist: sim.dist, speed: sim.speed, bonus: sim.bonus, combo: sim.combo, stats: sim.stats, player, vars: sim.vars, ents: sim.ents };
  return JSON.stringify(o, (k, v) => (k === "px" || k === "py" ? undefined : v));
}

describe("Sim: Darstellungs-Interpolation (px/py, view.alpha/time)", () => {
  const scripted = (t: number): SimInput => {
    const ph = t % 1.7;
    return { jump: ph < 0.3, jumpPressed: ph < FIXED_DT, slide: ph > 0.9 && ph < 1.2, slidePressed: ph > 0.9 && ph < 0.9 + FIXED_DT, dashPressed: ph > 1.5 && ph < 1.5 + FIXED_DT };
  };

  it("px/py sind reine Darstellungsfelder: ohne sie bleibt der Sim-Zustand bitgleich (3 Seeds, 3 Welten, 30 s)", { timeout: 60_000 }, () => {
    for (const world of ["wien", "prater", "cyber"] as WorldId[]) {
      for (const seed of [11, 42, 777]) {
        const a = makeSim({ world, seed });
        const b = makeSim({ world, seed });
        a.player.hearts = 99;
        b.player.hearts = 99;
        const n = Math.round(30 / FIXED_DT);
        for (let i = 0; i < n; i += 1) {
          // Variante b: px/py werden vor jedem Schritt gelöscht – die Logik darf sie nie lesen
          for (const e of b.ents) {
            delete e.px;
            delete e.py;
          }
          a.step(FIXED_DT, scripted(i * FIXED_DT));
          b.step(FIXED_DT, scripted(i * FIXED_DT));
          a.events.length = 0;
          b.events.length = 0;
          if (i % 600 === 599) expect(stateKey(b)).toBe(stateKey(a));
        }
        expect(stateKey(b)).toBe(stateKey(a));
      }
    }
  });

  it("spawn() setzt px/py auf die Startposition, updateEntities() auf die Position vor dem Schritt", () => {
    const s = makeSim();
    s.ents = [];
    (s.spawner as unknown as { cursor: number }).cursor = 1e9;
    const e = s.spawn({ kind: "walker", skin: "w", x: 500, y: s.groundY - 80, w: 56, h: 80, vx: -300, harmful: true }, 100);
    expect(e.px).toBe(600);
    expect(e.py).toBe(s.groundY - 80);
    const x0 = e.x;
    s.step(FIXED_DT, NO_INPUT);
    expect(e.px).toBe(x0);
    expect(e.x).toBeCloseTo(x0 - 300 * FIXED_DT, 6);
    // Gegner mit Eigenbewegung: interpolierte Position liegt zwischen px und x
    const mid = (e.px as number) + (e.x - (e.px as number)) * 0.5;
    expect(mid).toBeLessThan(e.px as number);
    expect(mid).toBeGreaterThan(e.x);
  });

  it("view(alpha): alpha wird durchgereicht, time ist stetig in alpha und nie negativ", () => {
    const s = makeSim();
    const prev = { dist: s.dist, hgt: s.player.hgt };
    // Erster Schritt: sim.time == FIXED_DT, alpha 0 ergäbe sonst 0 – nie negativ
    s.step(FIXED_DT, NO_INPUT);
    expect(s.view(0, prev, false, 2, FIXED_DT).time).toBeGreaterThanOrEqual(0);
    expect(s.view(0, prev, false, 2, FIXED_DT).time).toBeCloseTo(0, 9);
    expect(s.view(1, prev, false, 2, FIXED_DT).time).toBeCloseTo(s.time, 9);
    run(s, 1);
    let last = -1;
    for (let k = 0; k <= 20; k += 1) {
      const a = k / 20;
      const v = s.view(a, prev, false, 2, FIXED_DT);
      expect(v.alpha).toBe(a);
      expect(v.time).toBeGreaterThanOrEqual(0);
      expect(v.time).toBeGreaterThanOrEqual(last); // monoton steigend, ohne Sprung (linear)
      if (last >= 0) expect(v.time - last).toBeCloseTo(FIXED_DT / 20, 9);
      last = v.time;
    }
    expect(s.view(1, prev, false, 2, FIXED_DT).time).toBeCloseTo(s.time, 9);
    // Zeit vor dem allerersten Schritt (Phase ready bzw. time 0): geklemmt
    const fresh = new Sim({ mode: "world", world: "wien", character: "fred", seed: 5 }, WORLDS);
    expect(fresh.view(0, { dist: fresh.dist, hgt: 0 }, false, 2, FIXED_DT).time).toBe(0);
  });
});

describe("Sim: Near-Miss nur ohne Berührung (feel-core-04)", () => {
  it("Treffer durch einen Block: kein „Knapp!“, Kombo bleibt 1", () => {
    const s = lab();
    s.spawn({ kind: "block", skin: "crate", x: s.playerWorldX + 150, y: s.groundY - 70, w: 70, h: 70, harmful: true }, 0);
    const log = runLog(s, Math.round(2 / FIXED_DT));
    expect(s.stats.hurts).toBe(1);
    expect(s.stats.nearMisses).toBe(0);
    expect(s.combo).toBe(1);
    expect(log.some((e) => e.type === "near-miss" || e.type === "combo-up")).toBe(false);
    expect(s.bonus).toBe(0);
  });

  it("Treffer gibt keine Energie zurück (kein +9 „Knapp!“-Zuschuss nach dem Fehler)", () => {
    // Hintergrund: Der Bot der Welt-Tests rettete sich früher nach dem ersten Treffer mit genau diesem Zuschuss per Dash
    // (Alpen, Seed 3: 25 statt 34+ Energie am Baumstamm). Der Zuschuss ist der Exploit, den feel-core-04 abschafft.
    const play = (withBlock: boolean): Sim => {
      const s = lab();
      s.player.energy = 40; // weit unter ENERGY_MAX, ein Zuschuss wäre sichtbar
      if (withBlock) s.spawn({ kind: "block", skin: "crate", x: s.playerWorldX + 150, y: s.groundY - 70, w: 70, h: 70, harmful: true }, 0);
      runLog(s, Math.round(2 / FIXED_DT));
      return s;
    };
    const hit = play(true);
    const control = play(false);
    expect(hit.stats.hurts).toBe(1);
    expect(hit.stats.nearMisses).toBe(0);
    // Der Treffer darf die Energie nur gleich lassen oder senken – nie über die Kontrolle ohne Hindernis heben
    expect(hit.player.energy).toBeLessThanOrEqual(control.player.energy + 1e-9);
  });

  it("Dash durch 4 Blöcke: keine Near-Misses, Energie sinkt netto um die Dash-Kosten (keine Rückerstattung)", () => {
    const build = (): Sim => {
      const s = lab();
      s.player.energy = 60;
      for (let k = 0; k < 4; k += 1) s.spawn({ kind: "block", skin: "crate", x: s.playerWorldX + 220 + k * 150, y: s.groundY - 70, w: 60, h: 70, harmful: true }, 0);
      return s;
    };
    const s = build();
    runLog(s, Math.round(1.6 / FIXED_DT), (i) => inp({ dashPressed: i === 4 }));
    // Kontrolle: gleicher Dash ohne Blöcke → identische Energie (die Blöcke dürfen nichts zurückzahlen)
    const c = lab();
    c.player.energy = 60;
    runLog(c, Math.round(1.6 / FIXED_DT), (i) => inp({ dashPressed: i === 4 }));
    expect(s.stats.dashes).toBe(1);
    expect(s.stats.hurts).toBe(0);
    expect(s.stats.nearMisses).toBe(0);
    expect(s.combo).toBe(1);
    expect(s.bonus).toBe(0);
    expect(s.player.energy).toBeCloseTo(c.player.energy, 6);
    expect(s.player.energy).toBeLessThan(60 - s.perks.dashCost + 4); // netto ≈ −Kosten + etwas Regeneration, nicht +36
  });

  it("Schild-Treffer und Turbo-Flug durch ein Hindernis geben ebenfalls kein „Knapp!“", () => {
    const sh = lab();
    sh.player.shield = 5;
    sh.spawn({ kind: "block", skin: "crate", x: sh.playerWorldX + 150, y: sh.groundY - 70, w: 70, h: 70, harmful: true }, 0);
    runLog(sh, Math.round(1.5 / FIXED_DT));
    expect(sh.player.shield).toBe(0); // Schild hat den Treffer absorbiert
    expect(sh.stats.hurts).toBe(0);
    expect(sh.stats.nearMisses).toBe(0);

    const tu = lab();
    tu.player.turbo = 3;
    tu.player.invuln = 3;
    // hohe Wand quer durch die Flughöhe
    tu.spawn({ kind: "block", skin: "crate", x: tu.playerWorldX + 300, y: tu.groundY - 420, w: 80, h: 420, harmful: true }, 0);
    runLog(tu, Math.round(1.5 / FIXED_DT));
    expect(tu.stats.hurts).toBe(0);
    expect(tu.stats.nearMisses).toBe(0);
  });

  it("sauberer Sprung mit ≈10 px Abstand zählt weiter als Near-Miss", () => {
    const jumpIn = (i: number): SimInput => inp({ jump: i < 60, jumpPressed: i === 2 });
    // Probelauf ohne Hindernis: Scheitelpunkt (Füße am höchsten) und Weltposition dort
    const probe = lab();
    let apexFeet = Infinity;
    let apexX = 0;
    for (let i = 0; i < 140; i += 1) {
      probe.step(FIXED_DT, jumpIn(i));
      if (probe.feetY() < apexFeet) {
        apexFeet = probe.feetY();
        apexX = probe.playerWorldX;
      }
    }
    expect(probe.stats.hurts).toBe(0);
    // schmaler Block: Oberkante 5 px unter dem Scheitel-Fußpunkt → Abstand zur (um 5 px geschrumpften) Figurenbox ≈ 10 px
    const trial = (dy: number): Sim => {
      const s = lab();
      s.spawn({ kind: "block", skin: "crate", x: apexX - 6, y: apexFeet + dy, w: 12, h: 200, hb: [0, 0, 12, 200], harmful: true }, 0);
      runLog(s, 140, jumpIn);
      return s;
    };
    const clean = trial(5);
    expect(clean.stats.hurts).toBe(0);
    expect(clean.stats.nearMisses).toBe(1);
    // Kontrolle: 30 px tiefer liegender Block → mehr als 24 px Abstand → kein Near-Miss
    const far = trial(40);
    expect(far.stats.hurts).toBe(0);
    expect(far.stats.nearMisses).toBe(0);
    // Kontrolle: 20 px höher → Berührung → Treffer, aber kein Near-Miss
    const hit = trial(-20);
    expect(hit.stats.hurts).toBe(1);
    expect(hit.stats.nearMisses).toBe(0);
  });
});

describe("Sim: Sprung-Puffer über die Betäubungssperre (feel-core-05)", () => {
  /** Block trifft; `pressMs` nach dem Treffer wird Sprung gedrückt (Flanke + 0,4 s gehalten). */
  function hitThenPress(pressMs: number): { jumpT: number; stunAtJump: number; hitT: number; events: string[] } {
    const s = lab();
    s.spawn({ kind: "block", skin: "crate", x: s.playerWorldX + 60, y: s.groundY - 60, w: 60, h: 60, harmful: true }, 0);
    let hitT = -1;
    let pressT = -1;
    let jumpT = -1;
    let stunAtJump = -1;
    const events: string[] = [];
    for (let i = 0; i < Math.round(2 / FIXED_DT); i += 1) {
      const hearts = s.player.hearts;
      const press = hitT >= 0 && pressT < 0 && s.time >= hitT + pressMs / 1000;
      if (press) pressT = s.time;
      s.step(FIXED_DT, inp({ jump: pressT >= 0 && s.time < pressT + 0.4, jumpPressed: press }));
      for (const e of s.events) {
        events.push(e.type);
        if (e.type === "jump" && jumpT < 0 && pressT >= 0) {
          jumpT = s.time;
          stunAtJump = s.player.stun;
        }
      }
      s.events.length = 0;
      if (hitT < 0 && s.player.hearts < hearts) hitT = s.time;
    }
    return { jumpT: jumpT < 0 ? jumpT : jumpT - pressT, stunAtJump, hitT, events };
  }

  it("Druck 50 ms nach dem Treffer: Sprung feuert unmittelbar am Sperrenende (stun ≤ 0,25), geht nicht mehr verloren", () => {
    const r = hitThenPress(50);
    expect(r.hitT).toBeGreaterThan(0);
    expect(r.jumpT).toBeGreaterThan(0); // vorher: −1 (verloren)
    expect(r.stunAtJump).toBeLessThanOrEqual(0.25 + 1e-9);
    expect(r.stunAtJump).toBeGreaterThan(0.25 - 2 * FIXED_DT); // im allerersten Schritt nach der Sperre
  });

  it("auch Drücke direkt beim Treffer (0, 100, 150 ms) gehen nicht verloren; späte Drücke (≥ 250 ms) wie bisher", () => {
    for (const ms of [0, 100, 150, 200]) expect(hitThenPress(ms).jumpT).toBeGreaterThan(0);
    // Druck nach dem Sperrenende: Ausführung innerhalb eines Schritts (unverändert)
    const late = hitThenPress(300);
    expect(late.jumpT).toBeGreaterThan(0);
    expect(late.jumpT).toBeLessThan(2 * FIXED_DT);
  });

  it("Aktionen während der Sperre lösen weiterhin nichts aus (Dash, Rutschen, Stampfen)", () => {
    const s = lab();
    s.spawn({ kind: "block", skin: "crate", x: s.playerWorldX + 60, y: s.groundY - 60, w: 60, h: 60, harmful: true }, 0);
    // bis zum Treffer laufen
    for (let i = 0; i < 400 && s.player.stun <= 0; i += 1) s.step(FIXED_DT, NO_INPUT);
    s.events.length = 0;
    expect(s.player.stun).toBeGreaterThan(0.25);
    const dashes = s.stats.dashes;
    const log: string[] = [];
    // solange gesperrt: Dash + Rutschen drücken
    while (s.player.stun > 0.25 + FIXED_DT) {
      s.step(FIXED_DT, inp({ dashPressed: true, slidePressed: true, slide: true }));
      for (const e of s.events) log.push(e.type);
      s.events.length = 0;
    }
    expect(s.stats.dashes).toBe(dashes);
    expect(log.filter((t) => t === "dash" || t === "slide" || t === "stomp-start")).toEqual([]);
  });
});

describe("Sim: Rutsch-Puffer (feel-core-03)", () => {
  const hop = (i: number): SimInput => inp({ jump: i < 12, jumpPressed: i === 2 });

  /** Schritt-Index (0-basiert) der Landung eines kurzen Hüpfers ohne weitere Eingabe. */
  function landingStep(): number {
    const s = lab();
    let air = false;
    for (let i = 0; i < 200; i += 1) {
      s.step(FIXED_DT, hop(i));
      s.events.length = 0;
      if (!s.player.grounded) air = true;
      else if (air) return i;
    }
    throw new Error("keine Landung");
  }

  /** Hüpfer; ↓-Flanke `msBefore` ms vor der Landung (Taste danach losgelassen, außer `hold`). */
  function hopWithDown(msBefore: number, hold = false) {
    const L = landingStep();
    const press = L - Math.round(msBefore / (FIXED_DT * 1000));
    const s = lab();
    const types: string[] = [];
    let slidingAtLanding = false;
    for (let i = 0; i <= L + 1; i += 1) {
      s.step(FIXED_DT, { ...hop(i), slidePressed: i === press, slide: hold ? i >= press : i === press });
      for (const e of s.events) types.push(e.type);
      s.events.length = 0;
      if (i === L) slidingAtLanding = s.player.sliding;
    }
    return { s, types, slidingAtLanding, L };
  }

  it("↓ 60 ms vor der Landung (tief, fallend): rutscht nach der Landung, kein Stampfen", () => {
    for (const ms of [20, 60, 100]) {
      const r = hopWithDown(ms);
      expect(r.types).not.toContain("stomp-start");
      expect(r.types).toContain("slide");
      expect(r.slidingAtLanding).toBe(true); // schon im Landeschritt
      expect(r.s.player.sliding).toBe(true);
      expect(r.s.player.slideBuf).toBe(0); // verbraucht
    }
  });

  it("↓ hoch in der Luft (hgt > 75): Stampfen wie bisher", () => {
    const s = lab();
    const types: string[] = [];
    let pressed = false;
    for (let i = 0; i < 200 && !types.includes("stomp-land"); i += 1) {
      const press = !pressed && i > 10 && s.player.vy < 0 && s.player.hgt > 120;
      if (press) pressed = true;
      s.step(FIXED_DT, inp({ jump: i < 30, jumpPressed: i === 2, slidePressed: press }));
      for (const e of s.events) types.push(e.type);
      s.events.length = 0;
    }
    expect(pressed).toBe(true);
    expect(types).toContain("stomp-start");
    expect(types).toContain("stomp-land");
    expect(types).not.toContain("slide"); // Taste nicht gehalten → keine Rutsch-Landung
    expect(s.player.sliding).toBe(false);
  });

  it("aufwärts (vy > 0) bei niedriger Höhe: ↓ stampft weiterhin", () => {
    const s = lab();
    s.step(FIXED_DT, inp({ jump: true, jumpPressed: true }));
    s.step(FIXED_DT, inp({ jump: true }));
    expect(s.player.vy).toBeGreaterThan(0);
    expect(s.player.hgt).toBeLessThan(75);
    s.step(FIXED_DT, inp({ jump: true, slidePressed: true, slide: true }));
    expect(s.player.stomping).toBe(true);
  });

  it("↓ noch gehalten bei der Landung: rutscht (auch ohne Flanke kurz davor und nach einer Stampf-Landung)", () => {
    // gehalten seit mitten im Hüpfer (Flanke früh, hoch → Stampf), Landung bei gehaltener Taste
    const s = lab();
    const types: string[] = [];
    for (let i = 0; i < 120 && !(types.includes("stomp-land") && s.player.grounded); i += 1) {
      const t = i;
      s.step(FIXED_DT, inp({ jump: t < 30, jumpPressed: t === 2, slidePressed: t === 25, slide: t >= 25 }));
      for (const e of s.events) types.push(e.type);
      s.events.length = 0;
    }
    expect(types).toContain("stomp-start");
    expect(types).toContain("stomp-land");
    expect(types.indexOf("slide")).toBeGreaterThan(types.indexOf("stomp-land"));
    expect(s.player.sliding).toBe(true);

    // gehalten über den ganzen Hüpfer (kein Stampfen, da tief) → rutscht bei der Landung
    const r = hopWithDown(0, true);
    expect(r.types).toContain("slide");
    expect(r.s.player.sliding).toBe(true);
  });

  it("ohne ↓ rutscht die Landung nie; Puffer verfällt nach 0,16 s", () => {
    const L = landingStep();
    const s0 = lab();
    for (let i = 0; i <= L + 5; i += 1) s0.step(FIXED_DT, hop(i));
    expect(s0.player.sliding).toBe(false);
    // Aus 70 px Höhe im freien Fall dauert die Landung ≈ 0,23 s > 0,16 s: der Puffer ist dann verfallen
    const s = lab();
    s.player.grounded = false;
    s.player.jumpsUsed = 1;
    s.player.hgt = 70;
    s.player.vy = 0;
    s.step(FIXED_DT, inp({ slidePressed: true }));
    expect(s.player.slideBuf).toBeGreaterThan(0.15);
    expect(s.player.stomping).toBe(false);
    const types: string[] = [];
    for (let i = 0; i < 60; i += 1) {
      s.step(FIXED_DT, NO_INPUT);
      for (const e of s.events) types.push(e.type);
      s.events.length = 0;
    }
    expect(s.player.grounded).toBe(true);
    expect(types).not.toContain("slide");
    expect(s.player.sliding).toBe(false);
  });

  it("gepufferter Sprung hat Vorrang: Landung springt statt zu rutschen", () => {
    const L = landingStep();
    const s = lab();
    const types: string[] = [];
    for (let i = 0; i <= L + 4; i += 1) {
      if (i === 6) s.player.jumpsUsed = 2; // Doppelsprung verbraucht: der Druck in der Luft bleibt im Puffer
      const a = i === L - 5 ? { slidePressed: true } : {};
      const b = i === L - 3 ? { jumpPressed: true, jump: true } : {};
      s.step(FIXED_DT, { ...hop(i), ...a, ...b, slide: i === L - 5 });
      for (const e of s.events) types.push(e.type);
      s.events.length = 0;
    }
    expect(types.filter((t) => t === "jump")).toHaveLength(2); // Hüpfer + gepufferter Folgesprung bei der Landung
    expect(types).not.toContain("slide");
    expect(s.player.sliding).toBe(false);
    expect(s.player.grounded).toBe(false);
  });

  it("rutscht nur im Landeschritt, nicht in jedem Bodenschritt (nach dem Aufstehen wird nicht neu gestartet)", () => {
    const r = hopWithDown(0, true);
    const s = r.s;
    const slides = r.types.filter((t) => t === "slide").length;
    expect(slides).toBe(1);
    // Taste weiter gehalten, bis Rutschen endet (max. 1,1 s); danach darf es ohne neue Flanke nicht erneut starten
    const types: string[] = [];
    for (let i = 0; i < Math.round(2 / FIXED_DT); i += 1) {
      s.step(FIXED_DT, inp({ slide: true }));
      for (const e of s.events) types.push(e.type);
      s.events.length = 0;
    }
    expect(types.filter((t) => t === "slide")).toHaveLength(0);
    expect(s.player.sliding).toBe(false);
  });

  it("Rutsch-Landung rettet vor dem Überhang (Überhang kommt kurz nach der Landung)", () => {
    // Sprung, ↓ 60 ms vor der Landung, Überhang (Unterkante 72 px über dem Boden) trifft kurz danach ein.
    const L = landingStep();
    const trial = (down: boolean): Sim => {
      const s = lab();
      const v = s.speed;
      // Vorderkante des Überhangs erreicht die Figur ≈ 45 ms nach der Landung
      s.spawn({ kind: "overhead", skin: "bar", x: s.playerWorldX + v * (L * FIXED_DT + 0.045) + 17, y: s.groundY - 72 - 200, w: 360, h: 200, harmful: true, hb: [0, 0, 360, 200] }, 0);
      for (let i = 0; i < Math.round(1.6 / FIXED_DT); i += 1) {
        const press = down && i === L - 7;
        s.step(FIXED_DT, { ...hop(i), slidePressed: press, slide: press || (down && i > L - 7 && i < L + 40) });
        s.events.length = 0;
      }
      return s;
    };
    expect(trial(true).stats.hurts).toBe(0);
    expect(trial(false).stats.hurts).toBe(1);
  });
});

describe("Sim: abgelehnter Dash meldet „dash-denied“ (feel-core-12)", () => {
  const denied = (log: Array<{ type: string }>): number => log.filter((e) => e.type === "dash-denied").length;

  it("Dash ohne Energie: genau ein dash-denied, kein Dash, Energie unverändert (außer Regeneration)", () => {
    const s = lab();
    s.player.energy = 0;
    const log = runLog(s, 3, (i) => inp({ dashPressed: i === 0 }));
    expect(denied(log)).toBe(1);
    expect(log.some((e) => e.type === "dash")).toBe(false);
    expect(s.stats.dashes).toBe(0);
    expect(s.player.dashT).toBe(0);
  });

  it("5 Drücke innerhalb 0,3 s ergeben höchstens ein Ereignis; nach 0,4 s wieder eines", () => {
    const s = lab();
    s.player.energy = 0;
    const log = runLog(s, Math.round(0.3 / FIXED_DT), (i) => inp({ dashPressed: i % 7 === 0 })); // 5-6 Drücke in 0,3 s
    expect(denied(log)).toBe(1);
    // 0,3 s sind vergangen: Druck bei +0,025 s (unterdrückt), +0,125 s (≥ 0,4 s nach dem ersten → Ereignis), +0,15 s (unterdrückt)
    const more = runLog(s, Math.round(0.5 / FIXED_DT), (i) => inp({ dashPressed: i === 3 || i === 15 || i === 18 }));
    expect(denied(more)).toBe(1);
  });

  it("Dash im Abklingen (Energie reicht): dash-denied; während des Dashs selbst nicht", () => {
    const s = lab();
    s.player.energy = 100;
    const log = runLog(s, Math.round(1.2 / FIXED_DT), (i) => inp({ dashPressed: i === 0 || i === 12 || i === 60 }));
    expect(log.filter((e) => e.type === "dash")).toHaveLength(1);
    // i = 12 (0,1 s): dashT > 0 → kein Ereignis; i = 60 (0,5 s): Dash vorbei, Abklingzeit läuft noch → Ereignis
    const dn = log.filter((e) => e.type === "dash-denied");
    expect(dn).toHaveLength(1);
    expect(dn[0].t).toBeGreaterThan(0.45);
    expect(dn[0].t).toBeLessThan(0.6);
  });

  it("Dash bei genug Energie: unverändert, kein Ereignis", () => {
    const s = lab();
    s.player.energy = 100;
    const log = runLog(s, 5, (i) => inp({ dashPressed: i === 0 }));
    expect(denied(log)).toBe(0);
    expect(log.filter((e) => e.type === "dash")).toHaveLength(1);
    expect(s.player.energy).toBeLessThan(100 - s.perks.dashCost + 1);
  });

  it("ohne Dash-Druck nie ein Ereignis; Ereignis ändert den Sim-Zustand nicht (Klon-Vergleich)", () => {
    const a = lab();
    const b = lab();
    a.player.energy = 0;
    b.player.energy = 0;
    const la = runLog(a, 200, (i) => inp({ dashPressed: i % 11 === 0 }));
    const lb = runLog(b, 200);
    expect(denied(la)).toBeGreaterThan(1);
    expect(denied(lb)).toBe(0);
    expect(stateKey(a)).toBe(stateKey(b)); // Zustand identisch: nur Ereignis, keine Folgen
  });
});

describe("Sim: view() – Flip-sichere Höhe, Tod-Glühen, Blitz-Skalierung", () => {
  it("Gravitations-Flip (Cyber): Höhe wird über die Flip-Grenze nicht interpoliert (alpha 0,3 == alpha 1)", () => {
    const s = makeSim({ world: "cyber", seed: 77 });
    s.noSpawn = true;
    s.ents = [];
    s.speed = s.speedAtDiff(3);
    s.spawn({ kind: "portal", skin: "portal", x: s.playerWorldX + 40, y: s.ceilY, w: 60, h: s.groundY - s.ceilY, harmful: false, p: { dir: -1 } }, 0);
    let prev = { dist: s.dist, hgt: s.player.hgt, gravDir: s.player.gravDir };
    for (let i = 0; i < 200 && s.player.gravDir === 1; i += 1) {
      prev = { dist: s.dist, hgt: s.player.hgt, gravDir: s.player.gravDir };
      s.step(FIXED_DT, NO_INPUT);
    }
    expect(s.player.gravDir).toBe(-1); // der Flip fand im letzten Schritt statt
    expect(prev.gravDir).toBe(1);
    const v1 = s.view(1, prev, false, 2, FIXED_DT);
    for (const a of [0, 0.3, 0.7]) expect(s.view(a, prev, false, 2, FIXED_DT).playerFeetY).toBe(v1.playerFeetY);
    expect(v1.gravDir).toBe(-1);
    // Gegenprobe (altes Verhalten ohne gravDir): würde über den Flip hinweg interpolieren
    const old = s.view(0.3, { dist: prev.dist, hgt: prev.hgt }, false, 2, FIXED_DT);
    expect(Math.abs(old.playerFeetY - v1.playerFeetY)).toBeGreaterThan(50);
  });

  it("ohne Flip (gleiche gravDir) und ohne gravDir-Angabe wird wie bisher interpoliert", () => {
    const s = makeSim();
    s.noSpawn = true;
    s.ents = [];
    s.step(FIXED_DT, inp({ jump: true, jumpPressed: true }));
    const prev = { dist: s.dist, hgt: s.player.hgt };
    s.step(FIXED_DT, inp({ jump: true }));
    const mid = s.view(0.5, prev, false, 2, FIXED_DT);
    const end = s.view(1, prev, false, 2, FIXED_DT);
    const start = s.view(0, prev, false, 2, FIXED_DT);
    expect(end.playerFeetY).toBeLessThan(mid.playerFeetY);
    expect(mid.playerFeetY).toBeLessThan(start.playerFeetY);
    expect(mid.playerFeetY).toBeCloseTo((start.playerFeetY + end.playerFeetY) / 2, 6);
    // mit gleicher gravDir identisch zu ohne Angabe
    const withDir = s.view(0.5, { ...prev, gravDir: 1 }, false, 2, FIXED_DT);
    expect(withDir.playerFeetY).toBe(mid.playerFeetY);
    // 5-Argumente-Aufruf bleibt gültig: flashScale Standard 1
    expect(mid.flashScale).toBe(1);
  });

  it("hurtGlow klingt im Sterben monoton von 1 auf 0,3 ab (nur Darstellung, Sim unverändert)", () => {
    const s = lab();
    s.player.hearts = 1;
    s.spawn({ kind: "block", skin: "crate", x: s.playerWorldX + 60, y: s.groundY - 60, w: 60, h: 60, harmful: true }, 0);
    const prev = { dist: s.dist, hgt: 0 };
    for (let i = 0; i < 400 && s.phase === "running"; i += 1) s.step(FIXED_DT, NO_INPUT);
    expect(s.phase).toBe("dying");
    expect(s.view(1, prev, false, 2, FIXED_DT).hurtGlow).toBeCloseTo(1, 1);
    const before = stateKey(s);
    let last = 2;
    let n = 0;
    while (s.phase === "dying" && n < 400) {
      const g = s.view(1, prev, false, 2, FIXED_DT).hurtGlow;
      expect(g).toBeLessThanOrEqual(last + 1e-12);
      expect(g).toBeGreaterThanOrEqual(0.3 - 1e-9);
      last = g;
      s.step(FIXED_DT, NO_INPUT);
      n += 1;
    }
    expect(s.phase).toBe("over");
    expect(last).toBeLessThan(0.45); // am Ende nahe 0,3
    expect(s.view(1, prev, false, 2, FIXED_DT).hurtGlow).toBeCloseTo(0.3, 6);
    expect(s.view(1, prev, false, 2, FIXED_DT).hurtGlow).toBeGreaterThanOrEqual(0.3 - 1e-9);
    // view() ist rein lesend
    expect(stateKey(s)).not.toBe(before); // (die Sim ist inzwischen weitergelaufen) …
    const k1 = stateKey(s);
    s.view(0.5, prev, true, 0, FIXED_DT, 0.2);
    expect(stateKey(s)).toBe(k1); // … aber view() ändert nichts
  });

  it("Treffer im Lauf: hurtGlow wie bisher aus stun (1 → 0), nicht vom Tod-Abklingen berührt", () => {
    const s = lab();
    s.spawn({ kind: "block", skin: "crate", x: s.playerWorldX + 60, y: s.groundY - 60, w: 60, h: 60, harmful: true }, 0);
    const prev = { dist: s.dist, hgt: 0 };
    let maxGlow = 0;
    for (let i = 0; i < 200; i += 1) {
      s.step(FIXED_DT, NO_INPUT);
      maxGlow = Math.max(maxGlow, s.view(1, prev, false, 2, FIXED_DT).hurtGlow);
    }
    expect(s.phase).toBe("running");
    expect(maxGlow).toBeGreaterThan(0.9);
    expect(s.view(1, prev, false, 2, FIXED_DT).hurtGlow).toBe(0);
  });

  it("flashScale wird durchgereicht (Standard 1), sim.flash bleibt unskaliert", () => {
    const s = makeSim();
    s.flash = 0.8;
    const prev = { dist: s.dist, hgt: 0 };
    expect(s.view(1, prev, false, 2, FIXED_DT).flashScale).toBe(1);
    expect(s.view(1, prev, false, 2, FIXED_DT, 0.3).flashScale).toBe(0.3);
    expect(s.view(1, prev, false, 2, FIXED_DT, 0.3).flash).toBe(0.8);
    expect(s.flash).toBe(0.8);
  });
});
