# Fredrun 2.0

Endlos-Runner im Browser – als Ansicht der App (Seitenleiste/Icon-Leiste/Dashboard „Fredrun 2.0“, aufgebaut wie das Original-Fredrun: `FredRun2View`, Kopfzeile „Findog Spielpause“, Vollbild-Schaltfläche) und eigenständig unter `/fredrun2`: acht Welten, fünf Helden (Fred, Frida, Superfred, Cyberfred, Superfrida –
alle aus dem Originalspiel), Highscore/Bestenliste, Weltreise-Modus und Tageslauf. Läuft ohne Server-Anbindung
(Speicherstand in `localStorage`), Canvas 2D, fester Zeitschritt (120 Hz) mit Interpolation (Figur und Entitäten), adaptive Bildqualität samt Auflösungs-Skala.
Die Verbesserungsrunde (Visuals, Spielgefühl, Komfort, Audio, Performance) ist in `POLISH.md` beschrieben.

## Architektur

```
src/game/fredrun2/            (Framework-unabhängig, TypeScript strict)
  constants.ts                Maße, Physik, Balancing
  types.ts                    Vertrag Engine ↔ Welten (Ent, PatternCtx, WorldDef, WorldRenderer …)
  rng.ts                      deterministischer PRNG (Seed → reproduzierbarer Lauf, Tageslauf)
  sim.ts                      reine Simulation: Spielfigur, Physik, Kollision, Punkte, Combo, Power-ups, Tour-Tore; Entitäten tragen px/py für die Interpolation
  spawner.ts, patterns.ts     Level-Generator (zeitbasierte Muster, Schwierigkeitsrampe, Gast-Gegner, Belohnungen)
  bot.ts                      vorausschauender Bot (Tests, Attract-Modus im Menü, QA-Screenshots)
  characters.ts               Helden + Fähigkeiten + Preise
  profile.ts                  Persistenz: Münzen, Freischaltungen, lokale Bestenlisten (Fallback), Einstellungen (siehe POLISH.md)
  assets.ts                   Bilder (Timeout/Retry), Charakter-Atlanten (public/fredrun2/chars), Props-Bibliothek, Dekodier-Warmup (ASSETS.md)
  render.ts, hud.ts,          Zeichnen: Figur, Effekte, Partikel, HUD (vorgerenderte HUD-Sprites in pickups.ts), Post-Processing
  particles.ts, pickups.ts
  draw-utils.ts               Zeichenhelfer und reine Darstellungslogik (Lauf-Phase, Squash, Treffer-Puls, Schatten, Tod-Pose, Tempo-Streifen)
  input.ts                    Tastatur, Touch/Zeiger (Tippen, Wischen, Sprung-Assistent), Gamepad (Spiel, Menü-Navigation, Rumble), Bildschirmtasten
  game.ts                     Hub/Controller: Schleife, Countdown (kurz/lang), Pause, Auto-Pause, „Lauf beenden“, Game-Over, Demo, Audio-Verknüpfung, Qualität, Skalierung, Ladekette
  game-audio.ts               Sim-Ereignis → Ton (Münz-/Combo-Leitern, Zonen-Budget, Signaltöne)
  run-summary.ts              Laufzusammenfassung und -buchung, Schnellstart-Regel, Countdown-Zahl
  ui-logic.ts, hints.ts,      reine UI-Logik (Zahlenformat, Eingabesperren, Game-Over-Texte), Einsteiger-Hinweise, Vibration
  haptics.ts
  quality-governor.ts,        adaptive Qualitätsstufe (Q0..Q2), Auflösungs-Skala, Zeichen-Drosselung (Pause/Game-Over/verdecktes Menü)
  render-scale.ts, frame-policy.ts
  yield.ts                    yieldToMain(): Hauptthread freigeben (scheduler.yield → MessageChannel → setTimeout)
  audio/                      Web-Audio: aufgenommene Musik-Schleifen (tracks.ts), CC0-Sample-Bank für Effekte (bank.ts), prozeduraler Fallback, Hinweis-Logik (cues.ts) – siehe audio/README.md, MUSIC.md, AUDIO.md
  worlds/<id>.ts              Welt-Module (Muster, Renderer, Systeme) – siehe WORLDS.md
  worlds/shared-a, shared-b   gemeinsame Bausteine (Kachel-/Stufen-Caches, Aufwärmen, Lade-Yield, Blitz-Regel, Test-Attrappen) – siehe WORLDS.md
src/components/fredrun2/      React-Oberfläche + CSS-Module: Menü (FredRun2.tsx, SettingsForm, CharacterSelect), Overlays (PauseDialog, GameOverCard, PortraitOverlay),
                              Gamepad-Navigation (useGamepadNav), globale Bestenliste (globalBoard), Touch-Tasten
src/components/fredrun2/FredRun2View.tsx   App-Ansicht (eingebettet, `embedded`-Modus von FredRun2, Spielername aus dem Original-Profil)
src/app/fredrun2/page.tsx     eigenständige Route
public/fredrun2/              Sprites (chars/, props/), Vorschaubilder (previews/)
tools/fredrun2/               Python-Pack-Skripte (Sprites/Props), QA-Werkzeuge (shot.mjs, page-shot.mjs, e2e.mjs, ui-harness.mjs …)
```

