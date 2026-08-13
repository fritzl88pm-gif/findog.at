import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const SOURCE_PATH = process.argv[2]
  ?? "C:/Users/conta/.codex/generated_images/019fba14-9e6b-7c31-bd21-dfe3d2863ccb/exec-e26aa8dd-f2a7-4e9c-b5ce-775f083b923a.png";
const EXPECTED_SOURCE_HASH = "86D18FBC5D98B90D8D91BF2692A98A6AE744F3A6E552BE6B76462B21D9AED62B";
const OUTPUT_DIRECTORY = path.resolve("public/fredrun");
const OUTPUT_FILE = "coin-f.webp";
const OUTPUT_SIZE = 256;
const CONTENT_SIZE = 240;

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex").toUpperCase();
}

async function main() {
  const source = await readFile(SOURCE_PATH);
  if (sha256(source) !== EXPECTED_SOURCE_HASH) {
    throw new Error(`Unerwartetes F-Münzenbild: ${path.basename(SOURCE_PATH)}`);
  }

  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const outputPath = path.join(OUTPUT_DIRECTORY, OUTPUT_FILE);
  await sharp(source)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 2 })
    .resize(CONTENT_SIZE, CONTENT_SIZE, { fit: "contain", kernel: sharp.kernel.lanczos3 })
    .extend({
      top: (OUTPUT_SIZE - CONTENT_SIZE) / 2,
      bottom: (OUTPUT_SIZE - CONTENT_SIZE) / 2,
      left: (OUTPUT_SIZE - CONTENT_SIZE) / 2,
      right: (OUTPUT_SIZE - CONTENT_SIZE) / 2,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .webp({ quality: 92, alphaQuality: 100, effort: 6, smartSubsample: true })
    .toFile(outputPath);

  const output = await readFile(outputPath);
  const outputStat = await stat(outputPath);
  const manifest = {
    generation: {
      mode: "built-in image generation",
      sourceSha256: EXPECTED_SOURCE_HASH,
      prompt: "Modern premium gold game coin with a centered capital F and restrained teal inner rim.",
    },
    output: {
      file: OUTPUT_FILE,
      format: "webp",
      sha256: sha256(output),
      size: { width: OUTPUT_SIZE, height: OUTPUT_SIZE },
      transparent: true,
      bytes: outputStat.size,
    },
  };

  await writeFile(
    path.join(OUTPUT_DIRECTORY, "coin-f-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

await main();
