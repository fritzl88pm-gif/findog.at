# Fredrun 2.0 – Welt-Module schreiben

Ein Weltmodul liefert für **eine** Spielwelt: (1) Level-Muster (Patterns), (2) Optik (WorldRenderer: Hintergrund,
Boden, Entitäts-Skins, Vordergrund, Wetter, Licht), (3) optionale Sondersysteme (WorldSystem, z.B. Lawine, Blitze),
(4) Metadaten (WorldDef). Die Engine (Physik, Kollision, Generator, HUD, Partikel, Audio) besitzt der Hauptagent.

* Pflicht-Lektüre: `src/game/fredrun2/types.ts` (Vertrag), `constants.ts`, `patterns.ts` (Baukasten),
  `worlds/basic.ts` (Referenzwelt mit allen Archetypen), `spawner.ts` (wie Muster verwendet werden),
  `sim.ts` (Verhalten der Archetypen: `updateEntities`, `collide`), `draw-utils.ts` (Zeichenhelfer).
* Deine Dateien: `src/game/fredrun2/worlds/<id>.ts` (Export-Name unverändert `WORLD_<ID>`), beliebig viele Helfer
  unter `src/game/fredrun2/worlds/<id>/…`. **Keine anderen Dateien ändern** (v.a. nicht sim.ts, types.ts, render.ts,
  game.ts, spawner.ts). Brauchst du ein Engine-Feature, hänge einen Eintrag an `docs/fredrun2/ENGINE_REQUESTS.md`
  (Format: `## <welt>: <Titel>` + Begründung + gewünschte API) und arbeite mit einer Umgehung weiter.

## Koordinaten & Physik (Kurzfassung)

* Logische Fläche 1280 × 720 (`VIEW_W/VIEW_H`). Figur steht bei Bildschirm-x `PLAYER_SX = 300`.
* Bodenlinie `groundY` (Standard 590; Welt darf `groundY` überschreiben). Figur: 118 px hoch (Hitbox), ~150 px sichtbar.
* Weltkoordinate x einer Entität; Bildschirm-x = `e.x - view.dist`. `y` = Bildschirm-y der Oberkante.
* Sprung: Höhe ≈ 216 px (`JUMP_HEIGHT`), Flugzeit 0.8 s; Doppelsprung addiert ≈ 170 px. Tempo 470 → 1180 px/s
  (`speedAtDiff`). Slide-Hitbox 50 px hoch; unter `overhead`-Balken mit Unterkante ≤ 72 px über Boden nur rutschend.
* **Muster in ZEIT statt Pixeln abstimmen**: `c.t(0.9)` = Abstand in Pixeln, den man in 0.9 s bei aktuellem Tempo
  zurücklegt. Breiten/Höhen von Hindernissen in Pixeln; Breite eines überspringbaren Hindernisses ≤ `0.6 * c.jumpDist`.
* Schwierigkeit `c.diff`: 0 (Anfang) … ~12. Muster mit `minDiff` (und optional `maxDiff`) einreihen; ab diff ≈ 6 dürfen
  Kombinationen mehrere Aktionen in < 1.2 s erzwingen. Ziel: früh entspannt & lehrreich, spät hart aber fair.
  Jedes Muster muss mit jeder Figur lösbar sein (Einzelsprung + Doppelsprung + Rutschen; Dash ist optional, nie Pflicht).
* Ruhezone nach jedem Muster fügt der Generator selbst an. Rückgabewert von `build` = Länge in px.
* Belohnungsmuster (Münzen/Edelsteine/Power-ups) liefert die Engine; in eigenen Mustern Münzen über/zwischen Hindernissen
  platzieren (`c.coinsOver`, `c.coinArc`, `c.coinLine`) – Münzbögen leiten den Spieler zur Lösung.

## Archetypen (Semantik im Detail: types.ts `EntKind`)

