import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const SOURCE_PATH = process.argv[2] ?? "C:/Users/conta/Downloads/Madinger-walk.png";
const EXPECTED_SOURCE_HASH = "F786C97C128EB92D6B164FF68A8CF7C35881FB5716E0357D3D3D00281A6C207E";
const OUTPUT_DIRECTORY = path.resolve("public/fredrun");
const OUTPUT_FILE = "madinger-walk.webp";
const SOURCE_COLUMNS = 7;
const SOURCE_ROWS = 7;
const FRAME_COUNT = SOURCE_COLUMNS * SOURCE_ROWS;
const CELL_SIZE = 192;
const ALPHA_THRESHOLD = 8;
const HORIZONTAL_PADDING = 8;
const TOP_PADDING = 6;
const BOTTOM_PADDING = 8;

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex").toUpperCase();
}

function frameRectangle(index, imageWidth, imageHeight) {
  const column = index % SOURCE_COLUMNS;
  const row = Math.floor(index / SOURCE_COLUMNS);
  const left = Math.round(column * imageWidth / SOURCE_COLUMNS);
  const top = Math.round(row * imageHeight / SOURCE_ROWS);
  const right = Math.round((column + 1) * imageWidth / SOURCE_COLUMNS);
  const bottom = Math.round((row + 1) * imageHeight / SOURCE_ROWS);
  return { left, top, width: right - left, height: bottom - top };
}

function alphaBounds(data, channels, imageWidth, rectangle) {
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
    throw new Error(`Leerer Madinger-Frame bei ${rectangle.left},${rectangle.top}.`);
  }

  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

async function main() {
  const source = await readFile(SOURCE_PATH);
  if (sha256(source) !== EXPECTED_SOURCE_HASH) {
    throw new Error(`Unerwartetes Madinger-Spritesheet: ${path.basename(SOURCE_PATH)}`);
  }

  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const frames = Array.from({ length: FRAME_COUNT }, (_, index) => {
    const rectangle = frameRectangle(index, info.width, info.height);
    return { index, rectangle, bounds: alphaBounds(data, info.channels, info.width, rectangle) };
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
      .flop()
      .png()
      .toBuffer();
    const column = frame.index % SOURCE_COLUMNS;
    const row = Math.floor(frame.index / SOURCE_COLUMNS);
    composites.push({
      input,
      left: column * CELL_SIZE + Math.round((CELL_SIZE - width) / 2),
      top: row * CELL_SIZE + CELL_SIZE - BOTTOM_PADDING - height,
    });
  }

  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const outputPath = path.join(OUTPUT_DIRECTORY, OUTPUT_FILE);
  await sharp({
    create: {
      width: CELL_SIZE * SOURCE_COLUMNS,
      height: CELL_SIZE * SOURCE_ROWS,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .webp({ quality: 92, alphaQuality: 100, effort: 6, smartSubsample: true })
    .toFile(outputPath);

  const output = await readFile(outputPath);
  const outputStat = await stat(outputPath);
  const manifest = {
    source: {
      file: path.basename(SOURCE_PATH),
      sha256: EXPECTED_SOURCE_HASH,
      grid: `${SOURCE_COLUMNS}x${SOURCE_ROWS}`,
      frameCount: FRAME_COUNT,
    },
    atlas: {
      file: OUTPUT_FILE,
      format: "webp",
      sha256: sha256(output),
      columns: SOURCE_COLUMNS,
      rows: SOURCE_ROWS,
      cellSize: CELL_SIZE,
      frameCount: FRAME_COUNT,
      anchor: "bottom-center",
      sharedScale: Number(scale.toFixed(6)),
      flippedHorizontally: true,
      direction: "right-to-left",
      bytes: outputStat.size,
    },
  };

  await writeFile(
    path.join(OUTPUT_DIRECTORY, "madinger-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

await main();
