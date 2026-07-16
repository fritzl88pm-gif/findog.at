import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const pageSource = readFileSync(fileURLToPath(new URL("../app/page.tsx", import.meta.url)), "utf8");
const viewSource = readFileSync(fileURLToPath(new URL("../components/fredrun-view.tsx", import.meta.url)), "utf8");
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

describe("Fredrun UI surface", () => {
  it("registers Fredrun in both navigation modes and the app view", () => {
    expect(pageSource).toContain('"fredrun"');
    expect(pageSource).toContain('onClick={openFredRunView}');
    expect(pageSource).toContain('title="Fredrun"');
    expect(pageSource).toContain('aria-label="Fredrun"');
    expect(pageSource).toContain('appView === "fredrun"');
    expect(pageSource).toContain('<FredRunView />');
  });

  it("exposes keyboard, pointer, pause, restart, and accessible status controls", () => {
    expect(viewSource).toContain('event.code !== "Space"');
    expect(viewSource).toContain('event.code !== "ArrowUp"');
    expect(viewSource).toContain("onPointerDown");
    expect(viewSource).toContain("visibilitychange");
    expect(viewSource).toContain("pauseFredRun");
    expect(viewSource).toContain("restartRound");
    expect(viewSource).toContain('aria-live="polite"');
  });

  it("ships only the three approved normalized atlases below the size budget", () => {
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
    expect(viewSource).toContain('jump: { source: "/fredrun/jump.png", columns: 6, frameCount: 24 }');

    const totalBytes = ["walk.png", "jump.png", "victory.png"].reduce((total, name) => (
      total + statSync(fileURLToPath(new URL(`../../public/fredrun/${name}`, import.meta.url))).size
    ), 0);
    expect(totalBytes).toBeLessThanOrEqual(3 * 1024 * 1024);
  });

  it("loads only the three remaining obstacle assets with recorded provenance and a small payload", () => {
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
});
