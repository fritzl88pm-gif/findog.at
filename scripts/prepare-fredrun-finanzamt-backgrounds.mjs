import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const RAW_DIRECTORY = path.resolve(
  process.argv[2] ?? "/opt/data/tmp/fredrun-finanzamt-multi-scene",
);
const OUTPUT_DIRECTORY = path.resolve(
  "public/fredrun/levels/finanzamt-night/backgrounds",
);
const CONTACT_SHEET_PATH = path.join(RAW_DIRECTORY, "all-scenes-contact-sheet.png");
const OUTPUT_WIDTH = 2172;
const OUTPUT_HEIGHT = 665;
const OUTPUT_QUALITY = 84;

const sourceAssets = [
  {
    id: "close-caseworker-office",
    title: "Close caseworker office",
    anchorScore: 0,
    rawFile: "close-caseworker-office-raw.png",
    rawSha256: "c0823fc34d9b90bf9cd4febbb0a6586e29605e038d89fbc28596579545952f9a",
    metadataPath: "/opt/data/generated-images/metadata/2026/08/20260816-204046_fredrun-finanzamt-night-close-office_codex-built-in-image-gen-model-i_openai-codex_c0823fc3.json",
    sceneTag: "close-office",
    removeSourcePlaque: true,
  },
  {
    id: "close-records-room",
    title: "Close records workroom",
    anchorScore: 500,
    rawFile: "close-records-room-raw.png",
    rawSha256: "bce050e9a7b2b141d986aac4f448a8fb8602572186c830c4c65414e7a2c885a5",
    metadataPath: "/opt/data/generated-images/metadata/2026/08/20260816-231214_fredrun-finanzamt-night-close-records-room_codex-built-in-image-gen-model-i_openai-codex_bce050e9.json",
    sceneTag: "close-records-room",
    removeSourcePlaque: false,
  },
  {
    id: "close-glass-offices",
    title: "Close glass-partitioned offices",
    anchorScore: 1_000,
    rawFile: "close-glass-offices-raw.png",
    rawSha256: "3f9ec23364a5d6c3f6c3fd5b665a7ae0e6561c6d0d7b7dc911c3730463d3ca88",
    metadataPath: "/opt/data/generated-images/metadata/2026/08/20260816-231214_fredrun-finanzamt-night-close-glass-offices_codex-built-in-image-gen-model-i_openai-codex_3f9ec233.json",
    sceneTag: "close-glass-offices",
    removeSourcePlaque: false,
  },
  {
    id: "close-archive",
    title: "Close archive basement workroom",
    anchorScore: 1_500,
    rawFile: "close-archive-raw.png",
    rawSha256: "4f263535fb15ea8db5cfc20ebc9a552c7fa07efa894d72df897485626e2d664e",
    metadataPath: "/opt/data/generated-images/metadata/2026/08/20260816-231215_fredrun-finanzamt-night-close-archive_codex-built-in-image-gen-model-i_openai-codex_4f263535.json",
    sceneTag: "close-archive",
    removeSourcePlaque: false,
  },
];

const legacyOutputFiles = [
  "close-office.webp",
  "records-corridor.webp",
  "open-plan-office.webp",
  "archive-basement.webp",
  "caseworker-corridor.webp",
];

const overlayDescriptions = [
  'professional wall sign: exact text "Finanzamt Österreich"',
  'binder spine: exact text "BAO"',
  'calendar note: exact text "31.12."',
  'coffee mug: exact mark "§"',
  "small Fred-blue dog silhouette sticker",
];

const sourceWallSignBounds = { left: 34, top: 176, width: 120, height: 68 };
const wallSignPatch = { id: "wall-sign", left: 300, top: 176, width: 120, height: 68 };
const mirroredTextPatches = [
  wallSignPatch,
  { id: "calendar-note", left: 1160, top: 262, width: 53, height: 42 },
  { id: "binder-spine", left: 1267, top: 326, width: 63, height: 18 },
  { id: "coffee-mug", left: 612, top: 326, width: 36, height: 29 },
];

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function assertMetadata(sourceAsset, metadata, raw, rawMetadata, archivedRaw, archivedPrompt) {
  const rawHash = sha256(raw);
  if (
    rawHash !== sourceAsset.rawSha256
    || metadata.sha256 !== sourceAsset.rawSha256
    || sha256(archivedRaw) !== sourceAsset.rawSha256
  ) {
    throw new Error(`Unexpected source or archive hash for ${sourceAsset.rawFile}`);
  }
  if (
    metadata.width !== rawMetadata.width
    || metadata.height !== rawMetadata.height
    || metadata.bytes !== raw.length
  ) {
    throw new Error(`Archive metadata does not match ${sourceAsset.rawFile}`);
  }
  if (archivedPrompt.trim() !== metadata.prompt.trim()) {
    throw new Error(`Archived prompt differs for ${sourceAsset.rawFile}`);
  }
  if (!Array.isArray(metadata.tags) || ![
    "findog",
    "fredrun",
    "finanzamt-night",
    "close-office",
    sourceAsset.sceneTag,
  ].every((tag) => metadata.tags.includes(tag))) {
    throw new Error(`Archive metadata tags are incomplete for ${sourceAsset.rawFile}`);
  }
}

