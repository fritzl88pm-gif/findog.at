/** Asset-Laden: Bilder, Charakter-Atlanten, Props-Bibliothek. Alles fehlertolerant (Fallbacks statt Abbruch). */
import { withRev } from "./asset-rev";
import { PLAYER_VISUAL_H } from "./constants";
import type { AssetLoader, CharacterId, PropLibrary, SpriteOpts } from "./types";

export const ASSET_BASE = "/fredrun2";

/** Wie lange ein Bild höchstens laden darf, bevor es als gescheitert gilt (hängende Anfrage statt Fehler). */
export const IMAGE_TIMEOUT_MS = 20_000;
/** Ein stiller Wiederholungsversuch nach Fehlschlag/Timeout (füllt den Cache für spätere Aufrufe, Aufrufer bekommen sofort null). */
export const IMAGE_RETRY_MS = 1500;

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();

/** Ein einzelner Ladeversuch mit Timeout; liefert null bei Fehler/Timeout (die hängende Anfrage wird abgebrochen). */
function fetchImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    let done = false;
    const finish = (result: HTMLImageElement | null, abort: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      if (abort) {
        try {
          img.src = ""; // Anfrage abbrechen, damit sie nicht parallel zum Retry weiterläuft
        } catch {
          // egal
        }
      }
      resolve(result);
    };
    const timer = setTimeout(() => finish(null, true), IMAGE_TIMEOUT_MS);
    img.decoding = "async";
    img.onload = () => finish(img, false);
    img.onerror = () => finish(null, false);
    img.src = withRev(url); // versionierte URL: nach Updates keine veralteten Cache-Treffer
  });
}

function startLoad(url: string, allowRetry: boolean): Promise<HTMLImageElement | null> {
  const p: Promise<HTMLImageElement | null> = fetchImage(url).then((img) => {
    if (!img) {
      // Fehlschläge nicht dauerhaft merken: der nächste Aufruf (ensure*, Weltstart) versucht es neu
      if (imageCache.get(url) === p) imageCache.delete(url);
      if (allowRetry) {
        setTimeout(() => {
          if (!imageCache.has(url)) void startLoad(url, false);
        }, IMAGE_RETRY_MS);
      }
    }
    return img;
  });
  imageCache.set(url, p);
  return p;
}

export function loadImage(url: string): Promise<HTMLImageElement | null> {
  if (typeof Image === "undefined") return Promise.resolve(null);
  return imageCache.get(url) ?? startLoad(url, true);
}

// --- Dekodier-Warmup -------------------------------------------------------------------------------------------------
// Der Browser dekodiert ein Bild erst beim ersten drawImage (Figuren-Sheet 13–52 ms, auf Handys 3–5x so viel) – mitten im Spiel
// als Hänger beim ersten Rutschen/Dash/Stampfer/Gegner. Ein 1×1-Warm-Draw absorbiert diese Kosten; der echte Draw kostet danach
// ~0,3 ms. Die Sheets werden gestaffelt abgearbeitet (ein Schritt je Leerlauf-Slot), die wichtigsten zuerst.
// WICHTIG: Der Warm-Draw muss im selben Canvas-Backend laufen wie die Spielfläche (render.ts: getContext("2d", { alpha: false }),
// auf Geräten mit Hardware-Canvas GPU-gestützt). Eine CPU-Canvas (willReadFrequently + getImageData) füllt nur den Software-
// Dekodier-Cache; der Erst-Draw der GPU-Fläche trifft einen anderen Cache und bliebe unverändert teuer (gemessen: Summe der
// 10 Fred-Sheets 223–255 ms mit und ohne altes Warmup, 1 ms mit Warm-Draw im GPU-Backend). Deshalb: Warm-Canvas ohne
// willReadFrequently, Flush per createImageBitmap (kein Rücklesen – Chrome schaltet eine GPU-Canvas nach zwei Rücklesungen auf
// Software um); getImageData nur als Rückfall in Browsern ohne createImageBitmap.
// Das Warmup ist ausdrücklich ANGEFORDERT, nie ein Nebeneffekt eines bloßen loadCharacter(id): Menü-Vorschauen laden alle Helden,
// und deren ~10 Sheets (je Held 50–60 MB dekodiert) dürfen nicht dauerhaft Speicher und Hauptthread-Zeit belegen, nur weil ein
// Held angezeigt wurde. Vertrag für den Spiel-Hub (game.ts):
//   const core = await loadCharacter(id, ["run", "jump", "fall", "idle"], { warm: true }); // gespielter/gewählter Held, Kern zuerst
//   void loadCharacter(id, undefined, { warm: true });                                    // Rest im Hintergrund (neues Objekt!)
//   ...                                                                                   // Weltstart, Menü, Countdown
//   await assets.warmed(true);                                                            // vor dem Countdown-Ende: alles dekodiert
// { warm: true } fordert das Warmup nach dem Laden an UND lässt warmed() auf diesen Ladevorgang warten (kein "sofort erfüllt",
// solange die Sheets noch unterwegs sind). Menü-Vorschauen (characterStage, CharacterSelect) rufen loadCharacter OHNE warm auf.
// Wer die Sprites schon hat, fordert mit warmCharacter(sprites) an. PropLib.preload() wärmt die Welt-Props selbst.

