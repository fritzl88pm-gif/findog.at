# Fredrun 2.0

Endlos-Runner im Browser (Route `/fredrun2`): sechs Welten, fünf Helden (Fred, Frida, Superfred, Cyberfred, Superfrida –
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
  profile.ts                  Persistenz: Münzen, Freischaltungen, Bestenlisten, Einstellungen
  assets.ts                   Bilder, Charakter-Atlanten (public/fredrun2/chars), Props-Bibliothek
  render.ts, hud.ts,          Zeichnen: Figur, Effekte, Partikel, HUD, Post-Processing
  particles.ts, pickups.ts
  input.ts                    Tastatur, Touch/Zeiger (Tippen, Wischen), Gamepad, Bildschirmtasten
  game.ts                     Controller: Schleife, Countdown, Pause, Game-Over, Demo, Audio-Verknüpfung, Qualität
  audio/                      prozedurale Web-Audio-Engine (SFX + dynamische Musik je Welt), siehe audio/README.md
  worlds/<id>.ts              Welt-Module (Muster, Renderer, Systeme) – siehe WORLDS.md
src/components/fredrun2/      React-Oberfläche (Menüs, Overlays, Touch-Tasten) + CSS-Modul
src/app/fredrun2/page.tsx     Route
public/fredrun2/              Sprites (chars/, props/), Vorschaubilder (previews/)
tools/fredrun2/               Python-Pack-Skripte (Sprites/Props), QA-Werkzeuge (shot.mjs, page-shot.mjs)
```

## Spielprinzip & Mechaniken

* Springen (variable Höhe, Doppelsprung, Coyote-Time, Jump-Buffer), Rutschen, **Stampfen** in der Luft (Schockwelle, Bounce auf Gegner),
  **Dash** (Energiering, unverwundbar, zerschmettert Kisten/Geschosse), **Kombo ×1…×8** (Beinahe-Treffer, Stampfer, Münzserien).
* 3 Herzen (max. 5), Treffer = Tempo-Verlust + Unverwundbarkeit; Power-ups: Magnet, Schutzschild, Zeitlupe, Turbo-Rakete, Herz.
* Heldenfähigkeiten: Fred „Spürnase“ (Münz-Sog), Frida „Blitzstart“ (Energie), Superfred „Cape-Gleiter“, Cyberfred „Düsen-Dash“, Superfrida „Super-Stampfer“.
* Gast-Gegner aus dem Original (Odo, Madinger, JQA, Luki) laufen in jeder Welt entgegen (stampfen!).
* Sechs Welten mit eigener Signatur-Mechanik: Wien (Blitz + Straßenbahn-Surfen), Alpen (Lawine, Aufwind, bröckelnde Plattformen),
  Finanzamt (Stempel, Laser, Förderbänder, Dunkelheit), Prater (Pendel, Trampoline, Riesenrad-Plattformen), Wachau (Flöße, Weinfässer),
  Cyber-Wien (Schwerkraft-Umkehr, Phasen-Tore).
* Modi: **Welt-Lauf** (je Welt eigene Bestenliste), **Weltreise** (alle Welten hintereinander, Tore, steigende Schwierigkeit),
  **Tageslauf** (gleicher Seed für alle am selben Tag).
* Schwierigkeit: Meter → Schwierigkeitsstufe → Tempo (470 → 1180 px/s) und Musterauswahl; Abstände in Zeit definiert ⇒ jedes Muster bleibt lösbar.

## Qualitätssicherung

* `npx vitest run src/game/fredrun2` – Sim-, Profil-, Audio-, Weltentests und **Bot-Lösbarkeitstests** für alle Welten
  (`BOT_WORLDS=wien,alpen npx vitest run src/game/fredrun2/bot.test.ts`).
* `node tools/fredrun2/shot.mjs --world wien --meters 0,600 --seconds 3,8 --out /tmp/x/wien [--live 8] [--fps]` – Screenshots/Performance im headless Chromium.
* `npx next dev -p 3111` + `node tools/fredrun2/page-shot.mjs --steps menu,worlds,play,pause,gameover --out /tmp/x/ui` – echte Seite.
* Debug-URL-Parameter: `?debug` (Hook `window.__fr2`), `?unlockall` (alle Helden), `?world=<id>`.

## Bedienung

Leertaste/↑/W/Tippen springen · ↓/S/Wischen rutschen (in der Luft: Stampfen) · Shift/D/Dash-Taste Dash · Esc/P Pause · M Ton · Gamepad (A/B/X/Start).
