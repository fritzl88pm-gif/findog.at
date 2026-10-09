# Fredrun 2.0 – Welt-Module schreiben

Ein Weltmodul liefert für **eine** Spielwelt: (1) Level-Muster (Patterns), (2) Optik (WorldRenderer: Hintergrund,
Boden, Entitäts-Skins, Vordergrund, Wetter, Licht), (3) optionale Sondersysteme (WorldSystem, z.B. Lawine, Blitze),
(4) Metadaten (WorldDef). Die Engine (Physik, Kollision, Generator, HUD, Partikel, Audio) besitzt der Hauptagent.

* Pflicht-Lektüre: `src/game/fredrun2/types.ts` (Vertrag), `constants.ts`, `patterns.ts` (Baukasten),
  `worlds/basic.ts` (Referenzwelt mit allen Archetypen), `spawner.ts` (wie Muster verwendet werden),
  `sim.ts` (Verhalten der Archetypen: `updateEntities`, `collide`), `draw-utils.ts` (Zeichenhelfer), `worlds/shared-b/` (Stufen-Caches, Aufwärmen, Lade-Yield, Blitz-Regel – siehe unten).
* Deine Dateien: `src/game/fredrun2/worlds/<id>.ts` (Export-Name unverändert `WORLD_<ID>`), beliebig viele Helfer
  unter `src/game/fredrun2/worlds/<id>/…`. **Keine anderen Dateien ändern** (v.a. nicht sim.ts, types.ts, render.ts,
  game.ts, spawner.ts). Brauchst du ein Engine-Feature, hänge einen Eintrag an `docs/fredrun2/ENGINE_REQUESTS.md`
  (Format: `## <welt>: <Titel>` + Begründung + gewünschte API) und arbeite mit einer Umgehung weiter.

## Koordinaten & Physik (Kurzfassung)

* Logische Fläche 1280 × 720 (`VIEW_W/VIEW_H`). Figur steht bei Bildschirm-x `PLAYER_SX = 300`.
* Bodenlinie `groundY` (Standard 590; Welt darf `groundY` überschreiben). Figur: 118 px hoch (Hitbox), ~150 px sichtbar.
* Weltkoordinate x einer Entität; Bildschirm-x = `e.x - view.dist`. `y` = Bildschirm-y der Oberkante. Die Sim rechnet in 120-Hz-Schritten; der Renderer interpoliert zwischen zwei Schritten:
  `Ent.px/py` = Position zu Beginn des letzten Schritts (nur Darstellung, die Sim-Logik liest sie nie), `view.alpha` = Anteil 0..1, `view.dist` und `view.time` sind bereits interpoliert. Die Engine übergibt `drawEntity`
  die interpolierte Position (`sx`, `sy`); wer `e.x/e.y` selbst liest, sieht den Stand des letzten Sim-Schritts (bis zu einem Schritt Versatz). `alpha` und `flashScale` sind optional: ältere Mocks/Aufrufer lassen sie weg, Leser nehmen `view.alpha ?? 1`.
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
die Engine emittiert Events `custom` mit Tags `zone-warn:<skin>` / `zone-active:<skin>` (Audio: `game-audio.ts` ordnet sie über den Skin-Namen zu – "bolt|lightning|blitz" → Blitz/Donner, "stamp|stempel" → Papier/Stempel,
"laser|beam" → Laser, "rock|stein" → Steinschlag, "phase" → Glitch nur im aktiven Takt und nur im Bild; Pegel nach Abstand zum Bildrand, höchstens zwei Zonen-Töne pro Sekunde, siehe AUDIO.md).

**Kombination = Kreativität**: Straßenbahn = `block` (Wagenkasten, harmful) + `platform` obendrauf (Dachsurfen);
Lawinen-Stein = `projectile` mit `p.gravity`; Riesenrad-Gondel = `platform` mit `ampY`; Kettenkarussell = `swinger`;
Laserzaun = `zone` (Höhe/Elevation bestimmt Springen vs. Rutschen); Förderband = `speedzone` + Deko.

## Welt-Systeme (Sonderereignisse)

