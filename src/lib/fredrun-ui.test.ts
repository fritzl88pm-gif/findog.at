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

  it("loads all four supplied obstacle assets with recorded provenance and a small payload", () => {
    expect(obstacleManifest).toMatchObject({
      format: "webp",
      alpha: true,
      maximumOutputSize: 192,
      assets: {
        beschluss: { sha256: "333AF269567DDDF3DAC89C12467DA42B7B2214508E1E0376B37D0C7156DD09FB" },
        reihe100: { sha256: "9B668A34398940FCBE7B376944ECF7C6BA9FB38FBD9867C9CACAE5FCFC3F4F3D" },
        steuerkodex: { sha256: "2F19937098D2E3D68C518E72864F40DD3DFCCC80C32688B4D4368DFF8C6A6B59" },
        paragraph: { sha256: "F5460B622F0D7FBF94232FFCCB4AEC6D281BFE0C31D2E48E5DD260BB378B3316" },
      },
    });

    const assets = Object.values(obstacleManifest.assets);
    expect(assets).toHaveLength(4);
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
});
