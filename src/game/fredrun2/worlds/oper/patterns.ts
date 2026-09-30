/**
 * Opernball – Level-Muster. Signatur: Dreiertakt („1-2-3“) mit gleichen Zeitabständen, Kronleuchter-Pendel im Walzertakt,
 * Champagner-Korken (Flasche schüttelt → Korken fliegt), Kellner und Tanzpaare zum Stampfen, Flügel-Sprungbrett zu
 * Balkonbahnen, Scheinwerfer-Kegel (Warnung → Blendlicht), Orchestergräben.
 *
 * Alle Abstände sind ZEITEN (`c.t(sec)`); ein Schlag `B` = 0.52 s, ein Takt = 3 Schläge. Jedes Muster ist per Einzelsprung,
 * Doppelsprung und Rutschen lösbar (Dash nie Pflicht); die Flügel-Sprungbretter sind immer optional.
 */
import type { PatternCtx, PatternDef } from "../../types";
import { arriveT, strikePhases } from "../shared-a/pattern-kit";
import { coinSpringArc } from "../shared-b/pat";
import { DIM, SKIN } from "./dims";
import { BEAT } from "./stages";

/** Ein Schlag in Pixeln */
const bt = (c: PatternCtx, n = 1): number => c.t(BEAT * n);

// --- Bausteine ---------------------------------------------------------------------------------------------------------------

function cake(c: PatternCtx, dx: number): number {
  c.block(dx, DIM.cake.w, DIM.cake.h, { skin: SKIN.cake, breakable: true });
  return DIM.cake.w;
}
function tower(c: PatternCtx, dx: number): number {
  c.block(dx, DIM.tower.w, DIM.tower.h, { skin: SKIN.tower, breakable: true });
  return DIM.tower.w;
}
function bouquet(c: PatternCtx, dx: number): number {
  c.block(dx, DIM.bouquet.w, DIM.bouquet.h, { skin: SKIN.bouquet, breakable: true });
  return DIM.bouquet.w;
}
function rope(c: PatternCtx, dx: number, wide = false): number {
  const w = wide ? Math.round(DIM.rope.w * 1.25) : DIM.rope.w;
  c.block(dx, w, wide ? Math.round(DIM.rope.h * 1.25) : DIM.rope.h, { skin: SKIN.rope, breakable: true });
  return w;
}
/** Harfe: höher als ein Einzelsprung → Doppelsprung (oder Dash) nötig; als einziges Hindernis nicht zerbrechlich */
function harp(c: PatternCtx, dx: number): number {
  const { w, h } = DIM.harp;
  c.block(dx, w, h, { skin: SKIN.harp, hb: [w * 0.2, h * 0.05, w * 0.6, h * 0.95] });
  return w;
}
/** Samtvorhang von oben: nur Rutschen kommt durch */
function drape(c: PatternCtx, dx: number, w = 210): number {
  c.overhead(dx, w, DIM.drapeBottom, { skin: SKIN.drape, thick: 640 });
  return w;
}
/** Tief hängender Kronleuchter (starr): Rutschen */
function lowLamp(c: PatternCtx, dx: number): number {
  const w = 136;
  c.overhead(dx, w, DIM.lowLampBottom, { skin: SKIN.lowlamp, thick: 520, hb: [w * 0.12, 0, w * 0.76, 516] });
  return w;
}
/**
 * Pendelnder Kronleuchter an der Decke. Tiefster Punkt: Kugelmitte ≈ 100 px über dem Boden → in der Mitte rutschen,
 * an den Umkehrpunkten (Kugel ≥ 175 px hoch) läuft man aufrecht unten durch.
 */
