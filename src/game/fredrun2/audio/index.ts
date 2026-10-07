/**
 * Fredrun 2.0 – prozedurale Web-Audio-Engine (keine Audiodateien, keine Bibliotheken).
 *
 *   const audio = createAudio();
 *   button.onclick = () => { void audio.unlock(); audio.music.play("wien"); };
 *   audio.sfx("coin");
 *
 * Einstellungen (Master/Musik/SFX/Muted) persistiert die App selbst.
 */
import { createEngine, createNoopAudio, prefetchAudio, resolveContextCtor } from "./engine";
import { MusicLibrary } from "./tracks";
import type { FredAudio } from "./types";

export type { FredAudio, LoopName, MusicTrackId, SfxName, SfxOptions, WorldMusicId } from "./types";
export { LOOP_NAMES, SFX_NAMES, WORLD_MUSIC_IDS } from "./types";

/** Gemeinsame Musik-Bibliothek: `preloadAudio` (vor dem Entsperren) und die Engine wählen dieselbe Variante eines Stücks. */
let sharedLibrary: MusicLibrary | null = null;
const library = (): MusicLibrary => (sharedLibrary ??= new MusicLibrary());

/**
 * Liefert im Browser die Engine, im Node/SSR-Fall oder ohne AudioContext ein sicheres No-Op-Objekt.
 * Es wird nichts erzeugt, bevor `unlock()` aus einer User-Geste aufgerufen wurde.
 */
export function createAudio(): FredAudio {
  const Ctor = resolveContextCtor();
  if (!Ctor) return createNoopAudio();
  return createEngine(Ctor, { library: library() }).audio;
}

/**
 * Wärmt den HTTP-Cache für den Audio-Start vor (SFX-Bank, Musik-Manifest, je Stück eine Variante), ohne zu dekodieren und ohne
 * AudioContext/Geste: `preloadAudio({ music: ["menu"] })` im Leerlauf nach dem Menü, `preloadAudio({ music: ["wien"] })` für die
 * gewählte Welt. `music` fehlt → nur das Menüstück. Ohne fetch (SSR) wirkungslos. `audio.prefetch()` der Engine ist dasselbe.
 */
export function preloadAudio(opts: { music?: string[] } = {}): void {
  prefetchAudio(library(), opts);
}
