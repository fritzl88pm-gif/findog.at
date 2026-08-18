import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const SOURCE_DIRECTORY = path.resolve(process.argv[2] ?? ".tmp/superfrida-sources");
const OUTPUT_DIRECTORY = path.resolve(process.argv[3] ?? "public/fredrun/superfrida");
const CELL_SIZE = 192;
const OUTPUT_COLUMNS = 8;
const SOURCE_CELL_SIZE = 512;
const SOURCE_COLUMNS = 8;
const SOURCE_FRAME_COUNT = 64;
const FRAME_COUNT = 64;
const ALPHA_THRESHOLD = 8;
const HORIZONTAL_PADDING = 8;
const TOP_PADDING = 6;
const BOTTOM_PADDING = 8;
const REFERENCE_SHA256 = "EF9559C593F4069290F0039A26BE2BFBDA81F1082FA9CC32C0A5FC7117EBF908";

// The provided sheet contains two jumps. Frames 0-39 form the complete first
// anticipation/takeoff/flight/landing cycle; resample only that cycle so Fredrun
// does not play a frantic double jump during its shared 0.82 second physics arc.
const jumpSourceFrames = Array.from(
  { length: FRAME_COUNT },
  (_, index) => Math.round(index * 39 / (FRAME_COUNT - 1)),
);

const animations = [
  {
    key: "walk",
    sourceKind: "provided-spritesheet",
    sourceFile: "Superfrida-run.png",
    metadata: {
      animationName: "Superfrida Provided Side-Scroller Run",
      generationTier: "user-provided",
      loop: true,
      facingDirection: "right",
    },
  },
  {
    key: "jump",
    sourceKind: "provided-spritesheet",
    sourceFile: "Superfrida-jump.png",
    sourceFrames: jumpSourceFrames,
    metadata: {
      animationName: "Superfrida Provided Single-Cycle Jump",
      generationTier: "user-provided-edited",
      facingDirection: "right",
      sourceUsage: "first-complete-jump-cycle-frames-0-through-39-resampled-to-64",
      runtimePlayback: {
        mode: "full-atlas-synced-to-fredrun-physics",
        durationSeconds: 0.82,
        heightSource: "shared-fredrun-physics",
      },
    },
  },
  {
    key: "victory",
    sourceKind: "autosprite",
    sourceFile: "victory.png",
    spritesheetId: "cmsxmv47i00atvlisbe4djzg7",
    sourceVideoId: "cmsxmrmdb0089vlis891y33sd",
    metadata: {
      animationName: "Superfrida Victory",
      generationTier: "existing-autosprite-clip",
      loop: true,
    },
  },
];

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex").toUpperCase();
}

