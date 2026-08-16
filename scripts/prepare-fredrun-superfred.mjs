import { createHash } from "node:crypto";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const SOURCE_DIRECTORY = path.resolve(process.argv[2] ?? "tmp/superfred-autosprite");
const OUTPUT_DIRECTORY = path.resolve(process.argv[3] ?? "public/fredrun/superfred");
const USER_JUMP_SOURCE_PATH = path.resolve(
  process.argv[4] ?? "C:/Users/conta/Downloads/1786815054521_67465ed8-cf75-4fdb-be5f-cb1cca53584b.png",
);
const CELL_SIZE = 192;
const OUTPUT_COLUMNS = 8;
const ALPHA_THRESHOLD = 8;
const HORIZONTAL_PADDING = 8;
const TOP_PADDING = 6;
const BOTTOM_PADDING = 8;
const REFERENCE_SHA256 = "5638F87F96ADFC18040BDE92EDD297894B217A8D6772890B7728EE35F11318A6";

const animations = [
  {
    key: "walk",
    sourceFile: "run-raw.png",
    spritesheetId: "cmsu4q2l300abg90c76i2k987",
    sourceVideoId: "cmsu4mm9b000e7i6o53e2ofzo",
    sourceCellSize: 512,
    sourceColumns: 8,
    frameCount: 64,
  },
  {
    key: "jump",
    sourceFile: path.basename(USER_JUMP_SOURCE_PATH),
    sourcePath: USER_JUMP_SOURCE_PATH,
    sourceKind: "user-provided-spritesheet",
    sourceCellSize: 512,
    sourceColumns: 8,
    sourceFrameCount: 64,
    frameCount: 64,
    phaseFrames: {
      takeoff: [0, 24],
      superman: [25, 40],
      landing: [41, 63],
    },
  },
  {
    key: "victory",
    sourceFile: "victory-raw.png",
    spritesheetId: "cmsu4q87100akg90c3tx2be7w",
    sourceVideoId: "cmsu4mmdx000o7i6o81tcvoz5",
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

function animationSourcePath(animation) {
  return animation.sourcePath ?? path.join(SOURCE_DIRECTORY, animation.sourceFile);
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
    throw new Error(`Leerer Superfred-Frame bei ${rectangle.left},${rectangle.top}.`);
  }
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

async function normalizeAnimation(animation) {
  const sourcePath = animationSourcePath(animation);
  const source = await readFile(sourcePath);
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const sourceRows = Math.ceil((animation.sourceFrameCount ?? animation.frameCount) / animation.sourceColumns);
  if (
    info.width !== animation.sourceColumns * animation.sourceCellSize
    || info.height !== sourceRows * animation.sourceCellSize
  ) {
    throw new Error(`Unerwartete AutoSprite-Größe für ${animation.sourceFile}: ${info.width}x${info.height}.`);
  }

  const sourceFrames = animation.sourceFrames
    ?? Array.from({ length: animation.frameCount }, (_, index) => index);
  if (sourceFrames.length !== animation.frameCount) {
    throw new Error(`Ungültige Frame-Zuordnung für ${animation.key}: ${sourceFrames.length}.`);
  }
  const frames = sourceFrames.map((sourceIndex) => {
    const rectangle = sourceRectangle(animation, sourceIndex);
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
      height: sourceRows * CELL_SIZE,
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
    sourceFile: path.basename(sourcePath),
    sourceSha256: sha256(source),
    spritesheetId: animation.spritesheetId,
    sourceVideoId: animation.sourceVideoId,
    sourceGrid: `${animation.sourceColumns}x${sourceRows}`,
    sourceFrameCount: animation.sourceFrameCount ?? animation.frameCount,
    sourceFrames,
    phaseFrames: animation.phaseFrames,
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
  const normalizedEntries = await Promise.all(animations.map(async (animation) => {
    try {
      await access(animationSourcePath(animation));
      return [animation.key, await normalizeAnimation(animation)];
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const existing = previousManifest.atlas?.animations?.[animation.key];
      if (!existing) {
        throw new Error(`Fehlende Quelldatei und kein bestehender Manifest-Eintrag für ${animation.key}.`);
      }
      return [animation.key, existing];
    }
  }));
  const manifest = {
    source: {
      referenceFile: "Superfred.png",
      referenceSha256: REFERENCE_SHA256,
      autospriteCharacterId: "cmsu4m95j00057i6op1njwhmy",
      generation: {
        videoTier: "pro",
        durationSeconds: 4,
        sourceFrameSize: 512,
        sourceFrameCount: 64,
        firstFrameQuality: "pro",
        backgroundRemoval: "ultra",
        sound: false,
        creditsUsed: 78,
        shippedCreditsUsed: 39,
        discardedDraftCredits: 39,
      },
    },
    atlas: {
      cellSize: CELL_SIZE,
      columns: OUTPUT_COLUMNS,
      rows: 8,
      frameCount: 64,
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