function exactScenicOverlay() {
  const signCenterX = wallSignPatch.left + wallSignPatch.width / 2;
  return Buffer.from(`
    <svg width="${OUTPUT_WIDTH}" height="${OUTPUT_HEIGHT}" viewBox="0 0 ${OUTPUT_WIDTH} ${OUTPUT_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <g font-family="DejaVu Sans, sans-serif">
        <g aria-label="Finanzamt Österreich">
          <rect x="${wallSignPatch.left}" y="${wallSignPatch.top}" width="${wallSignPatch.width}" height="${wallSignPatch.height}" rx="3" fill="#b6a37e" stroke="#342f29" stroke-width="3"/>
          <rect x="${wallSignPatch.left + 5}" y="${wallSignPatch.top + 5}" width="${wallSignPatch.width - 10}" height="${wallSignPatch.height - 10}" rx="1" fill="#c8b994" stroke="#6e624d" stroke-width="1"/>
          <circle cx="${wallSignPatch.left + 10}" cy="${wallSignPatch.top + 10}" r="2" fill="#453d31"/>
          <circle cx="${wallSignPatch.left + wallSignPatch.width - 10}" cy="${wallSignPatch.top + 10}" r="2" fill="#453d31"/>
          <circle cx="${wallSignPatch.left + 10}" cy="${wallSignPatch.top + wallSignPatch.height - 10}" r="2" fill="#453d31"/>
          <circle cx="${wallSignPatch.left + wallSignPatch.width - 10}" cy="${wallSignPatch.top + wallSignPatch.height - 10}" r="2" fill="#453d31"/>
          <text x="${signCenterX}" y="${wallSignPatch.top + 30}" text-anchor="middle" font-size="15" font-weight="700" fill="#18202a">Finanzamt</text>
          <text x="${signCenterX}" y="${wallSignPatch.top + 50}" text-anchor="middle" font-size="15" font-weight="700" fill="#18202a">Österreich</text>
        </g>
        <g aria-label="31.12.">
          <rect x="1160" y="267" width="53" height="37" rx="2" fill="#d5d0bc" stroke="#3b4148" stroke-width="2"/>
          <rect x="1165" y="262" width="4" height="9" rx="2" fill="#59606a"/>
          <rect x="1204" y="262" width="4" height="9" rx="2" fill="#59606a"/>
          <text x="1186.5" y="291" text-anchor="middle" font-size="14" font-weight="700" fill="#27313a">31.12.</text>
        </g>
        <g aria-label="BAO">
          <rect x="1267" y="326" width="63" height="18" rx="2" fill="#1c2631" stroke="#76808b" stroke-width="1"/>
          <rect x="1281" y="328" width="35" height="14" rx="1" fill="#bbb49d"/>
          <text x="1298.5" y="339" text-anchor="middle" font-size="11" font-weight="700" fill="#1c2631">BAO</text>
        </g>
        <g aria-label="§">
          <rect x="614" y="326" width="23" height="27" rx="6" fill="#d8d5c9" stroke="#2b333b" stroke-width="2"/>
          <path d="M637 333c9 0 9 13 0 13" fill="none" stroke="#d8d5c9" stroke-width="4"/>
          <path d="M637 333c9 0 9 13 0 13" fill="none" stroke="#2b333b" stroke-width="1.5"/>
          <text x="625.5" y="346" text-anchor="middle" font-size="16" font-weight="700" fill="#28313a">§</text>
        </g>
        <g aria-label="Fred blue dog sticker" transform="translate(526 237)">
          <path d="M2 8 6 3l4 4 9-1 4 4-2 10h-4l-1-6H9l-1 6H4L3 12 0 11Z" fill="#3e83cb" stroke="#183d67" stroke-width="1" stroke-linejoin="round"/>
          <circle cx="20" cy="9" r="1.2" fill="#d9edff"/>
        </g>
      </g>
    </svg>
  `);
}

