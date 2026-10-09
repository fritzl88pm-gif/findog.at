/** Eingabe: Tastatur, Zeiger/Touch (Tippen = springen, nach unten wischen = rutschen), Gamepad (Spiel und Menü-Navigation), Bildschirm-Tasten. */
import type { SimInput } from "./sim";

/** Entscheidungsfenster für Touch in der linken Zone: Wisch nach unten (nur Rutschen) oder Tippen (Sprung). Danach springt die Figur (außer bei Drift nach unten, siehe SWIPE_EXTEND_MS). */
export const SWIPE_DECIDE_MS = 28;
/** Mindestweg nach unten (px) innerhalb des Fensters, ab dem eine Touch-Bewegung als Wisch gilt. */
export const SWIPE_MIN_DY = 10;
/**
 * Ein Wisch beschleunigt aus dem Stand: in den ersten 28 bis 45 ms sind es oft nur 2 bis 8 px. Zieht der Finger schon
 * erkennbar nach unten (siehe SWIPE_DRIFT_DY), verlängert sich das Entscheidungsfenster bis zu dieser Zeit (ms ab Berührung).
 * Tippende ohne Drift zahlen nichts; Tippende mit Drift warten höchstens SWIPE_EXTEND_MS - SWIPE_DECIDE_MS (32 ms) länger,
 * beim Loslassen springt es ohnehin sofort.
 */
export const SWIPE_EXTEND_MS = 60;
/** Weg nach unten (px), ab dem das Entscheidungsfenster bis SWIPE_EXTEND_MS offen bleibt (dy muss dx dabei um SWIPE_RATIO überwiegen, wie beim Wisch). */
export const SWIPE_DRIFT_DY = 2;
/** Linker Anteil der angehängten Fläche, in dem Touch-Sprünge um das Entscheidungsfenster verzögert werden. */
export const LEFT_ZONE = 0.45;
/** Sprung-Assistent: so lange (Sekunden) gilt „Sprung gehalten“ nach einer verbrauchten Sprung-Flanke. */
export const JUMP_ASSIST_S = 0.38;
/** Gamepad-Navigation: Wiederholung einer gehaltenen Richtung nach dieser Zeit (ms). */
export const NAV_REPEAT_MS = 350;

const NAV_DEADZONE = 0.5;
/** Wisch-Verhältnis im Entscheidungsfenster (dy muss dx deutlich überwiegen, Kegel von ca. 35° um die Senkrechte); gilt auch für Wisch-Kandidaten und die Fensterverlängerung */
const SWIPE_RATIO = 1.4;
/**
 * Obergrenze (s) für den Halte-Ausgleich verzögerter Touch-Sprünge. Muss die verlängerte Wartezeit (SWIPE_EXTEND_MS plus ein
 * Frame von 30 Hz) abdecken, sonst springt ein Tippen mit Drift nach unten niedriger als eines ohne (8 bis 10 px Scheitelhöhe).
 */
const MAX_HOLD_COMP_S = 0.1;

const JUMP_KEYS = new Set(["Space", "ArrowUp", "KeyW"]);
const SLIDE_KEYS = new Set(["ArrowDown", "KeyS"]);
const DASH_KEYS = new Set(["ShiftLeft", "ShiftRight", "KeyD", "ArrowRight", "KeyX"]);
const PAUSE_KEYS = new Set(["Escape", "KeyP"]);

export type InputListener = {
  onPause?: () => void;
  onMute?: () => void;
  onAnyInput?: () => void;
};

export type PointerKind = "touch" | "mouse" | "pen";
export type NavDir = "up" | "down" | "left" | "right" | "confirm" | "back";

const NAV_DIRS: readonly NavDir[] = ["up", "down", "left", "right"];

/** Richtung (Index in NAV_DIRS, -1 = keine) aus D-Pad (Tasten 12-15) oder linkem Stick (Achsen 0/1, Deadzone). */
function padNavDir(pad: Gamepad): number {
  const b = pad.buttons;
  if (b[12]?.pressed) return 0;
  if (b[13]?.pressed) return 1;
  if (b[14]?.pressed) return 2;
  if (b[15]?.pressed) return 3;
  const ax = pad.axes[0] ?? 0;
  const ay = pad.axes[1] ?? 0;
  const ma = Math.abs(ax);
  const mb = Math.abs(ay);
  if (Math.max(ma, mb) < NAV_DEADZONE) return -1;
  if (mb >= ma) return ay < 0 ? 0 : 1;
  return ax < 0 ? 2 : 3;
}

