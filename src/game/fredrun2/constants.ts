/** Fredrun 2.0 – globale Konstanten. Alle Längen in logischen Pixeln (Spielfläche 1280 × 720). */

export const VIEW_W = 1280;
export const VIEW_H = 720;

/** Bildschirm-X der Spielfigur (Fußmitte). */
export const PLAYER_SX = 300;

/** Standard-Bodenlinie (Oberkante der Lauffläche). Welten dürfen abweichen. */
export const DEFAULT_GROUND_Y = 590;
/** Decke im Gravitationswelten-Modus (Cyber). */
export const DEFAULT_CEIL_Y = 150;

/** 1 Meter im Spiel = so viele Pixel Scroll-Distanz. */
export const PX_PER_METER = 60;

// --- Spielfigur -------------------------------------------------------------
export const PLAYER_W = 44;
export const PLAYER_H = 118;
export const SLIDE_W = 78;
export const SLIDE_H = 50;
/** Sichtbare Höhe der Figur (Lauf-Animation) in logischen Pixeln. */
export const PLAYER_VISUAL_H = 150;

// --- Physik -----------------------------------------------------------------
export const GRAVITY = 2700;
export const JUMP_V = 1080;
export const DOUBLE_JUMP_V = 960;
export const JUMP_CUT = 0.42;
export const MAX_FALL = 1500;
export const STOMP_V = 1750;
export const STOMP_BOUNCE_V = 880;
export const SPRING_V = 1500;
export const COYOTE_TIME = 0.1;
export const JUMP_BUFFER = 0.13;
export const APEX_GRAVITY_SCALE = 0.62; // "Hang-Time" am Sprungscheitel bei gehaltener Taste
export const APEX_BAND = 170; // |vy| unterhalb dieser Grenze zählt als Scheitelbereich

/** Sprunghöhe / Flugzeit eines vollen Einzelsprungs (ohne Apex-Hang). */
export const JUMP_HEIGHT = (JUMP_V * JUMP_V) / (2 * GRAVITY);
export const JUMP_AIR_TIME = (2 * JUMP_V) / GRAVITY;

// --- Slide / Dash / Energie -------------------------------------------------
export const SLIDE_MIN_TIME = 0.32;
export const SLIDE_MAX_TIME = 1.1;
export const DASH_TIME = 0.34;
export const DASH_SPEED_MULT = 1.85;
export const DASH_COST = 34;
export const DASH_COOLDOWN = 0.35;
export const DASH_GRACE = 0.45; // Unverwundbarkeit nach dem Dash
export const ENERGY_MAX = 100;

// --- Leben / Schaden --------------------------------------------------------
export const START_HEARTS = 3;
export const MAX_HEARTS = 5;
export const HURT_INVULN = 1.6;
export const HURT_STUN = 0.55;
export const HURT_SPEED_LOSS = 0.62; // Tempo-Faktor direkt nach Treffer

// --- Tempo / Schwierigkeit --------------------------------------------------
export const SPEED_BASE = 470;
export const SPEED_MAX = 1180;
/** Schwierigkeitsstufe steigt pro so vielen Metern um 1. */
export const METERS_PER_DIFFICULTY = 380;
export const DIFFICULTY_SPEED_SCALE = 3.6;

// --- Power-ups --------------------------------------------------------------
export const MAGNET_TIME = 10;
export const MAGNET_RADIUS = 330;
export const SHIELD_TIME = 16;
export const SLOWMO_TIME = 5.5;
export const SLOWMO_FACTOR = 0.62;
export const TURBO_TIME = 4.2;
export const TURBO_SPEED_MULT = 1.65;

// --- Punkte -----------------------------------------------------------------
export const SCORE_COIN = 10;
export const SCORE_GEM = 100;
export const SCORE_NEAR_MISS = 30;
export const SCORE_STOMP = 60;
export const SCORE_DASH_KILL = 80;
export const COMBO_MAX = 8;
export const COMBO_WINDOW = 3.2;
export const NEAR_MISS_CLEARANCE = 24;

// --- Sim --------------------------------------------------------------------
export const FIXED_DT = 1 / 120;
export const SPAWN_AHEAD = VIEW_W + 420;
export const CULL_BEHIND = 320;
