import { useEffect, useRef, useState } from "react";

import type { FredRunGame } from "@/game/fredrun2/game";
import type { NavDir } from "@/game/fredrun2/input";

/** Alles, was das Gamepad im aktiven Overlay ansteuern darf (Knöpfe, Reiter, Heldenkacheln, Regler, Auswahlfelder, Links) */
const NAV_SELECTOR = 'button:not([disabled]), [role="tab"], [role="radio"], input:not([type="hidden"]):not([disabled]), select:not([disabled]), a[href]';

export type NavMove = "up" | "down" | "left" | "right";

export interface NavRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Räumliche Auswahl des nächsten Ziels (rein): unter den Rechtecken, deren Mitte in Richtung `dir` hinter der Mitte von `from` liegt,
 * gewinnt das mit der kleinsten Wertung = Lücke in Richtung + 2 x Lücke quer dazu (0 bei Überlappung) + kleiner Versatz der Mitten.
 * So wird bei „runter“ der Knopf direkt darunter vor einem weiter seitlich gelegenen gewählt. -1, wenn nichts in der Richtung liegt.
 */
export function pickNavTarget(rects: ReadonlyArray<NavRect>, from: number, dir: NavMove): number {
  const a = rects[from];
  if (!a) return -1;
  const horizontal = dir === "left" || dir === "right";
  const sign = dir === "right" || dir === "down" ? 1 : -1;
  const acx = (a.left + a.right) / 2;
  const acy = (a.top + a.bottom) / 2;
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < rects.length; i += 1) {
    if (i === from) continue;
    const b = rects[i];
    const bcx = (b.left + b.right) / 2;
    const bcy = (b.top + b.bottom) / 2;
    const along = horizontal ? (bcx - acx) * sign : (bcy - acy) * sign;
    if (along <= 0.5) continue;
    // Lücke zwischen den Kanten in Richtung (nicht negativ) und quer dazu (0, wenn sich die Bänder überlappen)
    const gap = horizontal ? (sign > 0 ? b.left - a.right : a.left - b.right) : sign > 0 ? b.top - a.bottom : a.top - b.bottom;
    const cross = horizontal ? Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom)) : Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
    const offset = horizontal ? Math.abs(bcy - acy) : Math.abs(bcx - acx);
    const score = Math.max(0, gap) + 2 * cross + 0.25 * offset;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** Sichtbare, bedienbare Ziele im Bereich `scope` in Dokumentreihenfolge (ohne verdeckte, ausgeblendete und deaktivierte Elemente). */
function navItems(scope: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const el of scope.querySelectorAll<HTMLElement>(NAV_SELECTOR)) {
    if (el.closest('[aria-hidden="true"], [inert]')) continue;
    if (el.getAttribute("aria-disabled") === "true" && el.getAttribute("role") === "tab") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (getComputedStyle(el).visibility === "hidden") continue;
    out.push(el);
  }
  return out;
}

/** Oberstes Overlay: das letzte Element mit data-nav-scope in Dokumentreihenfolge (Menü < Pause/Ergebnis < Namensabfrage < Hochformat-Hinweis) */
function activeScope(root: HTMLElement): HTMLElement | null {
  const all = root.querySelectorAll<HTMLElement>("[data-nav-scope]");
  return all.length ? all[all.length - 1] : null;
}

/** Wert eines Eingabefelds so setzen, dass React (kontrollierte Felder) die Änderung bemerkt */
function setNativeValue(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
}

/** Regler (Links/Rechts = ein Schritt) und Auswahlfeld (nächste/vorige Option) verstellen. true, wenn das Element die Richtung verbraucht. */
function adjustControl(el: HTMLElement, dir: NavMove): boolean {
  if (dir !== "left" && dir !== "right") return false;
  const step = dir === "right" ? 1 : -1;
  if (el instanceof HTMLInputElement && el.type === "range") {
    const min = Number(el.min || 0);
    const max = Number(el.max || 100);
    const inc = Number(el.step) > 0 ? Number(el.step) : 1;
    const next = Math.min(max, Math.max(min, Math.round((Number(el.value) + step * inc) / inc) * inc));
    if (next !== Number(el.value)) {
      setNativeValue(el, String(next));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return true;
  }
  if (el instanceof HTMLSelectElement) {
    const idx = Math.min(el.options.length - 1, Math.max(0, el.selectedIndex + step));
    if (idx !== el.selectedIndex) {
      setNativeValue(el, el.options[idx].value);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return true;
  }
  return false;
}

/** Pfeiltaste an das Element schicken (bubbelt): Reiterleiste und Heldenauswahl reagieren darauf wie auf die Tastatur (wählen und fokussieren). */
function pressArrow(el: HTMLElement, key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown"): void {
  el.dispatchEvent(new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true }));
}

