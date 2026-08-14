import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const SOURCE_DIRECTORY = path.resolve(process.argv[2] ?? "tmp/frida-autosprite");
const OUTPUT_DIRECTORY = path.resolve(process.argv[3] ?? "public/fredrun/frida");
const CELL_SIZE = 192;
const OUTPUT_COLUMNS = 8;
const ALPHA_THRESHOLD = 8;
const HORIZONTAL_PADDING = 8;
const TOP_PADDING = 6;
const BOTTOM_PADDING = 8;
const REFERENCE_SHA256 = "4C51E0D746845DFD56EA001E49C9EA45393D5996E07821733D07461A7E5C3587";

const animations = [
  {
    key: "walk",
    sourceFile: "run-raw.png",
    spritesheetId: "cmsteek2b002r2cu2hl6gknyk",
    sourceVideoId: "cmstebvgf00hbzcghq0g41h4a",
    sourceCellSize: 512,
    sourceColumns: 8,
    frameCount: 64,
  },
  {
    key: "jump",
    sourceFile: "jump-raw.png",
    spritesheetId: "cmstej0hi00d51wsnwzgcvct0",
    sourceVideoId: "cmsteg2dy00bq1wsn2sf93fxp",
    sourceCellSize: 512,
    sourceColumns: 8,
    frameCount: 64,
  },
];

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex").toUpperCase();
}

function sourceRectangle(animation, index) {
  return {
    left: index % animation.sourceColumns * animation.sourceCellSize,
    top: Math.floor(index / animation.sourceColumns) * animation.sourceCellSize,
    width: animation.sourceCellSize,
    height: animation.sourceCellSize,
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

  if (right < left || bottom < top) throw new Error(`Leerer Frida-Frame bei ${rectangle.left},${rectangle.top}.`);
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

async function normalizeAnimation(animation) {
  const sourcePath = path.join(SOURCE_DIRECTORY, animation.sourceFile);
  const source = await readFile(sourcePath);
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const sourceRows = Math.ceil(animation.frameCount / animation.sourceColumns);
  if (
    info.width !== animation.sourceColumns * animation.sourceCellSize
    || info.height !== sourceRows * animation.sourceCellSize
  ) {
    throw new Error(`Unerwartete AutoSprite-Größe für ${animation.sourceFile}: ${info.width}x${info.height}.`);
  }

  const frames = Array.from({ length: animation.frameCount }, (_, index) => {
    const rectangle = sourceRectangle(animation, index);
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
      height: Math.ceil(animation.frameCount / OUTPUT_COLUMNS) * CELL_SIZE,
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
    sourceFile: animation.sourceFile,
    sourceSha256: sha256(source),
    spritesheetId: animation.spritesheetId,
    sourceVideoId: animation.sourceVideoId,
    columns: OUTPUT_COLUMNS,
    rows: Math.ceil(animation.frameCount / OUTPUT_COLUMNS),
    frameCount: animation.frameCount,
    sharedScale: Number(scale.toFixed(6)),
    outputFile: path.basename(outputPath),
    outputSha256: sha256(output),
    bytes: outputStats.size,
  };
}

async function main() {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const manifestPath = path.join(OUTPUT_DIRECTORY, "manifest.json");
  const previousManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const victory = previousManifest.atlas?.animations?.victory;
  if (!victory) throw new Error("Bestehende Frida-Tanzanimation fehlt im Manifest.");
  const normalizedEntries = await Promise.all(animations.map(async (animation) => (
    [animation.key, await normalizeAnimation(animation)]
  )));
  const manifest = {
    source: {
      referenceFile: "Photo 1.jpg",
      referenceSha256: REFERENCE_SHA256,
      autospriteCharacterId: "cmstdc8v0007bu6l4ok6pknjd",
      generation: {
        videoTier: "pro",
        durationSeconds: 4,
        sourceFrameSize: 512,
        sourceFrameCount: 64,
        firstFrameQuality: "pro",
        backgroundRemoval: "ultra",
        sound: false,
        creditsUsed: 39,
        shippedCreditsUsed: 26,
        discardedDraftCredits: 13,
      },
    },
    atlas: {
      cellSize: CELL_SIZE,
      columns: OUTPUT_COLUMNS,
      rows: 8,
      frameCount: 64,
      anchor: "bottom-center",
      animations: {
        ...Object.fromEntries(normalizedEntries),
        victory: {
          ...victory,
          columns: victory.columns ?? 8,
          rows: victory.rows ?? 4,
          frameCount: victory.frameCount ?? 32,
        },
      },
    },
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

await main();
