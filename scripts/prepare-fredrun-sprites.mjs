import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import PizZip from "pizzip";
import sharp from "sharp";

const SOURCE_ZIP_PATH = process.argv[2] ?? "C:/Users/conta/Downloads/Fred-spritesheet.zip";
const JUMP_SHEET_PATH = process.argv[3] ?? "C:/Users/conta/Downloads/Fred-jump.png";
const EXPECTED_ZIP_HASH = "DCD8D61B48B88FE525DA2D151544B8B8C859C9E3E222DEE18732E160E1A9F735";
const EXPECTED_JUMP_HASH = "F16512E534978A7F3E0081A455DC1EE57064383AC2D4C8C994050EB087670789";
const OUTPUT_DIRECTORY = path.resolve("public/fredrun");
const CELL_SIZE = 192;
const ALPHA_THRESHOLD = 8;
const HORIZONTAL_PADDING = 8;
const TOP_PADDING = 6;
const BOTTOM_PADDING = 8;
const JUMP_SOURCE_COLUMNS = 7;
const JUMP_SOURCE_FRAME_COUNT = 49;
const JUMP_OUTPUT_FRAME_COUNT = 24;

const archiveAnimations = [
  { key: "walk", sourceDirectory: "walk_right", sourceColumns: 8, sourceRows: 8, outputColumns: 8 },
  { key: "victory", sourceDirectory: "Victory", sourceColumns: 8, sourceRows: 8, outputColumns: 8 },
];

const jumpFrameIndices = Array.from({ length: JUMP_OUTPUT_FRAME_COUNT }, (_, index) => (
  Math.round(index * (JUMP_SOURCE_FRAME_COUNT - 1) / (JUMP_OUTPUT_FRAME_COUNT - 1))
));

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex").toUpperCase();
}

function frameRectangle(index, columns, rows, imageWidth, imageHeight) {
  const column = index % columns;
  const row = Math.floor(index / columns);
  const left = Math.round(column * imageWidth / columns);
  const top = Math.round(row * imageHeight / rows);
  const right = Math.round((column + 1) * imageWidth / columns);
  const bottom = Math.round((row + 1) * imageHeight / rows);
  return { left, top, width: right - left, height: bottom - top };
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
    throw new Error(`Leerer Sprite-Frame bei ${rectangle.left},${rectangle.top}.`);
  }

  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