async function makeThreeTilePreview(outputPath, sourceAsset) {
  const tileWidth = 724;
  const tileHeight = Math.round(tileWidth * OUTPUT_HEIGHT / OUTPUT_WIDTH);
  const tile = await sharp(outputPath)
    .resize(tileWidth, tileHeight, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
  const mirroredTile = await sharp(tile).flop().png().toBuffer();
  const scaleX = tileWidth / OUTPUT_WIDTH;
  const scaleY = tileHeight / OUTPUT_HEIGHT;
  const textPatchComposites = await Promise.all(mirroredTextPatches.map(async (patch) => {
    const left = Math.floor(patch.left * scaleX);
    const top = Math.floor(patch.top * scaleY);
    const right = Math.ceil((patch.left + patch.width) * scaleX);
    const bottom = Math.ceil((patch.top + patch.height) * scaleY);
    const width = right - left;
    const height = bottom - top;
    return {
      input: await sharp(tile).extract({ left, top, width, height }).png().toBuffer(),
      left: tileWidth - right,
      top,
    };
  }));
  const correctedMirroredTile = await sharp(mirroredTile)
    .composite(textPatchComposites)
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: tileWidth * 3,
      height: tileHeight,
      channels: 3,
      background: "#071723",
    },
  }).composite([
    { input: tile, left: 0, top: 0 },
    { input: correctedMirroredTile, left: tileWidth, top: 0 },
    { input: tile, left: tileWidth * 2, top: 0 },
  ]).png({ compressionLevel: 9 }).toFile(
    path.join(RAW_DIRECTORY, `${sourceAsset.id}-three-tile-preview.png`),
  );
}

async function makeContactSheet(outputPaths) {
  const tileWidth = Math.floor(OUTPUT_WIDTH / 2);
  const tileHeight = Math.round(tileWidth * OUTPUT_HEIGHT / OUTPUT_WIDTH);
  const tiles = await Promise.all(outputPaths.map((outputPath) => (
    sharp(outputPath)
      .resize(tileWidth, tileHeight, { fit: "fill", kernel: sharp.kernel.lanczos3 })
      .png()
      .toBuffer()
  )));

  await sharp({
    create: {
      width: tileWidth * 2,
      height: tileHeight * 2,
      channels: 3,
      background: "#071723",
    },
  }).composite(tiles.map((input, index) => ({
    input,
    left: index % 2 * tileWidth,
    top: Math.floor(index / 2) * tileHeight,
  }))).png({ compressionLevel: 9 }).toFile(CONTACT_SHEET_PATH);
}