`createSystems: () => WorldSystem[]` (frisch pro Lauf/Weltbetreten). `update(sim, dt)` läuft pro Sim-Schritt.
Nützliche Sim-Mitglieder: `sim.spawn(spec, originX)` (Spec-x relativ zu `originX`, y absolut), `sim.playerWorldX`, `sim.dist`,
`sim.speed`, `sim.diff`, `sim.time`, `sim.rng`, `sim.groundY`, `sim.player` (hgt, grounded, hearts …), `sim.hurt(source)`,
`sim.vars` (Zahlen-Bag, sichtbar im Renderer als `view.vars`), `sim.flash = 1` (Bildschirmblitz; der Hub skaliert ihn mit der Einstellung „Blitze“, siehe „Blitze und Weniger Bewegung“), `sim.speedMult`
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
  `shadowBlur` sparsam (teuer), Gradients cachen. Die Zeichenfläche ist 1280·s × 720·s Pixel groß (s = `Renderer.pixelScale`, Q0 exakt 1, Q1 bis 1,25, Q2 bis 2, siehe POLISH.md): bei s = 1 sind Blits an ganzzahligen Positionen der
  schnelle Pfad, skalierte oder subpixel-versetzte `drawImage`-Aufrufe und Verlaufsfüllungen kosten ein Vielfaches (Messung im Software-Raster). Lange Bakes in kleine Schritte teilen (`load`: `yieldBetweenBakes`, Laufzeit: `warm`, `StagePrep`)
  und `resize(k)` idempotent halten – der Vertrag steht im nächsten Abschnitt.
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
* Barrierefreiheit: `view.reducedMotion` → kein Flackern/Blitzen/starke Bewegung; Blitze und Aufheller mit `flashFactor(v)` skalieren (Abschnitt „Blitze und Weniger Bewegung“). Kontrast: Gefahren (harmful) müssen sich
  IMMER klar vom Hintergrund abheben (Rim-Light/Outline/Sättigung), auch in dunklen Welten. Nichts Wichtiges nahe der
  Figurhöhe (y 380–590) im Hintergrund, das wie ein Hindernis aussieht.
* Kein Text im Bild außer bewusst (Schilder klein, dezent; deutsch).

## Lade-, Aufwärm- und Skalen-Vertrag (`load`, `warm`, `resize`)

`WorldRenderer` (types.ts) hat neben `update/draw*` drei Hooks für den Aufbau. Der Hub (`game.ts`) ruft sie so auf:

| Hook | Wann | Pflicht des Renderers |
|------|------|-----------------------|
| `load(assets)` | einmal je Renderer, aus `ensureWorld` (Start/Demo-Welt, Menü-Weltwahl, Laufstart, Weltreise 500 m vor dem Tor), gleichzeitig mit dem Preload der `propIds`; danach gibt der Hub mit `yieldToMain()` den Hauptthread frei, bevor die Welt installiert und zum ersten Mal aktualisiert wird | Lange Bakes in Schritte teilen und dazwischen `await yieldBetweenBakes()` (alle acht Welten tun das). Darf scheitern: ohne Bilder/Props muss die Welt ihren Ersatz malen. Hängt das Laden über 15 s (`WORLD_LOAD_TIMEOUT_MS`), startet die Welt mit dem Basis-Renderer; der echte Renderer ersetzt ihn, sobald `load` fertig ist |
| `resize?(k)` | nach `createRenderer()` vor `load` (sobald die Skala bekannt ist), nach der Installation, falls sich die Skala beim Laden um ≥ 0,02 geändert hat, danach gedrosselt (120 ms) bei jeder Änderung um ≥ 0,02 (Governor-Stufe, Vollbild, Zoom, Monitorwechsel) | `k` ist `Renderer.pixelScale` = Bitmap-Pixel je Logikeinheit (ca. 1 … 2), **nicht** `devicePixelRatio`. **Idempotent**: dieselbe Dichte (die Welten runden auf Viertel bzw. nehmen eine Toleranz von 0,2) darf nichts kosten und nichts verwerfen; nur eine echte Änderung verwirft Skala-abhängige Caches (Hindernis-Sprites, Bodenkacheln, Münzstreifen) und stellt das Vorbacken wieder in die Warteschlange. Vor `load` genügt es, die Dichte zu merken. Welten, die in logischer Größe backen (Alpen), lassen `resize` leer |
| `warm?(budgetMs)` | jeden Live-Frame in einer 3-ms-Scheibe (`WARM_SLICE_MS`): im Countdown und in der Menü-Demo, in den ersten 20 s eines Laufs (`WARM_RUN_S`, nach Weltwechsel und nach einem Skalenwechsel erneut) und für die Zielwelt eines Tores, sobald sie geladen ist. Nicht in der Pause und nicht in QA-Pfaden (`debugAdvance`/`debugRender`) | höchstens ca. `budgetMs` arbeiten, in kleinen, einzeln abgeschlossenen Schritten. Rückgabe `true` = nichts mehr zu tun; der Hub ruft dann nicht mehr auf (bis ein Skalenwechsel das Vormerken löscht). Vor `load` darf `true` zurückkommen (der Hub installiert Welten erst danach) |