type PtrStart = {
  x: number;
  y: number;
  /** Zeitstempel der Zeitquelle (ms) */
  t: number;
  /** Wisch bereits als Rutschen gewertet */
  slid: boolean;
  /** Touch links: Sprung-Flanke wartet auf die Entscheidung Wisch/Tippen */
  pending: boolean;
  /** durch das Warten verlorene Haltezeit (s), wird beim Loslassen ausgeglichen */
  delay: number;
  /** letzter bekannter Weg (px) seit der Berührung, nach unten und seitlich (nur im Wartezustand gepflegt) */
  lastDy: number;
  lastDx: number;
};

export class InputManager {
  private jumpKeys = new Set<string>();
  private slideKeys = new Set<string>();
  private ptrJump = new Set<number>();
  private uiJump = false;
  private uiSlide = false;
  private swipeSlideUntil = 0;
  private padJump = false;
  private padSlide = false;
  private padDashPrev = false;
  private padStartPrev = false;
  private edgeJump = false;
  private edgeSlide = false;
  private edgeDash = false;
  private now = 0;
  enabled = false;
  listener: InputListener = {};
  /** Wechsel der Zeigerart (nur bei Änderung; auch bei Taps auf Bedienelemente). */
  onPointerKind: ((kind: PointerKind) => void) | null = null;
  /** Menü-Navigation per Gamepad; nur solange `enabled === false`. */
  onNav: ((dir: NavDir) => void) | null = null;
  private el: HTMLElement | null = null;
  private starts = new Map<number, PtrStart>();
  private bound = false;
  private clock: () => number;
  private lastKind: PointerKind | null = null;
  /** Anzahl der Zeiger, deren Sprung noch auf die Entscheidung wartet */
  private pendingN = 0;
  private tmpMs = 0;
  private jumpAssist = false;
  private assistUntil = 0;
  private tapHoldUntil = 0;
  private navDir = -1;
  private navNextAt = 0;
  private navConfirmPrev = false;
  private navBackPrev = false;

  constructor(opts: { clock?: () => number } = {}) {
    this.clock = opts.clock ?? defaultClock;
  }

  /** Zeitquelle (ms) austauschen, z. B. für Tests. */
  setClock(clock: () => number): void {
    this.clock = clock;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.repeat) {
      if (this.enabled && (JUMP_KEYS.has(e.code) || SLIDE_KEYS.has(e.code) || DASH_KEYS.has(e.code))) e.preventDefault();
      return;
    }
    if (PAUSE_KEYS.has(e.code)) {
      this.listener.onPause?.();
      return;
    }
    if (e.code === "KeyM") {
      this.listener.onMute?.();
      return;
    }
    if (!this.enabled) return;
    if (JUMP_KEYS.has(e.code)) {
      e.preventDefault();
      // jede neu gedrückte Sprungtaste ist eine Flanke (Doppelsprung mit zweiter Taste, auch bei gehaltener erster)
      if (!this.jumpKeys.has(e.code)) this.edgeJump = true;
      this.jumpKeys.add(e.code);
      this.listener.onAnyInput?.();
    } else if (SLIDE_KEYS.has(e.code)) {
      e.preventDefault();
      if (this.slideKeys.size === 0) this.edgeSlide = true;
      this.slideKeys.add(e.code);
      this.listener.onAnyInput?.();
    } else if (DASH_KEYS.has(e.code)) {
      e.preventDefault();
      this.edgeDash = true;
      this.listener.onAnyInput?.();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.jumpKeys.delete(e.code);
    this.slideKeys.delete(e.code);
  };

  private onBlur = (): void => {
    this.releaseAll();
  };

  private jumpHeldAny(): boolean {
    return this.ptrJump.size > 0 || this.uiJump || this.padJump;
  }

  /** Startet der Zeiger in der linken Zone der angehängten Fläche? (ohne Layout: nein, dann springt es sofort) */
  private inLeftZone(e: PointerEvent): boolean {
    const el = this.el;
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && e.clientX - r.left < r.width * LEFT_ZONE;
  }

