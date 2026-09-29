/** Eingabe: Tastatur, Zeiger/Touch (Tippen = springen, nach unten wischen = rutschen), Gamepad, Bildschirm-Tasten. */
import type { SimInput } from "./sim";

const JUMP_KEYS = new Set(["Space", "ArrowUp", "KeyW"]);
const SLIDE_KEYS = new Set(["ArrowDown", "KeyS"]);
const DASH_KEYS = new Set(["ShiftLeft", "ShiftRight", "KeyD", "ArrowRight", "KeyX"]);
const PAUSE_KEYS = new Set(["Escape", "KeyP"]);

export type InputListener = {
  onPause?: () => void;
  onMute?: () => void;
  onAnyInput?: () => void;
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
  private el: HTMLElement | null = null;
  private starts = new Map<number, { x: number; y: number; t: number; slid: boolean }>();
  private bound = false;

  private onKeyDown = (e: KeyboardEvent): void => {
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
      if (this.jumpKeys.size === 0 && !this.jumpHeldAny()) this.edgeJump = true;
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

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    if ((e.target as HTMLElement | null)?.closest("[data-fr2-ui]")) return;
    if (e.pointerType === "mouse" && e.button !== 0) {
      if (e.button === 2) this.edgeDash = true;
      return;
    }
    if (!this.jumpHeldAny()) this.edgeJump = true;
    this.ptrJump.add(e.pointerId);
    this.starts.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), slid: false });
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
    if (dy > 46 && dy > dx * 1.2 && performance.now() - s.t < 500) {
      s.slid = true;
      this.edgeSlide = true;
      this.swipeSlideUntil = this.now + 0.6;
      this.ptrJump.delete(e.pointerId);
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.ptrJump.delete(e.pointerId);
    this.starts.delete(e.pointerId);
  };

  private onContext = (e: Event): void => {
    if (this.enabled) e.preventDefault();
  };

  attach(el: HTMLElement): void {
    this.el = el;
    if (this.bound) return;
    this.bound = true;
    window.addEventListener("keydown", this.onKeyDown, { passive: false });
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointercancel", this.onPointerUp);
    el.addEventListener("contextmenu", this.onContext);
  }

  detach(): void {
    if (!this.bound) return;
    this.bound = false;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    const el = this.el;
    if (el) {
      el.removeEventListener("pointerdown", this.onPointerDown);
      el.removeEventListener("pointermove", this.onPointerMove);
      el.removeEventListener("pointerup", this.onPointerUp);
      el.removeEventListener("pointercancel", this.onPointerUp);
      el.removeEventListener("contextmenu", this.onContext);
    }
    this.el = null;
  }

  releaseAll(): void {
    this.jumpKeys.clear();
    this.slideKeys.clear();
    this.ptrJump.clear();
    this.starts.clear();
    this.uiJump = false;
    this.uiSlide = false;
    this.edgeJump = false;
    this.edgeSlide = false;
    this.edgeDash = false;
    this.swipeSlideUntil = 0;
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

  private pollGamepad(): void {
    if (typeof navigator === "undefined" || !navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    let jump = false;
    let slide = false;
    let dash = false;
    let start = false;
    for (const pad of pads) {
      if (!pad) continue;
      const b = pad.buttons;
      jump = jump || !!b[0]?.pressed || !!b[12]?.pressed;
      slide = slide || !!b[1]?.pressed || !!b[13]?.pressed || (pad.axes[1] ?? 0) > 0.6;
      dash = dash || !!b[2]?.pressed || !!b[5]?.pressed || !!b[7]?.pressed;
      start = start || !!b[9]?.pressed;
    }
    if (jump && !this.padJump && !this.jumpHeldAny()) this.edgeJump = true;
    if (slide && !this.padSlide) this.edgeSlide = true;
    if (dash && !this.padDashPrev) this.edgeDash = true;
    if (start && !this.padStartPrev) this.listener.onPause?.();
    this.padJump = jump;
    this.padSlide = slide;
    this.padDashPrev = dash;
    this.padStartPrev = start;
  }

  /** Einmal pro Sim-Schritt aufrufen (Flanken werden im ersten Schritt verbraucht). */
  consume(dt: number): SimInput {
    this.now += dt;
    const held = this.jumpKeys.size > 0 || this.ptrJump.size > 0 || this.uiJump || this.padJump;
    const slideHeld = this.slideKeys.size > 0 || this.uiSlide || this.padSlide || this.now < this.swipeSlideUntil;
    const out: SimInput = {
      jump: held,
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