`block, overhead, pit, platform (statisch/beweglich/bröckelnd), walker, flyer, projectile, swinger, zone, spring, portal,
wind, speedzone, pickup, decor`. Alle bewegen sich zusätzlich mit `vx` (px/s relativ zur Welt; negativ = kommt schneller
entgegen), Ausnahme swinger/flyer-Sinus (eigene Formeln). `breakable:true` → Dash/Stampf/Turbo zerstört. **`p.delay` (Sekunden)**: Startverzögerung – die Entität ist da (Skin darf zeichnen), ruht aber in der Welt und ist
harmlos, bis `age > delay`, danach gilt ihr normales Verhalten (z. B. Korken im Flaschenhals, Schneeball in der Hand, dann `vx`/`gravity`). **Sprungbrett** (`spring`): der Bounce hat immer die volle Höhe (`PlayerState.noCut`), unabhängig von der gehaltenen Sprungtaste. `stompable:true`
bei walker/flyer → Draufspringen besiegt (Punkte, Bounce). `warn:true` → Warnpfeil am rechten Rand.
Zone-Phasen `[{name:"warn",dur},{name:"active",dur},{name:"idle",dur}]`: Treffer nur in "active";
die Engine emittiert Events `custom` mit Tags `zone-warn:<skin>` / `zone-active:<skin>` (Audio: Skins mit "bolt", "stamp",
"laser", "rock" im Namen lösen automatisch passende Sounds aus).

**Kombination = Kreativität**: Straßenbahn = `block` (Wagenkasten, harmful) + `platform` obendrauf (Dachsurfen);
Lawinen-Stein = `projectile` mit `p.gravity`; Riesenrad-Gondel = `platform` mit `ampY`; Kettenkarussell = `swinger`;
Laserzaun = `zone` (Höhe/Elevation bestimmt Springen vs. Rutschen); Förderband = `speedzone` + Deko.

## Welt-Systeme (Sonderereignisse)

`createSystems: () => WorldSystem[]` (frisch pro Lauf/Weltbetreten). `update(sim, dt)` läuft pro Sim-Schritt.
Nützliche Sim-Mitglieder: `sim.spawn(spec, originX)` (Spec-x relativ zu `originX`, y absolut), `sim.playerWorldX`, `sim.dist`,
`sim.speed`, `sim.diff`, `sim.time`, `sim.rng`, `sim.groundY`, `sim.player` (hgt, grounded, hearts …), `sim.hurt(source)`,
`sim.vars` (Zahlen-Bag, sichtbar im Renderer als `view.vars`), `sim.flash = 1` (Bildschirmblitz), `sim.speedMult`
(Tempofaktor, jeden Schritt neu setzen!), `sim.emit("custom", x, y, {tag: "sfx:<SfxName>"})` (spielt Sound),
`sim.vars["loop:<LoopName>"] = 0..1` (Dauerklang: rain, wind, avalanche, laser-hum, office-hum, crowd-fair, river, cyber-hum).
Systeme müssen fair sein: jede neue Gefahr ≥ 0.6 s vorher telegrafieren (Zone-Phase "warn", Schatten, Ton) und nie direkt im
Sichtbereich neben Mustergefahren spawnen (Abstand ≥ 1.2 s Vorlauf). `onHurt` erlaubt Reaktionen (Lawine holt auf).

## Renderer-Anforderungen (Qualitätslatte: „AAA-Mobile-Runner“)

* `WorldRenderer` (siehe types.ts). **Hintergrund/Parallax**: mind. 5 Ebenen (Himmel/Gestirne, ferne Silhouetten,
  Mittelgrund, Nahgrund, Boden-Deko) mit unterschiedlichen Scroll-Faktoren (0.02 … 0.9 × `view.dist`), atmosphärische
  Perspektive (ferne Ebenen heller/bläulicher/entsättigt), Lichtstimmung, sanfte Animation (Wolken, Wasser, Flaggen,
  Fensterlicht, Glühwürmchen, Nebel …). **Stimmungsstufen**: `view.stage` / `view.stageBlend` (Überblendung) verändern
  Himmel, Licht, Wetter, Dekor deutlich – die Welt „erzählt“ beim Weiterlaufen.
* **Performance**: aufwändige Ebenen EINMAL auf Offscreen-Canvas (`makeCanvas`) vorrendern (Kachelbreite z.B. 2048 px,
  nahtlos: periodische Funktionen benutzen) und pro Frame mit `drawTiled` blitten. Pro Frame keine tausenden Pfad-Operationen,
  keine Allokationen in Hot-Loops, `view.quality` beachten (0 = wenige Partikel/kein Blur, 2 = alles). Ziel < 6 ms CPU pro
  Frame für Welt-Zeichnen (Messung: `node tools/fredrun2/shot.mjs … --fps`, Software-Rendering ist ~3–5× langsamer als GPU).
  `shadowBlur` sparsam (teuer), Gradients cachen. `resize(dpr)` ggf. Caches invalidieren.
* **Boden** (`drawGround`): Lauffläche mit Textur/Kante/Deko, Lücken (`pits`) sauber ausgeschnitten (Wasser, Abgrund, Schredder
  …je nach Welt) inkl. Tiefenwirkung. Bodenmuster scrollt exakt mit `view.dist` (Fußrutschen vermeiden!).
