import { describe, expect, it } from "vitest";

import {
  applyWoBeschlussHit,
  createWoBeschlussState,
  woBeschlussDamageStageForHits,
} from "@/lib/wo-beschluss";

describe("Wo Beschluss game state", () => {
  it("reaches K. o. after exactly 25 hits and ignores later hits", () => {
    let state = createWoBeschlussState();
    for (let hit = 0; hit < 25; hit += 1) state = applyWoBeschlussHit(state);

    expect(state).toEqual({ health: 0, hits: 25, condition: "down", finished: true });
    expect(applyWoBeschlussHit(state)).toBe(state);
  });

  it("maps hits to the eight supplied damage stages", () => {
    expect([0, 1, 4, 7, 10, 13, 17, 21].map(woBeschlussDamageStageForHits)).toEqual(
      [0, 1, 2, 3, 4, 5, 6, 7],
    );
  });
});