const MOVE_KEY: Record<NavMove, "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown"> = { left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown" };

function hasPad(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return false;
  try {
    return Array.from(navigator.getGamepads()).some((p) => p !== null);
  } catch {
    return false;
  }
}

/** Menü-Navigations-Handler des InputManagers setzen bzw. (nur wenn es noch unserer ist) entfernen */
function bindNav(input: FredRunGame["input"], handler: ((dir: NavDir) => void) | null, only?: (dir: NavDir) => void): void {
  if (only && input.onNav !== only) return;
  input.onNav = handler;
}

export interface GamepadNavOptions {
  /** Wurzelelement der Oberfläche; die Overlays darin tragen data-nav-scope */
  rootRef: React.RefObject<HTMLElement | null>;
  /** B / Zurück, wenn das aktive Overlay kein Element mit data-nav-back hat (Menü: Reiter „Spielen“, Namensabfrage: schließen) */
  onBack: () => void;
}

/**
 * Gamepad im Menü, im Pause-Dialog, in der Ergebnis-Karte und in der Namensabfrage: D-Pad/linker Stick (game.input.onNav, nur wenn
 * die Spiel-Eingabe aus ist) bewegt den Fokus räumlich zwischen den Elementen des obersten Overlays, A klickt das fokussierte
 * Element, B klickt das Element mit data-nav-back (Pause: „Weiter“, Ergebnis: „Menü“) bzw. ruft `onBack`. Links/Rechts verstellt Regler
 * und Auswahlfelder, in der Reiterleiste wechselt es den Reiter, in der Heldenliste (hoch/runter) den Helden – wie die Pfeiltasten.
 * Gibt zurück, ob ein Pad erkannt wurde (für den Hinweis „A = Bestätigen, B = Zurück“). Der Handler wird beim Unmount entfernt.
 */
export function useGamepadNav(game: FredRunGame | null, { rootRef, onBack }: GamepadNavOptions): boolean {
  const [padConnected, setPadConnected] = useState(hasPad);
  const backRef = useRef(onBack);
  useEffect(() => {
    backRef.current = onBack;
  }, [onBack]);

  // Pad erkannt (gamepadconnected) bzw. alle getrennt
  useEffect(() => {
    const onConnect = (): void => setPadConnected(true);
    const onDisconnect = (): void => setPadConnected(hasPad());
    window.addEventListener("gamepadconnected", onConnect);
    window.addEventListener("gamepaddisconnected", onDisconnect);
    return () => {
      window.removeEventListener("gamepadconnected", onConnect);
      window.removeEventListener("gamepaddisconnected", onDisconnect);
    };
  }, []);

  useEffect(() => {
    if (!game) return;
    const input = game.input;
    const handler = (dir: NavDir): void => {
      const root = rootRef.current;
      if (!root) return;
      const scope = activeScope(root);
      if (!scope) return;
      // Ein Nav-Ereignis beweist ein Pad; der Fokusring muss auch ohne Tastatur-Modus sichtbar sein (siehe .root[data-nav])
      setPadConnected(true);
      root.setAttribute("data-nav", "pad");
      const items = navItems(scope);
      const active = document.activeElement as HTMLElement | null;
      const cur = active ? items.indexOf(active) : -1;

      if (dir === "back") {
        const back = scope.querySelector<HTMLElement>("[data-nav-back]");
        if (back) {
          if (!(back as HTMLButtonElement).disabled) back.click();
        } else backRef.current();
        return;
      }

      // Noch nichts im Overlay fokussiert: der erste Druck setzt nur den Fokus (Vorgabe: data-nav-default, aktiver Reiter, erstes Ziel)
      if (cur < 0) {
        const pref = scope.querySelector<HTMLElement>("[data-nav-default]") ?? scope.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
        const target = pref && items.includes(pref) ? pref : items[0];
        target?.focus();
        return;
      }
      const el = items[cur];

      if (dir === "confirm") {
        if (el.getAttribute("role") === "radio") {
          // Heldenkachel: Auswählen/Kaufen hängt an Enter (ein Klick von „außen“ zählt dort nur als Ansehen)
          el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
        } else if (!(el instanceof HTMLInputElement && el.type !== "checkbox" && el.type !== "radio") && !(el instanceof HTMLSelectElement)) {
          el.click();
        }
        return;
      }

      if (adjustControl(el, dir)) return;
      // Reiterleiste: links/rechts wechselt den Reiter (wie die Pfeiltasten: wählt und fokussiert)
      if (el.getAttribute("role") === "tab" && (dir === "left" || dir === "right")) {
        const next = items[pickNavTarget(items.map((i) => i.getBoundingClientRect()), cur, dir)];
        if (!next || next.closest('[role="tablist"]') === el.closest('[role="tablist"]')) {
          pressArrow(el, MOVE_KEY[dir]);
          game.audio.sfx("ui-hover");
          return;
        }
      }
      // Heldenliste: hoch/runter schaltet den Helden (die Liste reagiert auf Pfeiltasten und fokussiert die Kachel)
      if (el.getAttribute("role") === "radio" && (dir === "up" || dir === "down")) {
        pressArrow(el, MOVE_KEY[dir]);
        return;
      }
      const next = pickNavTarget(items.map((i) => i.getBoundingClientRect()), cur, dir);
      if (next >= 0) {
        items[next].focus();
        game.audio.sfx("ui-hover");
      }
    };
    bindNav(input, handler);
    // Maus, Touch und Tastatur beenden den Pad-Modus des Fokusrings wieder (die künstlichen Pfeiltasten dieses Hooks nicht)
    const clearMode = (e: Event): void => {
      if (e.isTrusted) rootRef.current?.removeAttribute("data-nav");
    };
    window.addEventListener("pointerdown", clearMode, true);
    window.addEventListener("keydown", clearMode, true);
    return () => {
      bindNav(input, null, handler);
      window.removeEventListener("pointerdown", clearMode, true);
      window.removeEventListener("keydown", clearMode, true);
    };
  }, [game, rootRef]);

  return padConnected;
}
