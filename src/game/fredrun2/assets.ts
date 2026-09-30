/** Asset-Laden: Bilder, Charakter-Atlanten, Props-Bibliothek. Alles fehlertolerant (Fallbacks statt Abbruch). */
import { withRev } from "./asset-rev";
import { PLAYER_VISUAL_H } from "./constants";
import type { AssetLoader, CharacterId, PropLibrary, SpriteOpts } from "./types";

export const ASSET_BASE = "/fredrun2";

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();

export function loadImage(url: string): Promise<HTMLImageElement | null> {
  if (typeof Image === "undefined") return Promise.resolve(null);
  const cached = imageCache.get(url);
  if (cached) return cached;
  const p = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = withRev(url); // versionierte URL: nach Updates keine veralteten Cache-Treffer
  });
  imageCache.set(url, p);
  return p;
}

export interface AnimDef {
  file: string;
  cols: number;
  rows: number;
  frames: number;
  cw: number;
  ch: number;
  cx: number;
  footY: number;
  scale: number;
  fps: number;
  loop: boolean;
}

interface AtlasJson {
  id: string;
  runHeight: number;
  anims: Record<string, Partial<AnimDef> & { file: string }>;
}

export type AnimName = "run" | "jump" | "fall" | "doublejump" | "slide" | "hurt" | "dash" | "stomp" | "idle" | "victory" | "glide";

export interface LoadedAnim extends AnimDef {
  img: HTMLImageElement;
}

export class CharacterSprites {
  readonly anims = new Map<string, LoadedAnim>();
  runHeight = 214;
  constructor(readonly id: CharacterId) {}

  has(name: string): boolean {
    return this.anims.has(name);
  }

  /** Beste verfügbare Animation (mit Fallback-Kette). */
  resolve(name: AnimName): LoadedAnim | null {
    const chain: Record<AnimName, AnimName[]> = {
      run: ["run"],
      jump: ["jump", "run"],
      fall: ["fall", "jump", "run"],
      doublejump: ["doublejump", "jump", "run"],
      slide: ["slide", "run"],
      hurt: ["hurt", "fall", "run"],
      dash: ["dash", "run"],
      stomp: ["stomp", "fall", "jump", "run"],
      idle: ["idle", "run"],
      victory: ["victory", "idle", "run"],
      glide: ["glide", "fall", "jump", "run"],
    };
    for (const n of chain[name]) {
      const a = this.anims.get(n);
      if (a) return a;
    }
    return null;
  }

  /** Frame-Index für Zeit t (Sek.). */
  frameAt(a: LoadedAnim, t: number, once = false): number {
    const raw = Math.floor(t * a.fps);
    if (a.loop && !once) return ((raw % a.frames) + a.frames) % a.frames;
    return Math.max(0, Math.min(a.frames - 1, raw));
  }

  /** Zeichnet die Figur mit Fußmitte bei (x, feetY). flipY = kopfüber (Decken-Lauf). */
  draw(
    g: CanvasRenderingContext2D,
    name: AnimName,
    t: number,
    x: number,
    feetY: number,
    o: { flipY?: boolean; alpha?: number; heightScale?: number; once?: boolean; frame?: number } = {},
  ): boolean {
    const a = this.resolve(name);
    if (!a) return false;
    const k = (PLAYER_VISUAL_H / this.runHeight) * a.scale * (o.heightScale ?? 1);
    const f = o.frame ?? this.frameAt(a, t, o.once);
    const col = f % a.cols;
    const row = Math.floor(f / a.cols);
    const dw = a.cw * k;
    const dh = a.ch * k;
    const prevAlpha = g.globalAlpha;
    if (o.alpha !== undefined) g.globalAlpha = prevAlpha * o.alpha;
    if (o.flipY) {
      g.save();
      g.translate(x, feetY);
      g.scale(1, -1);
      g.drawImage(a.img, col * a.cw, row * a.ch, a.cw, a.ch, -a.cx * k, -a.footY * k, dw, dh);
      g.restore();
    } else {
      g.drawImage(a.img, col * a.cw, row * a.ch, a.cw, a.ch, x - a.cx * k, feetY - a.footY * k, dw, dh);
    }
    g.globalAlpha = prevAlpha;
    return true;
  }
}

