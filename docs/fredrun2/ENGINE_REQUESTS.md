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

## finanzamt: Warnpfeile (Off-Screen-Marker) liegen unter dem Welt-Overlay
* `Renderer.draw` zeichnet `drawWarnMarkers` vor `drawOverlay`. In dunklen Welten (Finanzamt: Taschenlampen-Maske bis 0.68 Deckkraft)
  werden die gelben „!“-Pfeile am rechten Rand dadurch mit abgedunkelt.
* Wunsch: Warnpfeile nach `current.drawOverlay` zeichnen (sie sind HUD-artig).
* Umgehung: Die Maske lässt am rechten Rand in Laufbahnhöhe (y 330–640) immer ein aufgehelltes Band frei.

## finanzamt: Zonen, unter denen man wie unter einem Überhang liegen bleibt
* Hoher Laser-Vorhang = `zone` (Rutschen nötig). Endet das Rutschen unter dem Vorhang (Taste losgelassen oder `SLIDE_MAX_TIME`), steht die
  Figur auf und wird getroffen – `canStand()` berücksichtigt nur `overhead`. Der Bot (Horizont 1.4 s) wählte dadurch oft zu früh begonnenes
  langes Rutschen, das außerhalb seines Horizonts unter dem Laser endete (≈ 4 Treffer/Lauf nur mit Laser-Mustern).
* Wunsch: `BuilderOpts.blockStand?: boolean` bzw. Ent-Flag, das `canStand()` auch für Zonen (unabhängig von der Phase) auswertet.
* Umgehung: je Vorhang ein unsichtbarer, harmloser `overhead` (Skin `laser-guard`, `harmful = false`) mit derselben Unterkante → 0 Treffer.

## finanzamt: Gefahren über dem Overlay nachzeichnen (Rim-Light-Garantie)
* Damit Gefahren in dunklen Stufen klar lesbar bleiben, merkt sich der Finanzamt-Renderer in `drawEntity` die gezeichneten Gefahren/Münzen
  und zeichnet sie in `drawOverlay` mit reduzierter Deckkraft erneut über die Dunkelheit. Für Gast-Gegner musste dazu `drawGuest` aus
  `render.ts` nachgebaut werden (Props `<gast>-run/-jump/-defeated`).
* Wunsch: `drawGuest` exportieren oder `drawOverlay(g, v, visibleEnts)` bzw. einen Hook „über dem Overlay zeichnen“ je Entität anbieten.