Qualität 0 (`view.quality === 0`): `StagePrep.setLow(true)` – die Folgestufe wird erst ab 60 % statt 28 % der Stufe und nicht im Leerlauf vorgebacken; Wachau und Cyber heben auf Q0 oder bei `deviceMemory < 4` verworfene Stufenflächen nicht für den nächsten Bake auf (`dropSpare`), Wachau legt dort auch keine Wahrzeichen-Arbeitsflächen an.
Fehler in `update`, `draw*` und `warm` fängt der Hub ab (`renderFailed`): beim dritten Fehler einer Welt wird ihr Renderer durch den Basis-Renderer ersetzt; ein Fehler in `warm` beendet außerdem das Aufwärmen dieser Welt.

Welten mit `warm`: Wien, Prater, Alpen, Cyber, Wachau (Stufen-Varianten, Hindernis-Sprites, Rauch-/Dampfgrößen, Wahrzeichen-Arbeitsflächen). Finanzamt, Oper und Winter haben kein `warm`.

### Gemeinsame Bausteine

| Baustein | Datei | Zweck |
|----------|-------|-------|
| `StageCache`, `Staged`, `gradedCache`, `stagedLayer`, `prepareStaged` | `shared-b/layers.ts` | Pro Stimmungsstufe vorgebackene Varianten (Nacht-Silhouette, Dunst, Bodenschatten). Eine Variante entsteht in Schritten (`step`: erst Vorarbeit, dann Bake; `Staged` in zwei Schritten, `gradedCache` in bis zu fünf), verworfene Flächen werden recycelt (`recycle`), `costMs` schätzt die Dauer eines Bakes |
| `StagePrep`, `stageProgress` | `shared-b/layers.ts` | Zeitgesteuertes Vorbacken: die aktuelle Stufe sofort, die Folgestufe erst ab `nextFrom` (0,28) des Stufen-Fortschritts und höchstens einen Schritt je `gapMs` (100 ms); beginnt die Überblendung, wird Fehlendes nachgeholt. `onApproach(next)` meldet einmal je Stufe kurz vorher (z. B. Kulissenbild vordekodieren), `warm(stage, budgetMs)` für den Leerlauf, `setLow` für Q0 |
| `WarmQueue` | `shared-b/warm.ts` | Warteschlange kleiner Backschritte für `warm()`: `add(step, estMs)`, `run(budgetMs)` startet weitere Schritte nur, wenn sie nach gemessener Dauer noch ins Budget passen (der erste läuft immer); `true` = leer |
| `yieldBetweenBakes` | `shared-b/yield.ts` | Pause zwischen Bake-Schritten in `load` (MessageChannel, Rückfall `setTimeout`; ohne Fenster sofort erfüllt). Bewusst nicht `yieldToMain`: dessen `scheduler.yield` lässt in Chromium kaum rAF-Frames zu (Messung im Kopfkommentar der Datei) |
| `flashFactor`, `REDUCED_FLASH_MAX` | `shared-b/flash.ts` | gemeinsame Blitz-Regel (nächster Abschnitt) |
| `recycled`, `paint(…, reuse)`, `touchCanvas` | `shared-b/canvas.ts` | Flächen gleicher Größe wiederverwenden (voller Reset des Zeichenzustands); `touchCanvas` erzwingt das Rastern einer frisch bemalten Fläche über einen 1×1-Blit in eine kleine `OffscreenCanvas`, damit die Kosten im Bake-Schritt statt im ersten gezeichneten Frame anfallen (ohne `OffscreenCanvas` wirkungslos, das Bild bleibt gleich) |
| `renderTile(…, reuse)` | `shared-a/gfx.ts` | Kachel mit Pixelfaktor, optional in einer recycelten Fläche |
| `SizedSprites` (`prewarm`), `MirrorBackdrop` (`predecode`), `canvas(…, reuse)` | `wien/cache.ts` | Sprite in festen Größen (statt pro Frame zu skalieren; `prewarm(n, maxSize)` backt im Leerlauf), gemalte Fernkulisse mit gespiegelter Kopie, Backen in drei Schritten |
| `Chunked.steps` | `finanzamt/chunked.ts` | Zerlegung der Kulisse in Zellen schrittweise (Generator) statt am Stück |
| `warmImage` | `assets.ts` | 1×1-Warm-Draw eines geladenen Bildes im Canvas-Backend der Spielfläche, damit das Dekodieren nicht im ersten echten Frame anfällt (Kulissenbilder in Wien, Alpen, Finanzamt und Winter) |
| `installCanvasStub`, `installRecordingStub`, `installTouchStub`, `manifestProps`, `NO_PROPS`, `assetsOf`, `stubView` | `shared-b/test-kit.ts` | Attrappen für Vitest (Umgebung „node“): zählbare Canvas mit Proxy-Kontext, `OffscreenCanvas`-Attrappe, Prop-Bibliothek nach dem echten Manifest, vollständiger `ViewState` |

