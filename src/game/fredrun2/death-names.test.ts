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

  it("Tabelle erwarteter Namen (je Welt mindestens drei Skins)", () => {
    const expected: Record<string, Record<string, string>> = {
      wien: { tram: "Straßenbahn", "tram-roof": "Straßenbahn", bolt: "Blitz", pigeon: "Taube", fiaker: "Fiaker", poller: "Poller", cone: "Leitkegel", bench: "Parkbank", wurstel: "Würstelstand", scaffold: "Baugerüst", rooftile: "Dachziegel", sign: "Schild", beam: "Balken" },
      alpen: { boulder: "Felsbrocken", logs: "Baumstamm", marmot: "Murmeltier", cow: "Kuh", ledge: "Felsvorsprung", ibex: "Steinbock", eagle: "Adler", rockfall: "Steinschlag", rollstone: "Rollstein", snowball: "Schneeball", fence: "Zaun" },
      finanzamt: { "paper-stack": "Aktenstapel", binders: "Ordner", boxes: "Kartons", "hanging-files": "Hängeregister", shredder: "Aktenvernichter", "office-chair": "Bürostuhl", "file-cart": "Aktenwagen", stamp: "Riesenstempel", "laser-low": "Laser", copier: "Kopierer", duct: "Lüftungsrohr", bat: "Fledermaus", "lamp-swing": "Pendelleuchte", "paper-plane": "Papierflieger" },
      prater: { "candy-crate": "Zuckerwatte-Kiste", booth: "Bude", valance: "Buden-Vordach", scooter: "Autoscooter", "swing-chair": "Kettenkarussell", ghost: "Geist", tires: "Reifenstapel", cannonball: "Kanone", ghostgate: "Geisterbahn-Tor" },
      wachau: { crate: "Kiste", crates: "Kiste", wall: "Mauer", water: "Abgrund", branch: "Ast", cask: "Weinfass", bees: "Bienenschwarm", vines: "Weinlaube", cargo: "Fracht" },
      cyber: { "barrier-neon": "Neon-Barriere", "server-rack": "Server-Rack", drone: "Drohne", "beam-fence": "Laserzaun", "laser-floor": "Laser", "phase-cyan": "Phasen-Tor", "glitch-cube": "Glitch-Würfel", plasma: "Plasma" },
      winter: { snowman: "Schneemann", sugarcane: "Zuckerstange", "xmas-tree": "Weihnachtsbaum", gingerbread: "Lebkuchenmann", iceblock: "Eisblock", icicles: "Eiszapfen", stall: "Marktstand", elf: "Elf", sled: "Schlitten", presents: "Geschenke-Stapel", krampus: "Krampus", chains: "Glockenkette" },
      oper: { bouquet: "Blumenstrauß", velvetrope: "Samtseil", drape: "Samtvorhang", piano: "Flügel", waiter: "Kellner", champagne: "Champagnerturm", cakecart: "Tortenwagen", dancers: "Tanzpaar", chandelier: "Kronleuchter", cork: "Korken", bottle: "Champagnerflasche", spot: "Scheinwerfer", harp: "Harfe" },
    };
    const wrong: string[] = [];
    for (const [world, skins] of Object.entries(expected)) {
      expect(Object.keys(skins).length).toBeGreaterThanOrEqual(3);
      for (const [skin, name] of Object.entries(skins)) if (deathLabel(skin) !== name) wrong.push(`${world}:${skin} -> "${deathLabel(skin)}" statt "${name}"`);
    }
    expect(wrong).toEqual([]);
  });

  it("Kettenkarussell und Bürostuhl werden nicht mehr verwechselt (feel-core-14)", () => {
    expect(deathLabel("swing-chair")).toBe("Kettenkarussell");
    expect(deathLabel("office-chair")).toBe("Bürostuhl");
    expect(deathLabel("OFFICE-CHAIR")).toBe("Bürostuhl");
    expect(deathLabel("chair")).toBe("Bürostuhl");
    expect(deathLabel("buerostuhl")).toBe("Bürostuhl");
  });

  it("Lauf-Abbruch aus der Pause hat ein Fallback-Label", () => {
    expect(deathLabel("quit")).toBe("Lauf beendet");
    expect(deathLabel("Quit")).toBe("Lauf beendet");
    // nur der exakte Wert, kein Teilwort-Treffer
    expect(deathLabel("quitter-xyz")).toBe("");
    expect(deathLabel("")).toBe("");
    expect(deathLabel(null)).toBe("");
    expect(deathLabel(undefined)).toBe("");
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
