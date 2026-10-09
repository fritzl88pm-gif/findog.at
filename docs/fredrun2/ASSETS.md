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

### Hindernis-Props der Welten (fal.ai) und Straßenbahn

* `wien-*`, `alpen-*`, `finanzamt-*`, `prater-*`, `wachau-*`, `cyber-*`: 30 gemalte Hindernis-Sprites (siehe `ART.md`, `art_prompts/legacy.json`), von den Welt-Skins
  auf die Hitbox eingepasst (Fußpunkt, Skalierung, gebackene Caches); ohne Prop zeichnet jeder Skin weiter seinen prozeduralen Painter.
* `wien-tram-n0 … n6`: Wiener E2-Triebwagen in **exakter 2D-Seitenansicht** (orthografisch, Front rechts, Fußanker unten), sieben Längen (logische Breiten 548 / 619 / 650 /
  714 / 753 / 816 / 855 bei `scale 0.6545`, Kastenhöhe 156 = `TRAM_H`). Die Längen entstehen aus wiederholten Fenster-/Türabschnitten desselben Wagens (Schnitte in Fenstersprossen);
  gezeichnet wird die Variante mit der kleinsten Abweichung, per `SpriteOpts.sx` auf die Hitbox-Breite gestreckt (≤ ±6 %).
* `SpriteOpts.sx`: zusätzlicher Breitenfaktor nur für die Breite (Straßenbahn-Längenanpassung).
* Cache-Busting: alle Asset-URLs tragen `?v=<Hash>` (`asset-rev.ts`) – nach Änderungen an `public/fredrun2` `node tools/fredrun2/asset-rev.mjs` ausführen (Test `asset-rev.test.ts`).

## Weltenkulissen (optional, gemalte Fernkulissen) – `public/fredrun2/worlds/<worldId>/`

Beliebige WebP-Bilder + Nutzung im Weltmodul. Die Originale aus `public/fredrun/` dürfen wiederverwendet werden.

## Laden, Fehlerfälle und Dekodier-Warmup (`src/game/fredrun2/assets.ts`)

* **Bilder** (`loadImage`, URL mit `?v=<Hash>`): Ein Bild darf höchstens 20 s laden (`IMAGE_TIMEOUT_MS`; die hängende Anfrage wird abgebrochen), danach liefert der Aufruf `null`. Fehlschläge werden nicht im Cache gemerkt, der nächste Aufruf (Weltstart, `ensure*`)
  versucht es neu; zusätzlich füllt ein stiller Wiederholungsversuch nach 1,5 s (`IMAGE_RETRY_MS`) den Cache für später. Eine Figur, bei der ein Sheet gescheitert ist, wird nicht dauerhaft als „vollständig“ gemerkt; gescheiterte Props gibt `PropLib` frei, ein späteres
  `preload()` lädt neu. Welt-Module müssen damit leben, dass `assets.image()` und `assets.props.has()` auch nach `load` noch nein sagen (Ersatzgrafik, siehe WORLDS.md).
* **Warum ein Warmup**: Ein `<img>` wird erst beim ersten `drawImage` dekodiert (ein Figuren-Sheet 13 … 52 ms, auf Handys ein Mehrfaches) – mitten im Spiel ein Hänger beim ersten Rutschen, Dash oder Stampfer. `warmImage` zeichnet deshalb einen 1×1-Ausschnitt in eine kleine
  Warm-Canvas (129 px, **im selben Canvas-Backend wie die Spielfläche**, `alpha: false`, ohne `willReadFrequently`) und flusht per `createImageBitmap`; nur ohne `createImageBitmap` bleibt `getImageData` als Rückfall. Ein Rücklesen auf eine CPU-Canvas würde nur den Software-Cache füllen
  und den Erst-Draw der GPU-Fläche nicht entlasten (Kommentar im Kopfblock der Datei).
* **Nur angefordert, nie nebenbei.** Menü-Vorschauen laden alle Helden (`characterStage`, `CharacterSelect` rufen `loadCharacter(id)` **ohne** `warm`); je Held bleiben dekodiert ca. 50 … 60 MB, das soll nur für den gespielten oder gewählten Helden gelten.
  Vertrag für den Spiel-Hub (`game.ts`):

  ```ts
  const core = await loadCharacter(id, ["run", "jump", "fall", "idle"], { warm: true }); // Kern zuerst (Menü, erste Sekunden)
  void loadCharacter(id, undefined, { warm: true });                                    // Rest im Hintergrund
  await assets.warmed(true);                                                            // vor dem Countdown-Ende: alles dekodiert
  ```

  `{ warm: true }` fordert das Warmup nach dem Laden an und lässt `warmed()` auf diesen Ladevorgang warten; wer die Sprites schon hat, nimmt `warmCharacter(sprites, urgent?)`. Der Held der jüngsten Anforderung gewinnt (Heldenwechsel verwirft wartende Jobs des früheren Helden,
  Welt-Props bleiben); bereits gewärmte Bilder werden nie doppelt gewärmt. Welt-Props wärmt `PropLib.preload` selbst.
* **Reihenfolge und Takt**: Bewegungen zuerst (`run`, `jump`, `fall`, `slide`, `dash`, `stomp`, `doublejump`, `hurt`, `glide`), dann Welt-Props, `idle` und `victory` (je ca. 8 MB) zuletzt (`ANIM_WARM_PRIO`). Gewärmt wird in Slots von höchstens 24 ms (`WARM_BUDGET_MS`): im Spiel nur
  in Leerlauf-Slots (`requestIdleCallback`, mindestens 12 ms frei, nach 1 s ohne Leerlauf trotzdem; ohne `requestIdleCallback` per `setTimeout`), mit `urgent = true` (Ladebildschirm, Countdown) Slot an Slot. Hängt der asynchrone Flush länger als 0,5 s, geht die Warteschlange trotzdem weiter.
* **Ladeablauf im Hub**: Beim Start laden Manifest, Helden-Kern und Demo-Welt gleichzeitig (Fortschrittsbalken gewichtet 0,08 / 0,3 / 0,55); das Menü erscheint spätestens nach 20 s (`INIT_CAP_MS`), auch wenn noch etwas lädt. Danach lädt der restliche Satz des Helden im Hintergrund.
  Beim Laufstart laden Held und Startwelt parallel, der Countdown hält höchstens 1,5 s (`WARM_WAIT_S`) bei „1“, bis das Warmup durch ist.
* **Folgen für neue Assets**: Jedes Sheet kostet beim ersten Zeichnen Dekodierzeit und Speicher – Sheets nicht größer als nötig (Ziel ≤ 450 KB pro Sheet), Animationen, die nie gezeichnet werden, weglassen. Neue Animationsnamen bekommen ohne Eintrag in `ANIM_WARM_PRIO` die Priorität 15 (nach den Welt-Props).

## AutoSprite-Credit-Budget (Gesamt 295 Credits zu Sessionbeginn)

| Agent | Budget | Zweck |
|-------|--------|-------|
| sprites | 175 | neue Charakter-Animationen (turbo, 5 Credits) |
| props | 100 | Props, animierte Gegner/Hazards |
| Reserve (Hauptagent) | 20 | Nachbesserungen |

Kein Agent überschreitet sein Budget. Kostenfreie Aktionen (regenerate_spritesheet, Sheets/Videos neu exportieren) sind erwünscht.