function sourceRectangle(index) {
  return {
    left: index % SOURCE_COLUMNS * SOURCE_CELL_SIZE,
    top: Math.floor(index / SOURCE_COLUMNS) * SOURCE_CELL_SIZE,
    width: SOURCE_CELL_SIZE,
    height: SOURCE_CELL_SIZE,
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
    throw new Error(`Leerer Superfrida-Frame bei ${rectangle.left},${rectangle.top}.`);
  }
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

async function normalizeAnimation(animation) {
  const sourcePath = path.join(SOURCE_DIRECTORY, animation.sourceFile);
  const source = await readFile(sourcePath);
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (
    info.width !== SOURCE_COLUMNS * SOURCE_CELL_SIZE
    || info.height !== Math.ceil(SOURCE_FRAME_COUNT / SOURCE_COLUMNS) * SOURCE_CELL_SIZE
  ) {
    throw new Error(`Unerwartete AutoSprite-Größe für ${animation.sourceFile}: ${info.width}x${info.height}.`);
  }

  const sourceFrames = animation.sourceFrames
    ?? Array.from({ length: FRAME_COUNT }, (_, index) => index);
  if (sourceFrames.length !== FRAME_COUNT) {
    throw new Error(`Ungültige Frame-Zuordnung für ${animation.key}: ${sourceFrames.length}.`);
  }
  const frames = sourceFrames.map((sourceIndex) => {
    const rectangle = sourceRectangle(sourceIndex);
    return { rectangle, bounds: findAlphaBounds(data, info.channels, info.width, rectangle) };
  });
  const maxWidth = Math.max(...frames.map((frame) => frame.bounds.width));
  const maxHeight = Math.max(...frames.map((frame) => frame.bounds.height));
  const scale = Math.min(
    (CELL_SIZE - HORIZONTAL_PADDING * 2) / maxWidth,
    (CELL_SIZE - TOP_PADDING - BOTTOM_PADDING) / maxHeight,
  );
  const composites = [];

  for (const [index, frame] of frames.entries()) {
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
      left: index % OUTPUT_COLUMNS * CELL_SIZE + Math.round((CELL_SIZE - width) / 2),
      top: Math.floor(index / OUTPUT_COLUMNS) * CELL_SIZE + CELL_SIZE - BOTTOM_PADDING - height,
    });
  }

  const outputPath = path.join(OUTPUT_DIRECTORY, `${animation.key}.webp`);
  await sharp({
    create: {
      width: OUTPUT_COLUMNS * CELL_SIZE,
      height: Math.ceil(FRAME_COUNT / OUTPUT_COLUMNS) * CELL_SIZE,
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
    sourceKind: animation.sourceKind,
    sourceFile: animation.sourceFile,
    sourceSha256: sha256(source),
    ...(animation.spritesheetId ? { spritesheetId: animation.spritesheetId } : {}),
    ...(animation.sourceVideoId ? { sourceVideoId: animation.sourceVideoId } : {}),
    sourceGrid: "8x8",
    sourceFrameCount: SOURCE_FRAME_COUNT,
    ...(animation.sourceFrames ? { sourceFrames } : {}),
    columns: OUTPUT_COLUMNS,
    rows: Math.ceil(FRAME_COUNT / OUTPUT_COLUMNS),
    frameCount: FRAME_COUNT,
    sharedScale: Number(scale.toFixed(6)),
    anchorMode: "bottom-center",
    outputFile: path.basename(outputPath),
    outputSha256: sha256(output),
    bytes: outputStats.size,
    ...animation.metadata,
  };
}

async function main() {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const normalizedEntries = await Promise.all(animations.map(async (animation) => (
    [animation.key, await normalizeAnimation(animation)]
  )));
  const normalizedAnimations = Object.fromEntries(normalizedEntries);
  const manifest = {
    source: {
      referenceFile: "Superfrida AutoSprite character",
      referenceSha256: REFERENCE_SHA256,
      autospriteCharacterId: "cmsxmqssh0074vlisw1avagcx",
      generation: {
        videoTier: "pro",
        durationSeconds: 4,
        sourceFrameSize: 512,
        sourceFrameCount: 64,
        firstFrameQuality: "pro",
        backgroundRemoval: "ultra",
        sound: false,
        creditsUsed: 39,
        shippedCreditsUsed: 0,
        discardedDraftCredits: 39,
        status: "replaced-by-user-provided-spritesheets",
      },
      providedSheets: {
        walk: {
          file: normalizedAnimations.walk.sourceFile,
          sha256: normalizedAnimations.walk.sourceSha256,
        },
        jump: {
          file: normalizedAnimations.jump.sourceFile,
          sha256: normalizedAnimations.jump.sourceSha256,
        },
      },
    },
    atlas: {
      cellSize: CELL_SIZE,
      columns: OUTPUT_COLUMNS,
      rows: Math.ceil(FRAME_COUNT / OUTPUT_COLUMNS),
      frameCount: FRAME_COUNT,
      anchor: "bottom-center",
      animations: normalizedAnimations,
    },
  };
  await writeFile(
    path.join(OUTPUT_DIRECTORY, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

await main();
