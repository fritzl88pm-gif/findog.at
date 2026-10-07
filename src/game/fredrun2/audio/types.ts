/**
 * Öffentliche Typen der Fredrun-2.0-Audio-Engine.
 *
 * Die Namenslisten sind zusätzlich als Laufzeit-Arrays exportiert (Tests, Debug-Menüs),
 * die Union-Typen werden daraus abgeleitet, damit es nur eine Quelle der Wahrheit gibt.
 */

export const WORLD_MUSIC_IDS = ["menu", "wien", "alpen", "finanzamt", "prater", "wachau", "cyber"] as const;
export type WorldMusicId = (typeof WORLD_MUSIC_IDS)[number];
/**
 * Stücke der aufgenommenen Musik: die Welt-Themen plus Heldenauswahl und die Welten „winter“/„oper“, die kein eigenes
 * prozedurales Thema haben (Fallback siehe engine.ts `proceduralId`).
 */
export type MusicTrackId = WorldMusicId | "select" | "winter" | "oper";

export const SFX_NAMES = [
  // UI
  "ui-click", "ui-hover", "ui-back", "ui-buy", "ui-denied",
  // Bewegung
  "jump", "doublejump", "land", "slide", "dash", "stomp", "stomp-chain", "spring", "portal", "wallbreak",
  // Pickups / Power-ups
  "coin", "gem", "heart", "powerup", "shield-on", "shield-hit", "slowmo-on", "slowmo-off", "magnet-on",
  // Treffer / Combo
  "hurt", "death", "near-miss", "combo-up", "combo-break",
  // Ablauf / Stinger
  "countdown", "go", "checkpoint", "world-transition", "gameover", "highscore",
  // Weltspezifisch
  "lightning-warn", "thunder", "tram-bell", "stamp-thud", "laser-zap", "paper-flutter", "cannon", "splash",
  "barrel-roll", "glitch", "avalanche-warn", "rockfall", "crumble", "bee-buzz", "pigeon", "enemy-defeat",
] as const;
export type SfxName = (typeof SFX_NAMES)[number];

export const LOOP_NAMES = [
  "rain", "wind", "avalanche", "magnet", "laser-hum", "crowd-fair", "river", "office-hum", "cyber-hum",
  "dash-whoosh", "slide-scrape",
] as const;
export type LoopName = (typeof LOOP_NAMES)[number];

export interface SfxOptions {
  /** Faktor, 1 = normal */
  pitch?: number;
  /** 0..1 */
  volume?: number;
  /** -1..1 */
  pan?: number;
}

export interface FredAudio {
  /**
   * Aus einer User-Geste aufrufen (Click/Touch/Key). Erzeugt/resumed den AudioContext (iOS/Safari-sicher). Idempotent und
   * wiederholbar: Läuft der Kontext nach der Wartezeit (≈ 1.2 s) noch nicht, genügt der nächste Aufruf; ein später eintreffendes
   * „running“ startet wartende Musik/Dauerklänge von selbst. Setzt (wo vorhanden) navigator.audioSession.type auf „playback“.
   */
  unlock(): Promise<void>;
  /** true, sobald der Kontext einmal „running“ war (und nicht pausiert/suspendiert ist) */
  readonly unlocked: boolean;
  sfx(name: SfxName, opts?: SfxOptions): void;
  /**
   * Beendet laufende Musik-Stinger (Game Over, Highscore, Weltwechsel): blendet sie in `fadeSec` (Standard 0.3 s) aus und hebt
   * die Musik-Absenkung (duck) auf. Aufruf beim Neustart/Zurück ins Menü, damit kein Jingle in den nächsten Lauf hineinläuft.
   */
  stopStingers(fadeSec?: number): void;
  /**
   * Lädt Dateien vor, ohne zu dekodieren (HTTP-Cache wärmen): SFX-Bank, Musik-Manifest und je angegebenem Stück genau eine
   * Variante (dieselbe, die `music.play` später wählt). Ohne fetch (SSR) wirkungslos; vor dem Entsperren erlaubt.
   */
  prefetch(opts: { music?: string[] }): void;
  /** Dauerklänge (Regen, Wind…) an/aus mit sanften Fades; level 0..1 */
  loop(name: LoopName, on: boolean, level?: number): void;
  music: {
    play(id: MusicTrackId, opts?: { crossfadeSec?: number; intensity?: number }): void;
    /** 0..1: mehr Layer (Drums, Bass, Arpeggio) je höher; weich geblendet */
    setIntensity(v: number, rampSec?: number): void;
    stop(fadeSec?: number): void;
    /**
     * Dämpft die Musik (Pause, Zeitlupe): amount 0..1 (geklemmt; 1 = Tiefpass 900 Hz und -5 dB), `rampSec` = Zeitkonstante
     * des weichen Übergangs (Standard 0.12 s). `play()` und `stop()` setzen die Dämpfung auf 0 zurück.
     */
    setMuffle(amount: number, rampSec?: number): void;
    readonly current: MusicTrackId | null;
  };
  setMasterVolume(v: number): void;
  setMusicVolume(v: number): void;
  setSfxVolume(v: number): void;
  setMuted(m: boolean): void;
  readonly muted: boolean;
  /** Duckt Musik kurz (z.B. bei Highscore-Fanfare / Tod), sec = Dauer */
  duck(amount: number, sec: number): void;
  /** Bei Tab-Wechsel/Pause: Kontext suspendieren bzw. fortsetzen. */
  suspend(): void;
  resume(): void;
  /** Spielzeit-Hooks für Tempo: Musik-Tempo skaliert leicht mit dem Spieltempo (1.0 .. 1.25) */
  setTempoScale(v: number): void;
  dispose(): void;
}
