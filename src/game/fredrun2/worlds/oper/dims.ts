/**
 * Opernball – gemeinsame Maße der Skins (Muster und Renderer nutzen dieselben Zahlen; Breiten/Höhen in Pixeln).
 * Alle Skin-Namen sind so gewählt, dass `death-names.ts` sie eindeutig erkennt.
 */

export const SKIN = {
  cake: "cakecart",
  harp: "harp",
  bouquet: "bouquet",
  tower: "champagne",
  rope: "velvetrope",
  drape: "drape",
  lowlamp: "chandelier-low",
  swing: "chandelier",
  waiter: "waiter",
  dancers: "dancers",
  cork: "cork",
  spot: "spot",
  piano: "piano",
  balcony: "balcony",
  bottle: "bottle",
  pit: "orchestra",
} as const;

export const DIM = {
  cake: { w: 128, h: 118 },
  harp: { w: 96, h: 246 },
  bouquet: { w: 90, h: 100 },
  tower: { w: 80, h: 138 },
  rope: { w: 108, h: 84 },
  waiter: { w: 90, h: 116 },
  dancers: { w: 108, h: 126 },
  cork: { w: 64, h: 40 },
  /** Lichtpfütze des Scheinwerfers (Trefferzone), Höhe = Trefferhöhe über dem Boden */
  spot: { w: 190, h: 104 },
  piano: { w: 200, h: 34 },
  bottle: { w: 58, h: 92 },
  /** Höhe des Flaschenhalses über dem Boden (Startpunkt des Korkens) */
  bottleNeck: 82,
  chandelierR: 46,
  /** Vordraperie: Unterkante über dem Boden ≤ 72 px → nur Rutschen kommt durch */
  drapeBottom: 66,
  lowLampBottom: 68,
} as const;