/** Zeitbudget je Slot (ein Sheet kostet 13–52 ms, danach wird der Slot beendet). */
const WARM_BUDGET_MS = 24;
/** Kantenlänge der Warm-Canvas: Chrome beschleunigt sehr kleine Canvas nicht (ältere Versionen: unter 128×129 px), sie soll aber im selben Backend wie die Spielfläche landen. */
const WARM_CANVAS_PX = 129;
/** Hängt der asynchrone Flush (createImageBitmap) länger, geht die Warteschlange trotzdem weiter (sonst bliebe warmed() offen). */
const WARM_FLUSH_TIMEOUT_MS = 500;
/** Mindest-Leerlauf, den ein requestIdleCallback-Slot melden muss, damit ein Sheet gewärmt wird. */
const WARM_MIN_IDLE_MS = 12;
/** Wartet das Warmup so lange ohne ausreichenden Leerlauf (laufendes Spiel), läuft ein Slot trotzdem. */
const WARM_FORCE_MS = 1000;
/** Mindestabstand zwischen Slots im setTimeout-Pfad (zusätzlich zur Dauer des letzten Slots). */
const WARM_GAP_MS = 4;

/** Reihenfolge: Spielbewegungen zuerst, Gegner-/Welt-Props danach, Idle/Siegerpose (je ca. 8 MB) zuletzt. */
const ANIM_WARM_PRIO: Record<string, number> = { run: 0, jump: 1, fall: 2, slide: 3, dash: 4, stomp: 5, doublejump: 6, hurt: 7, glide: 8, idle: 20, victory: 21 };
const PROP_WARM_PRIO = 10;
const OTHER_WARM_PRIO = 15;

let warmDoc: Document | null = null;
let warmCanvas: HTMLCanvasElement | null = null;
let warmCtx: CanvasRenderingContext2D | null = null;
/** true: Flush per createImageBitmap (Backend wie die Spielfläche); false: Rückfall auf getImageData (CPU-Canvas). */
let warmAsync = false;

function closeBitmap(b: ImageBitmap): void {
  try {
    b.close(); // das Ergebnis interessiert nicht, nur der Flush; Speicher sofort freigeben
  } catch {
    // egal
  }
}

function ignore(): void {
  // fehlgeschlagener Flush: das Warmup ist reine Optimierung
}

/**
 * Erzwingt Dekodierung/Aufbereitung eines geladenen Bildes im Canvas-Backend der Spielfläche: 1×1-Ausschnitt in eine kleine
 * Warm-Canvas (ohne willReadFrequently, wie render.ts) zeichnen und per createImageBitmap flushen. Der Flush selbst läuft
 * synchron (die Dekodierkosten fallen im Aufruf an), das Ergebnis kommt aber asynchron: Rückgabe = Promise, das erfüllt ist,
 * wenn der Flush durch ist (nie abgelehnt) – die WarmQueue wartet darauf, bevor sie das nächste Bild wärmt.
 * Rückgabe undefined: nichts zu warten (kaputtes/fehlendes Bild, kein DOM/Canvas, oder per getImageData-Rückfall bereits
 * synchron geflusht). Wirft nie.
 */
