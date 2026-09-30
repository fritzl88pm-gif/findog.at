import { describe, expect, it } from "vitest";
import { deathLabel } from "./death-names";
import { createPatternCtx } from "./patterns";
import { Rng } from "./rng";
import type { EntSpec } from "./types";
import { WORLDS } from "./worlds";

describe("Todesursachen-Namen", () => {
  it("benennt bekannte Gefahren", () => {
    expect(deathLabel("tram")).toBe("Straßenbahn");
    expect(deathLabel("beam-fence")).toBe("Laserzaun");
    expect(deathLabel("rockfall")).toBe("Steinschlag");
    expect(deathLabel("unbekannt-xyz")).toBe("");
  });

  it("jede Gefahr jeder Welt hat einen lesbaren Namen", () => {
    const missing: string[] = [];
    for (const w of Object.values(WORLDS)) {
      const seen = new Set<string>();
      for (const p of w.patterns) {
        for (const diff of [0.5, 3, 8]) {
          const specs: EntSpec[] = [];
          const ctx = createPatternCtx({ speed: 700, diff, groundY: w.groundY ?? 590, ceilY: w.ceilY ?? 150, rng: new Rng(3), worldId: w.id, defaultSkin: (k) => k }, specs);
          try {
            p.build(ctx);
          } catch {
            continue;
          }
          for (const s of specs) {
            if (s.harmful || s.kind === "zone" || s.kind === "walker" || s.kind === "flyer" || s.kind === "projectile") seen.add(s.skin);
          }
        }
      }
      for (const skin of seen) if (!deathLabel(skin) && !["portal", "gateway"].includes(skin)) missing.push(`${w.id}:${skin}`);
    }
    expect(missing).toEqual([]);
  });
});
