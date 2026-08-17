import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { fredRunEnvironmentForDistance } from "./fredrun";
import {
  FREDRUN_WORLD_IDS,
  FREDRUN_WORLDS,
  loadFredRunWorldBackgrounds,
} from "./fredrun-worlds";

const pageSource = readFileSync(fileURLToPath(new URL("../app/page.tsx", import.meta.url)), "utf8");
const standalonePageSource = readFileSync(
  fileURLToPath(new URL("../app/fredrun/page.tsx", import.meta.url)),
  "utf8",
);
const viewSource = readFileSync(fileURLToPath(new URL("../components/fredrun-view.tsx", import.meta.url)), "utf8");
const profileSource = readFileSync(fileURLToPath(new URL("./fredrun-profile.ts", import.meta.url)), "utf8");
const stylesSource = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");
const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../../public/fredrun/manifest.json", import.meta.url)), "utf8")) as {
  source: {
    archive: { sha256: string; includedAnimations: string[] };
    jumpSheet: { sha256: string; sourceGrid: string; sourceFrameCount: number; selectedFrameIndices: number[] };
    runSheet: { file: string; sha256: string; sourceGrid: string; sourceFrameCount: number; selectedFrameIndices: number[] };
  };
  atlas: {
    cellSize: number;
    anchor: string;
    animations: Record<"walk" | "jump" | "victory", { columns: number; rows: number; frameCount: number }>;
  };
};
const obstacleManifest = JSON.parse(readFileSync(
  fileURLToPath(new URL("../../public/fredrun/obstacles/manifest.json", import.meta.url)),
  "utf8",
)) as {
  format: string;
  alpha: boolean;
  maximumOutputSize: number;
  assets: Record<string, {
    sha256: string;
    outputFile: string;
    outputSize: { width: number; height: number };
    outputBytes: number;
  }>;
};
const introManifest = JSON.parse(readFileSync(
  fileURLToPath(new URL("../../public/fredrun/intro-manifest.json", import.meta.url)),
  "utf8",
)) as {
  source: { file: string; sha256: string; width: number; height: number };
  output: { file: string; format: string; width: number; height: number; bytes: number };
};
const odoManifest = JSON.parse(readFileSync(
  fileURLToPath(new URL("../../public/fredrun/odo-manifest.json", import.meta.url)),
  "utf8",
)) as {
  source: { file: string; sha256: string; grid: string; frameCount: number };
  atlas: {
    file: string;
    format: string;
    sha256: string;
    columns: number;
    rows: number;
    cellSize: number;
    frameCount: number;
    anchor: string;
    flippedHorizontally: boolean;
    bytes: number;
  };
};
const madingerManifest = JSON.parse(readFileSync(
  fileURLToPath(new URL("../../public/fredrun/madinger-manifest.json", import.meta.url)),
  "utf8",
)) as {
  source: { file: string; sha256: string; grid: string; frameCount: number };
  atlas: {
    file: string;
    format: string;
    sha256: string;
    columns: number;
    rows: number;
    cellSize: number;
    frameCount: number;
    anchor: string;
    sharedScale: number;
    flippedHorizontally: boolean;
    direction: string;
    bytes: number;
  };
};
const jqaManifest = JSON.parse(readFileSync(
  fileURLToPath(new URL("../../public/fredrun/jqa-dance-gangnam-manifest.json", import.meta.url)),
  "utf8",
)) as {
  source: { file: string; sha256: string; grid: string; frameCount: number };
  atlas: {
    file: string;
    format: string;
    sha256: string;
    columns: number;
    rows: number;
    cellSize: number;
    frameCount: number;
    anchor: string;
    sharedScale: number;
    flippedHorizontally: boolean;
    movement: string;
    bytes: number;
  };
};
const fridaManifest = JSON.parse(readFileSync(
  fileURLToPath(new URL("../../public/fredrun/frida/manifest.json", import.meta.url)),
  "utf8",
)) as {
  source: {
    referenceSha256: string;
    autospriteCharacterId: string;
    generation: {
      videoTier: string;
      durationSeconds: number;
      sourceFrameSize: number;
      sourceFrameCount: number;
      firstFrameQuality: string;
      backgroundRemoval: string;
      creditsUsed: number;
      shippedCreditsUsed: number;
      discardedDraftCredits: number;
      sound: boolean;
    };
  };
  atlas: {
    cellSize: number;
    columns: number;
    rows: number;
    frameCount: number;
    anchor: string;
    animations: Record<"walk" | "jump" | "victory", {
      spritesheetId: string;
      columns: number;
      rows: number;
      frameCount: number;
      outputFile: string;
      outputSha256: string;
      bytes: number;
    }>;
  };
};
const superfredManifest = JSON.parse(readFileSync(
  fileURLToPath(new URL("../../public/fredrun/superfred/manifest.json", import.meta.url)),
  "utf8",
)) as {
  source: {
    referenceFile: string;
    referenceSha256: string;
    autospriteCharacterId: string;
    generation: {
      videoTier: string;
      durationSeconds: number;
      sourceFrameSize: number;
      sourceFrameCount: number;
      firstFrameQuality: string;
      backgroundRemoval: string;
      creditsUsed: number;
      shippedCreditsUsed: number;
      discardedDraftCredits: number;
      sound: boolean;
    };
  };
  atlas: {
    cellSize: number;
    columns: number;
    rows: number;
    frameCount: number;
    anchor: string;
    animations: Record<"walk" | "jump" | "victory", {
      sourceKind?: string;
      sourceFile?: string;
      sourceSha256?: string;
      spritesheetId?: string;
      sourceGrid?: string;
      sourceFrameCount?: number;
      sourceFrames?: number[];
      phaseFrames?: Record<"takeoff" | "superman" | "landing", number[]>;
      columns: number;
      rows: number;
      frameCount: number;
      outputFile: string;
      outputSha256: string;
      bytes: number;
    }>;
  };
};
const cyberfredManifest = JSON.parse(readFileSync(
  fileURLToPath(new URL("../../public/fredrun/cyberfred/manifest.json", import.meta.url)),
  "utf8",
)) as typeof superfredManifest & {
  atlas: {
    animations: {
      jump: {
        runtimePlayback: {
          mode: string;
          frameSequence: number[];
          displayedFrameCount: number;
          footAnchors: string;
        };
      };
    };
  };
};
const lukiManifest = JSON.parse(readFileSync(
  fileURLToPath(new URL("../../public/fredrun/luki-manifest.json", import.meta.url)),
  "utf8",
)) as {
  source: { file: string; sha256: string; grid: string; frameCount: number };
  atlas: {
    file: string;
    format: string;
    sha256: string;
    columns: number;
    rows: number;
    cellSize: number;
    frameCount: number;
    anchor: string;
    sharedScale: number;
    flippedHorizontally: boolean;
    direction: string;
    bytes: number;
  };
};
const coinManifest = JSON.parse(readFileSync(
  fileURLToPath(new URL("../../public/fredrun/coin-f-manifest.json", import.meta.url)),
  "utf8",
)) as {
  generation: { mode: string; sourceSha256: string; prompt: string };
  output: {
    file: string;
    format: string;
    sha256: string;
    size: { width: number; height: number };
    transparent: boolean;
    bytes: number;
  };
};
const backgroundManifest = JSON.parse(readFileSync(
  fileURLToPath(new URL("../../public/fredrun/background-manifest.json", import.meta.url)),
  "utf8",
)) as {
  generation: { mode: string; sha256: string; size: { width: number; height: number } };
  output: { file: string; format: string; sha256: string; crop: { width: number; height: number }; bytes: number };
  runtime: { drawHeight: number; scrollFactor: number; loop: string };
};
const stagedBackgroundManifest = JSON.parse(readFileSync(
  fileURLToPath(new URL("../../public/fredrun/backgrounds/manifest.json", import.meta.url)),
  "utf8",
)) as {
  generation: { mode: string; reference: string; rawDirectory: string };
  runtime: {
    format: string;
    size: { width: number; height: number };
    quality: number;
    scoreAnchors: number[];
    crossfade: string;
    finalState: string;
    darknessPerStage: number;
    darknessCap: number;
    loop: string;
    effects: { renderer: string; deterministic: boolean; reducedMotion: string };
  };
  stages: Array<{
    anchorScore: number;
    state: string;
    raw: { file: string; width: number; height: number; bytes: number; sha256: string };
    output: { file: string; width: number; height: number; bytes: number; sha256: string };
  }>;
};
const finanzamtBackgroundManifest = JSON.parse(readFileSync(
  fileURLToPath(new URL(
    "../../public/fredrun/levels/finanzamt-night/backgrounds/manifest.json",
    import.meta.url,
  )),
  "utf8",
)) as {
  schemaVersion: number;
  worldId: string;
  generation: {
    route: string;
    rawDirectory: string;
    tags: string[];
    sound: { included: boolean; decision: string };
  };
  runtime: {
    format: string;
    width: number;
    height: number;
    quality: number;
    scoreAnchors: number[];
    crossfadeScoreDuration: number;
    transition: string;
    finalState: string;
    loop: string;
    mirroredTextTreatment: {
      method: string;
      patches: Array<{ id: string; left: number; top: number; width: number; height: number }>;
    };
    fallbackSource: string;
    compatibilityAliases: Array<{
      runtimePath: string;
      targetStageId: string;
      bytes: number;
      sha256: string;
      purpose: string;
    }>;
    effects: {
      fluorescentFlicker: {
        opacityRange: number[];
        reducedMotion: string;
        worldScope: string;
      };
    };
    processing: { script: string; method: string; overlays: string[] };
  };
  stages: Array<{
    id: string;
    anchorScore: number;
    prompt: string;
    provenance: {
      provider: string;
      model: string;
      rawPath: string;
      archivePath: string;
      archiveSha256: string;
      archiveMetadataPath: string;
      archivePromptPath: string;
      archiveTags: string[];
    };
    raw: { width: number; height: number; bytes: number; sha256: string };
    processing: {
      overlays: string[];
      exactOverlayPatches: Array<{ id: string; left: number; top: number; width: number; height: number }>;
    };
    output: {
      file: string;
      runtimePath: string;
      format: string;
      width: number;
      height: number;
      bytes: number;
      sha256: string;
    };
  }>;
};

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function stagedBackgroundSourcesFromView(): string[] {
  return FREDRUN_WORLDS.vienna.backgrounds.stages.map(({ source }) => source);
}

