import { expect, it } from "vitest";
import { drawFredRunUrbanEvent } from "./fredrun-urban-event-render";
import { URBAN_PATTERNS, URBAN_WARNING, urbanPackage, type FredRunUrbanEvent } from "./fredrun-urban-event";
function canvasRecorder(initialAlpha = 1) {
  const ops: unknown[][] = [];
  let properties: Record<string, unknown> = { globalAlpha: initialAlpha, fillStyle: "#000000", strokeStyle: "#000000", lineWidth: 1, lineCap: "butt", lineJoin: "miter" };
  const stack: Record<string, unknown>[] = [];
  function alpha(value: unknown) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw Error(`Invalid canvas alpha: ${value}`);
  }
  function color(value: unknown) {
    if (typeof value === "string" && value.startsWith("rgba(")) alpha(Number(value.slice(value.lastIndexOf(",") + 1, -1)));
  }
  const methods: Record<string, (...args: unknown[]) => unknown> = {
    save() { stack.push({ ...properties }); },
    restore() {
      if (!stack.length) throw Error("Unbalanced restore");
      properties = stack.pop()!;
    },
    createLinearGradient() {
      const gradient = { stops: [] as [number, string][] };
      // CanvasGradient methods are non-enumerable; compare recorded colors,
      // not closure identities when comparing independent static frames.
      return Object.defineProperty(gradient, "addColorStop", { value(offset: number, value: string) {
        alpha(offset); color(value); gradient.stops.push([offset, value]); ops.push(["addColorStop", offset, value]);
      } });
    },
  };
  for (const key of ["beginPath", "moveTo", "lineTo", "closePath", "fill", "stroke", "clip", "ellipse", "translate", "rotate", "scale", "fillRect", "roundRect", "bezierCurveTo", "quadraticCurveTo", "arc"]) {
    methods[key] = () => undefined;
  }
  const context = new Proxy({}, {
    get: (_, key: string) => {
      if (key in properties) return properties[key];
      if (!(key in methods)) throw Error(`Untracked canvas property/method: ${key}`);
      return (...args: unknown[]) => {
        if (args.some(v => typeof v === "number" && !Number.isFinite(v))) throw Error(`Nonfinite ${key}`);
        ops.push([key, ...args, ...(["fill", "stroke", "fillRect", "roundRect", "bezierCurveTo", "quadraticCurveTo", "arc"].includes(key) ? [{ ...properties }] : [])]);
        return methods[key](...args);
      };
    },
    set: (_, key: string, value: unknown) => {
      if (!(key in properties)) throw Error(`Untracked canvas property: ${key}`);
      if (key === "globalAlpha") alpha(value);
      if (key === "fillStyle" || key === "strokeStyle") color(value);
      if (key === "lineWidth" && (typeof value !== "number" || !Number.isFinite(value) || value <= 0)) throw Error("Invalid line width");
      properties[key] = value; ops.push(["set", key, value]); return true;
    },
  }) as CanvasRenderingContext2D;
  return { context, ops, depth: () => stack.length, properties: () => ({ ...properties }) };
}

function draw(event: FredRunUrbanEvent, reduced = false, decorations = true) {
  const r = canvasRecorder(0.6), before = r.properties();
  drawFredRunUrbanEvent(r.context, event, reduced, decorations);
  expect(r.depth()).toBe(0); expect(r.properties()).toEqual(before);
  return r.ops;
}

// Recover file centers from real canvas paths, including the cabinet transform.
function renderedFileOrigins(ops: unknown[][]) {
  let pose = { x: 0, y: 0, angle: 0 };
  const stack: typeof pose[] = [], files: typeof pose[] = [];
  for (let i = 0; i < ops.length; i++) {
    const [op, x, y, width] = ops[i];
    if (op === "save") stack.push({ ...pose });
    if (op === "restore") pose = stack.pop()!;
    if (op === "translate") {
      pose.x += Number(x) * Math.cos(pose.angle) - Number(y) * Math.sin(pose.angle);
      pose.y += Number(x) * Math.sin(pose.angle) + Number(y) * Math.cos(pose.angle);
    }
    if (op === "rotate") pose.angle += Number(x);
    if (op !== "roundRect" || ops[i + 1]?.[2] !== "#152a32") continue;
    const top = ops.slice(i + 1).find(o => o[0] === "moveTo")!;
    const localX = Number(top[1]) + Number(width) / 2, localY = Number(top[2]) - 5;
    files.push({ x: pose.x + localX * Math.cos(pose.angle) - localY * Math.sin(pose.angle),
      y: pose.y + localX * Math.sin(pose.angle) + localY * Math.cos(pose.angle), angle: pose.angle });
  }
  return files;
}

