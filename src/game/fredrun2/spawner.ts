import { PX_PER_METER, SPAWN_AHEAD, START_HEARTS } from "./constants";
import { createPatternCtx } from "./patterns";
import type { Sim } from "./sim";
import type { EntKind, PatternCtx, PatternDef, PickupType, WorldDef, WorldId } from "./types";

const DEFAULT_SKINS: Record<EntKind, string> = {
  block: "crate",
  overhead: "bar",
  pit: "pit",
  platform: "platform",
  walker: "walker",
  flyer: "flyer",
  projectile: "shot",
  swinger: "swinger",
  zone: "zone",
  spring: "spring",
  portal: "portal",
  wind: "wind",
  speedzone: "speedzone",
  pickup: "coin",
  decor: "decor",
};

export function restSeconds(diff: number): number {
  return 1.15 - 0.7 * Math.min(1, diff / 9);
}

/** Welt-unabhängige Belohnungsmuster (Münzen, Edelsteine, Power-ups). */
export const REWARD_PATTERNS: PatternDef[] = [
  {
    id: "reward-line",
    minDiff: 0,
    tags: ["reward"],
    weight: 3,
    build(c) {
      const n = c.rng.int(7, 12);
      c.coinLine(0, c.rng.pick([58, 74, 96]), n, 56);
      return n * 56;
    },
  },
  {
    id: "reward-wave",
    minDiff: 0.3,
    tags: ["reward"],
    weight: 2,
    build(c) {
      const n = 11;
      for (let i = 0; i < n; i += 1) c.coin(i * 54, 90 + Math.sin(i * 0.75) * 46);
      return n * 54;
    },
  },
  {
    id: "reward-arc",
    minDiff: 0,
    tags: ["reward"],
    weight: 2.5,
    build(c) {
      const span = Math.max(300, c.jumpDist * 0.85);
      c.coinArc(0, span, 150, 9);
      return span;
    },
  },
  {
    id: "reward-sky",
    minDiff: 1.6,
    tags: ["reward"],
    weight: 1.2,
    build(c) {
      const span = Math.max(360, c.jumpDist);
      c.coinArc(0, span, 300, 11);
      c.pickup("gem", span / 2, 360);
      return span;
    },
  },
  {
    id: "reward-stairs",
    minDiff: 0.8,
    tags: ["reward"],
    weight: 1.2,
    build(c) {
      for (let i = 0; i < 8; i += 1) c.coin(i * 60, 50 + i * 26);
      for (let i = 0; i < 6; i += 1) c.coin(8 * 60 + i * 60, 50 + (7 - i) * 22);
      return 14 * 60;
    },
  },
];

/**
 * Gast-Gegner aus dem Originalspiel (Odo, Madinger, JQA, Luki) – erscheinen in JEDER Welt als Läufer,
 * die dem Spieler entgegenrennen. Stampfen besiegt sie; Ketten geben Kombo-Punkte.
 */
const GUESTS = ["odo", "madinger", "jqa", "luki"] as const;
const guest = (c: PatternCtx): string => c.rng.pick(GUESTS);

export const ENEMY_PATTERNS: PatternDef[] = [
  {
    id: "guest-single",
    minDiff: 0.5,
    tags: ["enemy"],
    weight: 1.6,
    build(c) {
      c.walker(0, 64, 110, { skin: guest(c), vx: -c.rng.range(90, 170), stompable: true });
      c.coinArc(-40, 220, 150, 5);
      return 70;
    },
  },
  {
    id: "guest-hopper",
    minDiff: 1.6,
    tags: ["enemy"],
    weight: 1.3,
    build(c) {
      c.walker(0, 64, 110, { skin: guest(c), vx: -120, stompable: true, p: { hopEvery: 1.25, hopV: 760 } });
      return 70;
    },
  },
  {
    id: "guest-stomp-chain",
    minDiff: 1.2,
    tags: ["enemy", "combo"],
    weight: 1.3,
    build(c) {
      const n = c.diff > 5 ? 4 : 3;
      for (let i = 0; i < n; i += 1) c.walker(c.t(i * 0.58), 64, 110, { skin: guest(c), vx: 0, stompable: true });
      c.coinArc(c.t(0.1), c.t(0.58 * (n - 1)), 210, 6);
      return c.t(0.58 * (n - 1)) + 64;
    },
  },
  {
    id: "guest-pair",
    minDiff: 2.6,
    tags: ["enemy"],
    weight: 1.2,
    build(c) {
      c.walker(0, 64, 110, { skin: guest(c), vx: -160, stompable: true });
      c.walker(c.t(1.15), 64, 110, { skin: guest(c), vx: -160, stompable: true });
      return c.t(1.15) + 64;
    },
  },
  {
    id: "guest-rush",
    minDiff: 3.4,
    tags: ["enemy", "timing"],
    weight: 1,
    build(c) {
      c.walker(0, 64, 110, { skin: guest(c), vx: -c.rng.range(360, 480), stompable: true, warn: true });
      return 70;
    },
  },
  {
    id: "guest-squad",
    minDiff: 5.6,
    tags: ["enemy", "combo"],
    weight: 1.1,
    build(c) {
      c.walker(0, 64, 110, { skin: guest(c), vx: -150, stompable: true });
      c.block(c.t(0.95), 60, 78);
      c.walker(c.t(1.95), 64, 110, { skin: guest(c), vx: -220, stompable: true, p: { hopEvery: 1.1, hopV: 700 } });
      return c.t(1.95) + 64;
    },
  },
];

