import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const SOURCE_PATH = process.argv[2] ?? "C:/Users/conta/Downloads/intro.png";
const EXPECTED_SOURCE_HASH = "29F68BDD254CA3DFC3E6F8D1350DFCFFA55ED24DF3D569742AF725F86ECCA8A8";
const OUTPUT_DIRECTORY = path.resolve("public/fredrun");
const OUTPUT_FILE = "intro.webp";
const MAX_OUTPUT_WIDTH = 1600;

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex").toUpperCase();
}

async function main() {
  const source = await readFile(SOURCE_PATH);
  if (sha256(source) !== EXPECTED_SOURCE_HASH) {
    throw new Error(`Unerwartetes Fredrun-Intro: ${path.basename(SOURCE_PATH)}`);
  }

  const sourceMetadata = await sharp(source).metadata();
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const outputPath = path.join(OUTPUT_DIRECTORY, OUTPUT_FILE);

  await sharp(source)
    .resize({ width: MAX_OUTPUT_WIDTH, withoutEnlargement: true, kernel: sharp.kernel.lanczos3 })
    .webp({ quality: 88, effort: 6, smartSubsample: true })
    .toFile(outputPath);

  const outputMetadata = await sharp(outputPath).metadata();
  const outputStat = await stat(outputPath);
  const manifest = {
    source: {
      file: path.basename(SOURCE_PATH),
      sha256: EXPECTED_SOURCE_HASH,
      width: sourceMetadata.width,
      height: sourceMetadata.height,
    },
    output: {
      file: OUTPUT_FILE,
      format: "webp",
      width: outputMetadata.width,
      height: outputMetadata.height,
      bytes: outputStat.size,
    },
  };

  await writeFile(
    path.join(OUTPUT_DIRECTORY, "intro-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

await main();