Weitere weltlokale Muster aus der Runde: Prater/Alpen bestellen die Sprites ferner Entitäten nur vor (`PropBank.early`; gebacken wird in `update`, nicht im Zeichenpfad), Oper dekodiert Bilder per `fetch` + `createImageBitmap` außerhalb des
Hauptthreads (Rückfall auf `<img>`) und löst die Fugenbereinigung in Bändern, Wien gibt Roh-Fassade/-Dach nach den Bakes als Malfläche für die nächste Variante weiter.

## Blitze und „Weniger Bewegung“

Der Regler „Blitze“ (`Settings.flashes`, 0 … 1) erreicht die Welten als `ViewState.flashScale` (bei „Weniger Bewegung“ höchstens 0,3); die Sim-Werte (`sim.flash`, `view.flash`, `vars`) bleiben unverändert. Der Hub skaliert den Bildschirmblitz der Engine selbst.
Welten multiplizieren ihre **eigenen** Blitze und Wetter-Aufheller mit `flashFactor(v, reducedDefault = 0.25)` (`worlds/shared-b/flash.ts`):

* ohne „Weniger Bewegung“: `flashScale` (fehlt das Feld: 1);
* mit „Weniger Bewegung“: `min(flashScale ?? reducedDefault, 0,3)` – der Regler ersetzt das frühere Dämpfen der Welt, hebt es aber nie darüber hinaus an (keine Doppel-Skalierung, kein ungedämpfter Blitz, wenn ein Aufrufer `flashScale` nicht kappt);
* ungültige Werte (NaN, negativ) ergeben 0.

Eingebunden in Wien (Blitz-Aufheller, Fernblitze), Prater (`reducedDefault` 0), Cyber (Sturm, RGB-Balken) und Finanzamt (Alarmlicht, bei „Weniger Bewegung“ nur ruhiges Dauerlicht). Neue Welten mit Blitzen, Aufhellern oder Feuerwerk-Leuchten nutzen dieselbe Funktion.

## Test- & QA-Werkzeuge

