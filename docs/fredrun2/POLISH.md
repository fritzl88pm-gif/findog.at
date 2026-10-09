# Fredrun 2.0 – Verbesserungsrunde (Visuals, Spielgefühl, Komfort, Audio, Performance)

Überblick über die Runde nach Commit `63fa7f6` (`git log --oneline 63fa7f6..HEAD`, Commits `887196f` … `8c569e6`). Die Arbeit lief in Paketen (`pkg-foundation`, `pkg-audio-engine`, `pkg-render-logic`, `pkg-perf-core`, `pkg-input`,
`pkg-ui-css`, `pkg-sim`, `pkg-hud`, `pkg-audio-mix`, `pkg-perf-worlds-a/-b`, `pkg-hub-core`, `pkg-render-scene`, `pkg-hub-feedback`, `pkg-ui-menu`); die Namen
tauchen in den Commit-Nachrichten und in Code-Kommentaren auf.

Pfade sind relativ zu `src/game/fredrun2/` (Spielcode) bzw. `src/components/fredrun2/` (Oberfläche, mit „UI:“ gekennzeichnet). Zahlen stehen so im Code;
Messwerte stammen aus Commit-Nachrichten oder Code-Kommentaren und sind als solche markiert (Grenzen: Abschnitt 5).

## 1. Was ist neu

### Visuals

* **Figur** (reine Funktionen in `draw-utils.ts`, verdrahtet in `render.ts`, Tests `render-logic.test.ts`, `render-scene.test.ts`):
  * Lauf-Phase als Akkumulator (`stepRunPhase`, Abspielrate 0,7 … 1,45 nach Tempo): Tempowechsel ändern nur die Steigung, kein Strobing.
  * Squash & Stretch (`squashFor`): Landung 5 … 17 % nach Aufprallgeschwindigkeit (300 … 1500 px/s), Stampfer 22 %, Absprung +7 % Höhe in 0,09 s; „Weniger Bewegung“ halbiert.
  * Treffer: weißer Flash 0,7 → 0 in 0,15 s (folgt dem Regler „Blitze“), danach Puls (ca. 6 Hz, nie unter 60 % Deckkraft) – er folgt dem Sim-Timer `invuln`, nicht der
    Renderuhr (`playerAlpha`). Dash, Turbo und die Dash-Gnadenfrist zeigen einen cyanfarbenen Randschein statt Blinken.
  * Tod-Pose (`deathPose`): Kippen um 70° in 0,5 s, 25 px zurück, bis zu 4 kreisende Sterne; sie liegt auch auf der Game-Over-Karte (außer beim Sieger-Tanz nach neuem Rekord). „Weniger Bewegung“: nur Kippen.
  * Schatten von Figur und Gegnern werden mit der Flughöhe kleiner und blasser (Mindestfaktor 0,2), liegen nie über Gruben und werden an Grubenkanten abgeschnitten (`shadowShape`, `shadowRanges`).
* **Entitäten-Interpolation**: `Ent.px/py` (Position zu Beginn des letzten Sim-Schritts, nur Darstellung, `types.ts`); `render.ts` zeichnet `lerpPos(px, x, view.alpha)`. `Sim.view()` liefert dazu
  `alpha`, eine passende Zwischenzeit `time` und interpoliert die Figurhöhe nicht über einen Schwerkraft-Flip hinweg.
* **Tempo und Zeitlupe**: Geschwindigkeits-Streifen ab 520 px/s (volle Stärke 1100 px/s, 12 Bahnen; helle Welten `oper`, `prater`, `wachau` mit dunklen Linien und heller Gegenkontur; aus bei
  „Weniger Bewegung“ und Q0). Zeitlupe: weiche Rampe von 0,2 s für Welt, Partikel und Geister, vorgerendertes Overlay (Tönung 0,18, Vignette +15 %, entsättigte Ränder).
* **Partikel** (`particles.ts`, `render.ts`): weltfester Staub (bleibt am Aufprallort liegen), weiche Puff-Sprites statt Kreisen, Start-Staubstoß (10 Puffs), Gold-Ring plus 8 Sterne beim Münz-Pickup, Flug-Münzen zum
  HUD-Zähler (alle 2 bis 3 Münzen eine, höchstens 3 gleichzeitig, nur bei sichtbarem HUD, nicht bei „Weniger Bewegung“), weltfeste Wandtrümmer, Popups bleiben in einer sicheren Zone (`POPUP_ZONE`, HUD-Panel links oben ausgespart) und weichen aktiven Popups aus (`placePopup`).
* **HUD** (`hud.ts`, `pickups.ts`): Punktestand zählt hoch (`easeScore`), Bumps (0,22 s, +22 %) bei Münzen/Kombo/Score, Herz-Pop bei Verlust (0,5 s) und Gewinn (0,35 s), Power-up-Ringe blinken unter 2 s Restzeit (5 Hz),
  Rekordbalken unter dem Punktestand (ab 90 % golden; nach dem Überholen zeigt die Zeile „Rekord“ den eigenen laufenden Stand), abgelehnter Dash lässt den Energiering 0,25 s wackeln und rot blinken. Touch: Energiering
  konzentrisch zum gemessenen Dash-Knopf, Power-up-Reihe hält Abstand zum Rutschen-Knopf (`HudFx.probeButtons`, Safe-Areas), Eck-Gruppen wachsen auf kleiner Bühne (`uiScaleFor`). Herzen, Herz-Leiste, Münze,
  Power-up-Blasen und Platten sind vorgerendert (`HudSpriteCache`, Schein als fertiger Halo statt `shadowBlur`); „HUD-Kosten ca. −45 %“ (Commit `d5352e7`).
* **Szene**: Shake-Zoom vergrößert die Szene um die Mitte, statt Ränder zu füllen, und zeichnet mit `imageSmoothingQuality = "low"`; Pause und Resume-Countdown zeigen ein pixelgleich eingefrorenes Bild (die visuelle Uhr
  `visTime` steht), Pause in der Luft ebenso; der Cyber-Flip zeichnet die Füße exakt.