## Spielprinzip & Mechaniken

* Springen (variable Höhe, Doppelsprung, Coyote-Time, Jump-Buffer), Rutschen (mit Puffer: ↓ kurz vor der Landung bzw. gehalten rutscht beim Aufsetzen), **Stampfen** in der Luft (Schockwelle, Bounce auf Gegner),
  **Dash** (Energiering, unverwundbar, zerschmettert Kisten/Geschosse; ohne Energie wird er abgelehnt und das HUD meldet es), **Kombo ×1…×8** (Beinahe-Treffer, Stampfer, Münzserien;
  ein berührtes Hindernis gibt keinen Beinahe-Treffer).
* 3 Herzen (max. 5), Treffer = Tempo-Verlust + Unverwundbarkeit; Power-ups: Magnet, Schutzschild, Zeitlupe, Turbo-Rakete, Herz.
* Heldenfähigkeiten: Fred „Spürnase“ (Münz-Sog), Frida „Blitzstart“ (Energie), Superfred „Cape-Gleiter“, Cyberfred „Düsen-Dash“, Superfrida „Super-Stampfer“.
* Gast-Gegner aus dem Original (Odo, Madinger, JQA, Luki) laufen in jeder Welt entgegen (stampfen!).
* Acht Welten mit eigener Signatur-Mechanik: Wien (Blitz + Straßenbahn-Surfen), Alpen (Lawine, Aufwind, bröckelnde Plattformen),
  Finanzamt (Stempel, Laser, Förderbänder, Dunkelheit), Prater (Pendel, Trampoline, Riesenrad-Plattformen), Wachau (Flöße, Weinfässer),
  Cyber-Wien (Schwerkraft-Umkehr, Phasen-Tore), Christkindlmarkt (Eisflächen, Schneeball-Elfen, Krampus-Verfolgung),
  Opernball (Dreiertakt-Muster, Kronleuchter-Pendel, Klavier-Sprungbrett, Spotlights).
* Modi: **Welt-Lauf** (je Welt eigene, weltweite Bestenliste – siehe HIGHSCORES.md), **Weltreise** (alle Welten hintereinander, Tore, steigende Schwierigkeit),
  **Tageslauf** (gleicher Seed für alle am selben Tag).
* Schwierigkeit: Meter → Schwierigkeitsstufe → Tempo (470 → 1180 px/s) und Musterauswahl; Abstände in Zeit definiert ⇒ jedes Muster bleibt lösbar.

