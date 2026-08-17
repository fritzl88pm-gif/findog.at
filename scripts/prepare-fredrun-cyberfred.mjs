import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const SOURCE_DIRECTORY = path.resolve(process.argv[2] ?? "tmp/cyberfred-autosprite");
const OUTPUT_DIRECTORY = path.resolve(process.argv[3] ?? "public/fredrun/cyberfred");
const ONLY_ANIMATION_KEY = process.argv[4] ?? "";
const CELL_SIZE = 192;
const OUTPUT_COLUMNS = 8;
const SOURCE_CELL_SIZE = 512;
const SOURCE_COLUMNS = 8;
const FRAME_COUNT = 64;
const ALPHA_THRESHOLD = 8;
const HORIZONTAL_PADDING = 8;
const TOP_PADDING = 6;
const BOTTOM_PADDING = 8;
const REFERENCE_SHA256 = "CBDD7B6B92AE436C2AC5CD258BB54260E1E7A86236E30E7926A2E8CA2CA68B6E";
const PROVIDED_JUMP_SOURCE_FRAMES = [
  20, 24, 27, 30,
  31, 32, 33, 34, 35, 36,
  37, 38, 39, 40, 41, 42,
  43, 44, 45,
  47, 51, 55, 59, 63,
];

const animations = [
  {
    key: "walk",
    sourceFile: "run-raw.png",
    spritesheetId: "cmsxeo5s9006uil4usl7cp9oj",
    sourceVideoId: "cmsxekvt600b6vsmfsx6vuf77",
  },
  {
    key: "jump",
    sourceFile: "jump-provided.png",
    sourceLabel: "1786987959871_a309b29b-d608-4cdb-8ba9-ffd3336b1786.png",
    sourceKind: "provided-spritesheet",
    sourceFrameIndices: PROVIDED_JUMP_SOURCE_FRAMES,
    outputColumns: 6,
    metadata: {
      animationName: "Blue Booster Jump",
      facingDirection: "right",
      runtimeEffect: "embedded-right-plus-frame-anchored-left-blue-boot-thrusters",
      runtimePlayback: {
        mode: "full-atlas-synced-to-fredrun-physics",
        durationSeconds: 0.82,
        heightSource: "shared-fredrun-physics",
      },
    },
  },
  {
    key: "victory",
    sourceFile: "victory-raw.png",
    spritesheetId: "cmsxfw00400013794zpps1oqa",
    sourceVideoId: "cmsxfsvn9004m146w9fjcc2sf",
    metadata: {
      animationName: "Cyberfred Robot Dance",
      loop: true,
      danceStyle: "classic-robot-dance",
    },
  },
];

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex").toUpperCase();
}

function sourceRectangle(index, sourceColumns, sourceCellSize) {
  return {
    left: index % sourceColumns * sourceCellSize,
    top: Math.floor(index / sourceColumns) * sourceCellSize,
    width: sourceCellSize,
    height: sourceCellSize,
  };
}

