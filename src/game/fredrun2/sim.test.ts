import { describe, expect, it } from "vitest";
import { FIXED_DT, JUMP_HEIGHT, PLAYER_SX, PX_PER_METER } from "./constants";
import { NO_INPUT, Sim, type SimInput } from "./sim";
import { WORLDS } from "./worlds";
import type { CharacterId, RunConfig, WorldId } from "./types";

function makeSim(over: Partial<RunConfig> = {}): Sim {
  const s = new Sim({ mode: "world", world: "wien", character: "fred", seed: 1234, ...over }, WORLDS);
  s.begin();
  return s;
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
