import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const OUTPUT_DIRECTORY = path.resolve("public/fredrun/levels/alps/backgrounds");
const QA_DIRECTORY = "/opt/data/tmp/fredrun-alps-qa";
const OUTPUT_WIDTH = 2172;
const OUTPUT_HEIGHT = 665;
const OUTPUT_QUALITY = 82;
const PREVIEW_TILE_WIDTH = 724;
const PREVIEW_TILE_HEIGHT = 221;
const CONTACT_TILE_WIDTH = 1086;
const CONTACT_IMAGE_HEIGHT = 333;
const CONTACT_LABEL_HEIGHT = 42;

const GENERATION = Object.freeze({
  provider: "openai-codex",
  model: "gpt-image-2-high",
});

const DEFAULT_STAGE_SOURCES = Object.freeze({
  meadow: "/opt/data/generated-images/images/2026/08/20260819-041425_fredrun-alpenpanorama-almwiese-anchor_gpt-image-2-high_openai-codex_a9a00814.png",
  lake: "/opt/data/generated-images/images/2026/08/20260819-041425_fredrun-alpenpanorama-bergsee_gpt-image-2-high_openai-codex_47ba45db.png",
  peaks: "/opt/data/generated-images/images/2026/08/20260819-041425_fredrun-alpenpanorama-hochalm_gpt-image-2-high_openai-codex_ddc976aa.png",
  plateau: "/opt/data/generated-images/images/2026/08/20260819-041425_fredrun-alpenpanorama-gipfelplateau_gpt-image-2-high_openai-codex_22c45ba3.png",
});

const STAGE_DEFINITIONS = [
  { id: "meadow", label: "1. Tal & Almwiese", anchorScore: 0 },
  { id: "lake", label: "2. Zirbenwald & Bergsee", anchorScore: 500 },
  { id: "peaks", label: "3. Hochalm & Felsregion", anchorScore: 1_000 },
  { id: "plateau", label: "4. Gipfelgrat & Gipfelkreuz", anchorScore: 1_500 },
];

function parseArguments(argv) {
  const sources = new Map(Object.entries(DEFAULT_STAGE_SOURCES));
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const match = /^--(meadow|lake|peaks|plateau)$/u.exec(argument);
    if (!match) {
      throw new Error(`Unexpected argument: ${argument}. Usage: node scripts/prepare-fredrun-alps-backgrounds.mjs [--meadow PATH] [--lake PATH] [--peaks PATH] [--plateau PATH]`);
    }
    const sourcePath = argv[index + 1];
    if (!sourcePath || sourcePath.startsWith("--")) {
      throw new Error(`${argument} requires a PNG path`);
    }
    sources.set(match[1], path.resolve(sourcePath));
    index += 1;
  }
  return sources;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function renderStage(sourcePath) {
  const source = await readFile(sourcePath);
  const sourceMetadata = await sharp(source).metadata();
  const outputBuffer = await sharp(source)
    .rotate()
    .resize(OUTPUT_WIDTH, OUTPUT_HEIGHT, {
      fit: "cover",
      position: "south",
      kernel: sharp.kernel.lanczos3,
      withoutEnlargement: false,
    })
    .toColorspace("srgb")
    .webp({
      quality: OUTPUT_QUALITY,
      effort: 6,
      smartSubsample: true,
    })
    .toBuffer();

  return { source, sourceMetadata, outputBuffer };
}