## finanzamt: `debugAdvance` lässt Blitz/Überblendung nicht abklingen
* Nach einem Tor (Tour) bleibt in QA-Screenshots der Weltübergangs-Blitz (`flashV`, Farbe #c4b5fd) über viele Sekunden stehen, weil
  `debugAdvance` nur einen Frame mit `dt = 0.0001` zeichnet. Wunsch: Flash/Shake im `debugAdvance` mit der simulierten Zeit abklingen lassen.


## cyber: Portal-Flip spiegelt um den Fußpunkt – Figur klappt kurz unter den Boden
* `Sim.flipGravity` behält den Fußpunkt (`hgt = feet − ceilY` bzw. `groundY − feet`). Da Figur (`flipY` am Fuß) und Trefferfläche
  (`top = feet` bei `gravDir −1`) um den Fuß klappen, springt der Körper beim Boden→Decke-Flip schlagartig 118 px NACH UNTEN:
  ≈ 0.1–0.2 s wird die Figur unterhalb der Bodenlinie gezeichnet, und die Trefferfläche überstreicht noch ≈ 0.4 s lang den Bereich direkt
  über der verlassenen Fläche (umgekehrt beim Rückflip).
* Wunsch: um die Körpermitte kippen – Boden→Decke: neuer Fuß = alter Kopf (`hgt = max(0, feet − PLAYER_H − ceilY)`), Decke→Boden: neuer
  Fuß = `feet + PLAYER_H`. Der Flug wird dadurch ≈ 0.5 s statt 0.585 s; die Cyber-Muster sind mit `FLIGHT = 0.6 s` getaktet und bleiben gültig.
* Umgehung: Der Spielfeld-Anschlag im `CyberSystem` (siehe unten) begrenzt `hgt` direkt nach dem Flip auf `groundY − ceilY − PLAYER_H` –
  das entspricht genau dem Kippen um die Körpermitte. Zusätzlich 0.34 s Energiewirbel an der Figur; Muster halten die verlassene Fläche
  ≥ 0.45 s nach jedem Portal frei (Test „Flugkorridor frei“ in `worlds/cyber.test.ts`).

## cyber: Portal-Blitz zu stark für Portal-Folgen (Zickzack)
* `game.ts` setzt bei jedem `portal`-Ereignis `flashV = 0.7` (#c4b5fd, Vollbild) – auch bei `reducedMotion` (nur `sim.flash` wird dort
  gedämpft). Im Setpiece „Zickzack-Schacht“ (6 Portale in wenigen Sekunden) stroboskopartig.
* Wunsch: Portal-Blitz ≤ 0.25 oder `WorldDef.portalFlash?: number` (Cyber: 0.15), bei `reducedMotion` ×0.3. Der Cyber-Renderer zeichnet
  bereits eigene, lokale Flip-Effekte (Wirbel an der Figur, Schimmer an der Ziel-Lauffläche).
* QA-Hinweis (vgl. finanzamt): Nach dem ersten Portal bleiben `debugAdvance`-Screenshots dauerhaft lavendel verwaschen, weil `flashV` nur
  in `frame(dt)` abklingt. Umgehung: Scratchpad-Kopie von `shot.mjs` setzt vor jedem Foto `game.flashV = 0` und zeichnet neu.

## cyber: Rutschen unter Zonen – Bot-Schwäche (+1 zu finanzamt, dortige Umgehung in Cyber nicht möglich)
* Gleiches Problem wie „finanzamt: Zonen, unter denen man wie unter einem Überhang liegen bleibt“. In Cyber ist `overhead` verboten
  (Decke = Spielfläche, `auditPatterns(..., { forbid: ["pit","overhead"] })`), der unsichtbare `overhead`-Wächter entfällt also.
* Ablauf beim Bot: Er erkennt die Gefahr ≈ 1.3–1.4 s vorher, nimmt den ersten Plan, der den 1.4-s-Horizont übersteht (`slideL@0.4`,
  Rutschen bis 1.45 s) – die späteren, passenden Varianten (`slideL@0.5/0.6`) kommen nie dran. Endet das Rutschen unter der Zone, steht die
  Figur auf und wird getroffen. Gemessen: statischer Laserzaun 150–250 px breit → 15–18 Treffer in 48 Läufen à 35 s.
* Wunsch: (a) `canStand()` auch für Zonen mit Flag (z.B. `p.blockStand = 1`, unabhängig von der Phase, auch für `gravDir −1`);
  (b) Bot: Rollout bis `max(horizon, plan.end + 0.3 s)` simulieren oder unter gleich guten Plänen den spätest beginnenden wählen.
* Umgehung: Cyber-Lichtschranken sind schmal (40 px), rhythmisch und auch überspringbar (74–190 px), `minDiff 1.8` → 0–1 Treffer in 48 Läufen.

## cyber: `flyer.track` zielt bei gekippter Schwerkraft über die Decke
* `updateEntities` (flyer): `target = feetY − PLAYER_H·0.5 − h/2`. Bei `gravDir −1` liegt der Körper UNTER dem Fuß → Ziel oberhalb der Decke.
* Wunsch: `target = feetY − gravDir·PLAYER_H·0.5 − h/2`.
* Umgehung: Cyber nutzt `track` nur in Mustern ohne Portal (Figur sicher am Boden).

## cyber: Kein Anschlag an der Gegenfläche in Schwerkraft-Welten (wichtig)
* Doppelsprung vom Boden erreicht Fuß ≈ 214 px → Kopf bei ≈ 96 px, also im Deckenband (`ceilY 140`). Gravierender: Direkt NACH einem
  Portal ist `jumpsUsed = 1`, ein Sprung-Tastendruck (menschlicher Reflex „ins Portal springen“, Sprungpuffer) löst den Doppelsprung
  WEG von der neuen Lauffläche aus – bei `gravDir −1` also nach unten, und dort gibt es keinen Boden: Die Figur verschwindet ≈ 0.8 s unter
  der Bodenlinie (Fuß bis y ≈ 770). Der Bot nutzt das sogar gezielt aus (`jump@0.42` genau am Portal, um einer Decken-Barriere
  auszuweichen), nachgestellt in der Tour Wachau → Cyber.
* Wunsch: in `gravityFlip`-Welten in `stepPlayerPhysics` `hgt ≤ groundY − ceilY − PLAYER_H` erzwingen (Kopf stößt an, `vy = min(vy, 0)`).
  Damit wäre auch der Flip automatisch „um die Körpermitte“ (siehe oben).
* Umgehung: `CyberSystem.update` erzwingt genau diesen Anschlag (Test „Spielfeld-Anschlag …“ in `worlds/cyber.test.ts`). Nachteil: Bot-
  Rollouts klonen die Sim OHNE Systeme und sehen den Anschlag nicht (Flug real ≈ 0.5 s, vorhergesagt 0.585 s). Perfekter Bot: 0 Treffer in
  48 Läufen à 35 s, Demo-Bot (Horizont 1.25 s): 1; der „menschliche“ Audit-Bot (0.2 s Reaktion) steigt dadurch von 3 auf 11 Treffer
  (fast alle an Decken-Hindernissen kurz nach einem Flip). Liegt der Anschlag in der Sim-Physik, verschwindet diese Abweichung.

## wachau: Bot-Horizont erkennt Stürze in lange Wasserlücken zu spät
* Schaden gibt es erst bei `hgt < −170` (≈ 0.35 s nach Unterschreiten der Lauffläche). Ein Sprungplan mit Verzögerung > 0.2 s, der im
  Wasser landet, scheitert daher erst NACH dem 1.4-s-Horizont; der Bot nimmt den ersten „überlebenden“ (frühesten) Plan → gelegentlich
  ein verlorener Sprung. Gemessen vor der Umgehung (isolierte Muster, Bot): Floß-Sprint 4/6 Fehlschläge, Donauüberfahrt 2–4/6.
* Wunsch: im Rollout als Fehlschlag werten, wenn die Figur über einer `pit` unter −30 px fällt und keine Plattform darunter liegt, oder
  Horizont `max(1.4, plan.end + 0.9)`.
* Umgehung (Wachau): erstes Floß am Ufer vertäut (man läuft drauf) + „Abdeckungsregel“ (jede nächste Plattform ist auch von einem frühen
  Absprung am Anfang der vorigen erreichbar, inkl. Gleitweg der Zillen) → 0 Fehlschläge in 690 isolierten Muster-Läufen.

## wachau: Walker ignorieren Lücken / Bot-Klon ohne Systeme
* Walker rollen über `pit`s hinweg. Wachau lässt Fässer über Wasser per System „baden gehen“ (`state "sunk"`, harmlos, treiben). Der
  Bot-Klon führt keine Systeme aus und sieht dort weiter ein rollendes Fass (harmlos, höchstens ein unnötiger Sprung).
* Wunsch: optional `p.sinkInPits = 1` für Walker in `updateEntities` (fällt in die Lücke, `harmful = false`).

## wachau: `sim.spawn()` verbraucht `sim.rng` für Walker mit `hopEvery`
* `spawn()` setzt `p.hopT = hopEvery·(0.5 + rng.next())` und überschreibt vorgegebene Werte. System-gespawnte Walker (Terrassen-Fässer)
  verschieben dadurch die Zufallsfolge des Level-Generators (weiterhin deterministisch je Seed, aber Muster ändern sich mit System-Tuning).
* Wunsch: `p.hopT` respektieren, falls gesetzt, oder eigenen RNG für Walker-Timer.

## alpen: Todesursachen-Namen für Alpen-Skins
* `death-names.ts` kennt `ibex`, `lawine`, `rock|boulder|stein`, `pit` – es fehlen die übrigen Alpen-Skins, der Game-Over-Text bleibt leer.
* Wunsch: `[/eagle|adler/, "Adler"]`, `[/cow|kuh/, "Kuh"]`, `[/marmot/, "Murmeltier"]`, `[/snowball|schneeball/, "Schneeball"]`,
  `[/rollstone/, "Felsbrocken"]`, `[/ledge/, "Felsdach"]`, `[/cargo/, "Lastenseilbahn"]`, `[/fence|zaun/, "Weidezaun"]`,
  `[/trunk|logs/, "Baumstamm"]`, `[/cairn/, "Steinmandl"]` (Reihenfolge vor `/rock|…|stein/`, weil `rockfall`/`rollstone` sonst dort landen).

## alpen: Harness `debugAdvance` lässt den Tor-Blitz stehen
* `debugAdvance()` ruft am Ende `frame(0.0001)` → `flashV` (Welt-Übergang, Portal-Lila 0.7) klingt in Screenshots praktisch nie ab; nach
  einem Tour-Tor ist jedes weitere Bild lila überzogen (im echten Spiel korrekt).
* Wunsch: in `debugAdvance` `flashV`/`shake` um die simulierte Zeit abklingen lassen (z.B. `this.flashV = max(0, flashV − seconds·3.2)`).

## alpen: Bot-Horizont bei langen Schlucht-Ketten (bestätigt, siehe wachau)
* Gleiches Muster wie in der Wachau: der früheste „überlebende“ Sprungplan landet zu kurz vor der ersten Plattform. Umgehung in Alpen:
  kurzer Anlauf vor Schlucht-Mustern (`withRunUp`), breite Einstiegs-Felskanzel direkt an der Kante, Plattform-Treppen per
  `landDist()` (voller Sprung aus der Mitte trifft die nächste Mitte) und eine tiefe Rettungs-Thermik in langen Setpieces → 0 Treffer in
  allen Bot-Läufen (4 Figuren, 14 Seeds/Startweiten, 0–8000 m).
