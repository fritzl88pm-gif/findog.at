export type WoBeschlussCondition = "ready" | "shaken" | "dazed" | "critical" | "down";

export type WoBeschlussState = {
  health: number;
  hits: number;
  condition: WoBeschlussCondition;
  finished: boolean;
};

export const WO_BESCHLUSS_MAX_HEALTH = 100;
export const WO_BESCHLUSS_DAMAGE_PER_HIT = 4;
export const WO_BESCHLUSS_DAMAGE_STAGE_THRESHOLDS = [0, 1, 4, 7, 10, 13, 17, 21] as const;

export const WO_BESCHLUSS_ASSETS = {
  reactions: "/wo-beschluss/reaction-sheet.png",
  intermediate: "/wo-beschluss/reaction-intermediate.png",
  reactionsVariantB: "/wo-beschluss/reaction-sheet-variant-b.png",
  intermediateVariantB: "/wo-beschluss/reaction-intermediate-variant-b.png",
  reactionsVariantC: "/wo-beschluss/reaction-sheet-variant-c.png",
  intermediateVariantC: "/wo-beschluss/reaction-intermediate-variant-c.png",
  glove: "/wo-beschluss/boxing-glove-sheet.png",
} as const;

export function createWoBeschlussState(): WoBeschlussState {
  return { health: WO_BESCHLUSS_MAX_HEALTH, hits: 0, condition: "ready", finished: false };
}

export function woBeschlussConditionForHealth(health: number): WoBeschlussCondition {
  if (health <= 0) return "down";
  if (health <= 25) return "critical";
  if (health <= 50) return "dazed";
  if (health <= 75) return "shaken";
  return "ready";
}

export function woBeschlussDamageStageForHits(hits: number): number {
  for (let stage = WO_BESCHLUSS_DAMAGE_STAGE_THRESHOLDS.length - 1; stage >= 0; stage -= 1) {
    if (hits >= WO_BESCHLUSS_DAMAGE_STAGE_THRESHOLDS[stage]) return stage;
  }
  return 0;
}

export function applyWoBeschlussHit(current: WoBeschlussState): WoBeschlussState {
  if (current.finished) return current;

  const health = Math.max(0, current.health - WO_BESCHLUSS_DAMAGE_PER_HIT);
  return {
    health,
    hits: current.hits + 1,
    condition: woBeschlussConditionForHealth(health),
    finished: health === 0,
  };
}
