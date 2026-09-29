import { GRAVITY, JUMP_AIR_TIME, JUMP_HEIGHT, JUMP_V } from "./constants";
import type { Rng } from "./rng";
import type {
  BuilderOpts,
  EntKind,
  EntSpec,
  Hitbox,
  PatternCtx,
  PickupType,
  WorldId,
  ZonePhase,
} from "./types";

/** Standard-Trefferflächen: leicht nach innen gezogen, damit Kollisionen "fair" wirken. */
export function defaultHitbox(kind: EntKind, w: number, h: number): Hitbox {
  switch (kind) {
    case "block":
      return [w * 0.1, h * 0.08, w * 0.8, h * 0.92];
    case "overhead":
      return [w * 0.06, 0, w * 0.88, h - 4];
    case "walker":
      return [w * 0.18, h * 0.1, w * 0.64, h * 0.88];
    case "flyer":
      return [w * 0.16, h * 0.16, w * 0.68, h * 0.66];
    case "projectile":
      return [w * 0.12, h * 0.15, w * 0.76, h * 0.7];
    case "swinger":
      return [w * 0.12, h * 0.12, w * 0.76, h * 0.76];
    case "pickup":
      return [-w * 0.15, -h * 0.15, w * 1.3, h * 1.3];
    default:
      return [0, 0, w, h];
  }
}

const KIND_DEFAULT_HARMFUL: Partial<Record<EntKind, boolean>> = {
  block: true,
  overhead: true,
  walker: true,
  flyer: true,
  projectile: true,
  swinger: true,
};

export interface BuiltSpec extends EntSpec {
  /** Position relativ zum Musterstart (px) – vom Generator in Weltkoordinaten umgerechnet */
}

export interface PatternCtxInit {
  speed: number;
  diff: number;
  groundY: number;
  ceilY: number;
  rng: Rng;
  worldId: WorldId;
  defaultSkin: (kind: EntKind) => string;
}

/**
 * Erzeugt den Baukasten für ein Muster. Alle hinzugefügten Specs landen in `out` (x relativ zum Musterstart).
 */