  private onPointerDown = (e: PointerEvent): void => {
    // Zeigerart zuerst melden, vor allen Filtern: auch ein Tap auf einen Knopf zeigt, womit gespielt wird.
    const kind = e.pointerType;
    if ((kind === "touch" || kind === "mouse" || kind === "pen") && kind !== this.lastKind) {
      this.lastKind = kind;
      this.onPointerKind?.(kind);
    }
    if (!this.enabled) return;
    // Bedienelemente (Schaltflächen, Dialoge, Eingabefelder) sind keine Spielfläche: sonst würde `setPointerCapture`
    // den Mausklick auf z. B. „Hauptmenü“ im Pause-Dialog auf die Bühne umleiten und die Schaltfläche bliebe tot.
    if ((e.target as HTMLElement | null)?.closest("[data-fr2-ui], button, a, input, select, textarea, [role='dialog'], [role='alert']")) return;
    if (e.pointerType === "mouse" && e.button !== 0) {
      if (e.button === 2) this.edgeDash = true;
      return;
    }
    const old = this.starts.get(e.pointerId);
    if (old?.pending) this.pendingN -= 1;
    // Touch links: erst entscheiden, ob es ein Wisch nach unten (Rutschen) oder ein Tippen (Sprung) wird.
    // Maus, Stift und die rechte Fläche springen sofort.
    const pending = e.pointerType === "touch" && this.inLeftZone(e);
    if (pending) this.pendingN += 1;
    else this.edgeJump = true; // jeder neue Zeiger ist eine Flanke (zweiter Finger = Doppelsprung)
    this.ptrJump.add(e.pointerId);
    this.starts.set(e.pointerId, { x: e.clientX, y: e.clientY, t: this.clock(), slid: false, pending, delay: 0, lastDy: 0, lastDx: 0 });
    this.listener.onAnyInput?.();
    try {
      this.el?.setPointerCapture(e.pointerId);
    } catch {
      /* ignorieren */
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const s = this.starts.get(e.pointerId);
    if (!s || s.slid) return;
    const dy = e.clientY - s.y;
    const dx = Math.abs(e.clientX - s.x);
    if (s.pending) {
      s.lastDy = dy;
      s.lastDx = dx;
      if (dy >= SWIPE_MIN_DY && dy > dx * SWIPE_RATIO) {
        // Wisch nach unten: nur Rutschen, kein Sprung (und damit kein Doppelsprung-Verbrauch)
        s.pending = false;
        this.pendingN -= 1;
        s.slid = true;
        this.edgeSlide = true;
        this.swipeSlideUntil = this.now + 0.6;
        this.ptrJump.delete(e.pointerId);
      } else if (dy * dy + dx * dx >= SWIPE_MIN_DY * SWIPE_MIN_DY && dy <= dx * SWIPE_RATIO) {
        // Bewegung in eine andere Richtung: kein Wisch nach unten mehr möglich, also springen. Zieht der Finger noch klar
        // nach unten (dy > 1,4 dx, aber erst unter 10 px), bleibt es ein Wisch-Kandidat: der Weg ist durch dx schon ≥ 10 px,
        // das Fenster (expirePending) entscheidet dann spätestens bei SWIPE_EXTEND_MS.
        this.commitPending(s, this.clock());
      }
      return;
    }
    if (dy > 46 && dy > dx * 1.2 && this.clock() - s.t < 500) {
      s.slid = true;
      this.edgeSlide = true;
      this.swipeSlideUntil = this.now + 0.6;
      this.ptrJump.delete(e.pointerId);
    }
  };

  /** Wartenden Sprung auslösen (Tippen, Fensterablauf, andere Richtung). */
  private commitPending(s: PtrStart, tMs: number): void {
    s.pending = false;
    this.pendingN -= 1;
    this.edgeJump = true;
    s.delay = Math.min(MAX_HOLD_COMP_S, Math.max(0, (tMs - s.t) / 1000));
  }

  private expirePending = (s: PtrStart): void => {
    if (!s.pending) return;
    const age = this.tmpMs - s.t;
    if (age < SWIPE_DECIDE_MS) return;
    // Wisch aus dem Stand: zieht der Finger schon erkennbar nach unten (im selben Kegel wie der Wisch selbst),
    // noch bis SWIPE_EXTEND_MS auf die 10 px warten
    if (age < SWIPE_EXTEND_MS && s.lastDy >= SWIPE_DRIFT_DY && s.lastDy > s.lastDx * SWIPE_RATIO) return;
    this.commitPending(s, this.tmpMs);
  };

  private clearPending = (s: PtrStart): void => {
    s.pending = false;
  };

  private onPointerUp = (e: PointerEvent): void => {
    const s = this.starts.get(e.pointerId);
    if (s) {
      // Tippen ohne Wisch: der Sprung startet jetzt
      if (s.pending) this.commitPending(s, this.clock());
      // Die Wartezeit hat vom Halten abgezogen: so lange nach dem Loslassen weiter „gehalten“ melden,
      // damit die Sprunghöhe eines Tippens dieselbe bleibt wie bei sofortigem Sprung.
      if (s.delay > 0) this.tapHoldUntil = Math.max(this.tapHoldUntil, this.now + s.delay);
      this.starts.delete(e.pointerId);
    }
    this.ptrJump.delete(e.pointerId);
  };

  private onPointerCancel = (e: PointerEvent): void => {
    // abgebrochene Berührung (Systemgeste, Handballen): nichts auslösen, wartender Sprung verfällt
    const s = this.starts.get(e.pointerId);
    if (s?.pending) this.pendingN -= 1;
    this.starts.delete(e.pointerId);
    this.ptrJump.delete(e.pointerId);
  };

  private onContext = (e: Event): void => {
    if (this.enabled) e.preventDefault();
  };

  /** Zeiger-Listener anmelden: `el` ist die ganze Spielfläche (Wurzel), nicht nur die 16:9-Bühne; Zonen und Wisch beziehen sich auf sie. */
  attach(el: HTMLElement): void {
    if (this.bound && this.el === el) return;
    if (this.bound) this.unbindElement();
    this.el = el;
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointercancel", this.onPointerCancel);
    el.addEventListener("contextmenu", this.onContext);
    if (this.bound) return;
    this.bound = true;
    window.addEventListener("keydown", this.onKeyDown, { passive: false });
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  private unbindElement(): void {
    const el = this.el;
    if (!el) return;
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointermove", this.onPointerMove);
    el.removeEventListener("pointerup", this.onPointerUp);
    el.removeEventListener("pointercancel", this.onPointerCancel);
    el.removeEventListener("contextmenu", this.onContext);
    this.el = null;
    this.starts.clear();
    this.ptrJump.clear();
    this.pendingN = 0;
  }

  detach(): void {
    if (!this.bound) return;
    this.bound = false;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.unbindElement();
  }

  releaseAll(): void {
    this.jumpKeys.clear();
    this.slideKeys.clear();
    this.ptrJump.clear();
    this.starts.clear();
    this.pendingN = 0;
    this.uiJump = false;
    this.uiSlide = false;
    this.edgeJump = false;
    this.edgeSlide = false;
    this.edgeDash = false;
    this.swipeSlideUntil = 0;
    this.assistUntil = 0;
    this.tapHoldUntil = 0;
  }

  /**
   * Aufgelaufene Flanken verwerfen (Countdown: sonst springt die Figur bei „Los“ von allein).
   * Gehaltene Zustände bleiben; ein wartender Touch-Sprung verfällt, der Finger bleibt „gehalten“.
   */
  discardEdges(): void {
    this.edgeJump = false;
    this.edgeSlide = false;
    this.edgeDash = false;
    if (this.pendingN > 0) {
      this.starts.forEach(this.clearPending);
      this.pendingN = 0;
    }
  }

  /** Sprung-Assistent: nach einer Sprung-Flanke 0,38 s lang „Sprung gehalten“ melden (Tippen = voller Sprung). */
  setJumpAssist(on: boolean): void {
    this.jumpAssist = on;
    if (!on) this.assistUntil = 0;
  }

  // Bildschirm-Tasten (React-Overlay)
  setUiJump(v: boolean): void {
    if (v && !this.uiJump && !this.jumpHeldAny()) this.edgeJump = true;
    this.uiJump = v;
  }
  setUiSlide(v: boolean): void {
    if (v && !this.uiSlide) this.edgeSlide = true;
    this.uiSlide = v;
  }
  pressDash(): void {
    this.edgeDash = true;
  }

  /** Controller-Vibration (stark 0..1, Dauer in ms); ohne Controller oder Aktor ohne Wirkung. */
  rumble(strong: number, ms: number): void {
    if (typeof navigator === "undefined" || !navigator.getGamepads) return;
    try {
      const mag = Math.min(1, Math.max(0, strong));
      const duration = Math.min(5000, Math.max(0, ms));
      for (const pad of navigator.getGamepads()) {
        const act = pad?.vibrationActuator;
        if (!act?.playEffect) continue;
        const p = act.playEffect("dual-rumble", { startDelay: 0, duration, weakMagnitude: mag * 0.6, strongMagnitude: mag });
        // Promise-Ablehnung (Tab nicht fokussiert, Gerät getrennt) ignorieren
        if (p && typeof p.catch === "function") p.catch(() => {});
      }
    } catch {
      /* ignorieren */
    }
  }

  private pollGamepad(): void {
    if (typeof navigator === "undefined" || !navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    let jump = false;
    let slide = false;
    let dash = false;
    let start = false;
    let confirm = false;
    let back = false;
    let dir = -1;
    for (const pad of pads) {
      if (!pad) continue;
      const b = pad.buttons;
      jump = jump || !!b[0]?.pressed || !!b[12]?.pressed;
      slide = slide || !!b[1]?.pressed || !!b[13]?.pressed || (pad.axes[1] ?? 0) > 0.6;
      dash = dash || !!b[2]?.pressed || !!b[5]?.pressed || !!b[7]?.pressed;
      start = start || !!b[9]?.pressed;
      confirm = confirm || !!b[0]?.pressed;
      back = back || !!b[1]?.pressed;
      if (dir < 0) dir = padNavDir(pad);
    }
    if (jump && !this.padJump && !this.jumpHeldAny()) this.edgeJump = true;
    if (slide && !this.padSlide) this.edgeSlide = true;
    if (dash && !this.padDashPrev) this.edgeDash = true;
    if (start && !this.padStartPrev) this.listener.onPause?.();
    this.padJump = jump;
    this.padSlide = slide;
    this.padDashPrev = dash;
    this.padStartPrev = start;
    this.pollNav(dir, confirm, back);
  }

  /** Menü-Navigation: nur außerhalb des Laufs, mit Flankenerkennung; eine gehaltene Richtung wiederholt nach 350 ms. */
  private pollNav(dir: number, confirm: boolean, back: boolean): void {
    if (this.enabled) {
      // Im Lauf nur mitführen: eine beim Wechsel (Tod, Pause) noch gehaltene Taste/Richtung löst erst nach dem Loslassen aus.
      this.navDir = dir;
      this.navNextAt = Infinity;
      this.navConfirmPrev = confirm;
      this.navBackPrev = back;
      return;
    }
    if (dir < 0) {
      this.navDir = -1;
    } else if (dir !== this.navDir) {
      this.navDir = dir;
      this.navNextAt = this.clock() + NAV_REPEAT_MS;
      this.onNav?.(NAV_DIRS[dir]);
    } else {
      const t = this.clock();
      if (t >= this.navNextAt) {
        this.navNextAt = t + NAV_REPEAT_MS;
        this.onNav?.(NAV_DIRS[dir]);
      }
    }
    if (confirm && !this.navConfirmPrev) this.onNav?.("confirm");
    if (back && !this.navBackPrev) this.onNav?.("back");
    this.navConfirmPrev = confirm;
    this.navBackPrev = back;
  }

  /** Einmal pro Sim-Schritt aufrufen (Flanken werden im ersten Schritt verbraucht). */
  consume(dt: number): SimInput {
    this.now += dt;
    if (this.pendingN > 0) {
      this.tmpMs = this.clock();
      this.starts.forEach(this.expirePending);
    }
    const held = this.jumpKeys.size > 0 || this.ptrJump.size > 0 || this.uiJump || this.padJump;
    const slideHeld = this.slideKeys.size > 0 || this.uiSlide || this.padSlide || this.now < this.swipeSlideUntil;
    if (this.edgeJump && this.jumpAssist) this.assistUntil = this.now + JUMP_ASSIST_S;
    const out: SimInput = {
      jump: held || this.now < this.assistUntil || this.now < this.tapHoldUntil,
      jumpPressed: this.edgeJump,
      slide: slideHeld,
      slidePressed: this.edgeSlide,
      dashPressed: this.edgeDash,
    };
    this.edgeJump = false;
    this.edgeSlide = false;
    this.edgeDash = false;
    return out;
  }

  /** Pro Frame (vor den Sim-Schritten). */
  poll(): void {
    this.pollGamepad();
  }
}

function defaultClock(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
