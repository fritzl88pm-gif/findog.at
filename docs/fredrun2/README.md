# Fredrun 2.0

Endlos-Runner im Browser – als Ansicht der App (Seitenleiste/Icon-Leiste/Dashboard „Fredrun 2.0“, aufgebaut wie das Original-Fredrun: `FredRun2View`, Kopfzeile „Findog Spielpause“, Vollbild-Schaltfläche) und eigenständig unter `/fredrun2`: acht Welten, fünf Helden (Fred, Frida, Superfred, Cyberfred, Superfrida –
alle aus dem Originalspiel), Highscore/Bestenliste, Weltreise-Modus und Tageslauf. Läuft ohne Server-Anbindung
(Speicherstand in `localStorage`), Canvas 2D, fester Zeitschritt (120 Hz) mit Interpolation, adaptive Bildqualität.

## Architektur

```
src/game/fredrun2/            (Framework-unabhängig, TypeScript strict)
  constants.ts                Maße, Physik, Balancing
  types.ts                    Vertrag Engine ↔ Welten (Ent, PatternCtx, WorldDef, WorldRenderer …)
  rng.ts                      deterministischer PRNG (Seed → reproduzierbarer Lauf, Tageslauf)
  sim.ts                      reine Simulation: Spielfigur, Physik, Kollision, Punkte, Combo, Power-ups, Tour-Tore
  spawner.ts, patterns.ts     Level-Generator (zeitbasierte Muster, Schwierigkeitsrampe, Gast-Gegner, Belohnungen)
  bot.ts                      vorausschauender Bot (Tests, Attract-Modus im Menü, QA-Screenshots)
  characters.ts               Helden + Fähigkeiten + Preise
  profile.ts                  Persistenz: Münzen, Freischaltungen, lokale Bestenlisten (Fallback), Einstellungen
  assets.ts                   Bilder, Charakter-Atlanten (public/fredrun2/chars), Props-Bibliothek
  render.ts, hud.ts,          Zeichnen: Figur, Effekte, Partikel, HUD, Post-Processing
  particles.ts, pickups.ts
  input.ts                    Tastatur, Touch/Zeiger (Tippen, Wischen), Gamepad, Bildschirmtasten
  game.ts                     Controller: Schleife, Countdown, Pause, Game-Over, Demo, Audio-Verknüpfung, Qualität
  audio/                      Web-Audio: aufgenommene Musik-Schleifen (tracks.ts), CC0-Sample-Bank für Effekte (bank.ts), prozeduraler Fallback – siehe audio/README.md, MUSIC.md, AUDIO.md
  worlds/<id>.ts              Welt-Module (Muster, Renderer, Systeme) – siehe WORLDS.md
src/components/fredrun2/      React-Oberfläche (Menüs, Overlays, Touch-Tasten) + CSS-Modul
src/components/fredrun2/FredRun2View.tsx   App-Ansicht (eingebettet, `embedded`-Modus von FredRun2, Spielername aus dem Original-Profil)
src/app/fredrun2/page.tsx     eigenständige Route
public/fredrun2/              Sprites (chars/, props/), Vorschaubilder (previews/)
tools/fredrun2/               Python-Pack-Skripte (Sprites/Props), QA-Werkzeuge (shot.mjs, page-shot.mjs)
```

## Spielprinzip & Mechaniken

* Springen (variable Höhe, Doppelsprung, Coyote-Time, Jump-Buffer), Rutschen, **Stampfen** in der Luft (Schockwelle, Bounce auf Gegner),
  **Dash** (Energiering, unverwundbar, zerschmettert Kisten/Geschosse), **Kombo ×1…×8** (Beinahe-Treffer, Stampfer, Münzserien).
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

Weitere Dokumente: `ASSETS.md` (Sprite-/Prop-Konventionen), `WORLDS.md` + `WORLD_BRIEFS.md` (Welt-Vertrag und Briefings), `ENGINE_REQUESTS.md` (Wünsche der Welt-Autoren + Status), `AUDIO.md` (Klangeffekte: Sample-Bank aus Kenney-CC0-Samples, Rezepte, Neubau, Pegel).

## Qualitätssicherung

* `npx vitest run src/game/fredrun2` – Sim-, Profil-, Audio-, Weltentests und **Bot-Lösbarkeitstests** für alle Welten
  (`BOT_WORLDS=wien,alpen npx vitest run src/game/fredrun2/bot.test.ts`).
* `node tools/fredrun2/shot.mjs --world wien --meters 0,600 --seconds 3,8 --out /tmp/x/wien [--live 8] [--fps]` – Screenshots/Performance im headless Chromium.
* `npx next dev -p 3111` + `node tools/fredrun2/page-shot.mjs --steps menu,worlds,play,pause,gameover --out /tmp/x/ui` – echte Seite.
* `node tools/fredrun2/e2e.mjs --base http://localhost:3112` – End-to-End-Test der echten Seite (Menü, Kauf, Lauf, Pause, Game-Over, Persistenz, Weltreise, Konsolenfehler); Server: `npx next build && npx next start -p 3112`.
* `node tools/fredrun2/previews.mjs` – erzeugt die Vorschaubilder der Welt-Karten (`public/fredrun2/previews/*.webp`); `node tools/fredrun2/anim-gallery.mjs` – Figuren-Animationen im Spielcode.
* `node tools/fredrun2/music-smoke.mjs [--block]` – Rauchtest der Musik im Browser (Menü-/Weltmusik hörbar, Jingle, Rückfall bei blockierten Dateien).
* `FFMPEG=<pfad> node tools/fredrun2/audio-smoke.mjs` – Rauchtest der Audio-Engine im Browser (Sample-Bank, prozeduraler Fallback, Encoder-Delay-Ausgleich).
* Menschlicher Fairness-Audit: `BOT_AUDIT=1 npx vitest run src/game/fredrun2/bot.test.ts -t menschlicher` (0.2 s Reaktionszeit, begrenzte Sicht).
* Debug-URL-Parameter: `?debug` (Hook `window.__fr2`), `?unlockall` (alle Helden), `?world=<id>`.

## Bedienung

Leertaste/↑/W/Tippen springen · ↓/S/Wischen rutschen (in der Luft: Stampfen) · Shift/D/Dash-Taste Dash · Esc/P Pause · M Ton · Gamepad (A/B/X/Start).