## Welten

| Welt | Signatur | Stufen | Muster |
|------|----------|--------|--------|
| Wien im Sturm | Blitz-Vorwarnung, Straßenbahn-Surfen, Katastrophen-Story (8 Stufen mit den Originalhintergründen) | 8 | 18+ |
| Alpenpanorama | Lawine (fair getaktet), Aufwind, bröckelnde Felsen, Gondeln, Steinschlag | 5 | 28 |
| Finanzamt bei Nacht | Riesenstempel, Laser-Gitter (springen/rutschen), Förderbänder, Taschenlampen-Dunkelheit | 5 | 29 |
| Prater | Kettenkarussell-Pendel, Trampoline, Riesenrad-Gondeln, Kanonen | 5 | 18+ |
| Wachau | Floß-Sprünge über die Donau, rollende Weinfässer, Bienen, Marillen | 5 | 23 |
| Cyber-Wien 2099 | Schwerkraft-Umkehr (Decken-Lauf), Phasen-Tore, Drohnen, Glitch | 5 | 24 |
| Christkindlmarkt | Eisflächen (Tempo-Rutsche), Schneeball-Elfen, Eiszapfen, Glühwein-Aufwind, Rodel-Plattformen, Krampus-Verfolgung (gemalte Kulissen, GPT Image 2) | 5 | 31 |
| Opernball | Dreiertakt-Folgen, Kronleuchter-Pendel, Champagner-Korken, Kellner/Tanzpaare zum Stampfen, Klavier-Sprungbrett, Spotlights (gemalte Kulissen, GPT Image 2) | 5 | 29 |

Weitere Dokumente: `POLISH.md` (Verbesserungsrunde: Neuerungen, Einstellungen, Konstanten, Werkzeuge, Grenzen, Testliste), `ASSETS.md` (Sprite-/Prop-Konventionen, Ladevertrag), `WORLDS.md` + `WORLD_BRIEFS.md` + `WORLD_BRIEFS_2.md` (Welt-Vertrag und Briefings),
`ENGINE_REQUESTS.md` (Wünsche der Welt-Autoren + Status), `AUDIO.md` (Engine-API, Klangeffekte: Sample-Bank aus Kenney-CC0-Samples, Rezepte, Neubau, Pegel, Hinweis-Töne), `MUSIC.md` (Musik und Jingles), `ART.md` (Bild-Pipeline), `HIGHSCORES.md` (globale Bestenlisten).

## Einstellungen und Komfort

Menü → „Einstellungen“ (Gruppen Ton, Steuerung & Hilfen, Grafik & Komfort, Spieler). Neu: Sprung-Assistent, Schneller Neustart, Signaltöne, Vibration, Regler „Wackeln“ und „Blitze“; dazu „Weniger Bewegung“ (auch über die Systemvorgabe),
Qualität „Automatisch/Hoch/Mittel/Niedrig“, Hinweise, FPS-Anzeige. Standardwerte und Wirkung: `POLISH.md`. Komfortfunktionen im Spiel: Auto-Pause (Fokus-/Tab-Verlust, Vollbild verlassen, Hochformat), „Lauf beenden“ in der Pause (bucht den Lauf),
Eingabesperren auf Pause und Ergebnis-Karte (250/450 ms), Einsteiger-Hinweise in den ersten drei Läufen, Hinweis bei nicht speicherbarem Profil, Gamepad-Navigation in den Menüs.

## Qualitätssicherung

* `npx vitest run src/game/fredrun2` – Sim-, Profil-, Eingabe-, Hub-Logik- (`ui-logic`, `hints`, `run-summary`, `quality-governor`, `frame-policy` …), Audio-, Weltentests und **Bot-Lösbarkeitstests** für alle Welten
  (`BOT_WORLDS=wien,alpen npx vitest run src/game/fredrun2/bot.test.ts`). Dazu `npx tsc --noEmit` und `npx eslint src/game/fredrun2 src/components/fredrun2 tools/fredrun2`.
