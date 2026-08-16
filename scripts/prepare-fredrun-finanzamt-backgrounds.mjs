import { createHash } from "node:crypto";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const RAW_DIRECTORY = path.resolve(
  process.argv[2] ?? "/opt/data/tmp/fredrun-finanzamt-generated",
);
const OUTPUT_DIRECTORY = path.resolve(
  "public/fredrun/levels/finanzamt-night/backgrounds",
);
const CONTACT_SHEET_PATH = path.join(RAW_DIRECTORY, "contact-sheet.png");
const OUTPUT_WIDTH = 2172;
const OUTPUT_HEIGHT = 665;
const OUTPUT_QUALITY = 84;

const sourceAssets = [
  {
    id: "records-corridor",
    title: "Records corridor",
    anchorScore: 0,
    rawFile: "01-records-corridor-raw.png",
    rawSha256: "96fff0d1df83bca896c491b83cb0d2943d60737918e77d77fe675ed73b4064b2",
    metadataPath: "/opt/data/generated-images/metadata/2026/08/20260816-192556_fredrun-finanzamt-night-records-corridor_codex-built-in-image-gen-model-i_openai-codex_96fff0d1.json",
    crop: { left: 0, top: 304, width: 1672, height: 512 },
  },
  {
    id: "open-plan-office",
    title: "Open-plan office",
    anchorScore: 500,
    rawFile: "02-open-plan-office-raw.png",
    rawSha256: "8ed55cb687592d04caf35047e301f38ed077714ca6b6c5b5f16b2af8489d88a9",
    metadataPath: "/opt/data/generated-images/metadata/2026/08/20260816-193006_fredrun-finanzamt-night-open-plan-office_codex-built-in-image-gen-model-i_openai-codex_8ed55cb6.json",
    crop: { left: 0, top: 227, width: 1823, height: 558 },
  },
  {
    id: "archive-basement",
    title: "Archive basement",
    anchorScore: 1000,
    rawFile: "03-archive-basement-raw.png",
    rawSha256: "5991896c5b1468fe29d2de9b2b09159310fe4c9444e3f1e3aaa0400d977d93b7",
    metadataPath: "/opt/data/generated-images/metadata/2026/08/20260816-193519_fredrun-finanzamt-night-archive-basement_codex-built-in-image-gen-model-i_openai-codex_5991896c.json",
    crop: { left: 0, top: 304, width: 1672, height: 512 },
  },
  {
    id: "caseworker-corridor",
    title: "Caseworker corridor",
    anchorScore: 1500,
    rawFile: "04-caseworker-corridor-raw.png",
    rawSha256: "115d8fd6e2a2051113553118e5272e2fc1e4e439c151e5b7b3db2a3be64ff20c",
    metadataPath: "/opt/data/generated-images/metadata/2026/08/20260816-194120_fredrun-finanzamt-night-caseworker-corridor_gpt-image-2_openai-codex_115d8fd6.json",
    crop: { left: 0, top: 320, width: 1672, height: 512 },
  },
];

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function assertMetadata(asset, metadata, raw, rawMetadata) {
  const rawHash = sha256(raw);
  if (rawHash !== asset.rawSha256 || metadata.sha256 !== asset.rawSha256) {
    throw new Error(`Unexpected raw hash for ${asset.rawFile}`);
  }
  if (
    metadata.width !== rawMetadata.width
    || metadata.height !== rawMetadata.height
    || metadata.bytes !== raw.length
  ) {
    throw new Error(`Archive metadata does not match ${asset.rawFile}`);
  }
  if (!Array.isArray(metadata.tags) || !["findog", "fredrun", "finanzamt-night"].every(
    (tag) => metadata.tags.includes(tag),
  )) {
    throw new Error(`Archive metadata tags are incomplete for ${asset.rawFile}`);
  }
  if (
    asset.crop.left < 0
    || asset.crop.top < 0
    || asset.crop.left + asset.crop.width > rawMetadata.width
    || asset.crop.top + asset.crop.height > rawMetadata.height
  ) {
    throw new Error(`Crop is outside the source bounds for ${asset.rawFile}`);
  }
}