function viewImplementationBetween(start: string, end: string): string {
  const startIndex = viewSource.indexOf(start);
  const endIndex = viewSource.indexOf(end, startIndex);
  if (startIndex < 0 || endIndex < 0) return "";
  return viewSource.slice(startIndex, endIndex);
}

describe("Fredrun UI surface", () => {
  it("exposes the standalone game route in production", () => {
    expect(standalonePageSource).toContain("<FredRunView accessToken=\"\" standalone />");
    expect(standalonePageSource).not.toContain("process.env.NODE_ENV");
    expect(standalonePageSource).not.toContain("notFound()");
  });

  it("registers Fredrun in both navigation modes and the app view", () => {
    expect(pageSource).toContain('"fredrun"');
    expect(pageSource).toContain('onClick={openFredRunView}');
    expect(pageSource).toContain('title="Fredrun"');
    expect(pageSource).toContain('aria-label="Fredrun"');
    expect(pageSource).toContain('appView === "fredrun"');
    expect(pageSource).toContain(
      '<FredRunView key={user?.id ?? "fredrun"} accessToken={session?.access_token ?? ""} />',
    );
  });

  it("exposes keyboard, pointer, pause, replay, menu return, and accessible status controls", () => {
    expect(viewSource).toContain('event.code !== "Space"');
    expect(viewSource).toContain('event.code !== "ArrowUp"');
    expect(viewSource).toContain("onPointerDown");
    expect(viewSource).toContain("visibilitychange");
    expect(viewSource).toContain("pauseFredRun");
    expect(viewSource).toContain("playAgain");
    expect(viewSource).toContain("returnToMenu");
    expect(viewSource).toContain('aria-live="polite"');
    expect(viewSource).toContain('snapshot.phase === "countdown"');
    expect(viewSource).toContain('className="fredrun-overlay fredrun-countdown-overlay"');
    expect(viewSource).toContain('aria-live="assertive"');
  });

  it("offers a supported mobile fullscreen control with synchronized state", () => {
    expect(viewSource).toContain("document.fullscreenEnabled && shell?.requestFullscreen");
    expect(viewSource).toContain('document.addEventListener("fullscreenchange", syncFullscreenState)');
    expect(viewSource).toContain('await shell.requestFullscreen({ navigationUI: "hide" })');
    expect(viewSource).toContain('const MOBILE_FULLSCREEN_QUERY = "(max-width: 900px), (pointer: coarse)"');
    expect(viewSource).toContain('await screen.orientation.lock("landscape")');
    expect(viewSource).toContain("screen.orientation.unlock()");
    expect(viewSource).toContain('aria-label={isFullscreen ? "Vollbild beenden" : "Vollbild öffnen"}');
    expect(stylesSource).toContain(".fredrun-game-shell:fullscreen");
    expect(stylesSource).toMatch(
      /\.fredrun-game-shell:fullscreen \.fredrun-stage\s*\{[\s\S]*?aspect-ratio: 8 \/ 3;/u,
    );
    expect(stylesSource).toMatch(
      /@media \(max-width: 900px\)[\s\S]*?\.fredrun-hud \.fredrun-fullscreen-button\s*\{\s*display: inline-grid;/u,
    );
  });

  it("renders collectible air coins, coin score feedback, and a collision impact", () => {
    expect(viewSource).toContain("state.coins.forEach((coin) => drawCoin");
    expect(viewSource).toContain('context.fillText("F", 0, 0.5)');
    expect(viewSource).toContain("state.phase !== \"game-over\"");
    expect(viewSource).toContain("drawHitFeedback(context, state)");
    expect(viewSource).toContain('className="fredrun-coin-hud"');
    expect(viewSource).toContain("snapshot.coinsCollected * FREDRUN_COIN_SCORE");
    expect(viewSource).toContain("fredrun-stage--game-over fredrun-stage--hit");
    expect(stylesSource).toContain("@keyframes fredrun-hit-shake");
    expect(stylesSource).toContain("@keyframes fredrun-hit-flash");
  });

  it("renders near-miss combos and both collectible power-up states", () => {
    expect(viewSource).toContain("state.powerUps?.forEach((powerUp) => drawPowerUp");
    expect(viewSource).toContain("drawPlayerPowerEffects(context, state, reducedMotion)");
    expect(viewSource).toContain('magnet: "Magnet"');
    expect(viewSource).toContain('const MAGNET_SOURCE = "/fredrun/powerup-magnet.png"');
    expect(viewSource).toContain("<FredRunMagnetIcon />");
    expect(viewSource).toContain('shield: "Schild"');
    expect(viewSource).not.toContain('"slow-motion": "Zeitlupe"');
    expect(viewSource).toContain('className="fredrun-effect-strip"');
    expect(viewSource).toContain('className="fredrun-feedback-pop fredrun-feedback-pop--near-miss"');
    expect(viewSource).toContain("snapshot.nearMissScore");
    expect(stylesSource).toContain(".fredrun-effect-chip--magnet");
    expect(stylesSource).toContain(".fredrun-effect-chip--shield");
    expect(stylesSource).not.toContain(".fredrun-effect-chip--slow-motion");
    expect(stylesSource).toContain("@keyframes fredrun-feedback-pop");
    expect(stylesSource).toContain("@keyframes fredrun-shield-flash");
  });

  it("offers authenticated score submission and a global top ten", () => {
    expect(viewSource).toContain('fetch("/api/fredrun/highscores"');
    expect(viewSource).toContain('Authorization: `Bearer ${accessToken}`');
    expect(viewSource).toContain('maxLength={FREDRUN_PLAYER_NAME_MAX_LENGTH}');
    expect(viewSource).toContain('Score einreichen');
    expect(viewSource).toContain('id="fredrun-leaderboard-title">Top 10');
    expect(viewSource).toContain('fredrun-leaderboard-entry--rank-${entry.rank}');
    expect(viewSource).toContain('input, textarea, button, [contenteditable=\'true\']');
  });

  it("keeps authenticated progress in Supabase and local storage only for standalone play", () => {
    expect(viewSource).toContain('fetch("/api/fredrun/progress"');
    expect(viewSource).toContain('action: "settle_run"');
    expect(viewSource).toContain('action: "purchase"');
    expect(viewSource).toContain('action: "select"');
    expect(viewSource).toContain('if (!accessToken) {');
    expect(viewSource).toContain("readFredRunProfile(storage)");
    expect(viewSource).toContain("serverBacked={Boolean(accessToken)}");
  });

  it("ships the three runtime atlases while preserving source provenance", () => {
    expect(manifest.source.archive.sha256).toBe("DCD8D61B48B88FE525DA2D151544B8B8C859C9E3E222DEE18732E160E1A9F735");
    expect(manifest.source.archive.includedAnimations).toEqual(["Victory"]);
    expect(manifest.source.jumpSheet).toMatchObject({
      sha256: "F16512E534978A7F3E0081A455DC1EE57064383AC2D4C8C994050EB087670789",
      sourceGrid: "7x7",
      sourceFrameCount: 49,
    });
    expect(manifest.source.jumpSheet.selectedFrameIndices).toHaveLength(24);
    expect(manifest.source.jumpSheet.selectedFrameIndices[0]).toBe(0);
    expect(manifest.source.jumpSheet.selectedFrameIndices.at(-1)).toBe(48);
    expect(manifest.source.runSheet).toMatchObject({
      file: "Fred-run.png",
      sha256: "72A63C14C1D2E620884FF9C1D9C553A6184EBB528F2A08B26DE6B6EA39CDEBDE",
      sourceGrid: "8x8",
      sourceFrameCount: 64,
    });
    expect(manifest.source.runSheet.selectedFrameIndices).toHaveLength(64);
    expect(manifest.source.runSheet.selectedFrameIndices[0]).toBe(24);
    expect(manifest.source.runSheet.selectedFrameIndices.at(-1)).toBe(55);
    expect(manifest.atlas).toMatchObject({
      cellSize: 192,
      anchor: "bottom-center",
      animations: {
        walk: { columns: 8, rows: 8, frameCount: 64 },
        jump: { columns: 6, rows: 4, frameCount: 24 },
        victory: { columns: 8, rows: 8, frameCount: 64 },
      },
    });
    expect(viewSource).toContain('jump: { source: "/fredrun/jump.png", columns: 6, frameCount: 24, fps: 18 }');
    expect(viewSource).toContain('victory: { source: "/fredrun/victory.png", columns: 8, frameCount: 64, fps: 18 }');

    const totalBytes = ["walk.png", "jump.png", "victory.png"].reduce((total, name) => (
      total + statSync(fileURLToPath(new URL(`../../public/fredrun/${name}`, import.meta.url))).size
    ), 0);
    expect(totalBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it("ships Frida with selectable run, jump, and victory animations", () => {
    expect(fridaManifest.source).toMatchObject({
      referenceSha256: "4C51E0D746845DFD56EA001E49C9EA45393D5996E07821733D07461A7E5C3587",
      autospriteCharacterId: "cmstdc8v0007bu6l4ok6pknjd",
      generation: {
        videoTier: "pro",
        durationSeconds: 4,
        sourceFrameSize: 512,
        sourceFrameCount: 64,
        firstFrameQuality: "pro",
        creditsUsed: 78,
        shippedCreditsUsed: 26,
        discardedDraftCredits: 52,
        sound: false,
      },
    });
    expect(fridaManifest.atlas).toMatchObject({
      cellSize: 192,
      columns: 8,
      rows: 8,
      frameCount: 64,
      anchor: "bottom-center",
    });
    expect(fridaManifest.atlas.animations.walk).toMatchObject({ columns: 8, rows: 8, frameCount: 64 });
    expect(fridaManifest.atlas.animations.jump).toMatchObject({ columns: 8, rows: 8, frameCount: 64 });
    expect(fridaManifest.atlas.animations.victory).toMatchObject({ columns: 8, rows: 4, frameCount: 32 });
    expect(Object.keys(fridaManifest.atlas.animations)).toEqual(["walk", "jump", "victory"]);
    for (const animation of Object.values(fridaManifest.atlas.animations)) {
      expect(animation.spritesheetId).toMatch(/^cm/);
      expect(animation.outputSha256).toMatch(/^[A-F0-9]{64}$/);
      expect(statSync(fileURLToPath(new URL(
        `../../public/fredrun/frida/${animation.outputFile}`,
        import.meta.url,
      ))).size).toBe(animation.bytes);
    }
    expect(viewSource).toContain('walk: { source: "/fredrun/frida/walk.webp", columns: 8, frameCount: 64, fps: 16 }');
    expect(viewSource).toContain('jump: { source: "/fredrun/frida/jump.webp", columns: 8, frameCount: 64, fps: 16 }');
    expect(viewSource).toContain('victory: { source: "/fredrun/frida/victory.webp", columns: 8, frameCount: 32, fps: 16 }');
    expect(viewSource).toContain('id="fredrun-menu-characters-title">Charakter auswählen');
    expect(viewSource).toContain("<FredRunCharacterPreview characterId={characterId} />");
    expect(viewSource).toContain("onSelectCharacter(characterId)");
    expect(stylesSource).toContain(".fredrun-menu-character-grid");
    expect(stylesSource).toContain(".fredrun-menu-character-card.is-selected");
  });

  it("ships Superfred with selectable run, jump, and victory animations", () => {
    expect(superfredManifest.source).toMatchObject({
      referenceFile: "Superfred.png",
      referenceSha256: "5638F87F96ADFC18040BDE92EDD297894B217A8D6772890B7728EE35F11318A6",
      autospriteCharacterId: "cmsu4m95j00057i6op1njwhmy",
      generation: {
        videoTier: "pro",
        durationSeconds: 4,
        sourceFrameSize: 512,
        sourceFrameCount: 64,
        firstFrameQuality: "pro",
        creditsUsed: 78,
        shippedCreditsUsed: 39,
        discardedDraftCredits: 39,
        sound: false,
      },
    });
    expect(superfredManifest.atlas).toMatchObject({
      cellSize: 192,
      columns: 8,
      rows: 8,
      frameCount: 64,
      anchor: "bottom-center",
    });
    expect(Object.keys(superfredManifest.atlas.animations)).toEqual(["walk", "jump", "victory"]);
    for (const animation of Object.values(superfredManifest.atlas.animations)) {
      expect(animation).toMatchObject({ columns: 8, rows: 8, frameCount: 64 });
      expect(animation.outputSha256).toMatch(/^[A-F0-9]{64}$/);
      expect(statSync(fileURLToPath(new URL(
        `../../public/fredrun/superfred/${animation.outputFile}`,
        import.meta.url,
      ))).size).toBe(animation.bytes);
    }
    expect(superfredManifest.atlas.animations.walk.spritesheetId).toMatch(/^cms/);
    expect(superfredManifest.atlas.animations.victory.spritesheetId).toMatch(/^cms/);
    expect(superfredManifest.atlas.animations.jump).toMatchObject({
      sourceKind: "user-provided-spritesheet",
      sourceFile: "1786815054521_67465ed8-cf75-4fdb-be5f-cb1cca53584b.png",
      sourceSha256: "40A74232D99C82CC917366EA10A3EDC67CDA8D053A121B39617B76FE5B7AEE60",
      sourceGrid: "8x8",
      sourceFrameCount: 64,
      phaseFrames: {
        takeoff: [24, 27],
        superman: [28, 38],
        landing: [39, 46],
      },
    });
    const sourceFrames = superfredManifest.atlas.animations.jump.sourceFrames;
    expect(sourceFrames).toHaveLength(64);
    expect(sourceFrames?.[0]).toBe(24);
    expect(sourceFrames?.[9]).toBe(27);
    expect(sourceFrames?.[10]).toBe(28);
    expect(sourceFrames?.at(-1)).toBe(46);
    const totalBytes = Object.values(superfredManifest.atlas.animations).reduce((total, animation) => (
      total + animation.bytes
    ), 0);
    expect(totalBytes).toBeLessThanOrEqual(3 * 1024 * 1024);
    expect(profileSource).toContain('export const FREDRUN_CHARACTER_IDS = ["fred", "frida", "superfred", "cyberfred"] as const');
    expect(viewSource).toContain('walk: { source: "/fredrun/superfred/walk.webp?v=smooth-walk-1", columns: 8, frameCount: 64, fps: 16 }');
    expect(viewSource).toContain('const JUMP_ANIMATION_DURATION = 0.82;');
    expect(viewSource).toContain('jump: { source: "/fredrun/superfred/jump.webp?v=superman-jump-2", columns: 8, frameCount: 64, fps: 16 }');
    expect(viewSource).toContain('victory: { source: "/fredrun/superfred/victory.webp", columns: 8, frameCount: 64, fps: 16 }');
    expect(profileSource).toContain('superfred: { name: "Superfred", description: "Mit Cape und Extrapower", price: FREDRUN_SUPERFRED_PRICE }');
    expect(stylesSource).toContain("grid-template-columns: repeat(3, minmax(0, 1fr));");
    expect(viewSource).toContain('className="fredrun-overlay fredrun-pause-overlay"');
    expect(stylesSource).toContain(".fredrun-pause-overlay h2");
  });

  it("ships Cyberfred with AutoSprite run, jump, and dance animations", () => {
    expect(cyberfredManifest.source).toMatchObject({
      referenceFile: "Photo 1.jpg",
      referenceSha256: "CBDD7B6B92AE436C2AC5CD258BB54260E1E7A86236E30E7926A2E8CA2CA68B6E",
      autospriteCharacterId: "cmsxekm1900atvsmf58tejjnd",
      generation: {
        videoTier: "pro",
        durationSeconds: 4,
        sourceFrameSize: 512,
        sourceFrameCount: 64,
        firstFrameQuality: "pro",
        backgroundRemoval: "ultra",
        creditsUsed: 65,
        shippedCreditsUsed: 39,
        discardedDraftCredits: 26,
        sound: false,
      },
    });
    expect(cyberfredManifest.atlas).toMatchObject({
      cellSize: 192,
      columns: 8,
      rows: 8,
      frameCount: 64,
      anchor: "bottom-center",
    });
    expect(Object.keys(cyberfredManifest.atlas.animations)).toEqual(["walk", "jump", "victory"]);
    for (const animation of Object.values(cyberfredManifest.atlas.animations)) {
      expect(animation).toMatchObject({
        sourceKind: "autosprite",
        sourceGrid: "8x8",
        sourceFrameCount: 64,
        columns: 8,
        rows: 8,
        frameCount: 64,
      });
      expect(animation.spritesheetId).toMatch(/^cms/);
      expect(animation.outputSha256).toMatch(/^[A-F0-9]{64}$/);
      expect(statSync(fileURLToPath(new URL(
        `../../public/fredrun/cyberfred/${animation.outputFile}`,
        import.meta.url,
      ))).size).toBe(animation.bytes);
    }
    const totalBytes = Object.values(cyberfredManifest.atlas.animations).reduce((total, animation) => (
      total + animation.bytes
    ), 0);
    expect(totalBytes).toBeLessThanOrEqual(3 * 1024 * 1024);
    expect(viewSource).toContain('walk: { source: "/fredrun/cyberfred/walk.webp", columns: 8, frameCount: 64, fps: 16 }');
    expect(viewSource).toContain('source: "/fredrun/cyberfred/jump.webp?v=smooth-single-arc-v3"');
    expect(viewSource).toContain("frameSequence: CYBERFRED_JUMP_FRAME_SEQUENCE");
    expect(viewSource).toContain('victory: { source: "/fredrun/cyberfred/victory.webp?v=robot-dance-v2", columns: 8, frameCount: 64, fps: 16 }');
    expect(cyberfredManifest.atlas.animations.jump).toMatchObject({
      animationName: "Blue Booster Jump",
      facingDirection: "right",
      runtimeEffect: "electric-blue-boot-thrusters",
    });
    expect(cyberfredManifest.atlas.animations.jump.runtimePlayback).toEqual({
      mode: "curated-single-arc",
      frameSequence: [8, 10, 12, 14, 16, 18, 20, 21, 22, 22, 21, 20, 18, 16, 14, 12, 10, 8],
      displayedFrameCount: 18,
      footAnchors: "per-frame-source-cell-coordinates",
    });
    expect(cyberfredManifest.atlas.animations.victory).toMatchObject({
      animationName: "Cyberfred Robot Dance",
      danceStyle: "classic-robot-dance",
      loop: true,
    });
    expect(viewSource).toContain("function drawCyberfredJumpThrusters");
    expect(viewSource).toContain("CYBERFRED_JUMP_BOOT_ANCHORS[spriteFrame]");
    expect(viewSource).toContain('characterId === "cyberfred"');
    expect(profileSource).toContain('export const FREDRUN_CYBERFRED_PRICE = 2_000;');
    expect(profileSource).toContain('name: "Cyberfred"');
    expect(profileSource).toContain('price: FREDRUN_CYBERFRED_PRICE');
  });

  it("lays out the game-over score on the left and the selected dancer on the right", () => {
    expect(viewSource).toContain('className="fredrun-game-over-summary"');
    expect(viewSource).toContain("<h2>{snapshot.score} Punkte</h2>");
    expect(viewSource).toContain("Noch einmal");
    expect(viewSource).toContain('<FredRunVictoryDance characterId={selectedCharacter} />');
    expect(viewSource).toContain('aria-label={`${fredRunCharacters[characterId].name} tanzt`}');
    expect(stylesSource).toContain('"summary dance"');
    expect(stylesSource).toContain("grid-area: dance");
  });

  it("loads the three static obstacle assets with recorded provenance and a small payload", () => {
    expect(obstacleManifest).toMatchObject({
      format: "webp",
      alpha: true,
      maximumOutputSize: 192,
      assets: {
        reihe100: { sha256: "9B668A34398940FCBE7B376944ECF7C6BA9FB38FBD9867C9CACAE5FCFC3F4F3D" },
        steuerkodex: { sha256: "2F19937098D2E3D68C518E72864F40DD3DFCCC80C32688B4D4368DFF8C6A6B59" },
        paragraph: { sha256: "27B339B0067235CAEB7E087BFCFD1E050568A675138E2ABF55126A81BA45A904" },
      },
    });

    const assets = Object.values(obstacleManifest.assets);
    expect(assets).toHaveLength(3);
    expect(obstacleManifest.assets).not.toHaveProperty("beschluss");
    expect(assets.every((asset) => asset.outputSize.width <= 192 && asset.outputSize.height <= 192)).toBe(true);
    expect(assets.reduce((total, asset) => total + asset.outputBytes, 0)).toBeLessThanOrEqual(128 * 1024);
    for (const asset of assets) {
      expect(statSync(fileURLToPath(new URL(
        `../../public/fredrun/obstacles/${asset.outputFile}`,
        import.meta.url,
      ))).size).toBe(asset.outputBytes);
      expect(viewSource).toContain(`/fredrun/obstacles/${asset.outputFile}`);
    }
  });

  it("names both selectable runners without naming individual opponents", () => {
    expect(viewSource).toContain(
      "Wähle deinen Charakter, sammle Münzen und spring über REIH 100, Steuerkodex und unerwartete Hindernisse.",
    );
    expect(viewSource).not.toContain("Spring mit Fred über Odo");
  });

  it("keeps running through score pulses without level or milestone UI", () => {
    expect(viewSource).toContain("FREDRUN_SCORE_PULSE_POINTS");
    expect(viewSource).toContain('className={scorePulseToken > 0 ? "fredrun-score--pulse" : undefined}');
    expect(viewSource).not.toContain('snapshot.phase === "milestone"');
    expect(viewSource).not.toContain("Nächste Stufe");
    expect(viewSource).not.toContain("<span>Stufe</span>");
  });

  it("uses the supplied intro artwork behind the responsive main menu", () => {
    expect(introManifest).toEqual({
      source: {
        file: "intro.png",
        sha256: "29F68BDD254CA3DFC3E6F8D1350DFCFFA55ED24DF3D569742AF725F86ECCA8A8",
        width: 1672,
        height: 941,
      },
      output: {
        file: "intro.webp",
        format: "webp",
        width: 1600,
        height: 900,
        bytes: 383610,
      },
    });
    expect(statSync(fileURLToPath(new URL("../../public/fredrun/intro.webp", import.meta.url))).size)
      .toBe(introManifest.output.bytes);
    expect(introManifest.output.bytes).toBeLessThanOrEqual(400 * 1024);
    expect(viewSource).toContain('const INTRO_SOURCE = "/fredrun/intro.webp"');
    expect(viewSource).toContain('className="fredrun-menu-background"');
    expect(viewSource).toContain('const showMenu = isReadyPhase');
    expect(viewSource).toContain('&& assetState === "ready"');
    expect(viewSource).toContain('aria-label="Fredrun-Hauptmenü"');
    expect(stylesSource).toContain(".fredrun-stage--menu");
  });

  it("shows a dedicated loading screen until assets and the local profile are ready", () => {
    expect(viewSource).toContain("const LOADING_SCREEN_MINIMUM_MS = 850");
    expect(viewSource).toContain("const showLoading = isReadyPhase");
    expect(viewSource).toContain('assetState !== "ready" || !profileReady || !minimumLoadingComplete');
    expect(viewSource).toContain('className="fredrun-loading-screen"');
    expect(viewSource).toContain('aria-label="Fredrun wird geladen"');
    expect(viewSource).toContain('aria-busy="true"');
    expect(viewSource).toContain('className="fredrun-loading-background"');
    expect(viewSource).toContain('className="fredrun-loading-card"');
    expect(stylesSource).toContain(".fredrun-loading-track");
    expect(stylesSource).toContain("@keyframes fredrun-loading-progress");
  });

  it("renders the local wallet, character shop, information screen, and safe abort flow", () => {
    expect(viewSource).toContain('{ id: "play", label: "Spielen" }');
    expect(viewSource).toContain('{ id: "characters", label: "Charaktere" }');
    expect(viewSource).toContain('{ id: "shop", label: "Shop" }');
    expect(viewSource).toContain('{ id: "info", label: "Info" }');
    expect(viewSource).toContain("profile.coinBalance.toLocaleString");
    expect(profileSource).toContain("FREDRUN_SUPERFRED_PRICE");
    expect(viewSource).toContain("purchaseFredRunCharacter");
    expect(viewSource).toContain("settleFredRunCoins");
    expect(viewSource).toContain("Kein Echtgeld");
    expect(viewSource).toContain("Bald verfügbar");
    expect(viewSource).toContain("Spielmechaniken & Power-ups");
    expect(viewSource).toContain('role={abortConfirmation ? "alertdialog" : undefined}');
    expect(viewSource).toContain("ungesicherte Münzen gehen verloren");
    expect(viewSource).toContain("Run-Münzen");
    expect(viewSource).toContain("handleFredRunDialogKeyDown");
    expect(viewSource).toContain('inert={dialogOpen ? true : undefined}');
    expect(viewSource).toContain("animated && !reducedMotion");
    expect(stylesSource).toContain(".fredrun-menu-wallet");
    expect(stylesSource).toContain(".fredrun-shop-grid");
    expect(stylesSource).toContain(".fredrun-info-grid");
    expect(stylesSource).toContain("@media (max-height: 520px) and (orientation: landscape)");
  });

  it("integrates a compact Levels menu with world purchase and selected-world play copy", () => {
    expect(FREDRUN_WORLD_IDS).toEqual(["vienna", "finanzamt-night"]);
    expect(FREDRUN_WORLDS.vienna).toMatchObject({ name: "Wien", price: 0 });
    expect(FREDRUN_WORLDS["finanzamt-night"]).toMatchObject({
      name: "Finanzamt bei Nacht",
      price: 500,
    });
    expect(viewSource).toContain('{ id: "levels", label: "Levels" }');
    expect(viewSource).toContain('activeTab === "levels"');
    expect(viewSource).toContain("FREDRUN_WORLD_IDS.map");
    expect(viewSource).toContain("purchaseFredRunWorld");
    expect(viewSource).toContain("selectedWorld.playKicker");
    expect(viewSource).toContain("selectedWorld.playDescription");
    expect(stylesSource).toContain(".fredrun-level-grid");
    expect(stylesSource).toContain(".fredrun-level-card.is-selected");
  });

  it("ships four distinct close-up Finanzamt rooms with complete provenance", () => {
    expect(finanzamtBackgroundManifest).toMatchObject({
      schemaVersion: 1,
      worldId: "finanzamt-night",
      generation: {
        route: "OpenAI Codex built-in image_gen",
        rawDirectory: "/opt/data/tmp/fredrun-finanzamt-multi-scene",
        tags: ["findog", "fredrun", "finanzamt-night", "close-office"],
        sound: { included: false },
      },
      runtime: {
        format: "webp",
        width: 2172,
        height: 665,
        quality: 84,
        scoreAnchors: [0, 500, 1_000, 1_500],
        crossfadeScoreDuration: 40,
        transition: "smoothstep crossfade over the final 40 score points before each next anchor",
        finalState: "hold close-archive from score 1500 onward",
        loop: "alternating mirrored horizontal tiles with pixel-continuous joins",
        mirroredTextTreatment: {
          method: "redraw unmirrored source patches after each mirrored tile",
        },
        fallbackSource: "/fredrun/levels/finanzamt-night/backgrounds/close-office.webp",
        compatibilityAliases: [{
          runtimePath: "/fredrun/levels/finanzamt-night/backgrounds/close-office.webp",
          targetStageId: "close-caseworker-office",
        }],
        effects: {
          fluorescentFlicker: {
            opacityRange: [0.008, 0.042],
            reducedMotion: "disabled",
            worldScope: "night-office only; Vienna receives zero overlay opacity",
          },
        },
        processing: { script: "scripts/prepare-fredrun-finanzamt-backgrounds.mjs" },
      },
    });
    expect(finanzamtBackgroundManifest.generation.sound.decision.length).toBeGreaterThan(20);
    expect(finanzamtBackgroundManifest.runtime.processing.method).toContain("exact resize");
    expect(finanzamtBackgroundManifest.runtime.mirroredTextTreatment.patches).toHaveLength(4);
    expect(finanzamtBackgroundManifest.runtime.mirroredTextTreatment.patches[0]).toEqual({
      id: "wall-sign",
      left: 300,
      top: 176,
      width: 120,
      height: 68,
    });
    const expectedOverlays = [
      'professional wall sign: exact text "Finanzamt Österreich"',
      'binder spine: exact text "BAO"',
      'calendar note: exact text "31.12."',
      'coffee mug: exact mark "§"',
      "small Fred-blue dog silhouette sticker",
    ];
    expect(finanzamtBackgroundManifest.runtime.processing.overlays).toEqual(expectedOverlays);
    expect(finanzamtBackgroundManifest.stages).toHaveLength(4);
    expect(finanzamtBackgroundManifest.stages.map(({ anchorScore }) => anchorScore))
      .toEqual([0, 500, 1_000, 1_500]);
    expect(finanzamtBackgroundManifest.stages.map(({ output }) => output.runtimePath)).toEqual(
      FREDRUN_WORLDS["finanzamt-night"].backgrounds.stages.map(({ source }) => source),
    );
    expect(finanzamtBackgroundManifest.stages.map(({ id }) => id)).toEqual([
      "close-caseworker-office",
      "close-records-room",
      "close-glass-offices",
      "close-archive",
    ]);

    const rawHashes = new Set(finanzamtBackgroundManifest.stages.map(({ raw }) => raw.sha256));
    const outputHashes = new Set(finanzamtBackgroundManifest.stages.map(({ output }) => output.sha256));
    expect(rawHashes.size).toBe(4);
    expect(outputHashes.size).toBe(4);
    const compatibilityAlias = readFileSync(fileURLToPath(new URL(
      "../../public/fredrun/levels/finanzamt-night/backgrounds/close-office.webp",
      import.meta.url,
    )));
    const compatibilityAliasManifest = finanzamtBackgroundManifest.runtime.compatibilityAliases[0];
    expect(compatibilityAlias.length).toBe(compatibilityAliasManifest.bytes);
    expect(sha256(compatibilityAlias)).toBe(compatibilityAliasManifest.sha256);
    expect(compatibilityAliasManifest.sha256)
      .toBe(finanzamtBackgroundManifest.stages[0].output.sha256);

    for (const stage of finanzamtBackgroundManifest.stages) {
      expect(stage.prompt.length).toBeGreaterThan(500);
      expect(stage.provenance.rawPath).toBe(
        `/opt/data/tmp/fredrun-finanzamt-multi-scene/${stage.id}-raw.png`,
      );
      expect(stage.provenance.archivePath).toMatch(/^\/opt\/data\/generated-images\/images\/2026\/08\//u);
      expect(stage.provenance.archiveSha256).toBe(stage.raw.sha256);
      expect(stage.provenance.archiveMetadataPath).toMatch(/^\/opt\/data\/generated-images\/metadata\/2026\/08\//u);
      expect(stage.provenance.archivePromptPath).toMatch(/^\/opt\/data\/generated-images\/prompts\/2026\/08\//u);
      expect(stage.provenance.provider.toLowerCase()).toContain("codex");
      expect(stage.provenance.model.length).toBeGreaterThan(5);
      expect(stage.provenance.archiveTags).toEqual(expect.arrayContaining([
        "findog",
        "fredrun",
        "finanzamt-night",
        "close-office",
        stage.id === "close-caseworker-office" ? "close-office" : stage.id,
      ]));
      expect(stage.raw).toMatchObject({ bytes: expect.any(Number), sha256: expect.stringMatching(/^[a-f0-9]{64}$/u) });
      expect(stage.output).toMatchObject({
        format: "webp",
        width: 2172,
        height: 665,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      });
      expect(stage.processing.overlays).toEqual(expectedOverlays);
      expect(stage.processing.exactOverlayPatches).toEqual(
        finanzamtBackgroundManifest.runtime.mirroredTextTreatment.patches,
      );
      const output = readFileSync(fileURLToPath(new URL(
        `../../public${stage.output.runtimePath}`,
        import.meta.url,
      )));
      expect(output.length).toBe(stage.output.bytes);
      expect(sha256(output)).toBe(stage.output.sha256);
    }
  });

  it("ships Odo as a normalized left-facing animated obstacle", () => {
    expect(odoManifest).toMatchObject({
      source: {
        file: "Odo-run.png",
        sha256: "22124B4BFE05E32D551B9A4877EC33DEFD08BF2C8AA1F41CFDC04DD364A552B8",
        grid: "8x8",
        frameCount: 64,
      },
      atlas: {
        file: "odo-run.webp",
        format: "webp",
        sha256: "869F7A2B428C405B5F4725A8DF53F68F0AC95CC05B54A3233BEBB46BEB317D68",
        columns: 8,
        rows: 8,
        cellSize: 192,
        frameCount: 64,
        anchor: "bottom-center",
        flippedHorizontally: true,
        bytes: 559078,
      },
    });
    expect(statSync(fileURLToPath(new URL("../../public/fredrun/odo-run.webp", import.meta.url))).size)
      .toBe(odoManifest.atlas.bytes);
    expect(odoManifest.atlas.bytes).toBeLessThanOrEqual(600 * 1024);
    expect(viewSource).toContain('source: "/fredrun/odo-run.webp"');
    expect(viewSource).toContain('context.fillText("Beschluss?"');
  });

  it("ships Madinger as a normalized right-to-left animated opponent", () => {
    expect(madingerManifest).toEqual({
      source: {
        file: "Madinger-walk.png",
        sha256: "F786C97C128EB92D6B164FF68A8CF7C35881FB5716E0357D3D3D00281A6C207E",
        grid: "7x7",
        frameCount: 49,
      },
      atlas: {
        file: "madinger-walk.webp",
        format: "webp",
        sha256: "B6A0B005821EE6BD381492EBFA6FA56B116D1D5F6FE2066B39212027F116335F",
        columns: 7,
        rows: 7,
        cellSize: 192,
        frameCount: 49,
        anchor: "bottom-center",
        sharedScale: 1.148387,
        flippedHorizontally: true,
        direction: "right-to-left",
        bytes: 195062,
      },
    });
    expect(statSync(fileURLToPath(new URL("../../public/fredrun/madinger-walk.webp", import.meta.url))).size)
      .toBe(madingerManifest.atlas.bytes);
    expect(madingerManifest.atlas.bytes).toBeLessThanOrEqual(256 * 1024);
    expect(viewSource).toContain('source: "/fredrun/madinger-walk.webp"');
    expect(viewSource).toContain("animation: { columns: 7, cellSize: 192, frameCount: 49, fps: 18 }");
  });

  it("ships JQA as a normalized stationary dancing obstacle", () => {
    expect(jqaManifest).toEqual({
      source: {
        file: "jqa-dance_gangnam.png",
        sha256: "8D2E3FB26AD4E7E28DF590C92E8679F60CF9EA8CA7B38D7931863163973F502F",
        grid: "8x8",
        frameCount: 64,
      },
      atlas: {
        file: "jqa-dance-gangnam.webp",
        format: "webp",
        sha256: "65C1555C71D957010F4EB97971A285324079974BE8719D59307ECB68EA5B7A22",
        columns: 8,
        rows: 8,
        cellSize: 192,
        frameCount: 64,
        anchor: "bottom-center",
        sharedScale: 0.422803,
        flippedHorizontally: false,
        movement: "stationary dance; world scroll only",
        bytes: 403038,
      },
    });
    expect(statSync(fileURLToPath(new URL(
      "../../public/fredrun/jqa-dance-gangnam.webp",
      import.meta.url,
    ))).size).toBe(jqaManifest.atlas.bytes);
    expect(jqaManifest.atlas.bytes).toBeLessThanOrEqual(512 * 1024);
    expect(viewSource).toContain('source: "/fredrun/jqa-dance-gangnam.webp"');
    expect(viewSource).toContain("animation: { columns: 8, cellSize: 192, frameCount: 64, fps: 18 }");
  });

  it("ships Luki as a normalized animated flag runner", () => {
    expect(lukiManifest).toEqual({
      source: {
        file: "luki-kolumbian_lauf.png",
        sha256: "3D715AF687931CC29FAD5EC1B2FD5E08D0617ADA253B9D03F027128DFDF44F62",
        grid: "7x7",
        frameCount: 49,
      },
      atlas: {
        file: "luki-colombia-run.webp",
        format: "webp",
        sha256: "735DA0B950B4D7A0BFEDC3EA5FCDECF5726610CCDC5E55BE754176E397309E57",
        columns: 7,
        rows: 7,
        cellSize: 192,
        frameCount: 49,
        anchor: "bottom-center",
        sharedScale: 0.407323,
        flippedHorizontally: true,
        direction: "right-to-left",
        bytes: 435652,
      },
    });
    expect(statSync(fileURLToPath(new URL(
      "../../public/fredrun/luki-colombia-run.webp",
      import.meta.url,
    ))).size).toBe(lukiManifest.atlas.bytes);
    expect(lukiManifest.atlas.bytes).toBeLessThanOrEqual(512 * 1024);
    expect(viewSource).toContain('source: "/fredrun/luki-colombia-run.webp"');
    expect(viewSource).toContain("animation: { columns: 7, cellSize: 192, frameCount: 49, fps: 20 }");
  });

  it("ships the modern transparent F coin as a compact game asset", () => {
    expect(coinManifest).toEqual({
      generation: {
        mode: "built-in image generation",
        sourceSha256: "86D18FBC5D98B90D8D91BF2692A98A6AE744F3A6E552BE6B76462B21D9AED62B",
        prompt: "Modern premium gold game coin with a centered capital F and restrained teal inner rim.",
      },
      output: {
        file: "coin-f.webp",
        format: "webp",
        sha256: "9B7188626B3E3C98D98498F9381455CD8197CBA0CDB68CD96079B7D06F2535DF",
        size: { width: 256, height: 256 },
        transparent: true,
        bytes: 25220,
      },
    });
    expect(statSync(fileURLToPath(new URL(
      "../../public/fredrun/coin-f.webp",
      import.meta.url,
    ))).size).toBe(coinManifest.output.bytes);
    expect(coinManifest.output.bytes).toBeLessThanOrEqual(32 * 1024);
    expect(viewSource).toContain('const COIN_SOURCE = "/fredrun/coin-f.webp"');
    expect(viewSource).toContain("context.drawImage(image, -diameter / 2, -diameter / 2, diameter, diameter)");
    expect(viewSource).toContain('<FredRunCoinIcon className="fredrun-coin-icon--hud" />');
    expect(viewSource).toContain('<FredRunCoinIcon className="fredrun-coin-icon--summary" />');
    expect(stylesSource).not.toContain(".fredrun-coin-hud i");
  });

  it("retains the bright Vienna panorama as the controlled mirrored fallback", () => {
    expect(backgroundManifest).toMatchObject({
      generation: {
        mode: "built-in image generation",
        sha256: "D0C9D9A4D9C95D3C43063AB8CBDE016B29BC51B5023D9A36F78270478CBA3132",
        size: { width: 2172, height: 724 },
      },
      output: {
        file: "vienna-panorama.webp",
        format: "webp",
        sha256: "58C947B1B7000E0F019B445357A745444D77EF2B0949AB4B75859AAA0B21080A",
        crop: { width: 2172, height: 665 },
        bytes: 140444,
      },
      runtime: {
        drawHeight: 450,
        scrollFactor: 0.12,
        loop: "alternating mirrored tiles",
      },
    });
    expect(statSync(fileURLToPath(new URL("../../public/fredrun/vienna-panorama.webp", import.meta.url))).size)
      .toBe(backgroundManifest.output.bytes);
    expect(FREDRUN_WORLDS.vienna.backgrounds.fallbackSource).toBe("/fredrun/vienna-panorama.webp");
    expect(viewSource).toContain("drawViennaBackground");
    expect(viewSource).toContain("context.scale(-1, 1)");
  });

  it("declares eight ordered score-anchored Vienna backgrounds in the registry and manifest", () => {
    const scoreAnchors = Array.from({ length: 8 }, (_, index) => index * 500);
    expect(stagedBackgroundManifest).toMatchObject({
      generation: {
        mode: "built-in image generation",
        reference: "/fredrun/vienna-panorama.webp",
        rawDirectory: "/opt/data/cache/fredrun-generated",
      },
      runtime: {
        format: "webp",
        size: { width: 2172, height: 665 },
        quality: 78,
        scoreAnchors,
        crossfade: "smoothstep over the final 40 points before each anchor",
        finalState: "hold last stage from 3500 points",
        darknessPerStage: 0.025,
        darknessCap: 0.125,
        loop: "alternating mirrored tiles",
        effects: {
          renderer: "canvas-2d",
          deterministic: true,
          reducedMotion: "static background without scrolling, lightning or particle motion",
        },
      },
    });
    expect(stagedBackgroundManifest.stages).toHaveLength(8);
    expect(stagedBackgroundManifest.stages.map(({ anchorScore }) => anchorScore)).toEqual(scoreAnchors);

    const manifestSources = stagedBackgroundManifest.stages.map(
      ({ output }) => `/fredrun/backgrounds/${output.file}`,
    );
    expect(new Set(manifestSources).size).toBe(8);
    expect(stagedBackgroundSourcesFromView()).toEqual(manifestSources);

    for (const stage of stagedBackgroundManifest.stages) {
      expect(stage.state.trim().length).toBeGreaterThan(0);
      expect(stage.output).toMatchObject({ width: 2172, height: 665 });
      expect(statSync(fileURLToPath(new URL(
        `../../public/fredrun/backgrounds/${stage.output.file}`,
        import.meta.url,
      ))).size).toBe(stage.output.bytes);
    }
  });

  it("smoothly crossfades at matching scroll offsets and clamps the final stage", () => {
    expect(fredRunEnvironmentForDistance(250 * 34)).toMatchObject({
      fromStage: 0,
      toStage: 1,
      blend: 0,
    });
    expect(fredRunEnvironmentForDistance(450 * 34).blend).toBe(0);
    expect(fredRunEnvironmentForDistance(480 * 34).blend).toBeCloseTo(0.5, 8);
    expect(fredRunEnvironmentForDistance(3_500 * 34)).toMatchObject({
      fromStage: 7,
      toStage: 7,
      blend: 0,
      darkness: 0.125,
    });
    expect(fredRunEnvironmentForDistance(10_000 * 34)).toMatchObject({
      fromStage: 7,
      toStage: 7,
      blend: 0,
    });

    const drawBackgroundSource = viewImplementationBetween(
      "function drawBackground",
      "function drawObstacle",
    );
    expect(drawBackgroundSource).toContain("fredRunEnvironmentForDistance(state.distance)");
    expect(drawBackgroundSource).toContain("fredRunWorldBackgroundForScore");
    expect(drawBackgroundSource).toContain("selection.fromStage");
    expect(drawBackgroundSource).toContain("selection.toStage");
    expect(drawBackgroundSource).toContain("selection.blend");
    expect(drawBackgroundSource).toContain("environment.darkness");
    expect(drawBackgroundSource).toContain("drawStormAtmosphere");
    expect(drawBackgroundSource).toContain("drawRainAtmosphere");
    expect(drawBackgroundSource).toContain("drawSmokeAtmosphere");
    expect(drawBackgroundSource).toContain("drawAtmosphericParticles");
    expect(viewSource).not.toContain("drawFlame");
    expect(viewSource).not.toContain("FLAME_ANCHORS");
    expect(viewSource).not.toContain("environment.fire");
    expect(drawBackgroundSource.match(/drawViennaBackground\(/gu)?.length).toBeGreaterThanOrEqual(3);
    const drawViennaSource = viewImplementationBetween(
      "function drawViennaBackground",
      "function seededUnit",
    );
    expect(drawViennaSource).toContain("Math.floor(drawX)");
    expect(drawViennaSource).toContain("Math.ceil(drawX + tileWidth)");
    expect(drawViennaSource).toContain("tileRight - tileLeft + 1");
    expect(drawViennaSource).toContain("NIGHT_OFFICE_TEXT_PATCHES");
    expect(drawViennaSource).toContain("preserveMirroredText");
    expect(viewSource).toContain("{ left: 300, top: 176, width: 120, height: 68 }");
  });

  it("disables scrolling and animated atmosphere for reduced motion", () => {
    const backgroundSource = viewImplementationBetween(
      "function drawFallbackBackground",
      "function drawObstacle",
    );
    expect(backgroundSource).toContain("reducedMotion ? 0 : (state.distance * BACKGROUND_SCROLL_FACTOR)");
    expect(backgroundSource).toContain("if (environment.storm <= 0.01 || reducedMotion) return");
    expect(backgroundSource).toContain("if (environment.rain <= 0.01 || reducedMotion) return");
    expect(backgroundSource).toContain("if (environment.smoke <= 0.01 || reducedMotion) return");
    expect(backgroundSource).toContain("if (reducedMotion) return");
    expect(backgroundSource).toContain("drawFluorescentFlicker");
    expect(backgroundSource).toContain("fredRunFluorescentFlicker(worldId, state.elapsed, reducedMotion)");
    expect(stylesSource).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.fredrun-score--pulse\s*\{\s*animation: none !important;/u,
    );
    expect(stylesSource).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.fredrun-coin--pulse,[\s\S]*?\.fredrun-countdown-overlay > strong\s*\{\s*animation: none !important;/u,
    );
  });

  it("keeps successfully loaded stages when one background image fails", async () => {
    const viennaSources = stagedBackgroundSourcesFromView();
    const finanzamtSources = FREDRUN_WORLDS["finanzamt-night"].backgrounds.stages
      .map(({ source }) => source);
    const failedSources = new Set([
      viennaSources[1],
      finanzamtSources[0],
      finanzamtSources[2],
      finanzamtSources[3],
    ]);
    const viennaFallbackSource = FREDRUN_WORLDS.vienna.backgrounds.fallbackSource;
    const finanzamtFallbackSource = FREDRUN_WORLDS["finanzamt-night"].backgrounds.fallbackSource;
    const backgrounds = await loadFredRunWorldBackgrounds(async (source) => {
      if (failedSources.has(source)) throw new Error("stage failed");
      return { source };
    });

    expect(backgrounds.vienna).toEqual(viennaSources.map((source) => ({
      source: failedSources.has(source) ? viennaFallbackSource : source,
    })));
    expect(backgrounds["finanzamt-night"]).toEqual(finanzamtSources.map((source) => ({
      source: failedSources.has(source) ? finanzamtFallbackSource : source,
    })));
    expect(viewSource).toContain("loadFredRunWorldBackgrounds(loadImage)");
  });

  it("replaces the complete game surface with a server-provided access block", () => {
    expect(viewSource).toContain('const [accessBlockMessage, setAccessBlockMessage] = useState("")');
    expect(viewSource).toContain("parseFredRunAccessBlockedResponse(payload)");
    expect(viewSource).toMatch(/if \(accessBlockMessage\) \{[\s\S]*?className="fredrun-access-block"[\s\S]*?\{accessBlockMessage\}/u);
    expect(viewSource).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/iu);
    expect(stylesSource).toContain(".fredrun-access-block");
  });
});
