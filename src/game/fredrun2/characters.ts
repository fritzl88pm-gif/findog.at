import type { CharacterId } from "./types";
import { CHARACTER_IDS } from "./types";

export { CHARACTER_IDS };

/** Spielrelevante Fähigkeiten einer Figur – bewusst moderat, damit Highscores vergleichbar bleiben. */
export interface CharacterPerks {
  /** Faktor auf Energiegewinn */
  energyGain: number;
  dashCost: number;
  /** Faktor auf Dauer des Dash */
  dashTimeScale: number;
  /** Schwerelosigkeit während des Dash (0 = normale Schwerkraft, 1 = schwebt) */
  dashHover: number;
  /** maximale Gleitzeit pro Luftphase (Sekunden), 0 = kein Gleiten */
  glideTime: number;
  /** Schockwellen-Radius beim Stampfen (px) */
  stompRadius: number;
  /** passiver Münz-Sog (px), unabhängig vom Magnet */
  passiveMagnet: number;
}

export interface CharacterDef {
  id: CharacterId;
  name: string;
  tagline: string;
  abilityName: string;
  abilityText: string;
  /** Kaufpreis in Münzen (0 = von Anfang an freigeschaltet) */
  price: number;
  /** Farben für UI (CSS) */
  color: string;
  colorDark: string;
  perks: CharacterPerks;
}

const BASE_PERKS: CharacterPerks = {
  energyGain: 1,
  dashCost: 34,
  dashTimeScale: 1,
  dashHover: 0.85,
  glideTime: 0,
  stompRadius: 110,
  passiveMagnet: 0,
};

export const CHARACTERS: Record<CharacterId, CharacterDef> = {
  fred: {
    id: "fred",
    name: "Fred",
    tagline: "Der blaue Findog-Klassiker",
    abilityName: "Spürnase",
    abilityText: "Zieht Münzen in der Nähe sanft an.",
    price: 0,
    color: "#2aa6c9",
    colorDark: "#0c4a5e",
    perks: { ...BASE_PERKS, passiveMagnet: 150 },
  },
  frida: {
    id: "frida",
    name: "Frida",
    tagline: "Pink, klug und voller Energie",
    abilityName: "Blitzstart",
    abilityText: "Lädt Energie 30 % schneller, Dash kostet weniger.",
    price: 0,
    color: "#ec4899",
    colorDark: "#7a1d4d",
    perks: { ...BASE_PERKS, energyGain: 1.3, dashCost: 26 },
  },
  superfred: {
    id: "superfred",
    name: "Superfred",
    tagline: "Mit Cape und Extrapower",
    abilityName: "Cape-Gleiter",
    abilityText: "Sprungtaste in der Luft halten: sanft gleiten.",
    price: 400,
    color: "#3b82f6",
    colorDark: "#173a7a",
    perks: { ...BASE_PERKS, glideTime: 1.5 },
  },
  cyberfred: {
    id: "cyberfred",
    name: "Cyberfred",
    tagline: "Hightech-Rüstung, rote Visor-Power",
    abilityName: "Düsen-Dash",
    abilityText: "Dash hält 40 % länger und schwebt vollständig.",
    price: 800,
    color: "#ef4444",
    colorDark: "#4a1414",
    perks: { ...BASE_PERKS, dashTimeScale: 1.4, dashHover: 1 },
  },
  superfrida: {
    id: "superfrida",
    name: "Superfrida",
    tagline: "Pinkes Cape und heldenhafte Sprungkraft",
    abilityName: "Super-Stampfer",
    abilityText: "Stampf-Schockwelle mit doppelter Reichweite.",
    price: 1200,
    color: "#f472b6",
    colorDark: "#831843",
    perks: { ...BASE_PERKS, stompRadius: 230 },
  },
};

export function isCharacterId(value: unknown): value is CharacterId {
  return typeof value === "string" && (CHARACTER_IDS as readonly string[]).includes(value);
}