export function warmImage(img: HTMLImageElement | null | undefined): Promise<void> | undefined {
  try {
    if (!img || typeof document === "undefined" || !img.naturalWidth || !img.naturalHeight) return undefined;
    if (warmDoc !== document) {
      warmCanvas = null;
      warmCtx = null;
      warmAsync = typeof createImageBitmap === "function";
      const c = document.createElement("canvas"); // wirft das, bleibt warmDoc ungesetzt (nächster Aufruf versucht es neu)
      c.width = WARM_CANVAS_PX;
      c.height = WARM_CANVAS_PX;
      warmCanvas = c;
      // Gleiche Optionen wie die Spielfläche (kein willReadFrequently: das erzwänge das Software-Backend)
      warmCtx = warmAsync ? c.getContext("2d", { alpha: false }) : c.getContext("2d", { willReadFrequently: true });
      warmDoc = document;
    }
    if (!warmCtx || !warmCanvas) return undefined;
    warmCtx.drawImage(img, 0, 0, 1, 1, 0, 0, 1, 1);
    if (!warmAsync) {
      warmCtx.getImageData(0, 0, 1, 1); // Rückfall (kein createImageBitmap): Rücklesen als Flush
      return undefined;
    }
    return createImageBitmap(warmCanvas, 0, 0, 1, 1).then(closeBitmap, ignore);
  } catch {
    return undefined;
  }
}

export interface WarmDeps {
  /**
   * Wärmt ein Bild (wirft nie). Liefert optional ein Promise für einen asynchron endenden Flush: die Warteschlange startet das
   * nächste Bild erst, wenn es erfüllt ist (höchstens WARM_FLUSH_TIMEOUT_MS), und whenIdle() erfüllt erst danach.
   */
  warm: (img: HTMLImageElement) => Promise<unknown> | void;
  /**
   * Plant einen Slot; cb bekommt den verfügbaren Leerlauf in ms. delayHintMs = Dauer des letzten Slots (nur setTimeout-Pfad),
   * urgent = ohne Leerlauf-Wartezeit so bald wie möglich (Lade-/Countdown-Phase).
   */
  schedule: (cb: (availMs: number) => void, delayHintMs: number, urgent: boolean) => void;
  now: () => number;
}

interface WarmJob {
  img: HTMLImageElement;
  prio: number;
  /** Zugehörigkeit (Figur-ID); null = gehört niemandem (Welt-Props) und wird von supersede() nie verworfen. */
  group: string | null;
}

function isPromiseLike(x: unknown): x is Promise<unknown> {
  return typeof x === "object" && x !== null && typeof (x as { then?: unknown }).then === "function";
}

/** Prioritäts-Warteschlange für das Warmup; reine Logik mit eingespeisten Abhängigkeiten (testbar ohne DOM). */
export class WarmQueue {
  private jobs: WarmJob[] = [];
  private loads = 0;
  private scheduled = false;
  /** Ein Slot wartet auf den asynchronen Flush seines letzten Bildes (dann läuft kein zweiter Slot und whenIdle bleibt offen). */
  private inflight = false;
  private urgent = false;
  private gen = 0;
  private waitSince = -1;
  private lastSlotMs = 0;
  private waiters: Array<() => void> = [];
  private readonly seen = new WeakSet<object>();

  constructor(private readonly deps: WarmDeps) {}

  /** Bild einreihen (niedrigere prio zuerst, bei Gleichstand in Eingangsreihenfolge; jedes Bild nur einmal). */
  add(img: HTMLImageElement | null | undefined, prio: number, group: string | null = null): void {
    if (!img || this.seen.has(img)) return;
    this.seen.add(img);
    let i = this.jobs.length;
    while (i > 0 && this.jobs[i - 1].prio > prio) i--;
    this.jobs.splice(i, 0, { img, prio, group });
    this.kick();
  }

  /**
   * Verwirft die wartenden Jobs aller Gruppen außer keep (Held gewechselt: der Rest des früheren Helden ist wertlos).
   * Gruppenlose Jobs (Props) bleiben. Verworfene Bilder dürfen später erneut eingereiht werden. Rückgabe: Anzahl verworfener Jobs.
   */
  supersede(keep: string): number {
    const before = this.jobs.length;
    this.jobs = this.jobs.filter((j) => {
      if (j.group === null || j.group === keep) return true;
      this.seen.delete(j.img);
      return false;
    });
    const dropped = before - this.jobs.length;
    if (dropped > 0) this.settle(); // war das der letzte offene Job, werden wartende whenIdle() erfüllt
    return dropped;
  }

