import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const OUTPUT_DIRECTORY = path.resolve("public/fredrun/levels/alps/backgrounds");
const OUTPUT_WIDTH = 2172;
const OUTPUT_HEIGHT = 665;
const OUTPUT_QUALITY = 82;

const inputFiles = [
  {
    name: "meadow",
    inputPath: path.resolve("C:/Users/conta/.gemini/antigravity-ide/brain/08b713b9-ed24-4ff2-b8ef-97ce83480414/alps_journey_stage1_1787083359010.jpg"),
    anchorScore: 0,
    label: "1. Tal & Almwiese",
  },
  {
    name: "lake",
    inputPath: path.resolve("C:/Users/conta/.gemini/antigravity-ide/brain/08b713b9-ed24-4ff2-b8ef-97ce83480414/alps_journey_stage2_1787083384092.jpg"),
    anchorScore: 500,
    label: "2. Zirbenwald & Bergsee",
  },
  {
    name: "peaks",
    inputPath: path.resolve("C:/Users/conta/.gemini/antigravity-ide/brain/08b713b9-ed24-4ff2-b8ef-97ce83480414/alps_journey_stage3_1787083413016.jpg"),
    anchorScore: 1000,
    label: "3. Hochalm & Felsregion",
  },
  {
    name: "plateau",
    inputPath: path.resolve("C:/Users/conta/.gemini/antigravity-ide/brain/08b713b9-ed24-4ff2-b8ef-97ce83480414/alps_journey_stage4_1787083444354.jpg"),
    anchorScore: 1500,
    label: "4. Gipfelgrat & Gipfelkreuz",
  },
];

async function main() {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });

  const manifestStages = [];

  for (const item of inputFiles) {
    const outputPath = path.join(OUTPUT_DIRECTORY, `${item.name}.webp`);
    await sharp(item.inputPath)
      .resize(OUTPUT_WIDTH, OUTPUT_HEIGHT, {
        fit: "cover",
        position: "center",
        kernel: sharp.kernel.lanczos3,
      })
      .webp({ quality: OUTPUT_QUALITY, effort: 6 })
      .toFile(outputPath);

    console.log(`Exported ${outputPath}`);
    manifestStages.push({
      id: item.name,
      source: `/fredrun/levels/alps/backgrounds/${item.name}.webp`,
      anchorScore: item.anchorScore,
      label: item.label,
    });
  }

  // Fallback panorama
  const fallbackPath = path.join(OUTPUT_DIRECTORY, "fallback.webp");
  await sharp(inputFiles[0].inputPath)
    .resize(OUTPUT_WIDTH, OUTPUT_HEIGHT, {
      fit: "cover",
      position: "center",
      kernel: sharp.kernel.lanczos3,
    })
    .webp({ quality: OUTPUT_QUALITY, effort: 6 })
    .toFile(fallbackPath);

  const manifest = {
    worldId: "alps",
    name: "Alpenpanorama",
    theme: "Austrian Alps Hiking Ascent",
    dimensions: { width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT },
    stages: manifestStages,
    fallback: "/fredrun/levels/alps/backgrounds/fallback.webp",
  };

  await writeFile(
    path.join(OUTPUT_DIRECTORY, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );
  console.log("Wrote manifest.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