* **Welten**: Blitze und Wetter-Aufheller laufen über eine gemeinsame Regel (`worlds/shared-b/flash.ts`, siehe WORLDS.md); alle acht Welt-Renderer wurden überarbeitet, die Änderungen betreffen laut Commits vor allem
  Backen und Laden (Abschnitt „Performance“). Sprites ferner Entitäten, die prozedural ersetzt werden, laufen in `save/restore` (Fix: veränderte Edelweiß-Münze, per Test abgesichert).

### Spielgefühl

* **Sim** (`sim.ts`, `spawner.ts`):
  * Rutsch-Puffer: ↓ im Fallen unter 75 px Höhe merkt sich 0,16 s „gleich rutschen“ statt eines Stampf-Sturzes; landet die Figur mit gehaltener ↓-Taste, rutscht sie direkt. Ein gepufferter Sprung hat Vorrang.
  * Der Sprung-Puffer läuft während der Betäubung nach einem Treffer nicht ab; ein Druck kurz nach dem Treffer feuert genau am Ende der Sperre.
  * „Knapp!“-Regel: Wer ein Hindernis berührt hat (Treffer, Schild, Dash, Turbo), bekommt beim Passieren keinen Beinahe-Treffer mehr (`Ent.fx.touched`).
  * Landeraum nach Gast-Gegner-Ketten: Takt 0,8 s statt 0,58 s und ein Schwanz von 0,5 s in der Rückgabelänge (`spawner.ts`); Pause zwischen Mustern mit Streuung 0,9 … 1,15 (`REST_JITTER_MIN/MAX`).
    Bot-Audit laut Commit `d5352e7`: Treffer direkt nach einer Kette 8,6 % → 1,0 %, erzwungene Kette hinter Kette 20 … 25 % → 0 %.
  * Neues Sim-Ereignis `dash-denied` (Dash bei zu wenig Energie oder Abklingzeit, höchstens alle 0,4 s) für Ton und HUD.
* **Eingabe** (`input.ts`, Tests `input.test.ts`):
  * Touch in der linken Zone (45 % der Fläche): kurzes Entscheidungsfenster, ob ein Wisch nach unten (nur Rutschen, kein Sprung) oder ein Tippen (Sprung) vorliegt; schräge Wische bis ca. 35° gelten als Wisch.
    Der durch das Warten verlorene Halte-Anteil wird ausgeglichen, damit die Sprunghöhe gleich bleibt. Maus, Stift und die rechte Fläche springen sofort.
  * Jede neu gedrückte Sprungtaste und jeder neue Zeiger ist eine Flanke (zweite Taste/zweiter Finger = Doppelsprung). Abgebrochene Berührungen (`pointercancel`) lösen nichts aus.
  * Sprung-Assistent (Einstellung): nach einer Sprung-Flanke gilt „Sprung gehalten“ für 0,38 s – Tippen ergibt einen vollen Sprung. Die Sim bleibt unverändert.
  * `discardEdges()` im Countdown: aufgelaufene Eingaben aus Pause und Countdown lassen die Figur bei „Los“ nicht von allein springen.
  * `onPointerKind`: der Hub schaltet die Touch-Bedienung nach der zuletzt benutzten Zeigerart (Stift ändert nichts). Eingabe hängt an der ganzen Spielfläche (Wurzel), nicht nur an der 16:9-Bühne.
  * Gamepad: D-Pad/linker Stick navigieren Menüs (`onNav`, nur solange das Spiel keine Eingabe annimmt), A bestätigt, B geht zurück; `rumble()` für Treffer und Tod.
* **Hub** (`game.ts`):
  * Schnellstart (Einstellung „Schneller Neustart“): Countdown 1 s mit einem Zähl-Ton statt 3,2 s – nur bei Wiederholung derselben Welt/desselben Modus/Helden; nach Pause/Game-Over ab dem 1. gewerteten Lauf,
    aus dem Menü erst ab dem 3. (`wantsQuickCountdown` in `run-summary.ts`).
  * „Lauf beenden“ (`quitRun("result" | "menu" | "restart")`): bucht den laufenden Lauf genau einmal (Münzen, Rekord, Lebenszeit) und zeigt die normale Ergebnis-Karte mit Ursache „Lauf beendet“, ohne Todes-Jingle.
    Gebucht wird nur, wenn etwas erreicht wurde (ganze Punkte oder Münzen, `isBankable`); ein Tod wird immer gebucht. Menü und Neustart aus der Pause buchen still.
  * Auto-Pause bei Fensterfokus-Verlust, verstecktem Tab, Verlassen des Vollbilds und Hochformat-Hinweis (`setPortraitBlocked`); der Countdown hält an, solange Fokus fehlt, der Tab verdeckt ist oder der Hinweis liegt.
  * Einsteiger-Hinweise nach Lage (`hints.ts`): Rutschen, Stampfen, Doppelsprung, Dash, Springen – nur in den ersten 3 gewerteten Läufen, höchstens einer gleichzeitig (3,5 s), jeder höchstens einmal je Lauf und nur,
    solange die Mechanik im Lauf noch nicht benutzt wurde. Wortlaut je Gerät (Tastatur/Touch).
  * Rekordjagd: einmal je Lauf, sobald der Punktestand den bisherigen Rekord der Bestenliste übersteigt (Rekord > 0): Toast „Neuer Rekord!“, Ton `checkpoint`, goldener Blitz 0,25.
  * Wackeln und Blitze getrennt regelbar (Einstellungen `shake`, `flashes`); Grubenblitz 0,35 (`PIT_FLASH`). Die Zeitlupe verlangsamt Welt, Partikel und Geister weich (Rampe 0,2 s).
  * `GameSnapshot` neu: `touch`, `storageOk`, `loadingWorld`, `live.coins`; `HudPowerup.left` (Restzeit in Sekunden), `HudState.reduced`, `dashDeniedT`, `recordPassed`.

### Komfort und Barrierefreiheit

* **Eingabesperren**: Game-Over-Karte 450 ms (`ARM_DELAY_MS`), Pause-Dialog 250 ms (`PAUSE_ARM_MS`) ohne Eingabe (Knöpfe gedimmt, Füllbalken); eine schon vor dem Einblenden gedrückte, noch gehaltene Taste (z. B. Leertaste) löst
  danach nichts aus (UI: `GameOverCard.tsx` → `useArmGate`).
