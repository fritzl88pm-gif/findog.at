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
});
