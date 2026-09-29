import { describe, expect, it } from "vitest";
import { boardKey, defaultProfile, normalizeProfile, purchaseCharacter, recordRun, TOP_LIMIT } from "./profile";

const run = (score: number, coins = 10) => ({ mode: "world" as const, world: "wien" as const, character: "fred" as const, score, meters: score / 2, coins, stomps: 1, nearMisses: 2, seconds: 30 });

describe("Profil", () => {
  it("startet mit freigeschalteten Standardfiguren", () => {
    const p = defaultProfile();
    expect(p.unlocked).toEqual(["fred", "frida"]);
    expect(p.coins).toBe(0);
  });

  it("normalisiert kaputte Daten", () => {
    const p = normalizeProfile({ coins: -5, character: "hacker", unlocked: ["cyberfred", "x"], best: { a: "b", "world:wien": 12.9 }, top: { "world:wien": [{ score: 5 }, { score: "x" }] } });
    expect(p.coins).toBe(0);
    expect(p.character).toBe("fred");
    expect(p.unlocked).toContain("cyberfred");
    expect(p.best["world:wien"]).toBe(12);
    expect(p.top["world:wien"]).toHaveLength(1);
  });

  it("trägt Läufe ein, bucht Münzen und führt Bestenliste", () => {
    let p = defaultProfile();
    let r = recordRun(p, run(500));
    expect(r.isNewBest).toBe(true);
    expect(r.rank).toBe(1);
    p = r.profile;
    expect(p.coins).toBe(10);
    r = recordRun(p, run(300));
    expect(r.isNewBest).toBe(false);
    expect(r.rank).toBe(2);
    expect(r.profile.best[boardKey("world", "wien")]).toBe(500);
    expect(r.profile.lifetime.runs).toBe(2);
  });

  it("Bestenliste ist auf TOP_LIMIT begrenzt", () => {
    let p = defaultProfile();
    for (let i = 1; i <= TOP_LIMIT + 5; i += 1) p = recordRun(p, run(i * 10)).profile;
    expect(p.top[boardKey("world", "wien")]).toHaveLength(TOP_LIMIT);
    expect(p.top[boardKey("world", "wien")][0].score).toBe((TOP_LIMIT + 5) * 10);
  });

  it("Kauf: zu wenig Münzen / genug Münzen / bereits im Besitz", () => {
    const p = defaultProfile();
    expect(purchaseCharacter(p, "superfred").status).toBe("insufficient");
    const rich = { ...p, coins: 1000 };
    const bought = purchaseCharacter(rich, "superfred");
    expect(bought.status).toBe("purchased");
    expect(bought.profile.coins).toBe(600);
    expect(purchaseCharacter(bought.profile, "superfred").status).toBe("owned");
  });
});