* **Weniger Bewegung** (Einstellung oder Systemvorgabe `prefers-reduced-motion`): Wackeln aus, Blitze höchstens 0,3, HUD ohne Bumps/Pops, Squash halbiert, Tod nur Kippen, keine Flug-Münzen und Geschwindigkeits-Streifen,
  Punktzahl der Ergebnis-Karte zählt nicht hoch, CSS-Animationen aus (`data-reduced` an der UI-Wurzel). Die Regler „Wackeln“ und „Blitze“ zeigen den wirksamen Wert.
* **Touch-Ziele und Schrift**: Tippflächen mindestens 40 px, bei Touch und auf Bühnen bis 900 px mindestens 44 px, runde Knöpfe mit um 9 px vergrößerter unsichtbarer Trefferfläche; kleinste Schrift 11 px (UI: `fredrun2.module.css`).
* **Fokus und Tastatur**: sichtbarer Fokusring für alles Bedienbare (cyan), per Gamepad bewegter Fokus bekommt ihn auch ohne Tastatur (`data-nav="pad"`); die Reiter-Leiste folgt dem ARIA-Tab-Muster (`TabStrip`:
  Roving-Tabindex, Pfeile, Pos1/Ende, `aria-selected`/`aria-controls`); Bestenlisten- und Modus-Chips sind dieselbe Komponente.
* **Gamepad im Menü** (UI: `useGamepadNav.ts`): räumliche Fokus-Bewegung im obersten Overlay, A klickt, B klickt das Element mit `data-nav-back` (Pause: „Weiter“, Ergebnis: „Menü“) bzw. geht zum Reiter „Spielen“; Links/Rechts verstellt
  Regler und Auswahlfelder und wechselt Reiter; Hinweis „A = Bestätigen, B = Zurück“, sobald ein Pad erkannt ist.
* **Hochformat** (UI: `PortraitOverlay.tsx`): `rotate` über dem ganzen Bildschirm (Vollbild & Querformat, „Trotzdem spielen“), `embed`: Karte „Zum Spielen Vollbild öffnen“ für die eingebettete Ansicht auf dem Handy (Bühne < 600 px,
  Touch). Der Bereich dahinter ist `inert`. Ohne Vollbild-Schnittstelle (iPhone-Safari) entfällt der Knopf; eingebettet bleibt der Link „Eigenständig öffnen“.
* **Speicher-Hinweis** (UI: `StorageNotice`): erscheint auf jedem Menü-Reiter, wenn das Profil nicht gespeichert werden kann (`saveProfile` liefert `false` → `storageOk`).
* **Haptik** (`haptics.ts`): `navigator.vibrate` (Android) bei Treffer 35 ms, Stampfen 15, Tod 70-40-110, Grube 50, Dash 14, Power-up 10; dazu Controller-Rumble bei Treffer/Tod. Nie in der Demo, nie ohne Einstellung.
* **Signaltöne** (Einstellung „Signaltöne“): Dash wieder bereit, Herzschlag beim letzten Herz, Ende der Zeitlupe.
* **Ergebnis-Karte** (UI: `GameOverCard.tsx`, Logik `ui-logic.ts`): Punktzahl zählt in 0,9 s hoch (Klick auf die Karte springt ans Ende), Rekord-Kontext mit Fortschrittsbalken, Platz in der lokalen Liste, Münzen samt „Noch N bis <Held>“, sechs Statistiken.
* **Profil**: defekte Roh-Daten (JSON-Fehler) werden einmalig unter `findog.fredrun2.profile.v1.bak` gesichert, bevor sie überschrieben werden.

### Audio

Ausführlich in AUDIO.md (Engine-API, Cues, Mix); hier die Eckpunkte:

* Neue Engine-API: `stopStingers(fadeSec)`, `music.setMuffle(amount, rampSec)`, `prefetch({ music })` bzw. `preloadAudio()`; `unlock()` ist wiederholbar und startet Gemerktes auch bei spätem „running“ (Safari/iOS).
* Jingles laufen über einen eigenen Bus am Musik-Regler (`stingerBus`) und sind abbrechbar; Pause dämpft die Musik (Tiefpass 900 Hz, −5 dB), die Zeitlupe leicht (0,6).
* Ereignis → Ton in `game-audio.ts` (statt `audioFor` in `game.ts`): gerasterte Münz-/Kombo-/Stampf-Leiter, Zonen-Töne mit Abstands-Pegel und Budget, Zustands-Hinweise über `audio/cues.ts`; abgelehnter Dash spielt `ui-denied` leise.
* Neue Effekte `dash-ready` und `heartbeat` (rein synthetisch). Pegel-Feinabgleich der häufigen Rückmeldungen (Sprung, Münze, Countdown …) und Musik-Trim 1,6 → 1,2.

### Performance

* **Adaptive Qualität** (`quality-governor.ts`): zeitbasierte Fenster statt Frame-Zahlen, Ziel aus dem Anzeige-Intervall (60/90/120 Hz gleich behandelt, 30-Hz-Anzeige wird gehalten), Dauerlast statt Klippe bei 250 ms,
  Aufstieg erst nach 20 s Stabilität mit wachsendem Backoff, zuletzt stabile Stufe in `localStorage` (`findog.fredrun2.q`, nicht im Profil). Der Hub wertet nur voll gezeichnete Frames von Lauf und sichtbarem Menü und lässt nach
  Kontextwechseln 2 s einschwingen.
* **Auflösungs-Skala** (`render-scale.ts`): Bitmap = 1280·s × 720·s; Q0 exakt s = 1, Q1 bis 1,25 (auf 1/8 gerastet), Q2 bis 2, nie über 3,7 MP; Skalen nahe 1 rasten auf 1 (1:1-Schnellpfad der Welt-Caches). Die Welt-Renderer bekommen
  die Skala per `resize()`, gedrosselt (120 ms) und erst ab 0,02 Unterschied.
* **Zeichen-Drosselung** (`frame-policy.ts`): Pause und eingefrorenes Ergebnis zeichnen nur bei „dirty“ (Phasenwechsel, Resize, Qualitätswechsel, Tab-Rückkehr, auslaufendes Wackeln/Blitzen, 300 ms Nachlauf), Game-Over-Karte ca. 30 fps
  (Sieger-Tanz voll), verdecktes Menü ca. 8 fps; Countdown, Lauf und sichtbares Menü jeder Frame. Übersprungene Zeit holt der nächste gezeichnete Frame nach. Die Charakter-Bühne im Menü (`characterStage.ts`) steht, solange der
  Reiter nicht aktiv, die Leinwand nicht sichtbar oder die Seite verdeckt ist.