function findAlphaBounds(data, channels, imageWidth, rectangle) {
  let left = rectangle.width;
  let top = rectangle.height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < rectangle.height; y += 1) {
    const sourceY = rectangle.top + y;
    for (let x = 0; x < rectangle.width; x += 1) {
      const sourceX = rectangle.left + x;
      const alpha = data[(sourceY * imageWidth + sourceX) * channels + 3];
      if (alpha <= ALPHA_THRESHOLD) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }

  if (right < left || bottom < top) {
    throw new Error(`Leerer Cyberfred-Frame bei ${rectangle.left},${rectangle.top}.`);
  }
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

async function normalizeAnimation(animation) {
  const sourcePath = path.join(SOURCE_DIRECTORY, animation.sourceFile);
  const source = await readFile(sourcePath);
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const sourceColumns = animation.sourceColumns ?? SOURCE_COLUMNS;
  const sourceCellSize = animation.sourceCellSize ?? SOURCE_CELL_SIZE;
  const sourceFrameCount = animation.sourceFrameCount ?? FRAME_COUNT;
  const sourceRows = Math.ceil(sourceFrameCount / sourceColumns);
  const sourceFrameIndices = animation.sourceFrameIndices
    ?? Array.from({ length: sourceFrameCount }, (_, index) => index);
  const outputColumns = animation.outputColumns ?? OUTPUT_COLUMNS;
  const outputFrameCount = sourceFrameIndices.length;
  if (
    info.width !== sourceColumns * sourceCellSize
    || info.height !== sourceRows * sourceCellSize
  ) {
    throw new Error(`Unerwartete Sprite-Größe für ${animation.sourceFile}: ${info.width}x${info.height}.`);
  }

  const frames = sourceFrameIndices.map((sourceIndex, outputIndex) => {
    const rectangle = sourceRectangle(sourceIndex, sourceColumns, sourceCellSize);
    return {
      sourceIndex,
      outputIndex,
      rectangle,
      bounds: findAlphaBounds(data, info.channels, info.width, rectangle),
    };
  });
  const maxWidth = Math.max(...frames.map((frame) => frame.bounds.width));
  const maxHeight = Math.max(...frames.map((frame) => frame.bounds.height));
  const scale = Math.min(
    (CELL_SIZE - HORIZONTAL_PADDING * 2) / maxWidth,
    (CELL_SIZE - TOP_PADDING - BOTTOM_PADDING) / maxHeight,
  );
  const composites = [];

  for (const frame of frames) {
    const width = Math.max(1, Math.round(frame.bounds.width * scale));
    const height = Math.max(1, Math.round(frame.bounds.height * scale));
    const input = await sharp(source)
      .extract({
        left: frame.rectangle.left + frame.bounds.left,
        top: frame.rectangle.top + frame.bounds.top,
        width: frame.bounds.width,
        height: frame.bounds.height,
      })
      .resize(width, height, { fit: "fill", kernel: sharp.kernel.lanczos3 })
      .webp({ quality: 94, alphaQuality: 100, effort: 6 })
      .toBuffer();
    composites.push({
      input,
      left: frame.outputIndex % outputColumns * CELL_SIZE + Math.round((CELL_SIZE - width) / 2),
      top: Math.floor(frame.outputIndex / outputColumns) * CELL_SIZE + CELL_SIZE - BOTTOM_PADDING - height,
    });
  }

  const outputPath = path.join(OUTPUT_DIRECTORY, `${animation.key}.webp`);
  await sharp({
    create: {
      width: outputColumns * CELL_SIZE,
      height: Math.ceil(outputFrameCount / outputColumns) * CELL_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .webp({ quality: 94, alphaQuality: 100, effort: 6 })
    .toFile(outputPath);

  const output = await readFile(outputPath);
  const outputStats = await stat(outputPath);
  return {
    sourceKind: animation.sourceKind ?? "autosprite",
    sourceFile: animation.sourceLabel ?? animation.sourceFile,
    sourceSha256: sha256(source),
    ...(animation.spritesheetId ? { spritesheetId: animation.spritesheetId } : {}),
    ...(animation.sourceVideoId ? { sourceVideoId: animation.sourceVideoId } : {}),
    sourceGrid: `${sourceColumns}x${sourceRows}`,
    sourceFrameCount,
    ...(animation.sourceFrameIndices ? { sourceFrames: sourceFrameIndices } : {}),
    columns: outputColumns,
    rows: Math.ceil(outputFrameCount / outputColumns),
    frameCount: outputFrameCount,
    sharedScale: Number(scale.toFixed(6)),
    outputFile: path.basename(outputPath),
    outputSha256: sha256(output),
    bytes: outputStats.size,
    ...animation.metadata,
  };
}

async function main() {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const selectedAnimations = ONLY_ANIMATION_KEY
    ? animations.filter((animation) => animation.key === ONLY_ANIMATION_KEY)
    : animations;
  if (selectedAnimations.length === 0) {
    throw new Error(`Unbekannte Cyberfred-Animation: ${ONLY_ANIMATION_KEY}`);
  }
  const normalizedEntries = await Promise.all(selectedAnimations.map(async (animation) => (
    [animation.key, await normalizeAnimation(animation)]
  )));
  const manifestPath = path.join(OUTPUT_DIRECTORY, "manifest.json");
  const existingManifest = ONLY_ANIMATION_KEY
    ? JSON.parse(await readFile(manifestPath, "utf8"))
    : null;
  const generatedManifest = {
    source: {
      referenceFile: "Photo 1.jpg",
      referenceSha256: REFERENCE_SHA256,
      autospriteCharacterId: "cmsxekm1900atvsmf58tejjnd",
      generation: {
        videoTier: "pro",
        durationSeconds: 4,
        sourceFrameSize: SOURCE_CELL_SIZE,
        sourceFrameCount: FRAME_COUNT,
        firstFrameQuality: "pro",
        backgroundRemoval: "ultra",
        sound: false,
        creditsUsed: 65,
        shippedCreditsUsed: 39,
        discardedDraftCredits: 26,
      },
    },
    atlas: {
      cellSize: CELL_SIZE,
      columns: OUTPUT_COLUMNS,
      rows: Math.ceil(FRAME_COUNT / OUTPUT_COLUMNS),
      frameCount: FRAME_COUNT,
      anchor: "bottom-center",
      animations: Object.fromEntries(normalizedEntries),
    },
  };
  const manifest = existingManifest ? {
    ...existingManifest,
    atlas: {
      ...existingManifest.atlas,
      animations: {
        ...existingManifest.atlas.animations,
        ...Object.fromEntries(normalizedEntries),
      },
    },
  } : generatedManifest;
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

await main();