function chandelier(c: PatternCtx, dx: number, per: number, ph: number, amp = 0.55): number {
  const anchor = 610;
  const len = anchor - 100;
  // Aufhängung in der Mitte des überstrichenen Bereichs → Muster belegt [dx, dx + CHANDELIER_SPAN]
  c.swinger(dx + CHANDELIER_SPAN / 2, anchor, len, { skin: SKIN.swing, amp, per, ph, r: DIM.chandelierR });
  return CHANDELIER_SPAN;
}
/** Breite, die ein pendelnder Kronleuchter (Ausschlag ≤ 0.6 rad) überstreicht */
const CHANDELIER_SPAN = 620;
function waiter(c: PatternCtx, dx: number, vx: number, o: { warn?: boolean } = {}): void {
  c.walker(dx, DIM.waiter.w, DIM.waiter.h, { skin: SKIN.waiter, vx, stompable: true, warn: o.warn });
}
function dancers(c: PatternCtx, dx: number, vx: number): void {
  c.walker(dx, DIM.dancers.w, DIM.dancers.h, { skin: SKIN.dancers, vx, stompable: true });
}

/**
 * Champagnerflasche + Korken. `D` = Musterposition (px), an der Korken und Figur (bei gleichbleibendem Tempo) zusammentreffen.
 * Die Flasche steht ruhig `vx·τF` weiter rechts (zeigt Schütteln/Schaum); der Korken sitzt bis zum Knall (`p.delay`) in ihrem
 * Hals und fliegt dann `flight` Sekunden bis zur Figur. Hoch = Kopfhöhe (rutschen), tief = Fußhöhe (springen).
 * Fair auch ohne exakte Vorhersage.
 */
function corkShot(c: PatternCtx, D: number, high: boolean, flight = 0.85, vxAbs = 330): number {
  const vx = -vxAbs;
  const tA = arriveT(c, D);
  const tF = Math.min(flight, Math.max(0.35, tA - 0.05));
  const tL = tA - tF;
  const xb = D - vx * tF; // Flaschenmitte = Korken-Mitte beim Knall
  const x0 = xb - DIM.cork.w / 2; // Korken sitzt im Flaschenhals und startet erst nach `delay`
  const elev = high ? 76 : 14;
  c.projectile(x0, DIM.cork.w, DIM.cork.h, elev, {
    skin: SKIN.cork,
    vx,
    warn: true,
    hb: [DIM.cork.w * 0.1, DIM.cork.h * 0.12, DIM.cork.w * 0.8, DIM.cork.h * 0.76],
    p: { delay: tL, neck: DIM.bottleNeck },
  });
  c.decor(xb - DIM.bottle.w / 2, DIM.bottle.w, DIM.bottle.h, 0, { skin: SKIN.bottle, p: { popT: tL } });
  return xb + DIM.bottle.w / 2;
}

/** Scheinwerfer-Kegel (Lichtpfütze am Boden): trifft nur im aktiven Fenster; überspringen. */
function spot(c: PatternCtx, dx: number, warn = 0.85, active = 0.5, bias = 0.45): number {
  const w = Math.round(Math.max(150, Math.min(210, c.t(0.34))));
  const xc = dx + w / 2;
  const ph = strikePhases(c, xc, warn, active, 9, bias);
  c.zone(dx, w, DIM.spot.h, 0, ph, { skin: SKIN.spot, loop: true, hb: [10, 0, w - 20, DIM.spot.h] });
  return w + 60;
}

/** Flügel-Sprungbrett (optional): hoher Bounce zu einer Balkonbahn mit Notenmünzen. */
function piano(c: PatternCtx, dx: number): number {
  const w = DIM.piano.w;
  c.spring(dx, w, { skin: SKIN.piano, hb: [0, 0, 70, DIM.piano.h] });
  return w;
}
function balcony(c: PatternCtx, dx: number, w: number, elev: number): void {
  c.platform(dx, w, elev, { skin: SKIN.balcony, thick: 28 });
}
function orchestraPit(c: PatternCtx, dx: number, w: number): void {
  c.pit(dx, w, { skin: SKIN.pit });
}

/** Münzen im Takt: eine je Schlag ab dx */
function beatCoins(c: PatternCtx, dx: number, n: number, elev: number, every = 1): void {
  for (let i = 0; i < n; i += 1) c.coin(dx + bt(c, i * every), elev);
}