* **Bilder und Sprites** (`assets.ts`): Ladefehler/Hänger: Timeout 20 s, ein stiller Wiederholungsversuch nach 1,5 s, Fehlschläge werden nicht gemerkt. Dekodier-Warmup (`warmImage` im selben Canvas-Backend wie die Spielfläche,
  Flush per `createImageBitmap`), nur für den gespielten/gewählten Helden (`loadCharacter(id, only, { warm: true })`) und Welt-Props; der Hub lädt erst den Kern (`run, jump, fall, idle`), dann den Rest, und der Countdown wartet
  höchstens 1,5 s bei „1“ auf `warmed(true)`.
* **Welten** (alle acht): `load()` gibt zwischen den Bake-Schritten den Hauptthread frei (`yieldBetweenBakes`), `warm(budgetMs)` backt Stufen-Varianten, Sprites und Rauchgrößen in 3-ms-Scheiben vor (Wien, Prater, Alpen, Cyber, Wachau),
  `resize()` ist idempotent, Stufen-Varianten entstehen in kleinen Schritten und werden recycelt (`StagePrep`, `gradedCache`, `Staged`; `StagePrep` in Wien, Prater, Alpen, Cyber, Wachau, Oper). Vertrag und Bausteine: WORLDS.md. Aus den Commits: Wien gibt Roh-Fassade/-Dach nach den Bakes
  als Malfläche weiter (spart 4 MB), Prater/Alpen bestellen Sprites ferner Entitäten vor (`PropBank.early`), Alpen rastert `blendMasked` in 64-px-Streifen, Oper dekodiert Bilder per `fetch`/`createImageBitmap` außerhalb des
  Hauptthreads, Finanzamt zerlegt `Chunked` schrittweise, Cyber bereitet die RGB-Split-Flächen vor dem ersten Sturm vor, Wachau legt die Arbeitsflächen der Wahrzeichen im Leerlauf an.
* **Weltreise**: die nächste Welt lädt 500 m vor dem Tor (`TOUR_METERS - 500`) im Hintergrund; hängt ein Welt-Laden länger als 15 s, startet die Welt mit dem Basis-Renderer und wird später ersetzt (`WORLD_LOAD_TIMEOUT_MS`).
* **Messwerte aus den Commits** (headless Chromium, siehe Abschnitt 5): längste rAF-Lücke beim Weltladen (1×) von 102 … 115 ms auf 18 … 59 ms (`c489eff`); Resume-Countdown: Fehldauer des Touch-Rings von 1578 ms auf ca. 32 ms;
  im Software-Raster kostete ein Shake-Frame mit Skalierung „high“ 25 … 46 % der Frame-Zeit (Kommentar in `render.ts`, deshalb „low“).

### Menü

* **Einstellungen** (UI: `SettingsForm.tsx`) in vier Gruppen – Ton, Steuerung & Hilfen, Grafik & Komfort, Spieler –, ab 900 px Bühnenbreite zweispaltig; Hörprobe (Münze) beim Loslassen von „Gesamt“ und „Effekte“.
* **Startseite**: zwei Zusammenfassungs-Karten (Held, Welt/Modus mit Rekord) führen in die Reiter; während eine Welt lädt, zeigt der Spielen-Knopf „Welt wird geladen …“ und ist gesperrt (kein mehrfaches Starten).
* **Welten-Reiter** je Modus: Welt-Lauf wählt die Welt (Rekord-Badge), Weltreise zeigt die Route mit Nummern, Tageslauf hebt die Tages-Welt hervor (übrige gedimmt).
* **Bestenliste**: Chips in zwei Gruppen (Welten, Modi), leere Liste mit Knopf „Jetzt laufen“; Reiter-Tastaturmuster (ältere Skripte suchen die Chips per `role="tab"`, siehe `board-e2e.mjs`).
* **Kleine Bühnen**: Logo schrumpft mit, Reiter einzeilig und wischbar (Touch bzw. Bühne ≤ 480 px), Zurück-Pille bis 680 px nur als Pfeil, Fähigkeits-Chips der Heldenauswahl mit Maus bis 640 px Bühnenbreite einzeilig scrollbar (Commit `05f3870`).

## 2. Neue Einstellungen (`profile.ts`, `Settings`)

Alle in `localStorage` (`findog.fredrun2.profile.v1`); fehlende Felder in alten Profilen bekommen den Standardwert (`normalizeProfile`).

| Schlüssel | Standard | Wirkung | Ort in der Oberfläche |
|-----------|----------|---------|------------------------|
| `quickRestart` | `true` | Countdown 1 s statt 3,2 s bei Wiederholung desselben Laufs (Regel siehe oben) | Steuerung & Hilfen: „Schneller Neustart“ |
| `haptics` | `true` | Vibration (Android) und Controller-Rumble bei Treffer/Tod, nie in der Demo | Grafik & Komfort: „Vibration“ – nur sichtbar, wenn `navigator.vibrate` existiert oder ein Controller verbunden ist |
| `shake` | `1` | Stärke des Wackelns 0 … 1; bei „Weniger Bewegung“ wirksam 0 | Grafik & Komfort: „Wackeln“ |
| `flashes` | `1` | Stärke von Vollbild-Blitzen und Wetter-Aufhellern 0 … 1 (an die Welten als `view.flashScale`); bei „Weniger Bewegung“ höchstens 0,3 | Grafik & Komfort: „Blitze“ |
| `jumpAssist` | `false` | Sprung-Assistent: Tippen = voller Sprung (0,38 s „gehalten“ nach der Flanke) | Steuerung & Hilfen: „Sprung-Assistent“ |
| `cues` | `true` | Signaltöne: Dash bereit, Herzschlag beim letzten Herz, Ende der Zeitlupe | Steuerung & Hilfen: „Signaltöne“ |

