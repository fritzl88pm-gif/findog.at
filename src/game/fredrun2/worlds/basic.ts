/**
 * Einfache Referenz-/Platzhalterwelt. Dient (1) als Test-Welt für Engine und Bot, (2) als Vorlage für echte Welten,
 * (3) als Fallback, falls ein Weltmodul nicht lädt. Zeigt die komplette Bandbreite der Entitäts-Archetypen.
 */
import { JUMP_HEIGHT } from "../constants";
import type { AssetLoader, Ent, PatternDef, ViewState, WorldDef, WorldId, WorldRenderer } from "../types";

function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export class BasicRenderer implements WorldRenderer {
  constructor(private readonly hue: number) {}
  async load(_assets: AssetLoader): Promise<void> {
    void _assets;
  }
  update(): void {}
  drawBackground(g: CanvasRenderingContext2D, v: ViewState): void {
    const grd = g.createLinearGradient(0, 0, 0, v.groundY);
    grd.addColorStop(0, `hsl(${this.hue}, 55%, 62%)`);
    grd.addColorStop(1, `hsl(${this.hue + 20}, 65%, 86%)`);
    g.fillStyle = grd;
    g.fillRect(0, 0, v.w, v.h);
    const layers = [
      { par: 0.1, base: 360, amp: 90, color: `hsl(${this.hue + 10}, 30%, 68%)` },
      { par: 0.25, base: 430, amp: 70, color: `hsl(${this.hue + 15}, 32%, 56%)` },
      { par: 0.5, base: 500, amp: 50, color: `hsl(${this.hue + 20}, 34%, 42%)` },
    ];
    for (const L of layers) {
      g.fillStyle = L.color;
      g.beginPath();
      g.moveTo(0, v.h);
      const off = v.dist * L.par;
      for (let x = 0; x <= v.w + 20; x += 20) {
        const wx = x + off;
        const y = L.base - (Math.sin(wx * 0.004) * 0.5 + Math.sin(wx * 0.011 + 1.7) * 0.3 + 0.5) * L.amp;
        g.lineTo(x, y);
      }
      g.lineTo(v.w, v.h);
      g.closePath();
      g.fill();
    }
  }
  drawGround(g: CanvasRenderingContext2D, v: ViewState, pits: ReadonlyArray<{ x0: number; x1: number }>): void {
    let x = 0;
    const segs: Array<[number, number]> = [];
    for (const p of [...pits].sort((a, b) => a.x0 - b.x0)) {
      if (p.x0 > x) segs.push([x, p.x0]);
      x = Math.max(x, p.x1);
    }
    if (x < v.w) segs.push([x, v.w]);
    for (const [a, b] of segs) {
      g.fillStyle = `hsl(${this.hue + 25}, 28%, 30%)`;
      g.fillRect(a, v.groundY, b - a, v.h - v.groundY);
      g.fillStyle = `hsl(${this.hue + 25}, 40%, 48%)`;
      g.fillRect(a, v.groundY, b - a, 10);
    }
    g.fillStyle = "rgba(0,0,0,0.12)";
    for (let i = 0; i < 40; i += 1) {
      const wx = Math.floor((v.dist * 1 + i * 90) / 90) * 90;
      const sx = wx - v.dist;
      g.fillRect(sx, v.groundY + 30 + hash(wx) * 60, 40 + hash(wx + 1) * 60, 3);
    }
  }
  drawEntity(): boolean {
    return false;
  }
  drawForeground(): void {}
}

const T = (c: { t(s: number): number }, s: number): number => c.t(s);