async function makeContactSheet(outputPaths) {
  const padding = 16;
  const gap = 16;
  const labelHeight = 34;
  const thumbnailWidth = 900;
  const thumbnailHeight = Math.round(thumbnailWidth * OUTPUT_HEIGHT / OUTPUT_WIDTH);
  const panelHeight = labelHeight + thumbnailHeight;
  const sheetWidth = padding * 2 + thumbnailWidth * 2 + gap;
  const sheetHeight = padding * 2 + panelHeight * 2 + gap;
  const composites = [];

  for (const [index, outputPath] of outputPaths.entries()) {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const left = padding + column * (thumbnailWidth + gap);
    const top = padding + row * (panelHeight + gap);
    const label = await sharp({
      text: {
        text: `<span foreground="#ffffff" weight="bold" size="24576">${index + 1}</span>`,
        rgba: true,
        width: thumbnailWidth,
        height: labelHeight,
        align: "left",
      },
    }).png().toBuffer();
    const thumbnail = await sharp(outputPath)
      .resize(thumbnailWidth, thumbnailHeight, { fit: "fill", kernel: sharp.kernel.lanczos3 })
      .png()
      .toBuffer();
    composites.push({ input: label, left: left + 8, top });
    composites.push({ input: thumbnail, left, top: top + labelHeight });
  }

  await sharp({
    create: {
      width: sheetWidth,
      height: sheetHeight,
      channels: 3,
      background: "#071723",
    },
  }).composite(composites).png({ compressionLevel: 9 }).toFile(CONTACT_SHEET_PATH);
}

async function main() {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const stages = [];
  const outputPaths = [];

  for (const asset of sourceAssets) {
    const rawPath = path.join(RAW_DIRECTORY, asset.rawFile);
    const raw = await readFile(rawPath);
    const rawMetadata = await sharp(raw).metadata();
    const metadata = JSON.parse(await readFile(asset.metadataPath, "utf8"));
    assertMetadata(asset, metadata, raw, rawMetadata);

    await Promise.all([
      access(metadata.archive_path),
      access(metadata.prompt_path),
    ]);
    const archivedRaw = await readFile(metadata.archive_path);
    if (sha256(archivedRaw) !== asset.rawSha256) {
      throw new Error(`Archived image differs from ${asset.rawFile}`);
    }

    const outputFile = `${asset.id}.webp`;
    const outputPath = path.join(OUTPUT_DIRECTORY, outputFile);
    await sharp(raw)
      .extract(asset.crop)
      .resize(OUTPUT_WIDTH, OUTPUT_HEIGHT, { fit: "fill", kernel: sharp.kernel.lanczos3 })
      .webp({ quality: OUTPUT_QUALITY, effort: 6, smartSubsample: true })
      .toFile(outputPath);

    const output = await readFile(outputPath);
    const outputMetadata = await sharp(output).metadata();
    const outputStat = await stat(outputPath);
    outputPaths.push(outputPath);
    stages.push({
      id: asset.id,
      title: asset.title,
      anchorScore: asset.anchorScore,
      prompt: metadata.prompt,
      provenance: {
        provider: metadata.provider,
        model: metadata.model,
        createdAt: metadata.created_at,
        rawPath,
        archivePath: metadata.archive_path,
        archiveMetadataPath: metadata.metadata_path,
        archivePromptPath: metadata.prompt_path,
      },
      raw: {
        file: asset.rawFile,
        format: rawMetadata.format,
        width: rawMetadata.width,
        height: rawMetadata.height,
        bytes: raw.length,
        sha256: asset.rawSha256,
      },
      processing: {
        crop: asset.crop,
        resize: { width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT, kernel: "lanczos3" },
      },
      output: {
        file: outputFile,
        runtimePath: `/fredrun/levels/finanzamt-night/backgrounds/${outputFile}`,
        format: outputMetadata.format,
        width: outputMetadata.width,
        height: outputMetadata.height,
        bytes: outputStat.size,
        sha256: sha256(output),
      },
    });
  }

  const manifest = {
    schemaVersion: 1,
    worldId: "finanzamt-night",
    displayName: "Finanzamt bei Nacht",
    generation: {
      route: "OpenAI Codex built-in image_gen",
      rawDirectory: RAW_DIRECTORY,
      tags: ["findog", "fredrun", "finanzamt-night"],
      sound: {
        included: false,
        decision: "No sound was generated or added; this world uses the existing Fredrun audio behavior.",
      },
    },
    runtime: {
      format: "webp",
      width: OUTPUT_WIDTH,
      height: OUTPUT_HEIGHT,
      quality: OUTPUT_QUALITY,
      scoreAnchors: sourceAssets.map(({ anchorScore }) => anchorScore),
      transition: "hard stage selection at each score anchor",
      finalState: "hold caseworker-corridor from 1500 points onward",
      loop: "alternating mirrored horizontal tiles",
      fallbackSource: "/fredrun/vienna-panorama.webp",
      processing: {
        script: "scripts/prepare-fredrun-finanzamt-backgrounds.mjs",
        method: "lane-aware integer crop, exact resize with Lanczos 3, then WebP encoding",
        sharpVersion: sharp.versions.sharp,
        libvipsVersion: sharp.versions.vips,
      },
    },
    stages,
  };

  await writeFile(
    path.join(OUTPUT_DIRECTORY, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  await makeContactSheet(outputPaths);
}

await main();