Bestehende Schalter, jetzt im neuen Formular: `master` 0,85, `music` 0,6, `sfx` 0,9, `muted` aus, `reducedMotion` aus, `quality` „auto“ (feste Stufen „low“/„medium“/„high“ schalten den Governor ab und vergessen die gemerkte Stufe),
`showFps` aus (zeigt `fps · Q<Stufe>`), `hints` an (Einsteiger-Hinweise, nur in den ersten 3 Läufen).

## 3. Konstanten zum Nachjustieren

### Eingabe (`input.ts`)

| Name | Wert | Wirkung |
|------|------|---------|
| `SWIPE_DECIDE_MS` | 28 | Entscheidungsfenster für Touch links; danach springt die Figur (Sprunglatenz, Abschnitt 5) |
| `SWIPE_EXTEND_MS` | 60 | Fensterende, solange der Finger erkennbar nach unten zieht |
| `SWIPE_DRIFT_DY` | 2 px | Weg nach unten, ab dem das Fenster bis `SWIPE_EXTEND_MS` offen bleibt |
| `SWIPE_MIN_DY` | 10 px | Mindestweg nach unten für „Wisch“ im Fenster |
| `LEFT_ZONE` | 0,45 | linker Anteil der Fläche mit verzögertem Touch-Sprung |
| `SWIPE_RATIO` (intern) | 1,4 | Wisch-Kegel: `dy > 1,4 · dx` (ca. 35° um die Senkrechte) |
| `MAX_HOLD_COMP_S` (intern) | 0,1 s | Obergrenze des Halte-Ausgleichs; muss die verlängerte Wartezeit decken |
| `JUMP_ASSIST_S` | 0,38 s | Dauer „Sprung gehalten“ des Assistenten |
| `NAV_REPEAT_MS`; `NAV_DEADZONE` (intern) | 350 ms; 0,5 | Wiederholung einer gehaltenen Richtung und Totzone der Gamepad-Menünavigation |
| im Code: Wisch rechts/Maus | `dy > 46`, `dy > 1,2 · dx`, < 500 ms | unverzögerter Wisch außerhalb der linken Zone; Rutschen hält danach 0,6 s (`swipeSlideUntil`) |

### Sim und Generator

| Datei · Name | Wert | Wirkung |
|--------------|------|---------|
| `sim.ts` · `SLIDE_BUFFER` (intern) | 0,16 s | Rutsch-Puffer vor der Landung |
| `sim.ts` · `SLIDE_BUFFER_HEIGHT` (intern) | 75 px | darunter wird ↓ im Fallen zum Puffer statt zum Stampfen |
| `constants.ts` · `JUMP_BUFFER`, `COYOTE_TIME`, `NEAR_MISS_CLEARANCE` | 0,13 s, 0,1 s, 24 px | unverändert, hängen am Spielgefühl |
| `sim.ts` · Mindestabstand `dash-denied` | 0,4 s (Literal in `handleInput`) | Häufigkeit der Rückmeldung |
| `spawner.ts` · `REST_JITTER_MIN/MAX` | 0,9 / 1,15 | Streuung der Pause zwischen Mustern (untere Grenze = Worst-Case für Landeräume) |
| `spawner.ts` · Gast-Gegner-Kette (`gap`, `tail`) | 0,8 s, 0,5 s | Takt der Gegner und Landeraum nach dem letzten |

### Hub (`game.ts`)

| Name | Wert | Wirkung |
|------|------|---------|
| `SLOW_RAMP_S` | 0,2 s | Rampe der visuellen Zeitlupe |
| `MUFFLE_PAUSE` / `MUFFLE_SLOW` | 1 / 0,6 | Musikdämpfung in Pause/Resume bzw. Zeitlupe |
| `PIT_FLASH`, `RECORD_FLASH` | 0,35, 0,25 | Blitzstärke beim Grubensturz und beim Überholen des Rekords (vor dem Regler „Blitze“) |
| `RUMBLE_HURT`, `RUMBLE_DEATH` | [0,6; 150 ms], [1; 320 ms] | Controller-Rumble |
| `WARM_SLICE_MS`, `WARM_RUN_S`, `WARM_WAIT_S` | 3 ms, 20 s, 1,5 s | Zeitscheibe für `warm()`, Aufwärmfenster im Lauf, Höchstwartezeit des Countdowns auf das Sprite-Warmup |
| `WORLD_LOAD_TIMEOUT_MS`, `INIT_CAP_MS` | 15 000, 20 000 | Welt-Laden bzw. erster Ladebildschirm: danach Basis-Renderer bzw. Menü |
| `WORLD_RESIZE_DEBOUNCE_MS`, `WORLD_SCALE_EPS` | 120 ms, 0,02 | Nachziehen der Skala in den Welten |
| `DRAW_SETTLE_MS`, `GOVERNOR_SETTLE_MS` | 300 ms, 2000 ms | Nachlauf nach Zeichen-Anlass; Einschwingzeit ohne Governor-Wertung |
| `CORE_ANIMS` | `run, jump, fall, idle` | zuerst geladene Animationen des Helden |

### Qualität (`quality-governor.ts`, `render-scale.ts`, `frame-policy.ts`)