/** Notfall-Layout: Sprites des Originalspiels (192px-Zellen), falls der neue Atlas fehlt. */
const LEGACY: Record<CharacterId, Record<string, Partial<AnimDef> & { file: string }>> = {
  fred: {
    run: { file: "/fredrun/walk.png", cols: 8, rows: 8, frames: 64, fps: 22 },
    jump: { file: "/fredrun/jump.png", cols: 6, rows: 4, frames: 24, fps: 18, loop: false },
    victory: { file: "/fredrun/victory.png", cols: 8, rows: 8, frames: 64, fps: 18 },
  },
  frida: {
    run: { file: "/fredrun/frida/walk.webp", cols: 8, rows: 8, frames: 64, fps: 20 },
    jump: { file: "/fredrun/frida/jump.webp", cols: 8, rows: 8, frames: 64, fps: 20, loop: false },
    victory: { file: "/fredrun/frida/victory.webp", cols: 8, rows: 4, frames: 32, fps: 16 },
  },
  superfred: {
    run: { file: "/fredrun/superfred/walk.webp", cols: 8, rows: 8, frames: 64, fps: 20 },
    jump: { file: "/fredrun/superfred/jump.webp", cols: 8, rows: 8, frames: 64, fps: 20, loop: false },
    victory: { file: "/fredrun/superfred/victory.webp", cols: 8, rows: 8, frames: 64, fps: 16 },
  },
  cyberfred: {
    run: { file: "/fredrun/cyberfred/walk.webp", cols: 8, rows: 8, frames: 64, fps: 20 },
    jump: { file: "/fredrun/cyberfred/jump.webp", cols: 8, rows: 4, frames: 32, fps: 22, loop: false },
    victory: { file: "/fredrun/cyberfred/victory.webp", cols: 8, rows: 8, frames: 64, fps: 16 },
  },
  superfrida: {
    run: { file: "/fredrun/superfrida/walk.webp", cols: 8, rows: 8, frames: 64, fps: 20 },
    jump: { file: "/fredrun/superfrida/jump.webp", cols: 8, rows: 8, frames: 64, fps: 20, loop: false },
    victory: { file: "/fredrun/superfrida/victory.webp", cols: 8, rows: 8, frames: 64, fps: 16 },
  },
};

const charCache = new Map<CharacterId, Promise<CharacterSprites>>();

