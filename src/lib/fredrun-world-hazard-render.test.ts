import { describe, expect, it } from "vitest";
import {
  advanceFredRun, createFredRunState, startFredRun, fredRunStampCollisionBoxes,
  type FredRunStampHazard, type FredRunPlatform,
} from "./fredrun";
import { drawStampHazard, drawFilingCabinet, drawPlatform, drawChasm, isFredRunCabinet } from "./fredrun-world-hazard-render";

const stamp: FredRunStampHazard = {
  id: 7, x: 400, y: 46, width: 54, height: 64, phase: "anticipation", timer: 0.5,
  anticipationDuration: 0.6, descendDuration: 0.16, impactDuration: 0.55, recoverDuration: 0.5, behavior: "strike",
};
const platform: FredRunPlatform = {
  id: 4, x: 320, y: 230, width: 340, height: 18, type: "crumbling", state: "intact",
  crumbleTimer: 0, crumbleDuration: 0.7, playerLanded: false,
};
const cabinet = { id: 3, kind: "odo" as const, x: 600, width: 38, height: 78 };

function render(draw: (c: CanvasRenderingContext2D) => void) {
  const ops: unknown[][] = [];
  const initial = { globalAlpha: 0.8, lineJoin: "miter", lineCap: "butt", fillStyle: "black", strokeStyle: "white", lineWidth: 4 };
  let state: Record<string, unknown> = { ...initial };
  const stack: Record<string, unknown>[] = [];
  const c = new Proxy({}, {
    get: (_, key: string) => key in state ? state[key] : (...args: unknown[]) => {
      ops.push([key, ...args]);
      if (key === "save") stack.push({ ...state });
      if (key === "restore") state = stack.pop()!;
      if (key === "createLinearGradient") return { addColorStop: (...stop: unknown[]) => ops.push(["colorStop", ...stop]) };
    },
    set: (_, key: string, value) => { state[key] = value; return true; },
  }) as CanvasRenderingContext2D;
  draw(c);
  expect(state).toEqual(initial);
  expect(stack).toHaveLength(0);
  expect(ops.flat().filter((v) => typeof v === "number").every(Number.isFinite)).toBe(true);
  return ops;
}

