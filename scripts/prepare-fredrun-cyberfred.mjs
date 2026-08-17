import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const SOURCE_DIRECTORY = path.resolve(process.argv[2] ?? "tmp/cyberfred-autosprite");
const OUTPUT_DIRECTORY = path.resolve(process.argv[3] ?? "public/fredrun/cyberfred");
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

const animations = [
  {
    key: "walk",
    sourceFile: "run-raw.png",
    spritesheetId: "cmsxeo5s9006uil4usl7cp9oj",
    sourceVideoId: "cmsxekvt600b6vsmfsx6vuf77",
  },
  {
    key: "jump",
    sourceFile: "jump-raw.png",
    spritesheetId: "cmsxfvcto0009zuxdynj10ejx",
    sourceVideoId: "cmsxfsw6c004q146wxpooqsje",
    metadata: {
      animationName: "Blue Booster Jump",
      firstFramePoseId: "cmsxfrmrv002h146wd2gwlna2",
      facingDirection: "right",
      runtimeEffect: "electric-blue-boot-thrusters",
      runtimePlayback: {
        mode: "curated-single-arc",
        frameSequence: [8, 10, 12, 14, 16, 18, 20, 21, 22, 22, 21, 20, 18, 16, 14, 12, 10, 8],
        displayedFrameCount: 18,
        footAnchors: "per-frame-source-cell-coordinates",
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
    throw new Error(`Leerer Cyberfred-Frame bei ${rectangle.left},${rectangle.top}.`);
  }
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

async function normalizeAnimation(animation) {
  const sourcePath = path.join(SOURCE_DIRECTORY, animation.sourceFile);
  const source = await readFile(sourcePath);
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const sourceRows = Math.ceil(FRAME_COUNT / SOURCE_COLUMNS);
  if (
    info.width !== SOURCE_COLUMNS * SOURCE_CELL_SIZE
    || info.height !== sourceRows * SOURCE_CELL_SIZE
  ) {
    throw new Error(`Unerwartete AutoSprite-Größe für ${animation.sourceFile}: ${info.width}x${info.height}.`);
  }

  const frames = Array.from({ length: FRAME_COUNT }, (_, index) => {
    const rectangle = sourceRectangle(index);
    return { index, rectangle, bounds: findAlphaBounds(data, info.channels, info.width, rectangle) };
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
      left: frame.index % OUTPUT_COLUMNS * CELL_SIZE + Math.round((CELL_SIZE - width) / 2),
      top: Math.floor(frame.index / OUTPUT_COLUMNS) * CELL_SIZE + CELL_SIZE - BOTTOM_PADDING - height,
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
    sourceKind: "autosprite",
    sourceFile: animation.sourceFile,
    sourceSha256: sha256(source),
    spritesheetId: animation.spritesheetId,
    sourceVideoId: animation.sourceVideoId,
    sourceGrid: `${SOURCE_COLUMNS}x${sourceRows}`,
    sourceFrameCount: FRAME_COUNT,
    columns: OUTPUT_COLUMNS,
    rows: Math.ceil(FRAME_COUNT / OUTPUT_COLUMNS),
    frameCount: FRAME_COUNT,
    sharedScale: Number(scale.toFixed(6)),
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
  const manifest = {
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
  await writeFile(
    path.join(OUTPUT_DIRECTORY, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

await main();