| Name | Wert | Wirkung |
|------|------|---------|
| `WINDOW_MS` (intern) | 1500 | Bewertungsfenster |
| `BAD_FACTOR` / `MEAN_FACTOR` / `BAD_SHARE` (intern) | 1,35 / 1,25 / 0,25 | Abstieg bei ≥ 25 % Frames > 1,35 · Ziel oder Mittel > 1,25 · Ziel |
| `SEVERE_MS`, `SEVERE_DT_MS` (intern) | 800, 60 | Dauerlast > 60 ms über 0,8 s: sofort Q0 |
| `OUTLIER_MS`, `OUTLIER_RUN_MIN` (intern) | 250, 3 | einzelne Frames darüber zählen nicht, ab dem dritten in Folge schon |
| `MIN_DWELL_AFTER_UP_MS` (intern) | 3000 | frühester Abstieg nach einem Aufstieg |
| `ASCENT_AFTER_MS`, `ASCENT_BAD_SHARE`, `ASCENT_BUSY_FACTOR` (intern) | 20 000, 0,02, 0,5 | Aufstieg nach 20 s mit ≤ 2 % schlechten Frames und busy < 0,5 · Ziel |
| `FAIL_WINDOW_MS`, `BACKOFF_BASE_MS`, `BACKOFF_MAX_MS` (intern) | 10 000, 120 000, 960 000 | wird ein Aufstieg binnen 10 s zurückgenommen, bleibt die Maximalstufe 120 s gedeckelt, dann verdoppelt |
| `PERSIST_AFTER_MS` (intern) | 30 000 | Stufe gilt als stabil und wird gemerkt (Abstiege sofort) |
| `QualityGovernor.initialLevel` | Touch + (≤ 4 Kerne oder ≤ 3 GB) + dpr ≥ 2 → Q1, sonst Q2 | Startstufe, wenn nichts gemerkt ist |
| `MAX_RENDER_PIXELS`, `Q1_MAX_SCALE`, `Q2_MAX_SCALE` | 3 700 000, 1,25, 2 | Obergrenzen der Auflösungs-Skala |
| `GAMEOVER_INTERVAL_MS`, `COVERED_INTERVAL_MS` | 28, 117 | Mindestabstand gezeichneter Frames (Game-Over-Karte, verdecktes Menü) |
| `game.ts` · Partikelbudget je Stufe | 0,35 / 0,7 / 1 | in `setQuality` |

### UI-Logik, Hinweise, Haptik

| Datei · Name | Wert |
|--------------|------|
| `ui-logic.ts` · `ARM_DELAY_MS`, `PAUSE_ARM_MS` | 450, 250 |
| `run-summary.ts` · `QUICK_COUNTDOWN_S`, `QUICK_MENU_RUNS` | 1, 3 |
| `hints.ts` · `HINT_LOOKAHEAD_PX`, `HINT_SHOW_S`, `HINT_GAP_S`, `HINT_MAX_RUNS` | 1100, 3,5, 0,5, 3 |
| `hints.ts` · `JUMP_HINT_AT_S`, `JUMP_HINT_UNTIL_S`, `DASH_HINT_AFTER_S` | 0,2, 2, 7 |
| `haptics.ts` · `HAPTIC_PATTERNS` | hurt 35, stomp 15, death [70, 40, 110], pit 50, dash 14, powerup 10 (ms) |
| UI: `GameOverCard.tsx` · `COUNT_UP_MS` | 900 |
| UI: `FredRun2.tsx` · `EMBED_PHONE_WIDTH` | 600 (eingebettet unter dieser Breite kommt die Vollbild-Karte) |
| UI: `fredrun2.module.css` · `--tap`, `--tap-min`, `--hit` (`.stage`) | 44 px, 40 px, 0 → 9 px bei Touch/Bühne ≤ 900 px |

### HUD und Darstellung

| Datei · Name | Wert |
|--------------|------|
| `hud.ts` · `BUMP_TIME`, `BUMP_GAIN`, `SCORE_EASE_RATE`, `SCORE_BUMP_MIN` | 0,22 s, 0,22, 14/s, 8 |
| `hud.ts` · `HEART_LOSS_TIME`, `HEART_GAIN_TIME`, `BLINK_BELOW`, `BLINK_HZ`, `BLINK_MIN` | 0,5 s, 0,35 s, 2 s, 5 Hz, 0,45 |
| `hud.ts` · `DASH_DENIED_TIME`, `DASH_DENIED_SHAKE` | 0,25 s, 6 |
| `hud.ts` · `UI_SCALE_TARGET`, `UI_SCALE_MAX`, `UI_SCALE_TOP_LEFT_MAX` | 0,72, 1,35, 1,2 |
| `draw-utils.ts` · `SQUASH_*`, `HIT_FLASH_*`, `INVULN_PULSE_*`, `DEATH_*` | siehe Abschnitt „Visuals“ |
| `draw-utils.ts` · `SPEED_LINE_START/FULL`, `SPEED_LANES`; `render.ts` · `SPEED_LINE_GAIN` | 520, 1100, 12; 2,2 |
| `particles.ts` · `MAX_FLYING`, `ORBIT_MAX` | 3, 4 |

### Audio

| Datei · Name | Wert | Wirkung |
|--------------|------|---------|
| `audio/tracks.ts` · `TRACK_TRIM` | 1,2 (vorher 1,6) | Pegel der aufgenommenen Musik |
| `audio/sfx.ts` · `G_JUMP`, `G_DOUBLEJUMP`, `G_SLIDE` | 1,5, 1,35, 1,5 | `SFX_META.gain` der Bewegungs-Töne |
| `audio/sfx.ts` · `G_DASH`, `G_STOMP_CHAIN`, `G_COIN`, `G_GEM` | 1,35, 1,35, 1,25, 1,3 | |
| `audio/sfx.ts` · `G_COUNTDOWN`, `G_GO`, `G_HEARTBEAT` | 1,6 (wirkt wie 1,5), 1,25, 1,5 | Obergrenze ist der Stimmen-Clamp 1,5 (`SfxVoice`) |
| `audio/sfx.ts` · `DUCK_COUNT`, `DUCK_MICRO` | [0,3; 0,2 s], [0,25; 0,25 s] | Musik-Absenkung bei Countdown/Go bzw. Herz, Power-up, Beinahe-Treffer, Combo-Aufstieg |
| `audio/loops.ts` · `avalanche.base` | 0,5 (vorher 0,7) | Lawine lag bei Level 0,6 ca. 4 dB über der Musik |
| `audio/graph.ts` · `MUFFLE_HZ`, `MUFFLE_DB`, `MUFFLE_TAU`, `DUCK_RELEASE_TAU` | 900 Hz, −5 dB, 0,12 s, 0,12 s | Dämpfung und Aufhebung der Absenkung |
| `game-audio.ts` · `ZONE_MIN_GAP_SEC`, `ZONE_WINDOW_SEC`, `ZONE_AUDIBLE_VOLUME` | 0,35 s, 1 s, 0,25 | Zonen-Ton-Budget: höchstens 2 je Sekunde, Töne unter 0,25 zählen nicht |
| `game-audio.ts` · `HEARTBEAT_VOLUME`, `DASH_DENIED_VOLUME`, `STOMP_START_PITCH/VOLUME` | 0,4, 0,5, 0,75 / 0,45 | |
| `audio/cues.ts` · `CUE_QUIET_SEC`, `HEARTBEAT_GAP_SEC`, `COIN_PITCH_MAX` | 2 s, 1,3 s, 2,5 | keine Hinweise in den ersten 2 s; Herzschlag-Takt |

