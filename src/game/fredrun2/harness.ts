/** QA-Harness (nur Tools): startet die Engine ohne React in einer Seite, gesteuert von tools/fredrun2/shot.mjs. */
import { FredRunGame, type AudioLike } from "./game";

const noop = (): void => {};
/** Aufgerufene Effektnamen (QA: Zähl-Töne, Jingles prüfen); begrenzt, damit lange Läufe nichts anhäufen. */
const sfxLog: string[] = [];
const nullAudio: AudioLike = {
  unlock: async () => {},
  sfx: (name) => {
    if (sfxLog.length < 500) sfxLog.push(name);
  },
  loop: noop,
  music: { play: noop, setIntensity: noop, stop: noop },
  setMasterVolume: noop,
  setMusicVolume: noop,
  setSfxVolume: noop,
  setMuted: noop,
  duck: noop,
  suspend: noop,
  resume: noop,
  setTempoScale: noop,
  dispose: noop,
};

declare global {
  interface Window {
    __fr2: { game: FredRunGame; sfxLog: string[] };
  }
}

async function main(): Promise<void> {
  const container = document.getElementById("stage") as HTMLElement;
  const canvas = document.getElementById("c") as HTMLCanvasElement;
  const game = new FredRunGame({ canvas, container, audio: nullAudio, onChange: noop });
  game.manual = true;
  await game.init();
  window.__fr2 = { game, sfxLog };
  document.title = "ready";
}

void main();
