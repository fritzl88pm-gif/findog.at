import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const OUTPUT_DIRECTORY = path.resolve("public/fredrun/obstacles");
const MAX_OUTPUT_SIZE = 192;
const ALPHA_THRESHOLD = 8;

const sourceAssets = [
  {
    key: "reihe100",
    input: process.argv[2] ?? "C:/Users/conta/Downloads/k7IBqIrZBUlwAfKgjcUOl_t88N4Iv9.png",
    sha256: "9B668A34398940FCBE7B376944ECF7C6BA9FB38FBD9867C9CACAE5FCFC3F4F3D",
  },
  {
    key: "steuerkodex",
    input: process.argv[3] ?? "C:/Users/conta/Downloads/mM79uPXO3whBsRILJcOt7_ohuZGsKF.png",
    sha256: "2F19937098D2E3D68C518E72864F40DD3DFCCC80C32688B4D4368DFF8C6A6B59",
  },
  {
    key: "paragraph",
    input: process.argv[4] ?? "C:/Users/conta/Downloads/t63Z-G-kR6wiyjHJAAKTa_EacK2To4.png",
    sha256: "F5460B622F0D7FBF94232FFCCB4AEC6D281BFE0C31D2E48E5DD260BB378B3316",
  },
];

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex").toUpperCase();
}

async function alphaBounds(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * info.channels + 3];
      if (alpha <= ALPHA_THRESHOLD) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }

  if (right < left || bottom < top) {
    throw new Error("Das Hindernis-Asset enthält keine sichtbaren Pixel.");
  }

  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

async function main() {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const expectedOutputFiles = new Set(sourceAssets.map((asset) => `${asset.key}.webp`));
  for (const existingFile of await readdir(OUTPUT_DIRECTORY)) {
    if (existingFile.endsWith(".webp") && !expectedOutputFiles.has(existingFile)) {
      await rm(path.join(OUTPUT_DIRECTORY, existingFile));
    }
  }
  const manifestAssets = {};

  for (const asset of sourceAssets) {
    const source = await readFile(asset.input);
    if (sha256(source) !== asset.sha256) {
      throw new Error(`Unerwartetes Hindernis-Asset: ${path.basename(asset.input)}`);
    }

    const sourceMetadata = await sharp(source).metadata();
    const bounds = await alphaBounds(source);
    const outputPath = path.join(OUTPUT_DIRECTORY, `${asset.key}.webp`);

    await sharp(source)
      .extract(bounds)
      .resize({
        width: MAX_OUTPUT_SIZE,
        height: MAX_OUTPUT_SIZE,
        fit: "inside",
        withoutEnlargement: true,
        kernel: sharp.kernel.lanczos3,
      })
      .webp({ quality: 92, alphaQuality: 100, effort: 6, smartSubsample: true })
      .toFile(outputPath);

    const outputMetadata = await sharp(outputPath).metadata();
    const outputStat = await stat(outputPath);
    manifestAssets[asset.key] = {
      sourceFile: path.basename(asset.input),
      sha256: asset.sha256,
      sourceSize: { width: sourceMetadata.width, height: sourceMetadata.height },
      sourceBounds: bounds,
      outputFile: `${asset.key}.webp`,
      outputSize: { width: outputMetadata.width, height: outputMetadata.height },
      outputBytes: outputStat.size,
    };
  }

  const manifest = {
    format: "webp",
    alpha: true,
    maximumOutputSize: MAX_OUTPUT_SIZE,
    assets: manifestAssets,
  };
  await writeFile(
    path.join(OUTPUT_DIRECTORY, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

await main();
