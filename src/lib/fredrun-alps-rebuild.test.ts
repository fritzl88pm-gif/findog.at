import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  FREDRUN_WORLDS,
  fredRunWorldBackgroundForScore,
} from "./fredrun-worlds";

const root = fileURLToPath(new URL("../..", import.meta.url));
const script = readFileSync(path.join(root, "scripts/prepare-fredrun-alps-backgrounds.mjs"), "utf8");
const styles = readFileSync(path.join(root, "src/app/globals.css"), "utf8");
const view = readFileSync(path.join(root, "src/components/fredrun-view.tsx"), "utf8");
const manifestPath = path.join(root, "public/fredrun/levels/alps/backgrounds/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
  schemaVersion: number;
  worldId: string;
  generation: { provider: string; model: string };
  runtime: {
    format: string;
    width: number;
    height: number;
    quality: number;
    scoreAnchors: number[];
    crossfadeScoreDuration: number;
    fallback: { file: string; sha256: string };
    effects: {
      animatedSunrays: {
        renderer: string;
        reducedMotion: string;
        worldScope: string;
      };
    };
  };
  previews: {
    directory: string;
    contactSheet: { file: string; width: number; height: number };
    threeTile: Array<{ id: string; file: string }>;
    midpoints: Array<{ from: string; to: string; file: string }>;
  };
  stages: Array<{
    id: string;
    label: string;
    anchorScore: number;
    source: { path: string; sha256: string; bytes: number; width: number; height: number };
    generation: { provider: string; model: string };
    output: {
      file: string;
      runtimePath: string;
      sha256: string;
      bytes: number;
      width: number;
      height: number;
      format: string;
    };
  }>;
};

