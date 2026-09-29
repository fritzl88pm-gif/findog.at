# Fredrun 2.0 – Asset-Konventionen

Alle Runtime-Assets liegen unter `public/fredrun2/`. Sprites sind **WebP mit Alpha** (lossy q≈80–88, `method=6`),
Layout ist immer ein Raster (Zeilenweise, links→rechts, oben→unten). Werkzeug-Skripte liegen in `tools/fredrun2/`
(Python + Pillow/numpy; kein Node-Build-Schritt nötig).

## Charaktere – `public/fredrun2/chars/<id>/`

`<id>` ∈ `fred | frida | superfred | cyberfred | superfrida`. Pro Charakter eine `atlas.json` + eine WebP je Animation:

```jsonc
{
  "id": "fred",
  "runHeight": 214,            // Höhe der Figur (Pixel, Sheet-Pixel) im Lauf-Zyklus, Kopf bis Fuß
  "anims": {
    "run": {
      "file": "run.webp",
      "cols": 8, "rows": 4, "frames": 32,   // frames <= cols*rows
      "cw": 256, "ch": 256,                 // Zellgröße in Sheet-Pixeln
      "cx": 128, "footY": 246,              // Ankerpunkt (Fußmitte) innerhalb der Zelle
      "scale": 1.0,                         // Zeichenfaktor relativ zu `run` (1.0 = gleiche Pixeldichte wie run)
      "fps": 28, "loop": true
    }
    // jump, fall, doublejump, slide, hurt, dash, stomp, idle, victory
  }
}
```

Pflicht-Animationen: `run` (loop), `jump` (Absprung→Scheitel, kein Loop), `fall` (loop, fallende Pose),
`doublejump` (Salto/Wirbel, kein Loop), `slide` (Rutschen, Loop, flach), `hurt` (Treffer/Stolpern, kein Loop),
`dash` (Sprint-Stoß, Loop), `stomp` (Stampf-Pose Richtung Boden, Loop), `idle` (Loop), `victory` (Loop).
Fehlt eine Animation, fällt die Engine auf `run`/`jump` zurück – aber Ziel ist Vollständigkeit.

Regeln für ALLE Frames eines Charakters:
* Figur blickt nach **rechts**, transparenter Hintergrund, keine Reste des Original-Hintergrunds (saubere Ränder, kein Halo).
* **Ein gemeinsamer Skalierungsfaktor** für alle Animationen eines Charakters (Figur hat in `run` ≈ 210–225 px Höhe bei 256er Zelle).
* Fußanker: Pro Frame wird die unterste opake Pixelzeile auf `footY` gelegt (Bodenkontakt), horizontal auf einen
  **geglätteten** Schwerpunkt (gleitender Mittelwert über ~7 Frames) – die Figur darf nicht ruckeln oder seitlich rutschen.
* Lauf-/Loop-Animationen müssen nahtlos loopen (letzter → erster Frame ohne Sprung; sonst Frames so beschneiden).
* Größe: Ziel ≤ 450 KB pro Sheet (WebP). 16–32 Frames reichen für alles außer `run` (32) und `victory` (≤ 32).

## Props / Gegner / Pickups – `public/fredrun2/props/`

Eine `manifest.json`:

```jsonc
{
  "props": {
    "tram": {
      "file": "tram.webp",
      "cols": 1, "rows": 1, "frames": 1,
      "cw": 512, "ch": 256,
      "ax": 0.5, "ay": 1.0,       // Anker relativ zur Zelle (0..1); (0.5,1) = Mitte unten
      "fps": 0, "loop": true,
      "tags": ["wien", "obstacle"]
    }
  }
}
```

* Statische Props: 1 Frame. Animierte (Gegner, Vögel, Drohnen …): Sheet mit 8–32 Frames.
* Nach rechts blickend (Gegner sollen später gespiegelt werden können).
* Transparenter Hintergrund, saubere Kanten. Ziel: ≤ 250 KB je Datei, 256–512 px Zellen.
* IDs sind `kebab-case`, sprechend (`pigeon-fly`, `odo-run`, `odo-defeated`, `coin`, `heart`, `powerup-magnet`, …).

## Weltenkulissen (optional, gemalte Fernkulissen) – `public/fredrun2/worlds/<worldId>/`

Beliebige WebP-Bilder + Nutzung im Weltmodul. Die Originale aus `public/fredrun/` dürfen wiederverwendet werden.

## AutoSprite-Credit-Budget (Gesamt 295 Credits zu Sessionbeginn)

| Agent | Budget | Zweck |
|-------|--------|-------|
| sprites | 175 | neue Charakter-Animationen (turbo, 5 Credits) |
| props | 100 | Props, animierte Gegner/Hazards |
| Reserve (Hauptagent) | 20 | Nachbesserungen |

Kein Agent überschreitet sein Budget. Kostenfreie Aktionen (regenerate_spritesheet, Sheets/Videos neu exportieren) sind erwünscht.
