/**
 * Test-Hilfen für Vitest (Umgebung „node“, kein DOM): `installCanvasStub()` ersetzt `document` so, dass
 * `createElement("canvas")` zählbare Attrappen mit einem Proxy-Zeichenkontext liefert (alle Aufrufe erlaubt, Zustand
 * wird gemerkt, `reset()` wird gezählt; mit `vi.unstubAllGlobals()` im afterEach entfernen). Dazu eine Prop-Bibliothek
 * nach dem echten Manifest und ein vollständiger ViewState für Renderer-Aufrufe.
 */
import { readFileSync } from "node:fs";
import { vi } from "vitest";
import type { AssetLoader, PropLibrary, ViewState } from "../../types";

export interface StubCanvas {
  width: number;
  height: number;
  getContext(kind: string): CanvasRenderingContext2D;
  /** Anzahl `reset()` auf dem Kontext dieser Fläche */
  resets: number;
}

export interface CanvasStub {
  /** alle bisher erzeugten Flächen */
  canvases: StubCanvas[];
  /** Anzahl erzeugter Flächen */
  readonly created: number;
}

function makeContext(canvas: StubCanvas): CanvasRenderingContext2D {
  const state: Record<string, unknown> = { canvas, globalAlpha: 1, lineWidth: 1, globalCompositeOperation: "source-over", imageSmoothingQuality: "low", lineDashOffset: 0, shadowBlur: 0 };
  const grad = { addColorStop(): void {} };
  return new Proxy(state, {
    get(t, prop: string) {
      if (prop in t) return t[prop];
      if (prop === "createLinearGradient" || prop === "createRadialGradient" || prop === "createConicGradient") return (): unknown => grad;
      if (prop === "reset") {
        return (): void => {
          canvas.resets += 1;
          t.globalAlpha = 1;
          t.globalCompositeOperation = "source-over";
        };
      }
      return (): undefined => undefined;
    },
    set(t, prop: string, value: unknown) {
      t[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

export function installCanvasStub(): CanvasStub {
  const canvases: StubCanvas[] = [];
  vi.stubGlobal("document", {
    createElement: (): StubCanvas => {
      let ctx: CanvasRenderingContext2D | null = null;
      const c: StubCanvas = {
        width: 0,
        height: 0,
        resets: 0,
        getContext(): CanvasRenderingContext2D {
          ctx ??= makeContext(c);
          return ctx;
        },
      };
      canvases.push(c);
      return c;
    },
  });
  return {
    canvases,
    get created(): number {
      return canvases.length;
    },
  };
}

export interface RecordingCanvas extends StubCanvas {
  /** alle Zeichenbefehle und Eigenschaftswerte dieser Fläche in Reihenfolge ("fillRect(0,0,10,5)", "fillStyle=#fff", …) */
  log: string[];
}

/**
 * Wie `installCanvasStub`, aber der Kontext schreibt jeden Aufruf und jede Zuweisung ins `log` der Fläche. Damit lassen
 * sich zwei Wege zum selben Bild (z.B. Einfärben in Schritten oder am Stück) auf IDENTISCHE Zeichenbefehle prüfen.
 * Flächen und Verläufe erscheinen als `<canvas WxH>` bzw. `<grad n>`.
 */
export function installRecordingStub(): { canvases: RecordingCanvas[] } {
  const canvases: RecordingCanvas[] = [];
  vi.stubGlobal("document", {
    createElement: (): RecordingCanvas => {
      let ctx: CanvasRenderingContext2D | null = null;
      const log: string[] = [];
      const c: RecordingCanvas = {
        width: 0,
        height: 0,
        resets: 0,
        log,
        getContext(): CanvasRenderingContext2D {
          if (ctx) return ctx;
          let grads = 0;
          const fmt = (a: unknown): string => {
            if (typeof a === "number") return String(Math.round(a * 1000) / 1000);
            if (a && typeof a === "object") {
              const o = a as { width?: number; height?: number; gradId?: number };
              if (o.gradId !== undefined) return `<grad ${o.gradId}>`;
              if (o.width !== undefined) return `<canvas ${o.width}x${o.height}>`;
            }
            return String(a);
          };
          const state: Record<string, unknown> = { canvas: c, globalAlpha: 1, globalCompositeOperation: "source-over" };
          ctx = new Proxy(state, {
            get(t, prop: string) {
              if (prop in t) return t[prop];
              if (prop === "createLinearGradient" || prop === "createRadialGradient" || prop === "createConicGradient") {
                return (...a: unknown[]): unknown => {
                  grads += 1;
                  const id = grads;
                  log.push(`${prop}#${id}(${a.map(fmt).join(",")})`);
                  return { gradId: id, addColorStop: (...b: unknown[]): void => void log.push(`grad${id}.addColorStop(${b.map(fmt).join(",")})`) };
                };
              }
              if (prop === "reset") return (): void => void (c.resets += 1);
              return (...a: unknown[]): undefined => {
                log.push(`${prop}(${a.map(fmt).join(",")})`);
                return undefined;
              };
            },
            set(t, prop: string, value: unknown) {
              t[prop] = value;
              log.push(`${prop}=${fmt(value)}`);
              return true;
            },
          }) as unknown as CanvasRenderingContext2D;
          return ctx;
        },
      };
      canvases.push(c);
      return c;
    },
  });
  return { canvases };
}

export interface TouchStub {
  /** Quellen, die `touchCanvas` gerastert hat (in Reihenfolge) */
  touched: unknown[];
  /** Argumente des letzten `drawImage` (sx, sy, sw, sh, dx, dy, dw, dh) */
  lastArgs: number[];
  /** Anzahl `clearRect` (jede Berührung gibt die Quelle wieder frei) */
  clears: number;
  /** Anzahl angelegter Berührungsflächen (OffscreenCanvas) */
  sinks: number;
}

/**
 * Ersetzt `OffscreenCanvas` durch eine Attrappe, an der `touchCanvas` (Rastern erzwingen) sichtbar wird. Jeder Aufruf
 * ersetzt die Klasse; `touchCanvas` legt dann seine Berührungsfläche neu an. Mit `vi.unstubAllGlobals()` entfernen.
 */
export function installTouchStub(opts: { throws?: boolean } = {}): TouchStub {
  const rec: TouchStub = { touched: [], lastArgs: [], clears: 0, sinks: 0 };
  class FakeOffscreen {
    constructor(
      readonly width: number,
      readonly height: number,
    ) {
      rec.sinks += 1;
    }
    getContext(): unknown {
      return {
        drawImage: (src: unknown, ...a: number[]): void => {
          if (opts.throws) throw new Error("Quelle nicht lesbar");
          rec.touched.push(src);
          rec.lastArgs = a;
        },
        clearRect: (): void => {
          rec.clears += 1;
        },
      };
    }
  }
  vi.stubGlobal("OffscreenCanvas", FakeOffscreen);
  return rec;
}

/** Prop-Bibliothek nach public/fredrun2/props/manifest.json (Zellmaße echt, `draw` ohne Wirkung) */
export function manifestProps(): PropLibrary {
  const manifest = JSON.parse(readFileSync("public/fredrun2/props/manifest.json", "utf8")) as { props: Record<string, { cw: number; ch: number; frames: number }> };
  return {
    has: (id) => id in manifest.props,
    preload: async () => undefined,
    draw: () => true,
    cell: (id) => (manifest.props[id] ? { w: manifest.props[id].cw, h: manifest.props[id].ch, frames: manifest.props[id].frames } : null),
  };
}

/** Bibliothek ohne Props (alle Skins nutzen ihre prozeduralen Ersatzbilder) */
export const NO_PROPS: PropLibrary = { has: () => false, preload: async () => undefined, draw: () => false, cell: () => null };

/** Bild-Attrappe (z.B. für gemalte Kulissen); `null` = keine Bilder, die Welt malt ihren Ersatz */
export const FAKE_IMAGE = { width: 2172, height: 665 } as unknown as HTMLImageElement;

export function assetsOf(props: PropLibrary, image: HTMLImageElement | null = null): AssetLoader {
  return { image: async () => image, props };
}

/** Vollständiger ViewState (Standardwerte: Stufe 0, Qualität 2, keine Sonderwerte); `over` überschreibt einzelne Felder */
export function stubView(over: Partial<ViewState> = {}): ViewState {
  return {
    w: 1280,
    h: 720,
    dist: 0,
    speed: 600,
    time: 0,
    dt: 1 / 60,
    groundY: 590,
    ceilY: 150,
    worldMeters: 0,
    stage: 0,
    stageBlend: 0,
    intensity: 0.5,
    gravDir: 1,
    playerX: 300,
    playerFeetY: 590,
    hurtGlow: 0,
    dashing: false,
    turbo: false,
    slowmo: 0,
    reducedMotion: false,
    quality: 2,
    vars: {},
    flash: 0,
    ...over,
  };
}