describe("world hazard presentation", () => {
  it("lights the strike footprint immediately and retains the full static warning in reduced motion", () => {
    const onset = { ...stamp, timer: 0 };
    const normal = render(c => drawStampHazard(c, onset, 0, false));
    const reduced = render(c => drawStampHazard(c, onset, 0, true));
    expect(reduced).toEqual(normal);
    const footprint = ["ellipse", stamp.x, 302, stamp.width / 2, 6, 0, 0, Math.PI * 2];
    expect(reduced).toContainEqual(footprint);
    for (const timer of [0, 0.3, 0.6]) {
      expect(render(c => drawStampHazard(c, { ...stamp, timer }, 12, true))).toEqual(reduced);
    }
    for (const phase of ["anticipation", "recovering", "dormant"] as const) {
      const safe = render(c => drawStampHazard(c, { ...stamp, phase, behavior: "pass-under" }, 0, true));
      expect(safe).not.toContainEqual(footprint);
    }
    for (const phase of ["descending", "impact"] as const) {
      expect(render(c => drawStampHazard(c, { ...stamp, phase }, 0, true))).toContainEqual(footprint);
    }
    expect(reduced.some(([name]) => ["fillText", "strokeRect", "setLineDash"].includes(name as string))).toBe(false);
  });

  it("varies continuous rock silhouettes without moving or extending the landing edge", () => {
    const outlines = [1, 4, 9, 12].map(id => {
      const ops = render(c => drawPlatform(c, { ...platform, id, type: "stable" }, 0, true));
      const start = ops.findIndex(([name, x, y]) => name === "moveTo" && x === platform.x && y === platform.y);
      const end = ops.findIndex((op, index) => index > start && op[0] === "closePath");
      const outline = ops.slice(start, end);
      expect(outline[1]).toEqual(["lineTo", platform.x + platform.width, platform.y]);
      for (const [, x, y] of outline.slice(2)) {
        expect(x).toBeGreaterThanOrEqual(platform.x);
        expect(x).toBeLessThanOrEqual(platform.x + platform.width);
        expect(y).toBeGreaterThan(platform.y);
      }
      expect(ops.some(([name]) => name === "translate" || name === "rotate")).toBe(false);
      return JSON.stringify(outline);
    });
    expect(new Set(outlines).size).toBe(outlines.length);
  });

  it("has deterministic bounded drawing and restores canvas state across every lifecycle", () => {
    const draws = [
      ...(["anticipation", "descending", "impact", "recovering", "dormant"] as const).flatMap(phase => [false, true].map(reduced =>
        (c: CanvasRenderingContext2D) => drawStampHazard(c, { ...stamp, phase, timer: 0.1 }, 3, reduced))),
      ...(["intact", "crumbling", "collapsed"] as const).flatMap(state => [false, true].map(reduced =>
        (c: CanvasRenderingContext2D) => drawPlatform(c, { ...platform, state, crumbleTimer: state === "collapsed" ? 0.85 : 0.5 }, 3, reduced, 1))),
      (c: CanvasRenderingContext2D) => drawFilingCabinet(c, cabinet, 3, false),
      (c: CanvasRenderingContext2D) => drawChasm(c, { id: 1, x: 400, width: 300 }),
    ];
    for (const draw of draws) {
      const ops = render(draw);
      expect(ops).toEqual(render(draw));
      expect(ops.length).toBeLessThan(1000);
      expect(ops.filter(([name]) => name === "fillText").every(([, text]) => text === "GEPRÜFT")).toBe(true);
    }
  });

  it("freezes decorative motion but keeps warning cracks in reduced motion; collapsed support disappears", () => {
    for (const time of [0, 3, 20]) {
      expect(render(c => drawFilingCabinet(c, cabinet, time, true))).toEqual(render(c => drawFilingCabinet(c, cabinet, 0, true)));
      expect(render(c => drawStampHazard(c, stamp, time, true))).toEqual(render(c => drawStampHazard(c, stamp, 0, true)));
    }
    const intact = render(c => drawPlatform(c, platform, 0, true));
    const warning = render(c => drawPlatform(c, { ...platform, state: "crumbling", crumbleTimer: 0.6 }, 0, true));
    expect(warning).not.toEqual(intact);
    expect(warning.filter(([name]) => name === "lineTo").length).toBeGreaterThan(intact.filter(([name]) => name === "lineTo").length);
    expect(render(c => drawPlatform(c, { ...platform, state: "collapsed", crumbleTimer: 0.8 }, 0, true))).toEqual([]);
    expect(render(c => drawPlatform(c, { ...platform, state: "collapsed", crumbleTimer: 1.4 }, 0, false))).toEqual([]);
  });

  it("culls offscreen objects and does not create a false cliff at a clipped viewport boundary", () => {
    expect(render(c => drawStampHazard(c, { ...stamp, x: -100 }, 0, false))).toEqual([]);
    expect(render(c => drawFilingCabinet(c, { ...cabinet, x: 1000 }, 0, false))).toEqual([]);
    expect(render(c => drawPlatform(c, { ...platform, x: 1100 }, 0, false))).toEqual([]);
    const ops = render(c => drawChasm(c, { id: 1, x: -100, width: 300 }));
    expect(ops).toContainEqual(["rect", 0, 300, 200, 60]);
    expect(ops).toContainEqual(["moveTo", -100, 300]);
    expect(ops).not.toContainEqual(["moveTo", 0, 300]);
  });

  it("articulates cabinet drawers within the existing obstacle width", () => {
    for (let time = 0; time < 4; time += 0.1) {
      const ops = render(c => drawFilingCabinet(c, cabinet, time, false));
      for (const [, x, , width] of ops.filter(([name]) => name === "roundRect")) {
        expect(x as number).toBeGreaterThanOrEqual(cabinet.x);
        expect((x as number) + (width as number)).toBeLessThanOrEqual(cabinet.x + cabinet.width);
      }
    }
    expect(render(c => drawFilingCabinet(c, cabinet, 0, false))).not.toEqual(render(c => drawFilingCabinet(c, cabinet, 0.5, false)));
    expect(["odo", "madinger", "luki"].every(kind => isFredRunCabinet({ ...cabinet, kind: kind as typeof cabinet.kind }))).toBe(true);
    expect(isFredRunCabinet({ ...cabinet, kind: "jqa" })).toBe(false);
  });
});

describe("stamp silhouette collision", () => {
  it("excludes the empty shoulders beside the neck, while retaining grip and sole", () => {
    const boxes = fredRunStampCollisionBoxes(stamp);
    const touches = (x: number, y: number) => boxes.some(b => x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height);
    expect(touches(stamp.x - 20, stamp.y + 10)).toBe(true);
    expect(touches(stamp.x - 20, stamp.y + 24)).toBe(false);
    expect(touches(stamp.x, stamp.y + 24)).toBe(true);
    expect(touches(stamp.x - 20, stamp.y + 40)).toBe(true);
    expect(touches(stamp.x, stamp.y + stamp.height)).toBe(false);
  });

  it("keeps contact fatal, return non-damaging, and sweeps a fast descending press", () => {
    const base = { ...startFredRun(createFredRunState("finanzamt-night")), spawnDistance: 1e6 };
    const contact = { ...stamp, x: 132, y: 236, phase: "impact" as const, timer: 0 };
    expect(advanceFredRun({ ...base, stamps: [contact] }, 0.01).phase).toBe("game-over");
    expect(advanceFredRun({ ...base, stamps: [{ ...contact, phase: "recovering" }] }, 0.01).phase).toBe("running");
    const descending = { ...stamp, x: 145, y: 46, phase: "descending" as const, timer: 0.13 };
    expect(advanceFredRun({ ...base, stamps: [descending] }, 0.05).phase).toBe("game-over");
  });
});
