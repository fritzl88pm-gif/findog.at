# Fredrun 2.0 – Engine-Wünsche der Welt-Agenten

Format: `## <welt>: <Titel>` + Begründung + gewünschte API. Welt-Agenten ändern keine Engine-Dateien, sondern arbeiten mit einer Umgehung weiter.

## wien: Tor-Übergang reicht die Stufe der AKTUELLEN Welt an den Renderer der Zielwelt weiter (Absturz Wien → Alpen)
* Beim Tor-Übergang (Tour) bekommt der Renderer der nächsten Welt dieselbe `ViewState` wie die aktuelle Welt – also `view.stage` der
  aktuellen Welt. Wien hat 8 Stufen à 260 m; bei `TOUR_METERS = 1300` steht Wien in Stufe 5. Der Alpen-Renderer (5 Stufen) erhält damit
  `stage = 5` und wirft in `AlpenRenderer.update → prepareStaged → paintSky` (`Cannot read properties of undefined (reading 'top')`).
  Nachstellen: `node tools/fredrun2/shot.mjs --mode tour --world wien --seconds 60,110,150` (Absturz bei ≈ 1300 m; im Spiel fängt
  `FredRunGame.guard` den Fehler, nach 3 Fehlern fällt die Alpen-Welt dauerhaft auf den Basis-Renderer zurück).
* Wunsch: dem Renderer der Zielwelt eine eigene Sicht übergeben, z.B. `{ ...view, stage: 0, stageBlend: 0, worldMeters: 0 }` für
  `next.update/drawBackground/drawGround/drawForeground` (die Zielwelt beginnt ohnehin in Stufe 0); `debugAdvance` sollte `update` der
  Zielwelt ebenfalls über `guard` aufrufen.
* Umgehung: Wien und Prater klemmen `view.stage` intern auf ihre letzte Stufe. Alle Welten sollten das tun, solange die Engine es nicht übernimmt.

## wien/prater: QA-Screenshots zeigen bei `--meters` immer Stufe 0
* `debugRun({ startMeters })` setzt auch den Welt-Startpunkt (`worldStartDist`) auf `startMeters` → `worldMeters` beginnt bei 0, jede
  Aufnahme mit `--meters 0,260,520,…` zeigt dieselbe erste Stimmungsstufe (nur die Schwierigkeit steigt).
* Wunsch: Option `--world-meters` in `tools/fredrun2/shot.mjs` bzw. `debugRun({ worldMeters })`, die `worldStartDist` passend setzt.
* Umgehung (Finisher Wien/Prater): eigenes Skript im Scratchpad setzt nach `debugRun` `game.sim.worldStartDist = 0`.

## wien/prater: `--fps` misst ohne GPU-Flush; Engine-Grundlast im Software-Rendering ≈ 36 ms
* Der Canvas ist in Headless-Chromium (SwiftShader) GPU-beschleunigt; `--fps` misst nur die Hauptthread-Zeit bis der Befehlspuffer voll
  ist. Ergebnis schwankt stark (Wien vor Optimierung: 1,2 ms in Stufe 0, 138 ms in Stufe 3). Reproduzierbar wird es mit einem
  erzwungenen Abschluss pro Frame (`ctx.getImageData(0, 0, 1, 1)` nach jedem `debugAdvance`).
* So gemessen kostet ein Frame OHNE jede Welt-Zeichnung (alle Welt-Methoden leer) bereits ≈ 36 ms (Bot-Planung, Figur, Partikel, HUD,
  Vignette). Die Vorgabe „Ø < 16 ms“ ist in dieser Umgebung damit für keine Welt erreichbar.
* Kalibrierung SwiftShader (1280×720): 1:1-Blit an ganzzahliger Position 0,4–0,5 ms; derselbe Blit subpixel-versetzt, skaliert oder
  gespiegelt 3,8–4,5 ms; Verlaufs-`fillRect` 4,1 ms. Wunsch: Vignette (`drawImage(256×144 → 1280×720)`) einmal in Zielgröße
  vorrendern und 1:1 blitten; Speed-Streifen/Slow-Mo-Tönung sind unkritisch.

## wien: `auditPatterns` – Ausnahme für „besurfbare“ Blöcke
* Die Straßenbahn ist ein `block` (Wagenkasten) mit deckungsgleicher `platform` (Dach). Sie ist breiter als `0.6 × jumpDist`, wird aber
  nicht übersprungen, sondern bestiegen (Höhe 156 < Sprunghöhe 216). `auditPatterns` meldet „Block zu breit“.
* Wunsch: Option `auditPatterns(world, { surfable: (block, specs) => boolean })` oder automatische Ausnahme, wenn eine Plattform mit
  gleichem `x/w/vx` auf dem Block liegt.
* Umgehung: `worlds/wien.test.ts` filtert diese Meldung und prüft stattdessen, dass jeder zu breite Block eine Straßenbahn mit Dach ist.
