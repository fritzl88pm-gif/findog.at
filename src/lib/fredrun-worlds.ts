export const FREDRUN_FINANZAMT_NIGHT_PRICE = 500;

export const FREDRUN_WORLD_IDS = ["vienna", "finanzamt-night"] as const;

export type FredRunWorldId = (typeof FREDRUN_WORLD_IDS)[number];

export type FredRunWorldBackgroundStage = {
  source: string;
  anchorScore: number;
};

export type FredRunWorldDefinition = {
  name: string;
  description: string;
  price: number;
  playKicker: string;
  playDescription: string;
  backgrounds: {
    stages: readonly FredRunWorldBackgroundStage[];
    fallbackSource: string;
    crossfadeScoreDuration: number | null;
    renderStyle: "vienna-disaster" | "night-office";
  };
};

export const FREDRUN_WORLDS = {
  vienna: {
    name: "Wien",
    description: "Vom Stephansdom durch ein Wien im Ausnahmezustand.",
    price: 0,
    playKicker: "Bereit für Wien?",
    playDescription: "Weiche Hindernissen aus, sammle Münzen und halte dem steigenden Tempo so lange wie möglich stand.",
    backgrounds: {
      stages: [
        { source: "/fredrun/backgrounds/vienna-ominous.webp", anchorScore: 0 },
        { source: "/fredrun/backgrounds/vienna-gathering-storm.webp", anchorScore: 500 },
        { source: "/fredrun/backgrounds/vienna-storm-damage.webp", anchorScore: 1_000 },
        { source: "/fredrun/backgrounds/vienna-heavy-smoke-emergency.webp", anchorScore: 1_500 },
        { source: "/fredrun/backgrounds/vienna-burning-collapse.webp", anchorScore: 2_000 },
        { source: "/fredrun/backgrounds/vienna-widespread-fire-collapse.webp", anchorScore: 2_500 },
        { source: "/fredrun/backgrounds/vienna-rubble-ashes.webp", anchorScore: 3_000 },
        { source: "/fredrun/backgrounds/vienna-cold-ash-aftermath.webp", anchorScore: 3_500 },
      ],
      fallbackSource: "/fredrun/vienna-panorama.webp",
      crossfadeScoreDuration: 40,
      renderStyle: "vienna-disaster",
    },
  },
  "finanzamt-night": {
    name: "Finanzamt bei Nacht",
    description: "Durch leere Büros, Aktenflure und das nächtliche Archiv.",
    price: FREDRUN_FINANZAMT_NIGHT_PRICE,
    playKicker: "Bereit fürs Finanzamt bei Nacht?",
    playDescription: "Lauf durch das stille Amt, sammle Münzen und bleib zwischen Akten und Schreibtischen in Bewegung.",
    backgrounds: {
      stages: [
        { source: "/fredrun/levels/finanzamt-night/backgrounds/close-caseworker-office.webp", anchorScore: 0 },
        { source: "/fredrun/levels/finanzamt-night/backgrounds/close-records-room.webp", anchorScore: 500 },
        { source: "/fredrun/levels/finanzamt-night/backgrounds/close-glass-offices.webp", anchorScore: 1_000 },
        { source: "/fredrun/levels/finanzamt-night/backgrounds/close-archive.webp", anchorScore: 1_500 },
      ],
      fallbackSource: "/fredrun/levels/finanzamt-night/backgrounds/close-office.webp",
      crossfadeScoreDuration: 40,
      renderStyle: "night-office",
    },
  },
} as const satisfies Record<FredRunWorldId, FredRunWorldDefinition>;

export type FredRunWorldBackgroundSelection = {
  fromStage: number;
  toStage: number;
  blend: number;
};

export type FredRunWorldBackgrounds<T> = Record<FredRunWorldId, T[]>;

export async function loadFredRunWorldBackgrounds<T>(
  load: (source: string) => Promise<T>,
): Promise<FredRunWorldBackgrounds<T>> {
  const entries = await Promise.all(FREDRUN_WORLD_IDS.map(async (worldId) => {
    const definition = FREDRUN_WORLDS[worldId].backgrounds;
    let fallback: Promise<T> | null = null;
    const stages = await Promise.all(definition.stages.map(async ({ source }) => {
      try {
        return await load(source);
      } catch {
        fallback ??= load(definition.fallbackSource);
        return fallback;
      }
    }));
    return [worldId, stages] as const;
  }));

  return Object.fromEntries(entries) as FredRunWorldBackgrounds<T>;
}

function smoothstep(value: number): number {
  const normalized = Math.min(1, Math.max(0, value));
  return normalized * normalized * (3 - 2 * normalized);
}

export function fredRunWorldBackgroundForScore(
  worldId: FredRunWorldId,
  score: number,
): FredRunWorldBackgroundSelection {
  const background = FREDRUN_WORLDS[worldId].backgrounds;
  const normalizedScore = Number.isFinite(score) ? Math.max(0, score) : 0;
  let fromStage = 0;
  for (let index = 1; index < background.stages.length; index += 1) {
    if (normalizedScore < background.stages[index].anchorScore) break;
    fromStage = index;
  }

  const toStage = Math.min(background.stages.length - 1, fromStage + 1);
  if (background.crossfadeScoreDuration === null || fromStage === toStage) {
    return { fromStage, toStage: fromStage, blend: 0 };
  }

  const currentAnchor = background.stages[fromStage].anchorScore;
  const nextAnchor = background.stages[toStage].anchorScore;
  const scoreSpan = nextAnchor - currentAnchor;
  const segmentProgress = normalizedScore / scoreSpan - currentAnchor / scoreSpan;
  const crossfadeFraction = background.crossfadeScoreDuration / scoreSpan;
  return {
    fromStage,
    toStage,
    blend: smoothstep((segmentProgress - (1 - crossfadeFraction)) / crossfadeFraction),
  };
}

export function fredRunFluorescentFlicker(
  worldId: FredRunWorldId,
  elapsed: number,
  reducedMotion: boolean,
): number {
  if (
    reducedMotion
    || FREDRUN_WORLDS[worldId].backgrounds.renderStyle !== "night-office"
  ) {
    return 0;
  }

  const time = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  const slowWave = 0.5 + 0.5 * Math.sin(time * 0.83 + Math.sin(time * 0.17) * 0.9);
  const secondaryWave = 0.5 + 0.5 * Math.sin(time * 1.97 + 1.1);
  return 0.008 + 0.034 * (slowWave * 0.78 + secondaryWave * 0.22);
}