* `node tools/fredrun2/shot.mjs --world wien --meters 0,600 --seconds 3,8 --out /tmp/x/wien [--live 8] [--fps]` – Screenshots/Performance im headless Chromium.
* `npx next dev -p 3111` + `node tools/fredrun2/page-shot.mjs --steps menu,worlds,play,pause,gameover --out /tmp/x/ui` – echte Seite.
* `node tools/fredrun2/e2e.mjs --base http://localhost:3112` – End-to-End-Test der echten Seite (Menü, Kauf, Lauf, Pause, Game-Over, Persistenz, Weltreise, Konsolenfehler); Server: `npx next build && npx next start -p 3112`.
* `node tools/fredrun2/ui-harness.mjs --port 3130 [--watch]` – bündelt die Oberfläche aus dem Arbeitsbaum per esbuild und liefert `/fredrun2` samt `public/` ohne `next build`; dagegen laufen `e2e.mjs`, `page-shot.mjs` und eigene Playwright-Prüfungen
  (`?debug=1`, `?embedded=1[&w=<px>]`). Optionen `--component-dir` (A/B-Vergleich gegen einen früheren Stand) und `--supabase` (Dummy-Client für `board-e2e.mjs`).
* `node tools/fredrun2/board-e2e.mjs --base http://localhost:3112` – globale Bestenliste mit simulierter Anmeldung (Build mit Dummy-Supabase-Variablen, siehe Kopfkommentar).
* `node tools/fredrun2/mem-probe.mjs` – Canvas-Speicher der Welt-Caches je Welt und in der Weltreise.
* `node tools/fredrun2/previews.mjs` – erzeugt die Vorschaubilder der Welt-Karten (`public/fredrun2/previews/*.webp`); `node tools/fredrun2/anim-gallery.mjs` – Figuren-Animationen im Spielcode.
* `node tools/fredrun2/music-smoke.mjs [--block]` – Rauchtest der Musik im Browser (Menü-/Weltmusik hörbar, Jingle, Rückfall bei blockierten Dateien).
* `FFMPEG=<pfad> node tools/fredrun2/audio-smoke.mjs [--only …]` – Rauchtest der Audio-Engine im Browser (Sample-Bank, prozeduraler Fallback, Encoder-Delay-Ausgleich; Engine-Szenarien `stinger-stop`, `late-resume`, `muffle`, `stinger-bus`, `prefetch`).
* Menschlicher Fairness-Audit: `BOT_AUDIT=1 npx vitest run src/game/fredrun2/bot.test.ts -t menschlicher` (0.2 s Reaktionszeit, begrenzte Sicht).
* Debug-URL-Parameter: `?debug` (Hook `window.__fr2`), `?unlockall` (alle Helden), `?world=<id>`.

## Bedienung

Leertaste/↑/W/Tippen springen (halten = höher, in der Luft nochmal = Doppelsprung; eine zweite Taste bzw. ein zweiter Finger zählt ebenfalls) · ↓/S/nach unten wischen rutschen (in der Luft: Stampfen) · Shift/D/→/X bzw. Dash-Taste: Dash ·
Esc/P Pause · M Ton. Touch: Tippen und Wischen gelten auf der ganzen Fläche, in der linken Zone (45 %) entscheidet ein kurzes Fenster (28 ms, mit Drift bis 60 ms) zwischen Wisch (nur Rutschen) und Tippen (Sprung); dazu die Knöpfe „Rutschen“ links unten und „Dash“ rechts unten.
Gamepad im Spiel: A/D-Pad hoch springen, B/D-Pad runter/Stick runter rutschen, X/R1/R2 Dash, Start Pause; in Menüs, Pause und Ergebnis: D-Pad/linker Stick bewegen den Fokus, A bestätigt, B geht zurück.
