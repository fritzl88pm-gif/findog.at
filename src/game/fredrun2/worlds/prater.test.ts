import { describe, expect, it } from "vitest";
import { WORLDS } from "./index";
import { WORLD_PRATER } from "./prater";
import { auditPatterns, botRuns } from "./shared-b/audit";

describe("Welt Prater", () => {
  it("Metadaten vollständig", () => {
    expect(WORLD_PRATER.stageNames.length).toBe(WORLD_PRATER.stageCount);
    expect(WORLD_PRATER.mechanics.length).toBeLessThanOrEqual(4);
    expect(WORLD_PRATER.patterns.length).toBeGreaterThanOrEqual(18);
    const ids = new Set(WORLD_PRATER.patterns.map((p) => p.id));
    expect(ids.size).toBe(WORLD_PRATER.patterns.length);
  });

  it("alle Muster bauen regelkonform", () => {
    const issues = auditPatterns(WORLD_PRATER, { forbid: ["portal"] });
    if (issues.length) console.log(issues.slice(0, 20));
    expect(issues).toEqual([]);
  });

  it("Bot übersteht zusätzliche Seeds", { timeout: 120_000 }, () => {
    const runs = botRuns(WORLDS, "prater", [
      { seed: 3, meters: 0, secs: 40 },
      { seed: 5, meters: 1200, secs: 35 },
      { seed: 9, meters: 2400, secs: 35 },
      { seed: 13, meters: 4000, secs: 30 },
    ]);
    for (const r of runs) if (r.log.length) console.log("prater", r.seed, r.meters, r.log.join("\n  "));
    for (const r of runs) expect(r.hurts).toBeLessThanOrEqual(2);
  });
});