export interface GateInfo {
  x: number;
  from: WorldId;
  to: WorldId;
}

export class Spawner {
  cursor: number;
  private lastId = "";
  private tagRun: { tag: string; count: number } = { tag: "", count: 0 };
  private sinceReward = 0;
  private nextPowerUpAt: number;
  patternCount = 0;
  /** Welt, für die aktuell Inhalte erzeugt werden (weicht in der Tour kurz vom Spielfeld-World ab). */
  spawnWorld: WorldDef;
  /** +1 = normale Schwerkraft am Spawn-Cursor, −1 = gekippt */
  expectedGrav: 1 | -1 = 1;

  constructor(private readonly sim: Sim, world: WorldDef, startX: number) {
    this.spawnWorld = world;
    this.cursor = startX;
    this.nextPowerUpAt = startX + PX_PER_METER * sim.rng.range(420, 620);
  }

  /** Erzeugt Inhalte bis `dist + SPAWN_AHEAD`. */
  fill(): void {
    const limit = this.sim.dist + SPAWN_AHEAD;
    let guard = 0;
    while (this.cursor < limit && guard < 24) {
      this.spawnNext();
      guard += 1;
    }
  }

  private makeCtx(out: import("./types").EntSpec[], diffOverride?: number): PatternCtx {
    const sim = this.sim;
    const w = this.spawnWorld;
    const diff = diffOverride ?? sim.diffAt(this.cursor);
    const speed = sim.speedAtDiff(diff) * (w.speedScale ?? 1);
    return createPatternCtx(
      {
        speed,
        diff,
        groundY: sim.groundYOf(w),
        ceilY: sim.ceilYOf(w),
        rng: sim.rng,
        worldId: w.id,
        defaultSkin: (k) => DEFAULT_SKINS[k],
      },
      out,
    );
  }

  private readonly mergedCache = new Map<string, PatternDef[]>();
  private patternsFor(w: WorldDef): PatternDef[] {
    let list = this.mergedCache.get(w.id);
    if (!list) {
      list = [...w.patterns, ...ENEMY_PATTERNS];
      this.mergedCache.set(w.id, list);
    }
    return list;
  }