  /** Läuft ein Ladevorgang (der später add() aufruft)? Dann erfüllt whenIdle() erst nach dessen Ende. */
  track<T>(p: Promise<T>): Promise<T> {
    this.loads++;
    const done = (): void => {
      this.loads--;
      this.settle();
    };
    p.then(done, done);
    return p;
  }

  /**
   * Erfüllt, wenn alle angemeldeten Ladevorgänge beendet und alle eingereihten Bilder gewärmt sind (auch ohne Bilder sofort).
   * urgent: nicht auf Leerlauf warten, sondern Slot an Slot (für Lade-/Countdown-Phasen, in denen ein Ruckeln nicht stört);
   * ohne urgent läuft das Warmup nur in Leerlauf-Slots und lässt ein laufendes Spiel in Ruhe.
   */
  whenIdle(urgent = false): Promise<void> {
    if (this.loads === 0 && this.jobs.length === 0 && !this.inflight) return Promise.resolve();
    if (urgent && !this.urgent) {
      this.urgent = true;
      if (this.jobs.length > 0) {
        this.scheduled = false; // einen evtl. noch wartenden Leerlauf-Slot ablösen (er wird über gen ungültig)
        this.kick();
      }
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private kick(): void {
    if (this.scheduled || this.inflight || this.jobs.length === 0) return;
    this.scheduled = true;
    if (this.waitSince < 0) this.waitSince = this.deps.now();
    const gen = ++this.gen;
    this.deps.schedule((availMs) => this.slot(availMs, gen), this.lastSlotMs, this.urgent);
  }

  private slot(availMs: number, gen: number): void {
    if (gen !== this.gen) return; // abgelöster Slot
    this.scheduled = false;
    const t0 = this.deps.now();
    // Zu wenig Leerlauf (Spiel läuft): erst nach WARM_FORCE_MS trotzdem ein Sheet, damit das Warmup nicht verhungert
    if (!this.urgent && availMs < WARM_MIN_IDLE_MS && t0 - this.waitSince < WARM_FORCE_MS) {
      this.kick();
      return;
    }
    this.work(t0, Math.min(WARM_BUDGET_MS, Math.max(availMs, 1)));
  }

  /**
   * Wärmt Bilder, bis das Budget des Slots aufgebraucht ist. Liefert warm() ein Promise (asynchroner Flush), pausiert der Slot bis
   * zu dessen Ende (oder WARM_FLUSH_TIMEOUT_MS) und prüft danach das Budget erneut: Wanduhrzeit ab Slotbeginn, ein Slot läuft
   * also nie über sein Leerlauf-Fenster hinaus weiter.
   */
  private work(t0: number, budget: number): void {
    while (this.jobs.length > 0) {
      const job = this.jobs.shift() as WarmJob;
      let pending: unknown;
      try {
        pending = this.deps.warm(job.img);
      } catch {
        // Warmup ist reine Optimierung
      }
      if (isPromiseLike(pending)) {
        this.inflight = true;
        this.awaitFlush(pending, () => {
          this.inflight = false;
          if (this.jobs.length > 0 && this.deps.now() - t0 < budget) this.work(t0, budget);
          else this.endSlot(t0);
        });
        return;
      }
      if (this.deps.now() - t0 >= budget) break;
    }
    this.endSlot(t0);
  }

  /** Ruft done einmal auf, sobald p erfüllt/abgelehnt ist, spätestens nach WARM_FLUSH_TIMEOUT_MS (ein hängender Flush stoppt das Warmup nicht). */
  private awaitFlush(p: Promise<unknown>, done: () => void): void {
    let fired = false;
    const finish = (): void => {
      if (fired) return;
      fired = true;
      clearTimeout(timer);
      done();
    };
    const timer = setTimeout(finish, WARM_FLUSH_TIMEOUT_MS);
    try {
      p.then(finish, finish);
    } catch {
      finish();
    }
  }

  private endSlot(t0: number): void {
    this.lastSlotMs = this.deps.now() - t0;
    this.waitSince = -1;
    this.kick();
    this.settle();
  }

  private settle(): void {
    if (this.loads > 0 || this.jobs.length > 0 || this.inflight) return;
    this.urgent = false; // alles gewärmt: Eilmodus endet
    if (this.waiters.length === 0) return;
    const w = this.waiters;
    this.waiters = [];
    for (const resolve of w) resolve();
  }
}

function warmNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function warmSchedule(cb: (availMs: number) => void, delayHintMs: number, urgent: boolean): void {
  if (urgent) {
    setTimeout(() => cb(WARM_BUDGET_MS), 0);
    return;
  }
  if (typeof requestIdleCallback === "function" && !(typeof document !== "undefined" && document.hidden)) {
    requestIdleCallback((d) => cb(d.didTimeout ? WARM_BUDGET_MS : d.timeRemaining()), { timeout: WARM_FORCE_MS });
    return;
  }
  // Safari/Hintergrund-Tab: setTimeout, Abstand mindestens so lang wie der letzte Slot (höchstens ~50 % Last)
  setTimeout(() => cb(WARM_BUDGET_MS), Math.max(WARM_GAP_MS, delayHintMs));
}

const warmQueue = new WarmQueue({ warm: warmImage, schedule: warmSchedule, now: warmNow });

/** Einreihen ohne DOM (SSR/Tests ohne document) überspringen – dort gibt es nichts zu wärmen. */
function queueWarm(img: HTMLImageElement | null | undefined, prio: number, group: string | null = null): void {
  if (typeof document !== "undefined") warmQueue.add(img, prio, group);
}

/**
 * Erfüllt, sobald alle laufenden Ladevorgänge mit Warmup-Anforderung (loadCharacter mit { warm: true }, PropLib.preload) beendet
 * und alle eingereihten Sheets (Figuren, Props) dekodiert sind (auch ohne Bilder oder bei fehlgeschlagenen Bildern; Ladefehler
 * sind durch das 20-s-Timeout begrenzt). Ein loadCharacter OHNE warm (Menü-Vorschau) zählt nicht und reiht nichts ein.
 * urgent = true: sofort Slot an Slot abarbeiten (Ladebildschirm/Countdown) statt nur im Leerlauf – im laufenden Spiel
 * kommt das Warmup sonst nur etwa im Sekundentakt voran, weil dort kaum Leerlauf bleibt.
 */
export function warmed(urgent = false): Promise<void> {
  return warmQueue.whenIdle(urgent);
}

/**
 * Held des jüngsten Warmup-Wunsches (loadCharacter mit warm, warmCharacter). Ladevorgänge enden in beliebiger Reihenfolge: wer
 * erst Held A und gleich darauf Held B anfordert, soll B gewärmt bekommen, auch wenn A's Atlas später eintrifft – sonst
 * verdrängte der Nachzügler A die Sheets des Helden, der tatsächlich gespielt wird.
 */
let warmTarget: CharacterId | null = null;

/** Reiht die Sheets der Figur ein (synchron, kein Warten); verdrängt wartende Jobs eines früheren Helden. */
function enqueueCharacter(sprites: CharacterSprites): void {
  if (typeof document === "undefined") return;
  warmQueue.supersede(sprites.id);
  for (const [name, a] of sprites.anims) warmQueue.add(a.img, ANIM_WARM_PRIO[name] ?? OTHER_WARM_PRIO, sprites.id);
}

/**
 * Fordert das Dekodier-Warmup für bereits geladene Sprites an (der gespielte bzw. gerade gewählte Held; für Menü-Vorschauen
 * nie: dort würde jeder angezeigte Held ~10 Sheets dauerhaft dekodiert halten). Wer erst lädt, nimmt stattdessen
 * loadCharacter(id, only, { warm: true }). Reihenfolge: Bewegungen (run, jump, fall, slide, dash, stomp, doublejump, hurt),
 * dann Welt-Props, idle/victory (je ca. 8 MB) zuletzt. Wartende Jobs eines früheren Helden werden verworfen (Heldenwechsel),
 * bereits gewärmte Bilder nie doppelt gewärmt. Auch mit nur teilweise geladener Figur und mehrfach aufrufbar (z. B. nochmals mit
 * der vollständigen). Rückgabe wie warmed(urgent): erfüllt, wenn alles gewärmt ist.
 */
export function warmCharacter(sprites: CharacterSprites | null | undefined, urgent = false): Promise<void> {
  if (sprites) {
    warmTarget = sprites.id;
    enqueueCharacter(sprites);
  }
  return warmQueue.whenIdle(urgent);
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

export interface LoadCharacterOpts {
  /**
   * true für den gespielten bzw. gerade gewählten Helden: nach dem Laden das Dekodier-Warmup anfordern (warmCharacter) und
   * warmed() auf diesen Ladevorgang warten lassen. Fehlt es (Menü-Vorschau), wird nichts gewärmt.
   */
  warm?: boolean;
}

/**
 * Lädt die Atlanten einer Figur (mit only nur die genannten Animationen; ohne only gecached). Ohne opts.warm wird NICHTS
 * gewärmt: Menü-Vorschauen laden jeden angezeigten Helden. Der Spiel-Hub lädt mit { warm: true } (Vertrag im Kopfblock des
 * Warmups) und wartet vor dem Countdown auf warmed(true). Ist zwischenzeitlich ein anderer Held angefordert worden (später
 * gestartetes warm-Laden oder warmCharacter), entfällt die Anforderung für diesen Nachzügler; er wird trotzdem geladen.
 */
export function loadCharacter(id: CharacterId, only?: AnimName[], opts?: LoadCharacterOpts): Promise<CharacterSprites> {
  const p = loadSprites(id, only);
  if (!opts?.warm) return p;
  warmTarget = id; // beim Anfordern festhalten, nicht erst beim Eintreffen (Ladereihenfolge ≠ Anforderungsreihenfolge)
  // track: warmed() wartet auf Laden UND Einreihen (done läuft erst nach dem then, wenn die Jobs schon in der Warteschlange stehen)
  return warmQueue.track(
    p.then((sprites) => {
      if (warmTarget === id) enqueueCharacter(sprites);
      return sprites;
    }),
  );
}

function loadSprites(id: CharacterId, only?: AnimName[]): Promise<CharacterSprites> {
  const key = id;
  const cached = charCache.get(key);
  if (cached && !only) return cached;
  let self: Promise<CharacterSprites> | null = null; // für den Cache-Vergleich unten (die IIFE startet vor der Zuweisung an p)
  const p: Promise<CharacterSprites> = (async () => {
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
    // Unvollständig geladene Figur (Bild gescheitert) nicht dauerhaft merken: der nächste Aufruf versucht die fehlenden Sheets neu
    if (!only && sprites.anims.size < names.length && charCache.get(key) === self) charCache.delete(key);
    return sprites;
  })();
  self = p;
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

  private reloadP: Promise<void> | null = null;

  ids(): string[] {
    return [...this.defs.keys()];
  }

  has(id: string): boolean {
    return this.imgs.has(id);
  }

  preload(ids: string[]): Promise<void> {
    return warmQueue.track(this.loadProps(ids));
  }

  private async loadProps(ids: string[]): Promise<void> {
    await this.ensureManifest();
    // Gürtel und Hosenträger: fehlen angeforderte Props im Manifest (veralteter Cache), einmalig am Cache vorbei neu laden.
    if (!this.reloadP && ids.some((id) => !this.defs.has(id))) this.reloadP = this.fetchManifest("reload");
    if (this.reloadP) await this.reloadP; // auch gleichzeitige preload()-Aufrufe warten auf denselben Reload
    await Promise.all(
      ids.map((id) => {
        const def = this.defs.get(id);
        if (!def || this.imgs.has(id)) return Promise.resolve();
        let p = this.pending.get(id);
        if (!p) {
          p = loadImage(`${ASSET_BASE}/props/${def.file}`).then((img) => {
            if (img) {
              this.imgs.set(id, img);
              queueWarm(img, PROP_WARM_PRIO);
            } else {
              this.pending.delete(id); // gescheitert: ein späteres preload() darf neu laden
            }
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

export function createAssetLoader(): AssetLoader & {
  props: PropLib;
  warmed: (urgent?: boolean) => Promise<void>;
  warmCharacter: (sprites: CharacterSprites | null | undefined, urgent?: boolean) => Promise<void>;
} {
  return { image: loadImage, props: new PropLib(), warmed, warmCharacter };
}

export type GameAssets = ReturnType<typeof createAssetLoader>;