* **Unit/Bot**: `BOT_WORLDS=<id> npx vitest run src/game/fredrun2/bot.test.ts` – der vorausschauende Bot spielt 70 s ab
  Meter 0 und 45 s ab Meter 3000; Erwartung ≤ 1 bzw. ≤ 2 Treffer. Bei Fehlschlägen listet der Test Muster-ID + Bot-Plan;
  entweder Muster fairer machen oder (bei Bot-Schwäche) Notiz in ENGINE_REQUESTS.md. Zusätzlich eigene Tests unter
  `worlds/<id>.test.ts` (z.B. alle Muster bauen ohne Ausnahme, Patterns respektieren Breitenlimits). Die Tests der Bausteine (`worlds/shared-b/*.test.ts`) und die Welt-Tests laufen ohne DOM:
  `shared-b/test-kit.ts` liefert Canvas-/`OffscreenCanvas`-Attrappen, die echte Prop-Bibliothek und einen vollständigen `ViewState`. Zu prüfen sind auch `resize` (zweimal mit derselben Dichte: nichts verworfen) und `warm`
  (liefert nach endlich vielen Aufrufen `true`).
* **Screenshots**: `node tools/fredrun2/shot.mjs --world <id> --meters 0,600,1500 --seconds 2,6 --out /tmp/…/name`
  (echter Spielcode im headless Chromium, Bot spielt; optional `--char superfred --seed 3 --size 1280x720 --dpr 2 --world-meters 780 --fps`; `--live <sek>` spielt in Echtzeit über rAF und gibt fps/p95/p99 aus). Danach die
  PNGs mit dem Read-Tool ansehen und iterieren, bis es **wirklich schön** aussieht (Bewertung wie ein Art Director:
  Farbharmonie, Tiefe, Lesbarkeit, Wiedererkennbarkeit, Stimmungswechsel je Stufe). Mehrere Stufen prüfen: `--meters` in Vielfachen
  von `stageMeters`.
* Typecheck: `npx tsc --noEmit -p tsconfig.json` (nur eigene Dateien müssen sauber sein), Lint: `npx eslint src/game/fredrun2/worlds`.

## Muster-Vielfalt (Mindestumfang je Welt)

≥ 16 Muster, davon: 3–4 Einsteiger (diff 0–1.5), 4–5 mittlere, 4–5 schwere (diff ≥ 5), 2 „Setpieces“ (lange, choreografierte
Abschnitte, diff ≥ 3, mit Belohnung), plus Muster, die die Signatur-Mechanik der Welt in Varianten zeigen. Tags sinnvoll setzen
(`hop, slide, gap, enemy, timing, combo, special`), damit der Generator Abwechslung erzwingt.

## Props und Fallbacks

Hindernis-Skins bevorzugen gemalte Props (`assets.props`), halten aber immer einen Ersatz bereit, falls ein Prop fehlt (Manifest-/Netzfehler):
`winter/fallback.ts` und `oper/fallback.ts` liefern Vektor-Ersatzbilder mit denselben Zellenmaßen und Ankerpunkten wie die Props (Animationen/Effekte greifen unverändert),
die älteren Welten behalten ihre prozeduralen Painter. Skins backen Props einmal pro Zielgröße in Offscreen-Sprites (kein `getImageData`/`shadowBlur` pro Frame).
Auch die Ladekette hat Ersatzwege: Bilder, die nicht kommen, geben `null` zurück (Timeout 20 s, ein stiller Wiederholungsversuch nach 1,5 s, siehe ASSETS.md), die Weltmodule malen dann ihren Ersatz; Oper lädt Bilder bevorzugt als `ImageBitmap`
(`fetch` + `createImageBitmap`) und fällt auf `<img>` zurück; fehlen Props im Manifest, laden Winter und Oper ihre Vektor-Ersatzbilder schon in `load` (`warmFallbacks` bzw. `skins.warm()`) statt beim ersten Auftritt; die Welt-Zugehörigkeit
einer Entität bestimmt `rendererFor` (Welt am Ort `e.x`), nicht die aktuelle Welt – beim Tor-Übergang zeichnet jede Welt ihre eigenen Entitäten.
Tests: `worlds/<welt>.test.ts` prüfen, dass Props in `propIds` und im Manifest stehen und die Zellenmaße passen.