it("empties each visible file source exactly when its package emerges there in both motion modes", () => {
  for (const variant of [1, 2]) for (const reduced of [false, true]) {
    URBAN_PATTERNS[variant].releases.forEach((release, index) => {
      const at: FredRunUrbanEvent = { kind: "filefall", phase: "action", timer: release, speed: 360, variant, absorbed: 7 };
      const before: FredRunUrbanEvent = index === 0 ? { ...at, phase: "anticipation", timer: URBAN_WARNING - 1e-6 } : { ...at, timer: release - 1e-6 };
      const sourceFiles = renderedFileOrigins(draw(before, reduced, false));
      const afterFiles = renderedFileOrigins(draw(at, reduced, false));
      expect(sourceFiles.length - afterFiles.length).toBe(index === 0 ? 2 : 3);
      expect(renderedFileOrigins(draw({ ...at, timer: release + 1e-6 }, reduced, false))).toHaveLength(afterFiles.length);
      // Middle drawer file / upper top-stack file is the source anchor.
      const source = sourceFiles[index === 0 ? sourceFiles.length - 1 : 1];
      const p = urbanPackage(at, index);
      // Anticipation has a <=1.3px decorative rock in normal motion only.
      expect.soft(Math.hypot(p.x - source.x, p.y - source.y)).toBeLessThan(index === 0 && !reduced ? 1.3 : 0.001);
      const visible = { ...at, absorbed: 7 & ~(1 << index) };
      expect(draw(visible, reduced, false)).toContainEqual(["translate", p.x, p.y]);
      const next = urbanPackage(visible, index, release + 1 / 60);
      expect(draw({ ...visible, timer: release + 1 / 60 }, reduced, false)).toContainEqual(["translate", next.x, next.y]);
      expect(Math.hypot(next.x - p.x, next.y - p.y)).toBeLessThan(6);
    });
  }
});
it("has an opaque, deformed source and cast warning from the first frame, even without decoration", () => {
  for (const kind of ["stormfront", "filefall"] as const) {
    const e: FredRunUrbanEvent = { kind, phase: "anticipation", timer: 0, speed: 360, variant: 0, absorbed: 0 };
    const ops = draw(e, true, false);
    expect(ops.length).toBeGreaterThan(200);
    expect(ops.filter(o => o[0] === "set" && o[1] === "globalAlpha")[0]).toEqual(["set", "globalAlpha", 0.6]);
    expect(ops.some(o => o[0] === "ellipse" && o[1] === 606 && (o[2] as number) >= 297)).toBe(true);
    expect(ops).toEqual(draw({ ...e, timer: 1.7 }, true, false));
  }
});
it("uses authoritative package positions, visibly removes absorbed groups and bounds all canvas state", () => {
  for (const kind of ["stormfront", "filefall"] as const) for (const variant of [0, 1, 2]) for (const reduced of [true, false]) {
    for (const phase of ["quiet", "clearance", "anticipation", "action", "recovery"] as const) for (const timer of [0, 0.03, 0.7, 0.8, 1.4, 2.8, 3.4, 5, 20]) {
      const e: FredRunUrbanEvent = { kind, phase, timer, speed: 580, variant, absorbed: 0 };
      const ops = draw(e, reduced);
      expect(ops.length).toBeLessThan(5000);
      if (phase === "quiet" || phase === "clearance") expect(ops).toEqual([]);
      if (phase === "action" && timer === 0.7) {
        const p = urbanPackage(e, 0);
        expect(ops).toContainEqual(["translate", p.x, p.y]);
        expect(draw({ ...e, absorbed: 1 }, reduced)).not.toContainEqual(["translate", p.x, p.y]);
      }
    }
  }
});