/**
 * Klavier → Balkon: Balkonbahn ab `dxPiano`; liefert das Ende der Balkonplatte (px).
 * Der Bounce (SPRING_V 1500) erreicht nur mit gehaltener Sprungtaste die volle Höhe (≈ 416 px); ohne Halten wird er von der
 * variablen Sprunghöhe der Engine auf ≈ 256 px gekappt. Die Balkonbahn liegt daher niedrig (190 px) und ist lang: wer nicht
 * hält, landet schon früh (≈ 0.4 s nach dem Abflug), wer hält, später (≈ 0.9 s) – beides trifft die Platte.
 */
function pianoBalcony(c: PatternCtx, dxPiano: number, elev = 190, notes = 8): number {
  piano(c, dxPiano);
  const launchX = dxPiano - 17;
  coinSpringArc(c, dxPiano + 30, 2, 0.18);
  const start = launchX + c.t(0.12);
  const len = c.t(0.95);
  balcony(c, start, len, elev);
  c.coinLine(start + 26, elev + 40, notes, 58);
  return start + len;
}

const rest = (c: PatternCtx, x: number, t = 0.5): number => x + c.t(t);

// --- Muster --------------------------------------------------------------------------------------------------------------------

export const OPER_PATTERNS: PatternDef[] = [
  // === Einsteiger =====================================================================================================
  {
    id: "op-bouquet",
    minDiff: 0,
    weight: 3,
    tags: ["hop"],
    build(c) {
      const w = bouquet(c, 0);
      c.coinsOver(0, w, DIM.bouquet.h + 90);
      return w;
    },
  },
  {
    id: "op-rope",
    minDiff: 0.1,
    weight: 2.4,
    tags: ["hop"],
    build(c) {
      const w = rope(c, 0, c.diff > 2 && c.rng.chance(0.5));
      c.coinsOver(0, w, DIM.rope.h + 90);
      return w;
    },
  },
  {
    id: "op-drape",
    minDiff: 0.4,
    weight: 2,
    tags: ["slide"],
    build(c) {
      const w = drape(c, 0, c.rng.int(190, 260));
      c.coinLine(20, 30, Math.max(3, Math.floor(w / 56)), 54);
      return w;
    },
  },
  {
    id: "op-piano-lift",
    minDiff: 0.3,
    weight: 1.5,
    tags: ["special", "reward"],
    build(c) {
      const end = pianoBalcony(c, 0, 190, 7);
      return rest(c, end, 0.4);
    },
  },
  {
    id: "op-waltz-hops",
    minDiff: 0.8,
    weight: 2,
    tags: ["hop", "timing"],
    // 1-2-3 in ruhigem Tempo: drei Hindernisse alle zwei Schläge, Münzen liegen auf dem Takt
    build(c) {
      const step = bt(c, 2);
      const a = bouquet(c, 0);
      rope(c, step);
      bouquet(c, step * 2);
      beatCoins(c, a + 40, 5, 150, 1);
      c.coinsOver(step * 2, DIM.bouquet.w, 190, 5);
      return step * 2 + a;
    },
  },
  {
    id: "op-waiter-solo",
    minDiff: 0.6,
    weight: 1.6,
    tags: ["enemy"],
    build(c) {
      waiter(c, 0, -c.rng.range(120, 190));
      c.coinArc(-50, 260, 170, 6);
      return 100;
    },
  },

  // === Mittlere ======================================================================================================
  {
    id: "op-tower-cake",
    minDiff: 1.3,
    weight: 1.7,
    tags: ["hop"],
    build(c) {
      const gap = c.t(1.15);
      const w1 = tower(c, 0);
      const w2 = cake(c, gap);
      c.coinsOver(0, w1, DIM.tower.h + 80, 5);
      c.coinsOver(gap, w2, DIM.cake.h + 80, 5);
      return gap + w2;
    },
  },
  {
    id: "op-dancers-solo",
    minDiff: 1.2,
    weight: 1.6,
    tags: ["enemy"],
    build(c) {
      dancers(c, 0, -c.rng.range(130, 200));
      c.coinArc(-60, 280, 190, 7);
      return 110;
    },
  },
  {
    id: "op-chandelier-slow",
    minDiff: 1.6,
    weight: 1.6,
    tags: ["timing", "slide"],
    build(c) {
      const span = chandelier(c, 0, BEAT * 6, c.rng.range(0, Math.PI * 2), 0.5);
      c.coinLine(span / 2 - 140, 30, 7, 46);
      return span;
    },
  },
  {
    id: "op-orchestra-pit",
    minDiff: 1.4,
    weight: 1.5,
    tags: ["gap"],
    build(c) {
      const w = Math.min(c.jumpDist * 0.5, 330);
      orchestraPit(c, 0, w);
      c.coinArc(-20, w + 40, 140, 7);
      return w;
    },
  },
  {
    id: "op-cork-low",
    minDiff: 1.8,
    weight: 1.5,
    tags: ["timing", "special"],
    build(c) {
      const end = corkShot(c, 0, false, 0.9, 300);
      c.coinArc(-40, 220, 120, 5);
      return Math.max(end, 200);
    },
  },
  {
    id: "op-spot",
    minDiff: 2.2,
    weight: 1.5,
    tags: ["timing", "special"],
    build(c) {
      const w = spot(c, 0);
      c.coinArc(-20, w - 20, 170, 6);
      return w;
    },
  },
  {
    id: "op-cork-high",
    minDiff: 2.5,
    weight: 1.4,
    tags: ["slide", "timing", "special"],
    build(c) {
      const end = corkShot(c, 0, true, 0.9, 330);
      c.coinLine(-20, 30, 5, 48);
      return Math.max(end, 200);
    },
  },
  {
    id: "op-harp",
    minDiff: 3.2,
    weight: 1.3,
    tags: ["hop"],
    build(c) {
      const w = harp(c, 0);
      c.coinArc(-60, w + 160, 300, 8);
      c.pickup("gem", w / 2, DIM.harp.h + 90);
      return w;
    },
  },
  {
    id: "op-waiter-line",
    minDiff: 2.4,
    weight: 1.4,
    tags: ["enemy", "combo"],
    build(c) {
      const n = c.diff > 5 ? 4 : 3;
      for (let i = 0; i < n; i += 1) waiter(c, c.t(i * 0.66), 0);
      c.coinArc(c.t(0.1), c.t(0.66 * (n - 1)), 220, 6);
      return c.t(0.66 * (n - 1)) + DIM.waiter.w;
    },
  },
  {
    id: "op-waltz-slide",
    minDiff: 3,
    weight: 1.6,
    tags: ["combo", "timing"],
    // Sprung – Sprung – Rutschen im Dreiertakt: Schlag 1 und 2 = Hop, Schlag 3 = Duck
    build(c) {
      const beat = bt(c, 1.7);
      rope(c, 0);
      bouquet(c, beat);
      const dw = drape(c, beat * 2, 230);
      beatCoins(c, 20, 3, 140, 1.7);
      c.coinLine(beat * 2 + 10, 30, 4, 50);
      return beat * 2 + dw;
    },
  },
  {
    id: "op-lowlamp-cake",
    minDiff: 3.2,
    weight: 1.3,
    tags: ["combo"],
    build(c) {
      const lw = lowLamp(c, 0);
      c.coinLine(20, 30, 3, 46);
      const gap = lw + c.t(1.0);
      const cw = cake(c, gap);
      c.coinsOver(gap, cw, DIM.cake.h + 80, 5);
      return gap + cw;
    },
  },

  // === Schwere =========================================================================================================
  {
    id: "op-chandelier-pair",
    minDiff: 5,
    weight: 1.3,
    tags: ["timing", "slide"],
    build(c) {
      const per = BEAT * 4;
      const span = chandelier(c, 0, per, 0.4, 0.5);
      const x2 = span + c.t(1.5);
      chandelier(c, x2, per, 0.4 + Math.PI * 0.5, 0.5);
      c.coinLine(span / 2 - 140, 30, 7, 46);
      c.coinLine(x2 + span / 2 - 140, 30, 7, 46);
      return x2 + span;
    },
  },
  {
    id: "op-cork-duo",
    minDiff: 5.3,
    weight: 1.2,
    tags: ["timing", "special", "combo"],
    build(c) {
      const e1 = corkShot(c, 0, false, 0.85, 380);
      const e2 = corkShot(c, c.t(1.25), true, 0.85, 380);
      c.coinLine(20, 30, 4, 50);
      return Math.max(e1, e2) + c.t(0.1);
    },
  },
  {
    id: "op-spot-trio",
    minDiff: 5.2,
    weight: 1.2,
    tags: ["timing", "combo"],
    // drei Scheinwerfer im Dreiertakt: hüpf – hüpf – hüpf
    build(c) {
      const step = bt(c, 2);
      let end = 0;
      for (let i = 0; i < 3; i += 1) end = Math.max(end, spot(c, i * step, 0.9, 0.5, 0.5) + i * step);
      for (let i = 0; i < 3; i += 1) c.coinArc(i * step - 10, 170, 170, 4);
      return end;
    },
  },
  {
    id: "op-waltz-four",
    minDiff: 5.8,
    weight: 1.3,
    tags: ["combo", "timing"],
    build(c) {
      const beat = bt(c, 1.6);
      let x = 0;
      rope(c, x);
      x += beat;
      bouquet(c, x);
      x += beat;
      const dw = drape(c, x, 220);
      x += dw + c.t(0.62);
      cake(c, x);
      beatCoins(c, 24, 3, 140, 1.6);
      c.coinLine(beat * 2 + 10, 30, 4, 50);
      c.coinsOver(x, DIM.cake.w, DIM.cake.h + 90, 5);
      return x + DIM.cake.w;
    },
  },
  {
    id: "op-waltz-fast",
    minDiff: 6.5,
    weight: 1.1,
    tags: ["combo", "timing"],
    // echtes „1-2-3“ im Ein-Schlag-Abstand (0.52 s): ein Sprung über zwei Seile, sofort landen und unter dem Vorhang durchrutschen
    build(c) {
      const step = bt(c, 1);
      const rw = rope(c, 0);
      rope(c, step);
      const dw = drape(c, step * 2 + c.t(0.08), 230);
      beatCoins(c, 10, 3, 130, 1);
      c.coinLine(step * 2 + 30, 30, 4, 50);
      c.coinsOver(0, rw + step, 170, 5);
      return step * 2 + dw + rw * 0;
    },
  },
  {
    id: "op-dancers-chain",
    minDiff: 5.5,
    weight: 1.3,
    tags: ["enemy", "combo"],
    build(c) {
      let x = 0;
      for (let i = 0; i < 4; i += 1) {
        if (i % 2) waiter(c, x, -70);
        else dancers(c, x, -70);
        x += c.t(0.74);
      }
      c.coinArc(0, x, 230, 8);
      return x + DIM.dancers.w;
    },
  },
  {
    id: "op-harp-cork",
    minDiff: 6.5,
    weight: 1.2,
    tags: ["hop", "timing", "combo"],
    build(c) {
      const hw = harp(c, 0);
      const D = hw + c.t(1.35);
      const end = corkShot(c, D, true, 0.8, 380);
      c.coinArc(-60, hw + 160, 300, 7);
      c.coinLine(D - 40, 30, 4, 50);
      return Math.max(end, D + 120);
    },
  },
  {
    id: "op-lamp-spot",
    minDiff: 7,
    weight: 1.1,
    tags: ["timing", "combo"],
    build(c) {
      const span = chandelier(c, 0, BEAT * 3, 1.1, 0.55);
      c.coinLine(span / 2 - 140, 30, 7, 46);
      const sx = span + c.t(1.2);
      const w = spot(c, sx, 0.85, 0.45, 0.5);
      c.coinArc(sx - 10, 170, 170, 4);
      return sx + w;
    },
  },

  // === Setpieces =======================================================================================================
  {
    id: "op-eroeffnung",
    minDiff: 3.4,
    weight: 0.9,
    tags: ["special", "enemy", "combo", "reward"],
    // „Ballsaal-Eröffnung“: eine Reihe Tanzpaare zum Draufstampfen (Kombo!), Notenbogen darüber
    build(c) {
      const n = 5;
      const step = c.t(0.7);
      for (let i = 0; i < n; i += 1) dancers(c, i * step, 0);
      c.coinArc(c.t(0.05), (n - 1) * step, 230, 10);
      c.pickup("gem", (n - 1) * step * 0.5, 330);
      return (n - 1) * step + DIM.dancers.w + c.t(0.3);
    },
  },
  {
    id: "op-klavierkonzert",
    minDiff: 3,
    weight: 0.9,
    tags: ["special", "reward", "combo"],
    // „Klavierkonzert“: Flügel → Balkonbahn → Harfe/Rope unten → zweiter Flügel → hoher Balkon mit Maske
    build(c) {
      let x = 0;
      const end1 = pianoBalcony(c, x, 190, 8);
      x = end1 + c.t(0.85);
      const w = harp(c, x);
      c.coinArc(x - 60, w + 160, 300, 7);
      x += w + c.t(1.15);
      rope(c, x);
      c.coinsOver(x, DIM.rope.w, 170, 5);
      x += DIM.rope.w + c.t(1.0);
      const end2 = pianoBalcony(c, x, 190, 8);
      c.pickup("gem", end2 - c.t(0.55), 330);
      return rest(c, end2, 0.4);
    },
  },
  {
    id: "op-mitternachtswalzer",
    minDiff: 5,
    weight: 0.9,
    tags: ["special", "combo", "timing"],
    // „Mitternachtswalzer“: Dreiertakt-Serie + Kronleuchter + Scheinwerfer
    build(c) {
      let x = 0;
      const beat = bt(c, 1.7);
      rope(c, x);
      bouquet(c, x + beat);
      const dw = drape(c, x + beat * 2, 220);
      beatCoins(c, 20, 3, 140, 1.7);
      x += beat * 2 + dw + c.t(0.9);
      const span = chandelier(c, x, BEAT * 3, 0.9, 0.55);
      c.coinLine(x + span / 2 - 140, 30, 7, 46);
      x += span + c.t(1.1);
      const sw = spot(c, x, 0.9, 0.5, 0.5);
      c.coinArc(x - 10, 170, 170, 4);
      x += sw + c.t(0.8);
      const w = cake(c, x);
      c.coinsOver(x, w, DIM.cake.h + 80, 5);
      return x + w;
    },
  },
  {
    id: "op-polonaise",
    minDiff: 4.5,
    weight: 0.9,
    tags: ["special", "enemy", "combo", "reward"],
    // „Polonaise“: Paare und Kellner im Wechsel, dazwischen Seile – Stampfketten für Kombo-Punkte
    build(c) {
      let x = 0;
      const step = c.t(0.7);
      for (let i = 0; i < 4; i += 1) {
        if (i % 2) waiter(c, x, 0);
        else dancers(c, x, 0);
        x += step;
      }
      c.coinArc(0, x - step, 240, 8);
      x += c.t(0.5);
      rope(c, x);
      c.coinsOver(x, DIM.rope.w, 170, 5);
      x += DIM.rope.w + c.t(1.0);
      for (let i = 0; i < 3; i += 1) {
        dancers(c, x, 0);
        x += step;
      }
      c.coinArc(x - step * 3, step * 2, 230, 6);
      c.pickup("gem", x - step * 1.5, 330);
      return x + DIM.dancers.w;
    },
  },
];