  private choose(list: PatternDef[], diff: number, allowSameTag: boolean): PatternDef | null {
    const rng = this.sim.rng;
    const candidates = list.filter((p) => diff >= p.minDiff && (p.maxDiff === undefined || diff <= p.maxDiff) && p.id !== this.lastId);
    let pool = candidates;
    if (!allowSameTag && this.tagRun.count >= 2) {
      const filtered = candidates.filter((p) => !(p.tags ?? []).includes(this.tagRun.tag as never));
      if (filtered.length) pool = filtered;
    }
    if (!pool.length) return candidates[0] ?? list[0] ?? null;
    // Bevorzuge Muster nahe der aktuellen Schwierigkeit (neuere Muster häufiger, ältere seltener)
    let total = 0;
    const weights = pool.map((p) => {
      const fresh = 1 + Math.max(0, 1.4 - (diff - p.minDiff) * 0.35);
      const wgt = (p.weight ?? 1) * fresh;
      total += wgt;
      return wgt;
    });
    let r = rng.next() * total;
    for (let i = 0; i < pool.length; i += 1) {
      r -= weights[i];
      if (r <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  }

  private place(specs: import("./types").EntSpec[], originX: number): void {
    for (const s of specs) {
      const e = this.sim.spawn(s, originX);
      if (e.kind === "portal") this.expectedGrav = this.expectedGrav === 1 ? -1 : 1;
    }
  }

  private spawnNext(): void {
    const sim = this.sim;
    const w = this.spawnWorld;
    const diff = sim.diffAt(this.cursor);

    // Tour: Portal-Tor zum nächsten Universum?
    if (sim.wantsGateway(this.cursor)) {
      this.spawnGateway();
      return;
    }

    // Power-up
    if (this.cursor >= this.nextPowerUpAt) {
      this.spawnPowerUp();
      this.nextPowerUpAt = this.cursor + PX_PER_METER * sim.rng.range(480, 820);
      return;
    }

    const wantReward = this.sinceReward >= 3 && sim.rng.chance(0.55 + Math.min(0.3, this.sinceReward * 0.08));
    const specs: import("./types").EntSpec[] = [];
    let pattern: PatternDef | null;
    let isReward = false;
    if (wantReward) {
      pattern = this.choose(REWARD_PATTERNS, diff, true);
      isReward = true;
    } else {
      pattern = this.choose(this.patternsFor(w), diff, false);
    }
    if (!pattern) {
      this.cursor += 400;
      return;
    }
    const ctx = this.makeCtx(specs);
    const length = pattern.build(ctx);
    this.sim.curPattern = pattern.id;
    this.place(specs, this.cursor);
    this.sim.curPattern = "";
    this.lastId = pattern.id;
    const tag = pattern.tags?.[0] ?? "";
    if (tag === this.tagRun.tag) this.tagRun.count += 1;
    else this.tagRun = { tag, count: 1 };
    this.sinceReward = isReward ? 0 : this.sinceReward + 1;
    this.patternCount += 1;
    const rest = restSeconds(diff) * ctx.speed * sim.rng.range(0.9, 1.15);
    this.cursor += Math.max(length, 60) + (isReward ? rest * 0.55 : rest);
  }

  private spawnPowerUp(): void {
    const sim = this.sim;
    const rng = sim.rng;
    const hearts = sim.player.hearts;
    const table: Array<[PickupType, number]> = [
      ["magnet", 3],
      ["shield", 3],
      ["slowmo", 2],
      ["turbo", 1.4],
      ["heart", hearts >= 5 ? 0 : hearts <= 1 ? 6 : hearts === START_HEARTS ? 1.6 : 2.6],
    ];
    const total = table.reduce((s, [, w]) => s + w, 0);
    let r = rng.next() * total;
    let type: PickupType = "magnet";
    for (const [t, wt] of table) {
      r -= wt;
      if (r <= 0) {
        type = t;
        break;
      }
    }
    const specs: import("./types").EntSpec[] = [];
    const ctx = this.makeCtx(specs);
    const span = Math.max(300, ctx.jumpDist * 0.8);
    ctx.coinArc(0, span, 120, 7);
    ctx.pickup(type, span / 2, 200);
    this.place(specs, this.cursor);
    this.cursor += span + ctx.t(0.9);
    this.sinceReward = 0;
  }

  private spawnGateway(): void {
    const sim = this.sim;
    const from = this.spawnWorld;
    const to = sim.nextTourWorld();
    const specs: import("./types").EntSpec[] = [];
    const ctx = this.makeCtx(specs);
    let x = this.cursor;
    if (this.expectedGrav === -1) {
      ctx.portal(0);
      x += ctx.t(1.1);
    }
    this.place(specs, this.cursor);
    const gateX = x + ctx.t(0.9);
    const gate = sim.spawn(
      { kind: "decor", skin: "gateway", x: 0, y: sim.groundYOf(from) - 440, w: 120, h: 440, p: { to: WORLD_ORDER_INDEX[to.id] } },
      gateX,
    );
    void gate;
    sim.registerGate({ x: gateX, from: from.id, to: to.id });
    this.spawnWorld = to;
    this.expectedGrav = 1;
    this.cursor = gateX + ctx.t(1.5);
    this.lastId = "";
    this.tagRun = { tag: "", count: 0 };
    this.sinceReward = 0;
  }
}

const WORLD_ORDER_INDEX: Record<WorldId, number> = { wien: 0, alpen: 1, finanzamt: 2, prater: 3, wachau: 4, cyber: 5, winter: 6, oper: 7 };