### Welten und Assets

| Datei · Name | Wert |
|--------------|------|
| `worlds/shared-b/layers.ts` · `StagePrep` (`nextFrom`, `nextFromLow`, `gapMs`) | 0,28, 0,6, 100 ms |
| `worlds/shared-b/flash.ts` · `REDUCED_FLASH_MAX` | 0,3 |
| `worlds/shared-b/canvas.ts` · `TOUCH_SIZE` (intern) | 160 px |
| `assets.ts` · `IMAGE_TIMEOUT_MS`, `IMAGE_RETRY_MS` | 20 000, 1500 |
| `assets.ts` · `WARM_BUDGET_MS`, `WARM_MIN_IDLE_MS`, `WARM_FORCE_MS`, `WARM_FLUSH_TIMEOUT_MS` (intern) | 24, 12, 1000, 500 |

## 4. Test- und Messwerkzeuge

| Werkzeug | Zweck |
|----------|-------|
| `npx vitest run src/game/fredrun2` | Einheitentests; neu u. a. `input`, `ui-logic`, `hints`, `haptics`, `run-summary`, `quality-governor`, `render-scale`, `frame-policy`, `yield`, `hud-fx`, `render-logic`, `render-scene`, `assets` (Warmup/Timeout), `audio/cues`, `game-audio`, `audio/engine`, `worlds/shared-b/*`. Stand der Abnahme: 41 Dateien, 1141 Tests grün (8 übersprungen = Bot-Fairness-Audit). Dazu `npx tsc --noEmit` und `npx eslint src/game/fredrun2 src/components/fredrun2 tools/fredrun2` |
| `node tools/fredrun2/ui-harness.mjs --port 3130 [--watch] [--component-dir <dir>] [--supabase]` | bündelt `FredRun2.tsx` per esbuild aus dem Arbeitsbaum und liefert `/fredrun2` samt `public/` ohne `next build`/`next dev` (alles im Speicher). Seite: `/fredrun2?debug=1` (setzt `window.__fr2.game`), `?embedded=1[&w=<px>]` (eingebettet, optional feste Breite). `--watch` bündelt bei jedem Laden neu, `--component-dir` vergleicht gegen einen früheren Stand (`git archive <rev> src/components/fredrun2`), `--supabase` bündelt den Supabase-Browserclient mit der Dummy-Konfiguration, die `board-e2e.mjs` verlangt. `next/link` ist durch ein `<a>` ersetzt, `/api/*` antwortet 404 |
| `node tools/fredrun2/e2e.mjs --base http://localhost:3130 [--shots <dir>]` | End-to-End der Seite (Menü, Kauf, Lauf, Pause, Game-Over, Persistenz, Weltreise); laut Kopfkommentar des Harness gegen dessen Menü-Teil und Lauf einsetzbar, sonst gegen `next start` |
| `node tools/fredrun2/board-e2e.mjs --base <url>` | globale Bestenliste mit simulierter Anmeldung/API; sucht den Weltreise-Chip seit dieser Runde als `role="tab"` |
| `node tools/fredrun2/page-shot.mjs --url <url> --steps … [--size 844x390 --touch true --dpr 2 --reduced true]` | Screenshots der echten Seite inkl. Menü, auch gegen den Harness (`--url http://localhost:3130/fredrun2`) |
| `node tools/fredrun2/shot.mjs --world wien --meters 0,600 --seconds 3,8 --out … [--fps] [--live 8] [--dpr 2] [--size WxH]` | Spielcode im headless Chromium; `--fps` misst Sim + Render synchron, `--live <s>` spielt in Echtzeit über rAF und gibt fps/p95/p99 aus |
| `node tools/fredrun2/mem-probe.mjs` | misst Canvas-Speicher (Offscreen-Caches) je Welt und in der Weltreise (`DPR=<n>` per Umgebung) |
| `FFMPEG=<pfad> node tools/fredrun2/audio-smoke.mjs [--only bank,fallback,48k,gapless,stinger-stop,late-resume,muffle,stinger-bus,prefetch]` | Audio-Engine im echten Browser; neu: Szenarien `stinger-stop`, `late-resume`, `muffle`, `stinger-bus`, `prefetch` |
| `src/game/fredrun2/harness.ts` | QA-Harness für `shot.mjs`/`mem-probe.mjs`: `window.__fr2 = { game, sfxLog }`, `sfxLog` sammelt bis zu 500 aufgerufene Effektnamen (Zähl-Töne, Jingles prüfen) |

## 5. Bekannte Grenzen

* **Messungen im Software-Raster.** Alle Zeit- und Lückenwerte in Commits und Kommentaren stammen aus headless Chromium (überwiegend SwiftShader-Software-Rasterung, teils gedrosselte CPU). Sie zeigen Verhältnisse, keine Absolutwerte
  für Handys oder GPU-Rechner; die Schwellen des Governors (Abschnitt 3) sind aus Code-Überlegungen und diesen Messungen abgeleitet, nicht auf Zielgeräten kalibriert.
* **Governor sieht nur CPU-Zeit.** `busyMs` misst Arbeitszeit des Frames; ein GPU-gebundenes Gerät mit konstant 33 ms ist von einer 30-Hz-Anzeige nicht zu unterscheiden und wird gehalten (Kommentar in `quality-governor.ts`).
* **Sprunglatenz links auf Touch.** Ein Tippen in der linken Zone (45 % der Fläche) springt erst nach `SWIPE_DECIDE_MS` (28 ms), bei Drift nach unten bis `SWIPE_EXTEND_MS` (60 ms), beim Loslassen sofort. Der Halte-Ausgleich
  (≤ 0,1 s) gleicht die Sprunghöhe aus, nicht die Latenz. Rechts, mit Maus und Stift springt es sofort.
