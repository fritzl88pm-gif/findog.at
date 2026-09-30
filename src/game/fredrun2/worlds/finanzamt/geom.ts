/** Finanzamt – gemeinsame Maße von Mustern, System und Skins (Pixel). */
import type { Hitbox } from "../../types";

/** Riesenstempel (Zone am Boden): Breite/Höhe des aufgeschlagenen Stempels */
export const STAMP_W = 120;
export const STAMP_H = 128;
export const STAMP_HB: Hitbox = [14, 12, STAMP_W - 28, STAMP_H - 12];
/** Bildschirm-y der Stempel-Unterkante in Ruhestellung (unter der Decke) */
export const STAMP_PARK_Y = 150;

/** Laser-Schwelle (niedrig → springen) */
export const LOW_W = 92;
export const LOW_H = 84;
/** Laser-Vorhang (hoch → rutschen): Unterkante über dem Boden, Oberkante als Bildschirm-y */
export const HIGH_ELEV = 76;
export const HIGH_TOP = 128;

/** Rollender Bürostuhl */
export const CHAIR_W = 78;
export const CHAIR_H = 104;
/** Fledermaus */
export const BAT_W = 78;
export const BAT_H = 56;
/** Papierflieger */
export const PLANE_W = 58;
export const PLANE_H = 24;
/** Aktenwagen */
export const CART_W = 120;
export const CART_H = 124;
export const CART_HB: Hitbox = [10, 18, CART_W - 20, CART_H - 18];
/** Kopierer */
export const COPIER_W = 118;
export const COPIER_H = 96;
