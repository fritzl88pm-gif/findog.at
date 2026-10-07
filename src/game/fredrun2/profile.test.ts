import { describe, expect, it } from "vitest";
import { boardKey, defaultProfile, loadProfile, normalizeProfile, PROFILE_BACKUP_KEY, PROFILE_KEY, purchaseCharacter, recordRun, saveProfile, SCORE_EPOCH, TOP_LIMIT } from "./profile";

/** Minimaler Storage-Ersatz (Map); optional mit werfendem setItem/getItem */
function mockStore(init: Record<string, string> = {}, opts: { throwSet?: boolean; throwGet?: boolean } = {}) {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItem(k: string): string | null {
      if (opts.throwGet) throw new Error("gesperrt");
      return m.has(k) ? (m.get(k) as string) : null;
    },
    setItem(k: string, v: string): void {
      if (opts.throwSet) throw new DOMException("voll", "QuotaExceededError");
      m.set(k, v);
    },
  };
}

const run = (score: number, coins = 10) => ({ mode: "world" as const, world: "wien" as const, character: "fred" as const, score, meters: score / 2, coins, stomps: 1, nearMisses: 2, seconds: 30 });

describe("Profil", () => {
  it("startet mit freigeschalteten Standardfiguren", () => {
    const p = defaultProfile();
    expect(p.unlocked).toEqual(["fred", "frida"]);
    expect(p.coins).toBe(0);
  });

  it("normalisiert kaputte Daten", () => {
    const p = normalizeProfile({ coins: -5, character: "hacker", unlocked: ["cyberfred", "x"], scoreEpoch: SCORE_EPOCH, best: { a: "b", "world:wien": 12.9 }, top: { "world:wien": [{ score: 5 }, { score: "x" }] } });
    expect(p.coins).toBe(0);
    expect(p.character).toBe("fred");
    expect(p.unlocked).toContain("cyberfred");
    expect(p.best["world:wien"]).toBe(12);
    expect(p.top["world:wien"]).toHaveLength(1);
  });

  it("setzt alte lokale Bestenlisten zurück, behält aber Münzen und Helden", () => {
    const old = { coins: 500, unlocked: ["cyberfred"], best: { "world:wien": 9000 }, top: { "world:wien": [{ name: "Alt", score: 9000, meters: 400, character: "fred", date: "" }] } };
    const p = normalizeProfile(old);
    expect(p.best).toEqual({});
    expect(p.top).toEqual({});
    expect(p.coins).toBe(500);
    expect(p.unlocked).toContain("cyberfred");
    expect(p.scoreEpoch).toBe(SCORE_EPOCH);
    // nach dem Zurücksetzen bleiben neue Bestwerte erhalten
    const again = normalizeProfile(JSON.parse(JSON.stringify(recordRun(p, run(300)).profile)));
    expect(again.best["world:wien"]).toBe(300);
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

  it("neue Einstellungen: Standardwerte bei Altprofilen ohne die Felder", () => {
    const old = { settings: { master: 0.5, music: 0.4, sfx: 0.3, muted: true, reducedMotion: true, quality: "high", showFps: true, hints: false } };
    const s = normalizeProfile(old).settings;
    expect(s).toMatchObject({ quickRestart: true, haptics: true, shake: 1, flashes: 1, jumpAssist: false, cues: true });
    // bisherige Felder unverändert übernommen
    expect(s).toMatchObject({ master: 0.5, music: 0.4, sfx: 0.3, muted: true, reducedMotion: true, quality: "high", showFps: true, hints: false });
    expect(defaultProfile().settings).toMatchObject({ quickRestart: true, haptics: true, shake: 1, flashes: 1, jumpAssist: false, cues: true });
    expect(normalizeProfile(null).settings.shake).toBe(1);
    expect(normalizeProfile({}).settings.cues).toBe(true);
  });

  it("neue Einstellungen: Regler werden geklemmt, Nicht-Zahlen fallen auf den Standard", () => {
    const n = (settings: Record<string, unknown>) => normalizeProfile({ settings }).settings;
    expect(n({ shake: 7 }).shake).toBe(1);
    expect(n({ shake: -1 }).shake).toBe(0);
    expect(n({ shake: "x" }).shake).toBe(1);
    expect(n({ shake: NaN }).shake).toBe(1);
    expect(n({ shake: null }).shake).toBe(1);
    expect(n({ shake: 0.4 }).shake).toBe(0.4);
    expect(n({ flashes: 3 }).flashes).toBe(1);
    expect(n({ flashes: -0.2 }).flashes).toBe(0);
    expect(n({ flashes: "0.3" }).flashes).toBe(1);
    expect(n({ flashes: 0.3 }).flashes).toBe(0.3);
    expect(n({ flashes: 0 }).flashes).toBe(0);
  });

  it("neue Einstellungen: Booleans (Standard true per !== false, jumpAssist per === true)", () => {
    const n = (settings: Record<string, unknown>) => normalizeProfile({ settings }).settings;
    expect(n({ quickRestart: false }).quickRestart).toBe(false);
    expect(n({ quickRestart: "nein" }).quickRestart).toBe(true);
    expect(n({ haptics: false }).haptics).toBe(false);
    expect(n({ cues: false }).cues).toBe(false);
    expect(n({ cues: 0 }).cues).toBe(true);
    expect(n({ jumpAssist: true }).jumpAssist).toBe(true);
    expect(n({ jumpAssist: "true" }).jumpAssist).toBe(false);
    expect(n({ jumpAssist: 1 }).jumpAssist).toBe(false);
  });

  it("Roundtrip save -> load liefert identische Einstellungen", () => {
    const store = mockStore();
    const p = defaultProfile();
    p.settings = { ...p.settings, quickRestart: false, haptics: false, shake: 0.35, flashes: 0.6, jumpAssist: true, cues: false, hints: false };
    expect(saveProfile(p, store)).toBe(true);
    const back = loadProfile(store);
    expect(back.settings).toEqual(p.settings);
    expect(back).toEqual(normalizeProfile(JSON.parse(JSON.stringify(p))));
  });

  it("Profilversion und Bestenlisten-Generation bleiben unverändert", () => {
    const p = defaultProfile();
    expect(p.version).toBe(1);
    expect(p.scoreEpoch).toBe(SCORE_EPOCH);
    expect(SCORE_EPOCH).toBe(2);
    expect(PROFILE_KEY).toBe("findog.fredrun2.profile.v1");
  });
});

describe("Profil-Speicher", () => {
  it("saveProfile: false bei fehlendem, werfendem oder vollem Speicher, wirft nie", () => {
    const p = defaultProfile();
    expect(saveProfile(p, null)).toBe(false);
    expect(saveProfile(p, mockStore({}, { throwSet: true }))).toBe(false);
    // setItem wirft einen Nicht-Error-Wert (manche Browser/In-App-Webviews)
    const odd = { getItem: () => null, setItem: () => { throw "kaputt"; } };
    expect(() => saveProfile(p, odd)).not.toThrow();
    expect(saveProfile(p, odd)).toBe(false);
    // zyklische Struktur lässt JSON.stringify scheitern
    const cyc = defaultProfile() as unknown as Record<string, unknown>;
    cyc.self = cyc;
    expect(saveProfile(cyc as unknown as ReturnType<typeof defaultProfile>, mockStore())).toBe(false);
    expect(saveProfile(p, mockStore())).toBe(true);
  });

  it("loadProfile: kaputtes JSON gibt das Standardprofil zurück und legt ein .bak an", () => {
    const store = mockStore({ [PROFILE_KEY]: "{kaputt" });
    const p = loadProfile(store);
    expect(p).toEqual(defaultProfile());
    expect(store.m.get(PROFILE_BACKUP_KEY)).toBe("{kaputt");
    expect(PROFILE_BACKUP_KEY).toBe(`${PROFILE_KEY}.bak`);
  });

  it("loadProfile: intaktes Profil legt kein .bak an, ebenso fehlende Daten", () => {
    const good = defaultProfile();
    good.coins = 42;
    const store = mockStore({ [PROFILE_KEY]: JSON.stringify(good) });
    expect(loadProfile(store).coins).toBe(42);
    expect(store.m.has(PROFILE_BACKUP_KEY)).toBe(false);
    const empty = mockStore();
    expect(loadProfile(empty)).toEqual(defaultProfile());
    expect(empty.m.has(PROFILE_BACKUP_KEY)).toBe(false);
  });

  it("loadProfile: ein zweites kaputtes JSON überschreibt ein vorhandenes .bak nicht", () => {
    const store = mockStore({ [PROFILE_KEY]: "{erste Kaputtheit" });
    loadProfile(store);
    expect(store.m.get(PROFILE_BACKUP_KEY)).toBe("{erste Kaputtheit");
    store.m.set(PROFILE_KEY, "{zweite Kaputtheit");
    expect(loadProfile(store)).toEqual(defaultProfile());
    expect(store.m.get(PROFILE_BACKUP_KEY)).toBe("{erste Kaputtheit");
  });

  it("loadProfile: werfender Speicher (Lesen oder Backup) wirft nie", () => {
    expect(loadProfile(mockStore({ [PROFILE_KEY]: "{x" }, { throwGet: true }))).toEqual(defaultProfile());
    // Lesen klappt, Backup-Schreiben scheitert (Quota)
    const m = new Map<string, string>([[PROFILE_KEY, "{x"]]);
    const quota = {
      getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
      setItem: () => {
        throw new DOMException("voll", "QuotaExceededError");
      },
    };
    expect(() => loadProfile(quota)).not.toThrow();
    expect(loadProfile(quota)).toEqual(defaultProfile());
    expect(loadProfile(null)).toEqual(defaultProfile());
  });
});