export const BASIC_PATTERNS: PatternDef[] = [
  {
    id: "b-hop",
    minDiff: 0,
    tags: ["hop"],
    weight: 3,
    build(c) {
      const w = c.rng.int(56, 90);
      const h = c.rng.int(56, 96);
      c.block(0, w, h);
      c.coinsOver(0, w, h + 90);
      return w;
    },
  },
  {
    id: "b-double-hop",
    minDiff: 0.5,
    tags: ["hop"],
    weight: 2,
    build(c) {
      c.block(0, 64, 74);
      c.block(T(c, 1.15), 64, 74);
      return T(c, 1.15) + 64;
    },
  },
  {
    id: "b-slide",
    minDiff: 0.4,
    tags: ["slide"],
    weight: 2,
    build(c) {
      const w = c.rng.int(160, 300);
      c.overhead(0, w, 72);
      c.coinLine(20, 30, Math.floor(w / 56));
      return w;
    },
  },
  {
    id: "b-pit",
    minDiff: 0.8,
    tags: ["gap"],
    weight: 2,
    build(c) {
      const w = Math.min(c.jumpDist * 0.62, 340);
      c.pit(0, w);
      c.coinArc(-20, w + 40, 130, 7);
      return w;
    },
  },
  {
    id: "b-walker",
    minDiff: 0.8,
    tags: ["enemy"],
    weight: 2,
    build(c) {
      c.walker(0, 58, 84, { vx: -140 });
      return 60;
    },
  },
  {
    id: "b-flyer",
    minDiff: 1.4,
    tags: ["enemy"],
    weight: 1.6,
    build(c) {
      c.flyer(0, 80, 56, 130, { amp: 24 });
      return 80;
    },
  },
  {
    id: "b-platform",
    minDiff: 1.2,
    tags: ["gap"],
    weight: 1.6,
    build(c) {
      const pw = Math.min(c.jumpDist * 0.55, 300);
      c.pit(0, pw + 120);
      c.platform(40, pw, 80);
      c.coinLine(60, 130, 4, 56);
      return pw + 120;
    },
  },
  {
    id: "b-timing",
    minDiff: 1.8,
    tags: ["timing"],
    weight: 1.4,
    build(c) {
      c.zone(0, 70, 420, 0, [
        { name: "warn", dur: 0.7 },
        { name: "active", dur: 0.45 },
      ], { skin: "bolt" });
      return 80;
    },
  },
  {
    id: "b-spring",
    minDiff: 1.0,
    tags: ["special"],
    weight: 1,
    build(c) {
      c.spring(0);
      c.pickup("gem", 20, JUMP_HEIGHT + 210);
      c.coinLine(0, 320, 5, 54);
      return 300;
    },
  },
  {
    id: "b-projectile",
    minDiff: 2.2,
    tags: ["enemy"],
    weight: 1,
    build(c) {
      c.projectile(0, 60, 26, 40, { vx: -380 });
      return 60;
    },
  },
  {
    id: "b-swinger",
    minDiff: 2.6,
    tags: ["timing"],
    weight: 1,
    build(c) {
      c.swinger(0, 520, 300, { amp: 0.7, per: 2.4, r: 36 });
      return 100;
    },
  },
  {
    id: "b-combo",
    minDiff: 3.4,
    tags: ["combo"],
    weight: 1.5,
    build(c) {
      c.block(0, 60, 70);
      c.overhead(T(c, 1.05), 220, 72);
      c.block(T(c, 1.05) + 220 + T(c, 1.0), 60, 90);
      return T(c, 2.05) + 280;
    },
  },
];

export function makeBasicWorld(id: WorldId, hue: number, name: string = id): WorldDef {
  return {
    id,
    name,
    tagline: "Testwelt",
    description: "Platzhalter",
    mechanics: [],
    accent: `hsl(${hue}, 70%, 50%)`,
    accentDark: `hsl(${hue}, 60%, 18%)`,
    music: id,
    stageMeters: 400,
    stageCount: 3,
    stageNames: ["Start", "Mitte", "Ende"],
    patterns: BASIC_PATTERNS,
    createRenderer: () => new BasicRenderer(hue),
  };
}

export function drawEntFallback(g: CanvasRenderingContext2D, e: Ent, sx: number, sy: number): void {
  g.save();
  switch (e.kind) {
    case "pit":
    case "wind":
    case "speedzone":
    case "decor":
      g.restore();
      return;
    case "portal":
      g.fillStyle = "rgba(180,120,255,0.7)";
      g.fillRect(sx, sy, e.w, e.h);
      break;
    case "zone":
      g.fillStyle = e.state === "active" ? "rgba(255,220,60,0.85)" : e.state === "warn" ? "rgba(255,220,60,0.25)" : "rgba(255,255,255,0.05)";
      g.fillRect(sx, sy, e.w, e.h);
      break;
    case "pickup": {
      g.fillStyle = e.pickup === "coin" ? "#ffd23f" : e.pickup === "gem" ? "#ff4d6d" : "#7ee8ff";
      g.beginPath();
      g.arc(sx + e.w / 2, sy + e.h / 2, e.w / 2, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case "walker":
    case "flyer":
      g.fillStyle = e.state === "defeated" ? "#888" : "#c0392b";
      g.fillRect(sx, sy, e.w, e.h);
      break;
    case "swinger":
      g.fillStyle = "#8e44ad";
      g.beginPath();
      g.arc(sx + e.w / 2, sy + e.h / 2, e.w / 2, 0, Math.PI * 2);
      g.fill();
      break;
    case "platform":
      g.fillStyle = e.state === "crumbling" ? "#b07040" : "#7a5230";
      g.fillRect(sx, sy, e.w, e.h);
      break;
    default:
      g.fillStyle = e.harmful ? "#e67e22" : "#3498db";
      g.fillRect(sx, sy, e.w, e.h);
  }
  g.restore();
}
