import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import PizZip from "pizzip";
import sharp from "sharp";

const SOURCE_PATH = process.argv[2] ?? "C:/Users/conta/Downloads/Fred-spritesheet.zip";
const EXPECTED_SOURCE_HASH = "DCD8D61B48B88FE525DA2D151544B8B8C859C9E3E222DEE18732E160E1A9F735";
const OUTPUT_DIRECTORY = path.resolve("public/fredrun");
const SOURCE_CELL_SIZE = 512;
const CELL_SIZE = 192;
const COLUMNS = 8;
const FRAME_COUNT = 64;
const ALPHA_THRESHOLD = 8;
const HORIZONTAL_PADDING = 8;
const TOP_PADDING = 6;
const BOTTOM_PADDING = 8;

const animations = [
  { key: "walk", sourceDirectory: "walk_right" },
  { key: "jump", sourceDirectory: "jump_right" },
  { key: "victory", sourceDirectory: "Victory" },
];

function findAlphaBounds(data, channels, frameX, frameY) {
  let left = SOURCE_CELL_SIZE;
  let top = SOURCE_CELL_SIZE;
  let right = -1;
  let bottom = -1;
  const atlasWidth = SOURCE_CELL_SIZE * COLUMNS;

  for (let y = 0; y < SOURCE_CELL_SIZE; y += 1) {
    const sourceY = frameY + y;
    for (let x = 0; x < SOURCE_CELL_SIZE; x += 1) {
      const sourceX = frameX + x;
      const alpha = data[(sourceY * atlasWidth + sourceX) * channels + 3];
      if (alpha <= ALPHA_THRESHOLD) {
        continue;
      }
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }

  if (right < left || bottom < top) {
    throw new Error(`Leerer Sprite-Frame bei ${frameX},${frameY}.`);
  }

  return {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

async function main() {
  const source = await readFile(SOURCE_PATH);
  const sourceHash = createHash("sha256").update(source).digest("hex").toUpperCase();
  if (sourceHash !== EXPECTED_SOURCE_HASH) {
    throw new Error(`Unerwartetes Spritepaket: ${sourceHash}`);
  }

  const zip = new PizZip(source);
  const decoded = [];
  const allBounds = [];

  for (const animation of animations) {
    const entryName = `${animation.sourceDirectory}/spritesheet.png`;
    const entry = zip.file(entryName);
    if (!entry) {
      throw new Error(`Fehlender ZIP-Eintrag: ${entryName}`);
    }

    const buffer = entry.asNodeBuffer();
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== SOURCE_CELL_SIZE * COLUMNS || info.height !== SOURCE_CELL_SIZE * COLUMNS || info.channels !== 4) {
      throw new Error(`Unerwartetes Atlasformat für ${entryName}.`);
    }

    const frames = Array.from({ length: FRAME_COUNT }, (_, index) => {
      const frameX = (index % COLUMNS) * SOURCE_CELL_SIZE;
      const frameY = Math.floor(index / COLUMNS) * SOURCE_CELL_SIZE;
      const bounds = findAlphaBounds(data, info.channels, frameX, frameY);
      allBounds.push(bounds);
      return { index, frameX, frameY, bounds };
    });
    decoded.push({ ...animation, buffer, frames });
  }

  const maxWidth = Math.max(...allBounds.map((bounds) => bounds.width));
  const maxHeight = Math.max(...allBounds.map((bounds) => bounds.height));
  const scale = Math.min(
    (CELL_SIZE - HORIZONTAL_PADDING * 2) / maxWidth,
    (CELL_SIZE - TOP_PADDING - BOTTOM_PADDING) / maxHeight,
  );

  await mkdir(OUTPUT_DIRECTORY, { recursive: true });

  for (const animation of decoded) {
    const composites = [];
    for (const frame of animation.frames) {
      const width = Math.max(1, Math.round(frame.bounds.width * scale));
      const height = Math.max(1, Math.round(frame.bounds.height * scale));
      const input = await sharp(animation.buffer)
        .extract({
          left: frame.frameX + frame.bounds.left,
          top: frame.frameY + frame.bounds.top,
          width: frame.bounds.width,
          height: frame.bounds.height,
        })
        .resize(width, height, { fit: "fill", kernel: sharp.kernel.lanczos3 })
        .png()
        .toBuffer();
      const column = frame.index % COLUMNS;
      const row = Math.floor(frame.index / COLUMNS);
      composites.push({
        input,
        left: column * CELL_SIZE + Math.round((CELL_SIZE - width) / 2),
        top: row * CELL_SIZE + CELL_SIZE - BOTTOM_PADDING - height,
      });
    }

    await sharp({
      create: {
        width: CELL_SIZE * COLUMNS,
        height: CELL_SIZE * COLUMNS,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite(composites)
      .png({ compressionLevel: 9, effort: 10 })
      .toFile(path.join(OUTPUT_DIRECTORY, `${animation.key}.png`));
  }

  const manifest = {
    source: {
      file: path.basename(SOURCE_PATH),
      sha256: EXPECTED_SOURCE_HASH,
      includedAnimations: animations.map((animation) => animation.sourceDirectory),
    },
    atlas: {
      cellSize: CELL_SIZE,
      columns: COLUMNS,
      rows: COLUMNS,
      frameCount: FRAME_COUNT,
      anchor: "bottom-center",
      sharedScale: Number(scale.toFixed(6)),
    },
  };
  await writeFile(path.join(OUTPUT_DIRECTORY, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

await main();