async function fetchJson<T>(url: string, cache: RequestCache = "force-cache"): Promise<T | null> {
  try {
    const res = await fetch(withRev(url), { cache });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function loadCharacter(id: CharacterId, only?: AnimName[]): Promise<CharacterSprites> {
  const key = id;
  const cached = charCache.get(key);
  if (cached && !only) return cached;
  const p = (async () => {
    const sprites = new CharacterSprites(id);
    const atlas = await fetchJson<AtlasJson>(`${ASSET_BASE}/chars/${id}/atlas.json`);
    let defs: Record<string, Partial<AnimDef> & { file: string }>;
    let base: string;
    if (atlas && atlas.anims && atlas.anims.run) {
      defs = atlas.anims;
      base = `${ASSET_BASE}/chars/${id}/`;
      sprites.runHeight = atlas.runHeight || 214;
    } else {
      defs = LEGACY[id];
      base = "";
      sprites.runHeight = 118; // Original: Figur ≈ 118 px in 192er Zelle
    }
    const names = Object.keys(defs).filter((n) => !only || only.includes(n as AnimName));
    await Promise.all(
      names.map(async (name) => {
        const d = defs[name];
        const img = await loadImage(base ? `${base}${d.file}` : d.file);
        if (!img) return;
        const cw = d.cw ?? 192;
        const ch = d.ch ?? 192;
        sprites.anims.set(name, {
          img,
          file: d.file,
          cols: d.cols ?? Math.max(1, Math.floor(img.width / cw)),
          rows: d.rows ?? Math.max(1, Math.floor(img.height / ch)),
          frames: d.frames ?? 1,
          cw,
          ch,
          cx: d.cx ?? cw / 2,
          footY: d.footY ?? ch - 6,
          scale: d.scale ?? 1,
          fps: d.fps ?? 24,
          loop: d.loop ?? true,
        });
      }),
    );
    return sprites;
  })();
  if (!only) charCache.set(key, p);
  return p;
}

// --- Props ------------------------------------------------------------------------------------

interface PropDef {
  file: string;
  cols: number;
  rows: number;
  frames: number;
  cw: number;
  ch: number;
  ax: number;
  ay: number;
  fps: number;
  loop: boolean;
  tags?: string[];
}

class PropLib implements PropLibrary {
  private defs = new Map<string, PropDef>();
  private imgs = new Map<string, HTMLImageElement>();
  private pending = new Map<string, Promise<void>>();
  private manifestP: Promise<void> | null = null;

  ensureManifest(): Promise<void> {
    if (!this.manifestP) this.manifestP = this.fetchManifest("force-cache");
    return this.manifestP;
  }

  private async fetchManifest(cache: RequestCache): Promise<void> {
    const json = await fetchJson<{ props: Record<string, PropDef> }>(`${ASSET_BASE}/props/manifest.json`, cache);
    if (json?.props) for (const [id, d] of Object.entries(json.props)) this.defs.set(id, d);
  }

  private reloaded = false;

  ids(): string[] {
    return [...this.defs.keys()];
  }

  has(id: string): boolean {
    return this.imgs.has(id);
  }

  async preload(ids: string[]): Promise<void> {
    await this.ensureManifest();
    // Gürtel und Hosenträger: fehlen angeforderte Props im Manifest (veralteter Cache), einmalig am Cache vorbei neu laden.
    if (!this.reloaded && ids.some((id) => !this.defs.has(id))) {
      this.reloaded = true;
      await this.fetchManifest("reload");
    }
    await Promise.all(
      ids.map((id) => {
        const def = this.defs.get(id);
        if (!def || this.imgs.has(id)) return Promise.resolve();
        let p = this.pending.get(id);
        if (!p) {
          p = loadImage(`${ASSET_BASE}/props/${def.file}`).then((img) => {
            if (img) this.imgs.set(id, img);
          });
          this.pending.set(id, p);
        }
        return p;
      }),
    );
  }

  cell(id: string): { w: number; h: number; frames: number } | null {
    const d = this.defs.get(id);
    return d ? { w: d.cw, h: d.ch, frames: d.frames } : null;
  }

  draw(g: CanvasRenderingContext2D, id: string, x: number, y: number, o: SpriteOpts = {}): boolean {
    const d = this.defs.get(id);
    const img = this.imgs.get(id);
    if (!d || !img) return false;
    let k = o.scale ?? 1;
    if (o.h !== undefined) k = o.h / d.ch;
    else if (o.w !== undefined) k = o.w / d.cw;
    const dw = d.cw * k * (o.sx ?? 1);
    const dh = d.ch * k;
    let f = o.frame ?? 0;
    if (o.frame === undefined && d.frames > 1) {
      const raw = Math.floor((o.t ?? 0) * (d.fps || 12));
      f = o.once ? Math.min(d.frames - 1, raw) : ((raw % d.frames) + d.frames) % d.frames;
    }
    const col = f % d.cols;
    const row = Math.floor(f / d.cols);
    const ax = o.ax ?? d.ax;
    const ay = o.ay ?? d.ay;
    const needsTransform = o.flipX || o.flipY || o.rotation;
    const prevAlpha = g.globalAlpha;
    if (o.alpha !== undefined) g.globalAlpha = prevAlpha * o.alpha;
    if (needsTransform) {
      g.save();
      g.translate(x, y);
      if (o.rotation) g.rotate(o.rotation);
      g.scale(o.flipX ? -1 : 1, o.flipY ? -1 : 1);
      g.drawImage(img, col * d.cw, row * d.ch, d.cw, d.ch, -ax * dw, -ay * dh, dw, dh);
      g.restore();
    } else {
      g.drawImage(img, col * d.cw, row * d.ch, d.cw, d.ch, x - ax * dw, y - ay * dh, dw, dh);
    }
    g.globalAlpha = prevAlpha;
    return true;
  }
}

export function createAssetLoader(): AssetLoader & { props: PropLib } {
  return { image: loadImage, props: new PropLib() };
}

export type GameAssets = ReturnType<typeof createAssetLoader>;
