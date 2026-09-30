/**
 * Christkindlmarkt – gemeinsame Maße (Muster + Skins) und Skin-Namen.
 * Die Größen folgen dem Seitenverhältnis der fertigen Props (`public/fredrun2/props/winter-*.webp`), damit die
 * Bilder unverzerrt in die Trefferbox passen.
 */
import type { Hitbox } from "../../types";

export interface Dim {
  w: number;
  h: number;
}

export const DIM = {
  snowman: { w: 84, h: 128 },
  presents: { w: 118, h: 248 },
  tree: { w: 98, h: 172 },
  cane: { w: 112, h: 86 },
  iceblock: { w: 94, h: 98 },
  stall: { w: 156, h: 156 },
  /** Deko-Stand im Hintergrund (Elfen-Dach) */
  stallBg: { w: 132, h: 132 },
  kessel: { w: 106, h: 122 },
  krampus: { w: 132, h: 134 },
  gingerbread: { w: 78, h: 92 },
  elf: { w: 114, h: 120 },
  sled: { w: 132, h: 66 },
  sledRide: { w: 200, h: 102 },
  ball: { w: 46, h: 40 },
  icicle: { w: 62, h: 124 },
  basket: { w: 84, h: 100 },
} as const satisfies Record<string, Dim>;

/** Höhe (px) der Eisfläche-Tempozone: > 1 = schneller */
export const ICE_MULT = 1.3;

/** Skin-Namen (Entitäten). Alle schädlichen Skins stehen in death-names.ts. */
export const SKIN = {
  snowman: "snowman",
  presents: "presents",
  tree: "xmas-tree",
  cane: "sugarcane",
  iceblock: "iceblock",
  stall: "stall",
  stallRoof: "stall-roof",
  stallBg: "stall-bg",
  kessel: "kessel",
  steam: "steam",
  krampus: "krampus",
  gingerbread: "gingerbread",
  elf: "elf",
  sled: "sled",
  sledRide: "sled-ride",
  ball: "snowball",
  icicles: "icicles",
  icicle: "icicle",
  basket: "firebasket",
  chains: "chains",
  ice: "ice",
  crevasse: "crevasse",
} as const;

/** Trefferflächen (organische Umrisse → deutlich kleiner als die Bildbox, fair) */
export const HB: Record<string, (w: number, h: number) => Hitbox> = {
  snowman: (w, h) => [w * 0.2, h * 0.1, w * 0.6, h * 0.88],
  presents: (w, h) => [w * 0.16, h * 0.05, w * 0.68, h * 0.94],
  tree: (w, h) => [w * 0.18, h * 0.06, w * 0.64, h * 0.92],
  cane: (w, h) => [w * 0.06, h * 0.14, w * 0.88, h * 0.86],
  iceblock: (w, h) => [w * 0.1, h * 0.12, w * 0.8, h * 0.86],
  stall: (w, h) => [w * 0.06, h * 0.14, w * 0.88, h * 0.86],
  kessel: (w, h) => [w * 0.14, h * 0.16, w * 0.72, h * 0.84],
  krampus: (w, h) => [w * 0.24, h * 0.1, w * 0.52, h * 0.88],
  gingerbread: (w, h) => [w * 0.2, h * 0.1, w * 0.6, h * 0.88],
  elf: (w, h) => [w * 0.24, h * 0.1, w * 0.52, h * 0.88],
  sled: (w, h) => [w * 0.08, h * 0.18, w * 0.84, h * 0.82],
  ball: (w, h) => [w * 0.16, h * 0.14, w * 0.68, h * 0.72],
  icicle: (w, h) => [w * 0.28, h * 0.06, w * 0.44, h * 0.94],
  basket: (w, h) => [w * 0.14, h * 0.2, w * 0.72, h * 0.8],
};