async function previewPng(file, width = PREVIEW_TILE_WIDTH, height = PREVIEW_TILE_HEIGHT) {
  return sharp(file)
    .resize(width, height, {
      fit: "cover",
      position: "centre",
      kernel: sharp.kernel.lanczos3,
    })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function writePreview(file, buffer) {
  await writeFile(file, buffer);
  return {
    file,
    sha256: sha256(buffer),
    bytes: buffer.length,
    width: PREVIEW_TILE_WIDTH * 3,
    height: PREVIEW_TILE_HEIGHT,
  };
}

async function makeThreeTilePreview(stage) {
  const tile = await previewPng(stage.output.path);
  const mirroredTile = await sharp(tile).flop().png().toBuffer();
  const buffer = await sharp({
    create: {
      width: PREVIEW_TILE_WIDTH * 3,
      height: PREVIEW_TILE_HEIGHT,
      channels: 3,
      background: "#0b1c28",
    },
  }).composite([
    { input: tile, left: 0, top: 0 },
    { input: mirroredTile, left: PREVIEW_TILE_WIDTH, top: 0 },
    { input: tile, left: PREVIEW_TILE_WIDTH * 2, top: 0 },
  ]).png({ compressionLevel: 9 }).toBuffer();

  const file = path.join(QA_DIRECTORY, `${stage.id}-three-tile-preview.png`);
  const record = await writePreview(file, buffer);
  return { id: stage.id, ...record };
}

async function makeMidpointPreview(fromStage, toStage) {
  const base = await previewPng(
    fromStage.output.path,
    PREVIEW_TILE_WIDTH * 3,
    PREVIEW_TILE_HEIGHT,
  );
  const overlay = await sharp(await previewPng(
    toStage.output.path,
    PREVIEW_TILE_WIDTH * 3,
    PREVIEW_TILE_HEIGHT,
  ))
    .ensureAlpha(0.5)
    .png()
    .toBuffer();
  const buffer = await sharp({
    create: {
      width: PREVIEW_TILE_WIDTH * 3,
      height: PREVIEW_TILE_HEIGHT,
      channels: 3,
      background: "#0b1c28",
    },
  }).composite([
    { input: base, left: 0, top: 0, blend: "over" },
    { input: overlay, left: 0, top: 0, blend: "over" },
  ])
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();

  const file = path.join(QA_DIRECTORY, `${fromStage.id}-${toStage.id}-midpoint-preview.png`);
  const record = await writePreview(file, buffer);
  return { from: fromStage.id, to: toStage.id, ...record };
}

async function makeContactSheet(stages) {
  const cellWidth = CONTACT_TILE_WIDTH;
  const cellHeight = CONTACT_LABEL_HEIGHT + CONTACT_IMAGE_HEIGHT;
  const cells = [];
  for (const [index, stage] of stages.entries()) {
    const image = await previewPng(stage.output.path, CONTACT_TILE_WIDTH, CONTACT_IMAGE_HEIGHT);
    const label = Buffer.from(`
      <svg width="${cellWidth}" height="${CONTACT_LABEL_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#f3f7fa"/>
        <text x="18" y="27" font-family="DejaVu Sans, sans-serif" font-size="17" font-weight="700" fill="#173b53">${stage.label.replace(/&/gu, "&amp;")} · Anchor ${stage.anchorScore}</text>
      </svg>
    `);
    const cell = await sharp({
      create: { width: cellWidth, height: cellHeight, channels: 3, background: "#ffffff" },
    }).composite([
      { input: label, left: 0, top: 0 },
      { input: image, left: 0, top: CONTACT_LABEL_HEIGHT },
    ]).png().toBuffer();
    cells.push({
      input: cell,
      left: index % 2 * cellWidth,
      top: Math.floor(index / 2) * cellHeight,
    });
  }

  const buffer = await sharp({
    create: {
      width: cellWidth * 2,
      height: cellHeight * 2,
      channels: 3,
      background: "#ffffff",
    },
  }).composite(cells).png({ compressionLevel: 9 }).toBuffer();
  const file = path.join(QA_DIRECTORY, "alps-contact-sheet.png");
  await writeFile(file, buffer);
  return {
    file,
    sha256: sha256(buffer),
    bytes: buffer.length,
    width: cellWidth * 2,
    height: cellHeight * 2,
  };
}

async function main() {
  const sourcePaths = parseArguments(process.argv.slice(2));
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  await rm(QA_DIRECTORY, { recursive: true, force: true });
  await mkdir(QA_DIRECTORY, { recursive: true });

  const stages = [];
  for (const definition of STAGE_DEFINITIONS) {
    const sourcePath = sourcePaths.get(definition.id);
    const { source, sourceMetadata, outputBuffer } = await renderStage(sourcePath);
    const output = {
      file: `${definition.id}.webp`,
      path: path.join(OUTPUT_DIRECTORY, `${definition.id}.webp`),
      runtimePath: `/fredrun/levels/alps/backgrounds/${definition.id}.webp`,
    };
    await writeFile(output.path, outputBuffer);
    const outputMetadata = await sharp(outputBuffer).metadata();

    stages.push({
      ...definition,
      source: {
        path: sourcePath,
        sha256: sha256(source),
        bytes: source.length,
        width: sourceMetadata.width,
        height: sourceMetadata.height,
      },
      generation: GENERATION,
      output: {
        ...output,
        sha256: sha256(outputBuffer),
        bytes: outputBuffer.length,
        width: outputMetadata.width,
        height: outputMetadata.height,
        format: outputMetadata.format,
      },
    });
  }

  const fallbackPath = path.join(OUTPUT_DIRECTORY, "fallback.webp");
  await copyFile(stages[0].output.path, fallbackPath);
  const fallbackBuffer = await readFile(fallbackPath);

  const threeTile = [];
  for (const stage of stages) threeTile.push(await makeThreeTilePreview(stage));

  const midpointPairs = [[0, 1], [1, 2], [2, 3]];
  const midpoints = [];
  for (const [fromIndex, toIndex] of midpointPairs) {
    midpoints.push(await makeMidpointPreview(stages[fromIndex], stages[toIndex]));
  }
  const contactSheet = await makeContactSheet(stages);

  const manifestFallback = {
    file: "fallback.webp",
    runtimePath: "/fredrun/levels/alps/backgrounds/fallback.webp",
    sha256: sha256(fallbackBuffer),
    bytes: fallbackBuffer.length,
    width: OUTPUT_WIDTH,
    height: OUTPUT_HEIGHT,
    format: "webp",
  };

  const portableStages = stages.map(({ output: { path: _outputPath, ...output }, ...stage }) => ({
    ...stage,
    output,
  }));
  const manifest = {
    schemaVersion: 1,
    worldId: "alps",
    displayName: "Alpenpanorama",
    generation: GENERATION,
    runtime: {
      format: "webp",
      width: OUTPUT_WIDTH,
      height: OUTPUT_HEIGHT,
      quality: OUTPUT_QUALITY,
      scoreAnchors: STAGE_DEFINITIONS.map(({ anchorScore }) => anchorScore),
      crossfadeScoreDuration: 250,
      transition: "smoothstep crossfade over the final 250 score points before each next anchor",
      finalState: "hold plateau from score 1500 onward",
      loop: "alternating mirrored horizontal tiles",
      fallback: manifestFallback,
      effects: {
        animatedSunrays: {
          renderer: "canvas-2d",
          reducedMotion: "static rays with animated particles disabled",
          worldScope: "alps only",
        },
      },
      composition: "four cheerful Alpine scenes with a clear lower running lane",
      processing: {
        script: "scripts/prepare-fredrun-alps-backgrounds.mjs",
        crop: "wide cover crop anchored to the lower running lane",
        resize: {
          width: OUTPUT_WIDTH,
          height: OUTPUT_HEIGHT,
          fit: "cover",
          position: "south",
          kernel: "lanczos3",
        },
        sharpVersion: sharp.versions.sharp,
        libvipsVersion: sharp.versions.vips,
      },
    },
    previews: {
      directory: QA_DIRECTORY,
      contactSheet,
      threeTile,
      midpoints,
    },
    stages: portableStages,
  };

  await writeFile(
    path.join(OUTPUT_DIRECTORY, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  for (const stage of stages) {
    console.log(`Exported ${stage.output.file} (${stage.output.bytes} bytes)`);
  }
  console.log(`Copied deterministic fallback ${fallbackPath}`);
  console.log(`Wrote ${path.join(OUTPUT_DIRECTORY, "manifest.json")}`);
  console.log(`Wrote QA previews in ${QA_DIRECTORY}`);
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