async function main() {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  await Promise.all(legacyOutputFiles.map((file) => (
    rm(path.join(OUTPUT_DIRECTORY, file), { force: true })
  )));
  const stages = [];
  const outputPaths = [];
  for (const sourceAsset of sourceAssets) {
    const rawPath = path.join(RAW_DIRECTORY, sourceAsset.rawFile);
    const raw = await readFile(rawPath);
    const rawMetadata = await sharp(raw).metadata();
    const metadata = JSON.parse(await readFile(sourceAsset.metadataPath, "utf8"));
    await Promise.all([
      access(metadata.archive_path),
      access(metadata.prompt_path),
    ]);
    const [archivedRaw, archivedPrompt] = await Promise.all([
      readFile(metadata.archive_path),
      readFile(metadata.prompt_path, "utf8"),
    ]);
    assertMetadata(sourceAsset, metadata, raw, rawMetadata, archivedRaw, archivedPrompt);

    const outputFile = `${sourceAsset.id}.webp`;
    const outputPath = path.join(OUTPUT_DIRECTORY, outputFile);
    const resizedRaw = await sharp(raw)
      .resize(OUTPUT_WIDTH, OUTPUT_HEIGHT, { fit: "fill", kernel: sharp.kernel.lanczos3 })
      .png()
      .toBuffer();
    const baseFrame = sourceAsset.removeSourcePlaque
      ? await (async () => {
        const cleanWallStrip = await sharp(resizedRaw)
          .extract({
            left: sourceWallSignBounds.left + sourceWallSignBounds.width + 5,
            top: sourceWallSignBounds.top,
            width: 32,
            height: sourceWallSignBounds.height,
          })
          .resize(sourceWallSignBounds.width, sourceWallSignBounds.height, {
            fit: "fill",
            kernel: sharp.kernel.lanczos3,
          })
          .png()
          .toBuffer();
        return sharp(resizedRaw)
          .composite([{
            input: cleanWallStrip,
            left: sourceWallSignBounds.left,
            top: sourceWallSignBounds.top,
          }])
          .png()
          .toBuffer();
      })()
      : resizedRaw;
    await sharp(baseFrame)
      .composite([{ input: exactScenicOverlay(), left: 0, top: 0 }])
      .webp({ quality: OUTPUT_QUALITY, effort: 6, smartSubsample: true })
      .toFile(outputPath);

    const output = await readFile(outputPath);
    const outputMetadata = await sharp(output).metadata();
    const outputStat = await stat(outputPath);
    stages.push({
      id: sourceAsset.id,
      title: sourceAsset.title,
      anchorScore: sourceAsset.anchorScore,
      prompt: metadata.prompt,
      provenance: {
        provider: metadata.provider,
        model: metadata.model,
        createdAt: metadata.created_at,
        rawPath,
        archivePath: metadata.archive_path,
        archiveSha256: sourceAsset.rawSha256,
        archiveMetadataPath: metadata.metadata_path,
        archivePromptPath: metadata.prompt_path,
        archiveTags: metadata.tags,
        sceneTag: sourceAsset.sceneTag,
      },
      raw: {
        file: sourceAsset.rawFile,
        format: rawMetadata.format,
        width: rawMetadata.width,
        height: rawMetadata.height,
        bytes: raw.length,
        sha256: sourceAsset.rawSha256,
      },
      processing: {
        resize: {
          width: OUTPUT_WIDTH,
          height: OUTPUT_HEIGHT,
          fit: "fill",
          kernel: "lanczos3",
        },
        overlays: overlayDescriptions,
        overlayFormat: "deterministic SVG composited by Sharp before WebP encoding",
        exactOverlayPatches: mirroredTextPatches,
        scenicSignRelocation: {
          sourceBounds: sourceAsset.removeSourcePlaque ? sourceWallSignBounds : null,
          outputBounds: wallSignPatch,
          sourceTreatment: sourceAsset.removeSourcePlaque
            ? "replace generated source plaque with adjacent wall texture before adding exact sign"
            : "raw contains no generated readable sign; add exact deterministic sign directly",
        },
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
    outputPaths.push(outputPath);
    await makeThreeTilePreview(outputPath, sourceAsset);
  }

  const compatibilityAliasFile = "close-office.webp";
  const compatibilityAliasPath = path.join(OUTPUT_DIRECTORY, compatibilityAliasFile);
  const compatibilityAlias = await readFile(outputPaths[0]);
  await writeFile(compatibilityAliasPath, compatibilityAlias);

  const manifest = {
    schemaVersion: 1,
    worldId: "finanzamt-night",
    displayName: "Finanzamt bei Nacht",
    generation: {
      route: "OpenAI Codex built-in image_gen",
      rawDirectory: RAW_DIRECTORY,
      tags: ["findog", "fredrun", "finanzamt-night", "close-office"],
      visualAnchor: {
        id: sourceAssets[0].id,
        rawSha256: sourceAssets[0].rawSha256,
        reuse: "accepted close-office source retained unchanged as scene 1 and edit anchor for scenes 2-4",
      },
      method: "scene 1 reuses the accepted raw; scenes 2-4 are full-quality built-in image edits of that anchor",
      sound: {
        included: false,
        decision: "No sound was generated or added; existing Fredrun audio code and assets are unchanged.",
      },
    },
    runtime: {
      format: "webp",
      width: OUTPUT_WIDTH,
      height: OUTPUT_HEIGHT,
      quality: OUTPUT_QUALITY,
      scoreAnchors: sourceAssets.map(({ anchorScore }) => anchorScore),
      crossfadeScoreDuration: 40,
      transition: "smoothstep crossfade over the final 40 score points before each next anchor",
      finalState: "hold close-archive from score 1500 onward",
      loop: "alternating mirrored horizontal tiles with pixel-continuous joins",
      mirroredTextTreatment: {
        method: "redraw unmirrored source patches after each mirrored tile",
        patches: mirroredTextPatches,
      },
      fallbackSource: "/fredrun/levels/finanzamt-night/backgrounds/close-office.webp",
      compatibilityAliases: [{
        runtimePath: `/fredrun/levels/finanzamt-night/backgrounds/${compatibilityAliasFile}`,
        targetStageId: sourceAssets[0].id,
        bytes: compatibilityAlias.length,
        sha256: sha256(compatibilityAlias),
        purpose: "keep already-open clients on the night-office art instead of the Vienna fallback",
      }],
      composition: "four distinct close side-on office workrooms with matched camera geometry and a clear lower running lane",
      effects: {
        fluorescentFlicker: {
          renderer: "deterministic cool-light gradient localized above the running lane",
          opacityRange: [0.008, 0.042],
          reducedMotion: "disabled",
          worldScope: "night-office only; Vienna receives zero overlay opacity",
        },
      },
      processing: {
        script: "scripts/prepare-fredrun-finanzamt-backgrounds.mjs",
        method: "deterministic full-frame exact resize with Lanczos 3, SVG scenic overlays, then WebP encoding",
        overlays: overlayDescriptions,
        sharpVersion: sharp.versions.sharp,
        libvipsVersion: sharp.versions.vips,
      },
    },
    previews: {
      contactSheet: CONTACT_SHEET_PATH,
      threeTileMirrored: sourceAssets.map(({ id }) => (
        path.join(RAW_DIRECTORY, `${id}-three-tile-preview.png`)
      )),
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
