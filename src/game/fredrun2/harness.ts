/** QA-Harness (nur Tools): startet die Engine ohne React in einer Seite, gesteuert von tools/fredrun2/shot.mjs. */
import { FredRunGame, type AudioLike } from "./game";

const noop = (): void => {};
const nullAudio: AudioLike = {
  unlock: async () => {},
  sfx: noop,
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
    __fr2: { game: FredRunGame };
  }
}

async function main(): Promise<void> {
  const container = document.getElementById("stage") as HTMLElement;
  const canvas = document.getElementById("c") as HTMLCanvasElement;
  const game = new FredRunGame({ canvas, container, audio: nullAudio, onChange: noop });
  game.manual = true;
  await game.init();
  window.__fr2 = { game };
  document.title = "ready";
}

void main();
