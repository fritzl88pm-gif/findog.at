/**
 * Fredrun 2.0 – prozedurale Web-Audio-Engine (keine Audiodateien, keine Bibliotheken).
 *
 *   const audio = createAudio();
 *   button.onclick = () => { void audio.unlock(); audio.music.play("wien"); };
 *   audio.sfx("coin");
 *
 * Einstellungen (Master/Musik/SFX/Muted) persistiert die App selbst.
 */
import { createEngine, createNoopAudio, resolveContextCtor } from "./engine";
import type { FredAudio } from "./types";

export type { FredAudio, LoopName, SfxName, SfxOptions, WorldMusicId } from "./types";
export { LOOP_NAMES, SFX_NAMES, WORLD_MUSIC_IDS } from "./types";

/**
 * Liefert im Browser die Engine, im Node/SSR-Fall oder ohne AudioContext ein sicheres No-Op-Objekt.
 * Es wird nichts erzeugt, bevor `unlock()` aus einer User-Geste aufgerufen wurde.
 */
export function createAudio(): FredAudio {
  const Ctor = resolveContextCtor();
  if (!Ctor) return createNoopAudio();
  return createEngine(Ctor).audio;
}