* **Entitäten** (`drawEntity`): jedes verwendete `skin` liebevoll zeichnen (prozedural oder mit Props aus
  `public/fredrun2/props/manifest.json` via `assets.props.draw(g, id, x, y, {h|w, t, flipX, …})`). Anker/Größe:
  zeichne Skin passend in die Box (sx, sy, e.w, e.h); Trefferfläche ist `e.hb`. Zustände (`e.state`, `e.fx.phaseT`,
  `e.age`, `e.stateT`) für Animation nutzen (z.B. Warn-Schatten, Aufprall). Münzen (`e.kind==="pickup" && e.pickup==="coin"`)
  dürfen **weltspezifisch** gezeichnet werden (Marille, Jeton, Datenchip, Euro …); gib `false` für alles zurück, was die
  Engine-Standardgrafik erledigen soll. Skin `"gateway"` (Tour-Tor) darf gezeichnet werden (`e.p.to` = Index der Zielwelt in
  [wien, alpen, finanzamt, prater, wachau, cyber, winter, oper]); sonst zeichnet die Engine ein Standard-Tor.
* Props laden in `load(assets)`: `await assets.props.preload([...ids])`; `assets.props.has(id)` prüfen; **jede Welt muss ohne
  Props ebenfalls gut aussehen** (Fallback prozedural). Bilder aus `public/fredrun/…` (Originalspiel) dürfen per
  `assets.image(url)` als Fernkulisse genutzt werden (Kachelung durch Spiegeln nahtlos machen).
* **Vordergrund** (`drawForeground`): Wetter (Regen, Schnee, Funken, Glühwürmchen), nahe Objekte vor der Figur, Nebel-/Lichtschleier;
  Blitze via `view.flash` (Engine legt Bildschirmblitz selbst) + `view.vars`. `drawOverlay` für Licht/Dunkelheit/Farbkorrektur.
* Barrierefreiheit: `view.reducedMotion` → kein Flackern/Blitzen/starke Bewegung. Kontrast: Gefahren (harmful) müssen sich
  IMMER klar vom Hintergrund abheben (Rim-Light/Outline/Sättigung), auch in dunklen Welten. Nichts Wichtiges nahe der
  Figurhöhe (y 380–590) im Hintergrund, das wie ein Hindernis aussieht.
* Kein Text im Bild außer bewusst (Schilder klein, dezent; deutsch).

## Test- & QA-Werkzeuge

* **Unit/Bot**: `BOT_WORLDS=<id> npx vitest run src/game/fredrun2/bot.test.ts` – der vorausschauende Bot spielt 70 s ab
  Meter 0 und 45 s ab Meter 3000; Erwartung ≤ 1 bzw. ≤ 2 Treffer. Bei Fehlschlägen listet der Test Muster-ID + Bot-Plan;
  entweder Muster fairer machen oder (bei Bot-Schwäche) Notiz in ENGINE_REQUESTS.md. Zusätzlich eigene Tests unter
  `worlds/<id>.test.ts` (z.B. alle Muster bauen ohne Ausnahme, Patterns respektieren Breitenlimits).
* **Screenshots**: `node tools/fredrun2/shot.mjs --world <id> --meters 0,600,1500 --seconds 2,6 --out /tmp/…/name`
  (echter Spielcode im headless Chromium, Bot spielt; optional `--char superfred --seed 3 --size 1280x720 --fps`). Danach die
  PNGs mit dem Read-Tool ansehen und iterieren, bis es **wirklich schön** aussieht (Bewertung wie ein Art Director:
  Farbharmonie, Tiefe, Lesbarkeit, Wiedererkennbarkeit, Stimmungswechsel je Stufe). Mehrere Stufen prüfen: `--meters` in Vielfachen
  von `stageMeters`.
* Typecheck: `npx tsc --noEmit -p tsconfig.json` (nur eigene Dateien müssen sauber sein), Lint: `npx eslint src/game/fredrun2/worlds`.

## Muster-Vielfalt (Mindestumfang je Welt)

≥ 16 Muster, davon: 3–4 Einsteiger (diff 0–1.5), 4–5 mittlere, 4–5 schwere (diff ≥ 5), 2 „Setpieces“ (lange, choreografierte
Abschnitte, diff ≥ 3, mit Belohnung), plus Muster, die die Signatur-Mechanik der Welt in Varianten zeigen. Tags sinnvoll setzen
(`hop, slide, gap, enemy, timing, combo, special`), damit der Generator Abwechslung erzwingt.