async function removeUniformBackground(buffer) {
  const { data, info } = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const background = [data[0], data[1], data[2]];
  const output = Buffer.alloc(info.width * info.height * 4);

  for (let pixel = 0; pixel < info.width * info.height; pixel += 1) {
    const sourceOffset = pixel * info.channels;
    const outputOffset = pixel * 4;
    const red = data[sourceOffset];
    const green = data[sourceOffset + 1];
    const blue = data[sourceOffset + 2];
    const distance = Math.hypot(red - background[0], green - background[1], blue - background[2]);
    const alpha = Math.round(Math.max(0, Math.min(1, (distance - 7) / 24)) * 255);
    output[outputOffset] = red;
    output[outputOffset + 1] = green;
    output[outputOffset + 2] = blue;
    output[outputOffset + 3] = alpha;
  }

  return sharp(output, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
}

async function decodeAnimation(config) {
  const { data, info } = await sharp(config.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const frameIndices = config.frameIndices ?? Array.from(
    { length: config.sourceColumns * config.sourceRows },
    (_, index) => index,
  );
  const frames = frameIndices.map((sourceIndex, outputIndex) => {
    const rectangle = frameRectangle(
      sourceIndex,
      config.sourceColumns,
      config.sourceRows,
      info.width,
      info.height,
    );
    return {
      sourceIndex,
      outputIndex,
      rectangle,
      bounds: findAlphaBounds(data, info.channels, info.width, rectangle),
    };
  });
  return { ...config, frames };
}

async function main() {
  const [zipSource, jumpSource] = await Promise.all([
    readFile(SOURCE_ZIP_PATH),
    readFile(JUMP_SHEET_PATH),
  ]);
  if (sha256(zipSource) !== EXPECTED_ZIP_HASH) throw new Error("Unerwartetes Fred-Spritepaket.");
  if (sha256(jumpSource) !== EXPECTED_JUMP_HASH) throw new Error("Unerwartetes Fred-Sprungsheet.");

  const zip = new PizZip(zipSource);
  const decoded = [];
  for (const animation of archiveAnimations) {
    const entryName = `${animation.sourceDirectory}/spritesheet.png`;
    const entry = zip.file(entryName);
    if (!entry) throw new Error(`Fehlender ZIP-Eintrag: ${entryName}`);
    decoded.push(await decodeAnimation({ ...animation, buffer: entry.asNodeBuffer() }));
  }

  const transparentJump = await removeUniformBackground(jumpSource);
  decoded.splice(1, 0, await decodeAnimation({
    key: "jump",
    buffer: transparentJump,
    sourceColumns: JUMP_SOURCE_COLUMNS,
    sourceRows: JUMP_SOURCE_COLUMNS,
    outputColumns: 6,
    frameIndices: jumpFrameIndices,
  }));

  const allBounds = decoded.flatMap((animation) => animation.frames.map((frame) => frame.bounds));
  const maxWidth = Math.max(...allBounds.map((bounds) => bounds.width));
  const maxHeight = Math.max(...allBounds.map((bounds) => bounds.height));
  const scale = Math.min(
    (CELL_SIZE - HORIZONTAL_PADDING * 2) / maxWidth,
    (CELL_SIZE - TOP_PADDING - BOTTOM_PADDING) / maxHeight,
  );

  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const animationManifest = {};
  for (const animation of decoded) {
    const rows = Math.ceil(animation.frames.length / animation.outputColumns);
    const composites = [];
    for (const frame of animation.frames) {
      const width = Math.max(1, Math.round(frame.bounds.width * scale));
      const height = Math.max(1, Math.round(frame.bounds.height * scale));
      const input = await sharp(animation.buffer)
        .extract({
          left: frame.rectangle.left + frame.bounds.left,
          top: frame.rectangle.top + frame.bounds.top,
          width: frame.bounds.width,
          height: frame.bounds.height,
        })
        .resize(width, height, { fit: "fill", kernel: sharp.kernel.lanczos3 })
        .png()
        .toBuffer();
      const column = frame.outputIndex % animation.outputColumns;
      const row = Math.floor(frame.outputIndex / animation.outputColumns);
      composites.push({
        input,
        left: column * CELL_SIZE + Math.round((CELL_SIZE - width) / 2),
        top: row * CELL_SIZE + CELL_SIZE - BOTTOM_PADDING - height,
      });
    }

    await sharp({
      create: {
        width: CELL_SIZE * animation.outputColumns,
        height: CELL_SIZE * rows,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite(composites)
      .png({ compressionLevel: 9, effort: 10 })
      .toFile(path.join(OUTPUT_DIRECTORY, `${animation.key}.png`));

    animationManifest[animation.key] = {
      columns: animation.outputColumns,
      rows,
      frameCount: animation.frames.length,
    };
  }

  const manifest = {
    source: {
      archive: {
        file: path.basename(SOURCE_ZIP_PATH),
        sha256: EXPECTED_ZIP_HASH,
        includedAnimations: archiveAnimations.map((animation) => animation.sourceDirectory),
      },
      jumpSheet: {
        file: path.basename(JUMP_SHEET_PATH),
        sha256: EXPECTED_JUMP_HASH,
        sourceGrid: "7x7",
        sourceFrameCount: JUMP_SOURCE_FRAME_COUNT,
        selectedFrameIndices: jumpFrameIndices,
      },
    },
    atlas: {
      cellSize: CELL_SIZE,
      anchor: "bottom-center",
      sharedScale: Number(scale.toFixed(6)),
      animations: animationManifest,
    },
  };
  await writeFile(path.join(OUTPUT_DIRECTORY, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

await main();