export function createPatternCtx(init: PatternCtxInit, out: EntSpec[]): PatternCtx {
  const { speed, diff, groundY, ceilY, rng, worldId } = init;
  const jumpDist = speed * JUMP_AIR_TIME;
  const add = (spec: EntSpec): EntSpec => {
    out.push(spec);
    return spec;
  };
  const skinOf = (kind: EntKind, o?: BuilderOpts): string => o?.skin ?? init.defaultSkin(kind);
  const base = (kind: EntKind, o: BuilderOpts | undefined, x: number, y: number, w: number, h: number): EntSpec => {
    const spec: EntSpec = {
      kind,
      skin: skinOf(kind, o),
      x,
      y,
      w,
      h,
      harmful: KIND_DEFAULT_HARMFUL[kind] ?? false,
      hb: o?.hb ?? defaultHitbox(kind, w, h),
      p: { ...(o?.p ?? {}) },
    };
    if (o?.breakable !== undefined) spec.breakable = o.breakable;
    if (o?.stompable !== undefined) spec.stompable = o.stompable;
    if (o?.warn !== undefined) spec.warn = o.warn;
    if (o?.vx !== undefined) spec.vx = o.vx;
    if (o?.state !== undefined) spec.state = o.state;
    if (o?.ceil) spec.ceil = true;
    return spec;
  };

  const ctx: PatternCtx = {
    speed,
    diff,
    groundY,
    ceilY,
    rng,
    jumpDist,
    worldId,
    t: (sec) => sec * speed,
    add,
    block(dx, w, h, o) {
      const y = o?.ceil ? ceilY : groundY - h;
      return add(base("block", o, dx, y, w, h));
    },
    overhead(dx, w, bottom, o) {
      const thick = o?.thick ?? 260;
      return add(base("overhead", o, dx, groundY - bottom - thick, w, thick));
    },
    pit(dx, w, o) {
      const spec = base("pit", o, dx, groundY, w, 200);
      spec.harmful = false;
      return add(spec);
    },
    platform(dx, w, elev, o) {
      const thick = o?.thick ?? 28;
      const spec = base("platform", o, dx, groundY - elev, w, thick);
      spec.harmful = false;
      spec.hb = [0, 0, w, thick];
      spec.p = {
        ...spec.p,
        crumble: o?.crumble ?? 0,
        ampX: o?.ampX ?? 0,
        ampY: o?.ampY ?? 0,
        per: o?.per ?? 3,
        ph: o?.ph ?? 0,
      };
      return add(spec);
    },
    walker(dx, w, h, o) {
      const spec = base("walker", o, dx, groundY - h, w, h);
      spec.stompable = o?.stompable ?? true;
      return add(spec);
    },
    flyer(dx, w, h, elev, o) {
      const y = groundY - elev - h;
      const spec = base("flyer", o, dx, y, w, h);
      spec.p = {
        ...spec.p,
        baseY: y,
        amp: o?.amp ?? 26,
        per: o?.per ?? 1.8,
        ph: o?.ph ?? rng.range(0, Math.PI * 2),
        track: o?.track ?? 0,
      };
      spec.stompable = o?.stompable ?? false;
      return add(spec);
    },
    projectile(dx, w, h, elev, o) {
      const spec = base("projectile", o, dx, groundY - elev - h, w, h);
      spec.vx = o?.vx ?? -260;
      spec.p = { ...spec.p, gravity: o?.gravity ?? 0 };
      return add(spec);
    },
    swinger(dx, anchorElev, len, o) {
      const r = o?.r ?? 34;
      const spec = base("swinger", o, dx, groundY - anchorElev, r * 2, r * 2);
      spec.p = {
        ...spec.p,
        ax: dx,
        ay: groundY - anchorElev,
        len,
        amp: o?.amp ?? 0.9,
        per: o?.per ?? 2.6,
        ph: o?.ph ?? 0,
        r,
      };
      return add(spec);
    },
    zone(dx, w, h, elev, phases: ZonePhase[], o) {
      const spec = base("zone", o, dx, groundY - elev - h, w, h);
      spec.harmful = false;
      spec.cycle = { phases, loop: o?.loop ?? false, offset: o?.offset ?? 0 };
      return add(spec);
    },
    spring(dx, w = 76, o) {
      const spec = base("spring", o, dx, groundY - 34, w, 34);
      spec.harmful = false;
      return add(spec);
    },
    portal(dx, o) {
      const spec = base("portal", o, dx, ceilY, 60, groundY - ceilY);
      spec.harmful = false;
      return add(spec);
    },
    wind(dx, w, h, elev, lift, o) {
      const spec = base("wind", o, dx, groundY - elev - h, w, h);
      spec.harmful = false;
      spec.p = { ...spec.p, lift };
      return add(spec);
    },
    speedzone(dx, w, mult, o) {
      const spec = base("speedzone", o, dx, groundY - 10, w, 10);
      spec.harmful = false;
      spec.p = { ...spec.p, mult };
      return add(spec);
    },
    decor(dx, w, h, elev, o) {
      const spec = base("decor", o, dx, groundY - elev - h, w, h);
      spec.harmful = false;
      return add(spec);
    },
    pickup(type: PickupType, dx, elev, o) {
      const size = type === "coin" ? 34 : type === "gem" ? 40 : 52;
      const spec = base("pickup", o, dx, groundY - elev - size / 2, size, size);
      spec.pickup = type;
      spec.harmful = false;
      spec.skin = o?.skin ?? type;
      return add(spec);
    },
    coin(dx, elev, o) {
      return ctx.pickup("coin", dx, elev, o);
    },
    coinLine(dx, elev, n, gap = 56, o) {
      for (let i = 0; i < n; i += 1) ctx.coin(dx + i * gap, elev, o);
    },
    coinArc(dx, span, apex, n = 7, o) {
      for (let i = 0; i < n; i += 1) {
        const u = n === 1 ? 0.5 : i / (n - 1);
        ctx.coin(dx + u * span, 44 + Math.sin(u * Math.PI) * apex, o);
      }
    },
    coinsOver(dx, w, clear, n = 7, o) {
      const span = Math.max(w + 140, 240);
      ctx.coinArc(dx + w / 2 - span / 2, span, Math.min(clear, JUMP_HEIGHT - 10), n, o);
    },
  };
  return ctx;
}

/** Physik-Hilfen für Musterautoren und Tests. */
export const PHYSICS = {
  gravity: GRAVITY,
  jumpV: JUMP_V,
  jumpHeight: JUMP_HEIGHT,
  jumpAirTime: JUMP_AIR_TIME,
};