const expectedStages = [
  {
    id: "meadow",
    label: "1. Tal & Almwiese",
    anchorScore: 0,
    sourcePath: "/opt/data/generated-images/images/2026/08/20260819-041425_fredrun-alpenpanorama-almwiese-anchor_gpt-image-2-high_openai-codex_a9a00814.png",
    sourceSha256: "a9a0081415f670184834fd4083d37c3b02c3ebfb498311eeafa7f669b64f5020",
    sourceWidth: 1_774,
    sourceHeight: 887,
  },
  {
    id: "lake",
    label: "2. Zirbenwald & Bergsee",
    anchorScore: 500,
    sourcePath: "/opt/data/generated-images/images/2026/08/20260819-041425_fredrun-alpenpanorama-bergsee_gpt-image-2-high_openai-codex_47ba45db.png",
    sourceSha256: "47ba45db4b754952add9048e6c99170d4dac9a954e6d5e37b333131c1229b0fe",
    sourceWidth: 1_774,
    sourceHeight: 887,
  },
  {
    id: "peaks",
    label: "3. Hochalm & Felsregion",
    anchorScore: 1_000,
    sourcePath: "/opt/data/generated-images/images/2026/08/20260819-041425_fredrun-alpenpanorama-hochalm_gpt-image-2-high_openai-codex_ddc976aa.png",
    sourceSha256: "ddc976aab3dac233edf592a093f357dda9e009571467943ba06c21adb5bc3712",
    sourceWidth: 1_983,
    sourceHeight: 793,
  },
  {
    id: "plateau",
    label: "4. Gipfelgrat & Gipfelkreuz",
    anchorScore: 1_500,
    sourcePath: "/opt/data/generated-images/images/2026/08/20260819-041425_fredrun-alpenpanorama-gipfelplateau_gpt-image-2-high_openai-codex_22c45ba3.png",
    sourceSha256: "22c45ba3ea06fbf23ac29618d16d496e1f14f6f3fc47f92247dd833511f39554",
    sourceWidth: 1_774,
    sourceHeight: 887,
  },
] as const;

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function narrowGameOverStyles(): string {
  const blocks = [...styles.matchAll(/@media \(max-width: 640px\) \{([\s\S]*?)(?=\n@media |\s*$)/gu)]
    .map((match) => match[1]);
  return blocks.find((block) => block.includes(".fredrun-game-over-overlay")) ?? "";
}

describe("Fredrun Alps catalog migration", () => {
  it("adds only the active free Alps catalog row, world constraint value, and default unlocks", () => {
    const migrationFiles = readdirSync(path.join(root, "supabase/migrations"))
      .filter((file) => file.includes("alps"));
    expect(migrationFiles).toEqual(["20260819103000_add_alps_world.sql"]);
    const migration = readFileSync(
      path.join(root, "supabase/migrations", migrationFiles[0]),
      "utf8",
    );

    expect(migration).toMatch(
      /insert into public\.fredrun_catalog_items[\s\S]*?\('world', 'alps', 2, 0, true, true\)[\s\S]*?on conflict \(item_type, item_id\) do update/iu,
    );
    expect(migration).toMatch(
      /constraint fredrun_user_progress_selected_world_check[\s\S]*?check \(selected_world in \('vienna', 'finanzamt-night', 'alps'\)\)/iu,
    );
    expect(migration).toMatch(
      /insert into public\.fredrun_user_unlocks[\s\S]*?select[\s\S]*?'world'[\s\S]*?'alps'[\s\S]*?'system_default'[\s\S]*?on conflict \(user_id, item_type, item_id\) do nothing/iu,
    );
    expect(migration).not.toMatch(/(?:update|delete)\s+(?:from\s+)?public\.fredrun_user_progress/iu);
    expect(migration).not.toMatch(/(?:update|delete)\s+(?:from\s+)?public\.fredrun_progress_events/iu);
    expect(migration).not.toMatch(/selected_character/iu);
  });
});

describe("Fredrun mobile game-over regression", () => {
  it("lets the narrow summary row grow and reserves separated space for the score form", () => {
    const css = narrowGameOverStyles();
    expect(css).toContain(".fredrun-stage--game-over");
    expect(css).toMatch(/\.fredrun-stage--game-over\s*\{[^}]*min-height:\s*560px/u);
    expect(css).toMatch(
      /\.fredrun-game-over-overlay\s*\{[^}]*grid-template-rows:\s*auto auto/u,
    );
    expect(css).toMatch(/\.fredrun-score-form\s*\{[^}]*margin-top:\s*1[2-9]px/u);
    expect(css).toMatch(/\.fredrun-score-form\s*\{[^}]*padding-top:\s*(?:1[0-9]|[2-9]\d)px/u);
    expect(css).not.toContain("grid-template-rows: minmax(0, 156px) auto");
  });
});

describe("Fredrun rebuilt Alpine runtime assets", () => {
  it("keeps the four-stage score journey and 250-point gentle crossfade", () => {
    const definition = FREDRUN_WORLDS.alps.backgrounds;
    expect(definition.crossfadeScoreDuration).toBe(250);
    expect(definition.stages.map(({ source, anchorScore }) => ({ source, anchorScore }))).toEqual([
      { source: "/fredrun/levels/alps/backgrounds/meadow.webp", anchorScore: 0 },
      { source: "/fredrun/levels/alps/backgrounds/lake.webp", anchorScore: 500 },
      { source: "/fredrun/levels/alps/backgrounds/peaks.webp", anchorScore: 1_000 },
      { source: "/fredrun/levels/alps/backgrounds/plateau.webp", anchorScore: 1_500 },
    ]);

    expect(fredRunWorldBackgroundForScore("alps", 250))
      .toMatchObject({ fromStage: 0, toStage: 1, blend: 0 });
    expect(fredRunWorldBackgroundForScore("alps", 375).blend).toBeCloseTo(0.5, 12);
    expect(fredRunWorldBackgroundForScore("alps", 500))
      .toMatchObject({ fromStage: 1, toStage: 2, blend: 0 });
    expect(fredRunWorldBackgroundForScore("alps", 1_375).blend).toBeCloseTo(0.5, 12);
    expect(fredRunWorldBackgroundForScore("alps", 2_000))
      .toEqual({ fromStage: 3, toStage: 3, blend: 0 });
  });

  it("documents and encodes every generated stage at the exact runtime contract", async () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.worldId).toBe("alps");
    expect(manifest.generation).toEqual({ provider: "openai-codex", model: "gpt-image-2-high" });
    expect(manifest.runtime).toMatchObject({
      format: "webp",
      width: 2_172,
      height: 665,
      quality: 82,
      scoreAnchors: [0, 500, 1_000, 1_500],
      crossfadeScoreDuration: 250,
      effects: {
        animatedSunrays: {
          renderer: "canvas-2d",
          reducedMotion: "static rays with animated particles disabled",
          worldScope: "alps only",
        },
      },
    });
    expect(manifest.stages.map(({ id }) => id)).toEqual(expectedStages.map(({ id }) => id));

    for (const [index, expected] of expectedStages.entries()) {
      const stage = manifest.stages[index];
      expect(stage).toMatchObject({
        label: expected.label,
        anchorScore: expected.anchorScore,
        source: {
          path: expected.sourcePath,
          sha256: expected.sourceSha256,
          width: expected.sourceWidth,
          height: expected.sourceHeight,
        },
        generation: { provider: "openai-codex", model: "gpt-image-2-high" },
        output: {
          file: `${expected.id}.webp`,
          runtimePath: `/fredrun/levels/alps/backgrounds/${expected.id}.webp`,
          width: 2_172,
          height: 665,
          format: "webp",
        },
      });
      expect(statSync(expected.sourcePath).size).toBe(stage.source.bytes);
      expect(sha256(expected.sourcePath)).toBe(stage.source.sha256);

      const outputFile = path.join(root, "public", stage.output.runtimePath);
      expect(statSync(outputFile).size).toBe(stage.output.bytes);
      expect(sha256(outputFile)).toBe(stage.output.sha256);
      await expect(sharp(outputFile).metadata()).resolves.toMatchObject({
        format: "webp",
        width: 2_172,
        height: 665,
        space: "srgb",
        channels: 3,
        hasAlpha: false,
      });
    }

    const fallbackFile = path.join(root, "public/fredrun/levels/alps/backgrounds/fallback.webp");
    expect(statSync(fallbackFile).size).toBe(manifest.stages[0].output.bytes);
    expect(sha256(fallbackFile)).toBe(manifest.stages[0].output.sha256);
    expect(manifest.runtime.fallback.sha256).toBe(manifest.stages[0].output.sha256);
  });

  it("uses the archived Linux sources explicitly and renders deliberate crops, not stretches", () => {
    for (const expected of expectedStages) {
      expect(script).toContain(expected.sourcePath);
    }
    expect(script).toContain("--meadow");
    expect(script).toContain("--lake");
    expect(script).toContain("--peaks");
    expect(script).toContain("--plateau");
    expect(script).toContain('fit: "cover"');
    expect(script).toContain('position: "south"');
    expect(script).toContain('kernel: sharp.kernel.lanczos3');
    expect(script).not.toContain("C:/");
    expect(script).not.toContain(".gemini");
    expect(script).not.toContain('fit: "fill"');
  });

  it("emits deterministic labeled QA previews outside the repository", async () => {
    expect(manifest.previews.directory).toBe("/opt/data/tmp/fredrun-alps-qa");
    expect(manifest.previews.threeTile.map(({ id }) => id))
      .toEqual(["meadow", "lake", "peaks", "plateau"]);
    expect(manifest.previews.midpoints.map(({ from, to }) => `${from}->${to}`)).toEqual([
      "meadow->lake",
      "lake->peaks",
      "peaks->plateau",
    ]);

    const previewFiles = [
      manifest.previews.contactSheet.file,
      ...manifest.previews.threeTile.map(({ file }) => file),
      ...manifest.previews.midpoints.map(({ file }) => file),
    ];
    for (const file of previewFiles) expect(existsSync(file)).toBe(true);
    await expect(sharp(manifest.previews.contactSheet.file).metadata()).resolves.toMatchObject({
      format: "png",
      width: 2_172,
      height: 750,
    });
    for (const file of [...manifest.previews.threeTile, ...manifest.previews.midpoints]) {
      await expect(sharp(file.file).metadata()).resolves.toMatchObject({
        format: "png",
        width: 2_172,
        height: 221,
      });
    }
  });

  it("fills the rightmost third of every midpoint preview with runtime imagery", async () => {
    for (const midpoint of manifest.previews.midpoints) {
      const { data, info } = await sharp(midpoint.file)
        .extract({ left: 1_448, top: 0, width: 724, height: 221 })
        .raw()
        .toBuffer({ resolveWithObject: true });
      const pixelCount = info.width * info.height;
      let canvasPixels = 0;
      let luminanceSum = 0;
      let luminanceSquaredSum = 0;

      for (let offset = 0; offset < data.length; offset += info.channels) {
        const [red, green, blue] = [data[offset], data[offset + 1], data[offset + 2]];
        if (red === 11 && green === 28 && blue === 40) canvasPixels += 1;
        const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
        luminanceSum += luminance;
        luminanceSquaredSum += luminance ** 2;
      }

      const meanLuminance = luminanceSum / pixelCount;
      const luminanceDeviation = Math.sqrt(
        luminanceSquaredSum / pixelCount - meanLuminance ** 2,
      );
      const canvasRatio = canvasPixels / pixelCount;

      expect(canvasRatio, `${midpoint.from}->${midpoint.to} canvas ratio`).toBeLessThan(0.01);
      expect(luminanceDeviation, `${midpoint.from}->${midpoint.to} luminance deviation`)
        .toBeGreaterThan(2);
    }
  });

  it("uses each already-numbered stage label exactly once in contact-sheet generation", () => {
    expect(manifest.stages.map(({ label }) => label)).toEqual(expectedStages.map(({ label }) => label));

    const contactSheetGenerator = script.slice(
      script.indexOf("async function makeContactSheet"),
      script.indexOf("async function main"),
    );
    expect(contactSheetGenerator).not.toMatch(/\$\{index \+ 1\}\.\s*\$\{stage\.label/u);
    expect(contactSheetGenerator).toContain("${stage.label.replace");
  });

  it("retains animated Alpine sun rays only in the Alpine renderer and freezes them for reduced motion", () => {
    const sunrays = view.slice(
      view.indexOf("function drawAlpsSunrays"),
      view.indexOf("function drawAlpsParticles"),
    );
    expect(sunrays).toContain("const baseTime = reducedMotion ? 0 : state.elapsed * 0.25");
    expect(view).toContain('world.backgrounds.renderStyle === "alps-sunny"');
    expect(view).toContain("drawAlpsSunrays(context, state, reducedMotion)");
    expect(view).toContain("function drawAlpsParticles");
    expect(view.slice(
      view.indexOf("function drawAlpsParticles"),
      view.indexOf("function drawBackground"),
    )).toContain("if (reducedMotion) return");
  });
});
