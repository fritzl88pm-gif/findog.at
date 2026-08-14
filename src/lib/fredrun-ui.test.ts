import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { fredRunEnvironmentForDistance } from "./fredrun";

const pageSource = readFileSync(fileURLToPath(new URL("../app/page.tsx", import.meta.url)), "utf8");
const viewSource = readFileSync(fileURLToPath(new URL("../components/fredrun-view.tsx", import.meta.url)), "utf8");
const stylesSource = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");
const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../../public/fredrun/manifest.json", import.meta.url)), "utf8")) as {
  source: {
    archive: { sha256: string; includedAnimations: string[] };
    jumpSheet: { sha256: string; sourceGrid: string; sourceFrameCount: number; selectedFrameIndices: number[] };
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

function stagedBackgroundSourcesFromView(): string[] {
  const declaration = viewSource.match(
    /const FREDRUN_BACKGROUND_SOURCES = \[([\s\S]*?)\] as const;/u,
  );
  if (!declaration) return [];
  return Array.from(declaration[1].matchAll(/"([^"]+)"/gu), (match) => match[1]);
}

function viewImplementationBetween(start: string, end: string): string {
  const startIndex = viewSource.indexOf(start);
  const endIndex = viewSource.indexOf(end, startIndex);
  if (startIndex < 0 || endIndex < 0) return "";
  return viewSource.slice(startIndex, endIndex);
}

function executableBackgroundLoader(
  loadImage: (source: string) => Promise<unknown>,
): () => Promise<unknown[]> {
  const implementation = viewImplementationBetween(
    "async function loadBackgrounds",
    "function drawFallbackBackground",
  );
  const bodyStart = implementation.indexOf("{");
  const bodyEnd = implementation.lastIndexOf("}");
  if (bodyStart < 0 || bodyEnd < 0) return async () => [];

  const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as FunctionConstructor;
  return AsyncFunction(
    "FREDRUN_BACKGROUND_SOURCES",
    "BACKGROUND_FALLBACK_SOURCE",
    "loadImage",
    implementation.slice(bodyStart + 1, bodyEnd),
  ).bind(
    undefined,
    stagedBackgroundSourcesFromView(),
    "/fredrun/vienna-panorama.webp",
    loadImage,
  ) as () => Promise<unknown[]>;
}

describe("Fredrun UI surface", () => {
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

  it("exposes keyboard, pointer, pause, restart, and accessible status controls", () => {
    expect(viewSource).toContain('event.code !== "Space"');
    expect(viewSource).toContain('event.code !== "ArrowUp"');
    expect(viewSource).toContain("onPointerDown");
    expect(viewSource).toContain("visibilitychange");
    expect(viewSource).toContain("pauseFredRun");
    expect(viewSource).toContain("restartRound");
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

  it("ships the three runtime atlases while preserving source provenance", () => {
    expect(manifest.source.archive.sha256).toBe("DCD8D61B48B88FE525DA2D151544B8B8C859C9E3E222DEE18732E160E1A9F735");
    expect(manifest.source.archive.includedAnimations).toEqual(["walk_right", "Victory"]);
    expect(manifest.source.jumpSheet).toMatchObject({
      sha256: "F16512E534978A7F3E0081A455DC1EE57064383AC2D4C8C994050EB087670789",
      sourceGrid: "7x7",
      sourceFrameCount: 49,
    });
    expect(manifest.source.jumpSheet.selectedFrameIndices).toHaveLength(24);
    expect(manifest.source.jumpSheet.selectedFrameIndices[0]).toBe(0);
    expect(manifest.source.jumpSheet.selectedFrameIndices.at(-1)).toBe(48);
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
        creditsUsed: 39,
        shippedCreditsUsed: 26,
        discardedDraftCredits: 13,
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
    expect(viewSource).toContain('aria-label="Charakter auswählen"');
    expect(viewSource).toContain("<FredRunCharacterPreview characterId={characterId} />");
    expect(viewSource).toContain("selectCharacter(characterId)");
    expect(stylesSource).toContain(".fredrun-character-options");
    expect(stylesSource).toContain(".fredrun-character-option.is-selected");
  });

  it("lays out the game-over score on the left and the selected dancer on the right", () => {
    expect(viewSource).toContain('className="fredrun-game-over-summary"');
    expect(viewSource).toContain("<h2>{snapshot.score} Punkte</h2>");
    expect(viewSource).toContain(">Noch einmal</button>");
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
        paragraph: { sha256: "F5460B622F0D7FBF94232FFCCB4AEC6D281BFE0C31D2E48E5DD260BB378B3316" },
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
      "Spring mit Fred oder Frida über REIH 100, Steuerkodex, Paragraphen und unerwartete Hindernisse.",
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

  it("uses the supplied intro artwork as the responsive title screen", () => {
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
    expect(viewSource).toContain('className="fredrun-intro"');
    expect(viewSource).toContain("Fred Runner: Fred läuft");
    expect(viewSource).toContain('const showIntro = assetState !== "error" && snapshot.phase === "ready"');
    expect(viewSource).toContain('aria-busy={assetState === "loading"}');
    expect(viewSource).not.toContain("Fred macht sich bereit");
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
    expect(viewSource).toContain('const BACKGROUND_FALLBACK_SOURCE = "/fredrun/vienna-panorama.webp"');
    expect(viewSource).toContain("drawViennaBackground");
    expect(viewSource).toContain("context.scale(-1, 1)");
  });

  it("declares eight ordered score-anchored background assets in the view and manifest", () => {
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
    expect(drawBackgroundSource).toContain("environment.fromStage");
    expect(drawBackgroundSource).toContain("environment.toStage");
    expect(drawBackgroundSource).toContain("environment.blend");
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
    expect(stylesSource).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.fredrun-score--pulse\s*\{\s*animation: none !important;/u,
    );
    expect(stylesSource).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.fredrun-coin--pulse,[\s\S]*?\.fredrun-countdown-overlay > strong\s*\{\s*animation: none !important;/u,
    );
  });

  it("keeps successfully loaded stages when one background image fails", async () => {
    const sources = stagedBackgroundSourcesFromView();
    const failedSource = sources[1];
    const fallbackSource = "/fredrun/vienna-panorama.webp";
    const loadBackgrounds = executableBackgroundLoader(async (source) => {
      if (source === failedSource) throw new Error("stage failed");
      return { source };
    });

    await expect(loadBackgrounds()).resolves.toEqual(sources.map((source) => ({
      source: source === failedSource ? fallbackSource : source,
    })));
  });
});