* **Nicht auf echten iOS-/Android-Geräten getestet.** Gilt für Touch-Wisch und Sprunglatenz, Vibration (iOS-Safari hat kein `navigator.vibrate`, der Schalter ist dort ausgeblendet), Controller-Rumble, Safe-Area-Messung der
  Touch-Knöpfe, Vollbild/Querformat-Sperre, `navigator.audioSession` (iOS-Stummschalter, „nur per Code geprüft“ laut `audio/README.md`), Safari-Pfade ohne `requestIdleCallback`/`addEventListener` auf `MediaQueryList`.
* **Audiopegel nicht nach Gehör.** `TRACK_TRIM`, die `G_*`-Werte und `avalanche.base` beruhen auf Offline-Render-Messungen (1/3-Oktav-Marge über dem Musik-Median); die Kommentare verweisen auf `impl/pkg-audio-mix/measure.json`,
  die nicht im Repo liegt. Die Bank-Effekte selbst wurden ebenfalls ohne Anhören gebaut (AUDIO.md, „Bekannte Schwächen“).
* **Warm-up nur in der Live-Schleife.** QA-Pfade (`debugAdvance`, `debugRender`, `debugSettle`) rufen `warm()` nicht auf; Screenshots backen wie früher lazy.
* **Welten-Optik.** Für die Überarbeitung der Welt-Renderer belegen die Commits Tests (`worlds/<welt>.test.ts`, Bot-Lösbarkeit); ein Durchgang auf Geräten ist nicht dokumentiert. `ENGINE_REQUESTS.md` ist unverändert.
* **Testlauf nicht wiederholt.** Die genannten Testzahlen stammen aus Commit-Nachrichten; für diese Dokumentation wurde nichts gebaut oder ausgeführt.

## 6. Manuelle Testliste

Vor einer Abnahme auf echten Geräten (Handy quer, Desktop, Controller), jeweils mit frischem Profil und mit vollem Profil:

1. **Touch links**: Tippen springt (kurz = niedrig, halten = höher, gleiche Höhe wie rechts); aus dem Stand nach unten wischen rutscht ohne Sprung, auch schräg; zweiter Finger = Doppelsprung; Sprung-Assistent an: Tippen = voller Sprung.
2. **Rutsch-Puffer**: in der Luft kurz vor der Landung unter einem Überhang ↓ drücken – die Figur rutscht beim Aufsetzen; ↓ gehalten bei der Landung rutscht ebenfalls.
3. **Dash**: ohne Energie Dash drücken – Ring wackelt rot, leiser Ablehnungston, kein Dauergeräusch; mit Energie: Dash, danach Ton „bereit“ (Signaltöne an).
4. **Game-Over und Pause**: Dauertippen/gehaltene Leertaste beim Tod überspringt die Karte nicht (450 ms); Doppeltipp auf Pause löst nicht „Weiter“ aus (250 ms); „Lauf beenden“ zeigt die Karte mit „Lauf beendet“, Münzen und Rekord gebucht;
   „Neustart“ aus der Pause bucht und startet neu; Pause in der Luft friert das Bild ein.
5. **Auto-Pause**: Tab wechseln, Fenster verlassen, Vollbild mit Esc verlassen, Gerät ins Hochformat drehen – der Lauf pausiert, der Countdown hält an; „Trotzdem spielen“ pausiert nicht mehr.
6. **Schnellstart**: Lauf 1 aus dem Menü hat den langen Countdown; Wiederholung nach Game-Over/Pause 1 s; Wechsel von Welt/Held/Modus oder Einstellung aus: langer Countdown.
7. **Hinweise**: frisches Profil, Läufe 1 bis 3 – je Mechanik höchstens ein Hinweis, Touch-Wortlaut ohne Tastennamen; ab Lauf 4 keine.
8. **Rekordjagd**: bei vorhandenem Rekord erscheint „Neuer Rekord!“ genau einmal, beim ersten Lauf ohne Rekord nie.
9. **Weniger Bewegung und Regler**: Wackeln auf 0, Blitze auf 0 (Wien-Gewitter, Prater-Gewitter, Cyber-Sturm, Finanzamt-Alarm); „Weniger Bewegung“ an: Regler zeigen „aus“ bzw. „≤ 30 %“, kein Squash-Übermaß, keine Streifen/Flug-Münzen.
10. **Vibration und Rumble**: Android – Treffer, Tod, Stampfen, Grube spürbar, in der Menü-Demo nie; Controller – Rumble bei Treffer/Tod.
11. **Gamepad im Menü**: D-Pad/Stick bewegen den Fokus mit sichtbarem Ring, A bestätigt, B geht zurück (Pause: „Weiter“, Ergebnis: „Menü“), Regler und Auswahlfelder mit Links/Rechts, Heldenliste hoch/runter.
12. **Audio nach Gehör**: Sprung, Münze, Doppelsprung, Countdown, „Los“ und Dash gegen die Musik in Wien, Cyber, Oper; Lawine (Alpen, Christkindlmarkt) nicht lauter als die Musik; Pause und Zeitlupe dämpfen die Musik hörbar und weich; Neustart nach Game-Over:
   kein Jingle klingt in den neuen Lauf; Herzschlag beim letzten Herz hörbar, aber nicht aufdringlich; Zonen-Töne (Blitz, Stempel, Laser, Steinschlag) nie mehr als zwei pro Sekunde; iPhone: Ton trotz Stummschalter, Ton nach spätem Entsperren.
13. **Qualität**: FPS-Anzeige an, auf einem schwachen Gerät beobachten, ob `Q` fällt und nicht pendelt; feste Stufen halten; Browser-Zoom, Fensterwechsel auf anderen Monitor und Vollbild ändern die Auflösung ohne Flackern der Welten.
14. **Laden**: Weltwahl im Menü zeigt „Welt wird geladen …“ nur bei ungeladenen Welten; Weltreise-Übergänge ohne spürbaren Hänger; Offline/blockierte Bilder: Spiel startet mit Ersatzgrafik, keine Konsolenfehler außer Netzfehlern.
15. **Speicher**: privates Fenster/gesperrter Speicher – Hinweis auf jedem Menü-Reiter, Spiel läuft weiter.
16. **Kleine Bühnen**: Handy quer (z. B. 667×375, 844×390) und eingebettet unter 600 px: Menü ohne Überdeckung, Tippflächen ≥ 40 px (Touch 44 px), Schrift ≥ 11 px, Vollbild-Karte beim eingebetteten Handy.
