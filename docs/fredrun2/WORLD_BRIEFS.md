# Fredrun 2.0 – Welt-Briefings

Allgemeiner Vertrag und Werkzeuge: `WORLDS.md` (Pflichtlektüre). **Referenzimplementierungen** (fertig, sehen gut aus): `worlds/wien.ts` +
`worlds/wien/*`, `worlds/prater.ts` + `worlds/prater/*` – Struktur: `worlds/<id>.ts` = `WorldDef`; Ordner `worlds/<id>/` = `patterns.ts`,
`renderer.ts`, `skins.ts`, `system.ts` (+ Kulissen). Gemeinsame Helfer (nur LESEN, nicht ändern – bei Bedarf eigene Kopien im eigenen
Ordner): `worlds/shared-a/` (Rain, Motes, PaintedBackdrop für gemalte Panoramen, renderTile/blitTiled, Stage-Farbtabellen,
pattern-kit mit Zeit-/Ankunftsberechnung, guests.ts) und `worlds/shared-b/` (StagePalette, gestufte Ebenen `stagedLayer`, Canvas-Helfer,
Glow-Sprites, `audit.ts` mit `auditPatterns`/`botRuns` für Tests). Test-Vorlage: `worlds/prater.test.ts`.

Verfügbar: Props (`public/fredrun2/props/manifest.json`, u.a. Gast-Gegner, Pickups, Welt-Hazards, **Landmarks** `landmark-*` als gemalte
Wahrzeichen: abbey, castle, riesenrad, cathedral, coaster, chalet, church, steamship, peak, carousel, tent, hauntedhouse, vineyard).
Landmarks: auf Offscreen-Canvas mit Dunstfarbe tönen (source-atop 0.25–0.55) und mit Parallax 0.04–0.25 verwenden; nie als Hindernis-Optik.
Audio-SFX/Loops: `src/game/fredrun2/audio/types.ts` (`SFX_NAMES`, `LOOP_NAMES`); Sounds via `sim.emit("custom", x, y, {tag: "sfx:<name>"})`
und Dauerklänge via `sim.vars["loop:<name>"]`.

Qualitätsbar (an Wien & Prater messen): mind. 5 Parallax-Ebenen, Stufen-Dramaturgie, atmosphärische Tiefe, Wetter/Partikel, liebevolle
Skins mit Zuständen/Animation, lesbare Gefahren, ≥ 18 Muster (inkl. 2 Setpieces), Systeme mit fairer Telegrafie, Test-Datei
`worlds/<id>.test.ts` (Metadaten, `auditPatterns`, `botRuns`), Bot-Test `BOT_WORLDS=<id> npx vitest run src/game/fredrun2/bot.test.ts`
grün, Screenshots mehrerer Stufen prüfen (`node tools/fredrun2/shot.mjs --world <id> --meters 0,<stageMeters>,… --seconds 3,8 --out <scratchpad>/<id>`),
Frame-Zeit (`--fps`, `--live 8`) im grünen Bereich (Ø < 16 ms im Software-Rendering), `view.reducedMotion` und `view.quality` beachten.

---

## Alpenpanorama (`alpen`) – Signatur: Lawine + Aufwind + bröckelnde Plattformen
* Look: sonnige Bergwelt, Almwiesen mit Blumen, Tannenwälder, See, Gipfel mit Schnee, Gletscher, Almhütten, Zäune, Kühe; 5 Stufen
  (`stageCount: 5`, `stageMeters: 320`): Wiese → See → Gipfel → Plateau/Hochgebirge → Gletschereis & Abendrot. Originalbilder als Fernkulisse
  (per `PaintedBackdrop`/Spiegelkachelung): `public/fredrun/levels/alps/backgrounds/{meadow,lake,peaks,plateau,fallback}.webp` (2172×665; nur
  oberen Teil mit Bergen/Bäumen nutzen; Wiesenteil ersetzt du durch eigenen Boden) + Landmarks `landmark-peak` (Hero-Gipfel, mehrfach variiert),
  `landmark-chalet`, `landmark-church` + prozedurale Ebenen (Tannen, Felsen, Zäune, Gras, Blüten, Vögel, Wolkenschatten), Lichtstrahlen,
  Schmetterlinge, später Schneetreiben/Wind.
* Mechaniken: (1) **Lawine** (`WorldSystem`): ab diff ≥ 2.5 rollt eine Schneewalze von links heran (`sim.vars.avalancheGap` px; Renderer zeichnet sie am
  linken Rand; `sim.vars.chaseWarn` 0..1 für HUD-Rand; `sim.vars["loop:avalanche"]`); Abstand wächst beim ungehinderten Laufen, schrumpft bei
  Treffern (`onHurt`) und Verlangsamung; holt sie auf → `sim.hurt("lawine")` + Rückstellen. Fair und lesbar, nie unausweichlich.
  (2) **Schluchten** (`pit`) mit **bröckelnden Plattformen** (`crumble`), Seilbahn-Gondeln als bewegliche Plattformen (`ampX`/`ampY`, Prop `gondola`),
  (3) **Aufwindzonen** (`wind`, lift ~1900; Thermik-Partikel; Edelweiß-Münzbahn `edelweiss`; Sprungtaste halten zum Steigen),
  (4) **Steinbock** (walker, `vx` −260, stompable, `p.hopEvery`/`p.hopV`; Prop `ibex-run`) und Kuh/Murmeltier als Hindernis, Adler (`eagle-fly`),
  (5) **Steinschlag** telegrafiert (Schatten + `zone` "rock" oder `projectile` mit gravity), (6) Zäune/Baumstämme/Findlinge (`wood-fence`, `boulder`),
  niedrige Überhänge (Äste, Felsvorsprung → rutschen). ≥ 18 Muster inkl. Setpiece „Gipfelgrat“.
* Meta: `name` "Alpenpanorama", `music: "alpen"`, Akzent `#39b26b` (dunkel `#0f3b24`), Loop `wind` je nach Höhe.

## Finanzamt bei Nacht (`finanzamt`) – Signatur: Stempel + Laser-Gitter + Förderbänder + Dunkelheit
* Look: nächtliches Amt: Aktenflure, Schreibtisch-Inseln, Glasbüros, Archivregale bis zur Decke, Neonröhren mit Flackern, Schreibtischlampen-Lichtkegel,
  Topfpflanzen, Kaffeemaschine, Rollwagen, Kameras mit roter LED, Papierfetzen im Luftzug. 5 Stufen (`stageCount: 5`, `stageMeters: 280`):
  Sachbearbeiter-Büro → Aktenraum → Glasbüros → Archiv → Serverkeller/Tresorraum (kälter/dunkler, mehr Laser). Originalbilder als Fernkulisse:
  `public/fredrun/levels/finanzamt-night/backgrounds/close-*.webp` (Sicht auf Manifest im selben Ordner; 2172×665) via `PaintedBackdrop`/Spiegelkachelung +
  prozedural: Deckenlichter, Regalsilhouetten, Glasreflexe, Linoleum-Boden mit Reflexion.
* Mechaniken: (1) **Stempel**: `zone`-Skin "stamp" (Riesenstempel von der Decke: warn ~0.8 s mit rotem Schatten am Boden, dann active 0.25 s, dann hoch; Prop `stamp-big`
  als Vorlage, Papierflug-Partikel), (2) **Laser-Gitter**: `zone`-Skin "laser" niedrig (→ springen) / hoch (→ rutschen), Takt-Rhythmus (Turrets `laser-turret`),
  (3) **Förderbänder** (`speedzone` mult 1.35 / 0.7; animierte Bandoptik mit Pfeilen), (4) **Aktenlawine** (`block` breakable, `vx` −300, Papierstapel `paper-stack`; Dash zerlegt sie),
  rollende **Bürostühle** (`office-chair`, walker nicht stompable, vx −220), **Rollwagen** (`file-cart`), Fledermaus (`bat-fly`),
  (5) **Schredder-Lücke** (`pit` mit animierten Klingen, Prop `shredder` als Deko) + Plattformen aus Aktenkartons, (6) **Aufzug/Rolltreppe** als bewegliche Plattform,
  (7) **Dunkelheit**: `drawOverlay` mit Taschenlampen-/Lichtkegel um die Figur (+ weiter vorne), `view.vars.darkness` steigt in späteren Stufen; Gefahren bleiben dank
  Rim-Light sichtbar; gelegentliche Notbeleuchtung (nicht bei reducedMotion). ≥ 18 Muster inkl. Setpieces „Sicherheitsschleuse“ (Laser-Rhythmus), „Papierlawine“.
* Meta: `name` "Finanzamt bei Nacht", `music: "finanzamt"`, Akzent `#3aa0ff` (dunkel `#0b1a33`), Loops `office-hum`, `laser-hum`.

## Wachau (`wachau`) – Signatur: Floß-Sprünge über die Donau + rollende Weinfässer
* Look: goldener Herbst in der Wachau: Weinterrassen an steilen Hängen, Marillenbäume, Burgruine Dürnstein, barockes Stift (Melk), Donau mit Schiffen, Reflexen und
  Nebelschwaden, Kirchtürme, Steinmauern; warme Lichtvolumen. 5 Stufen (`stageCount: 5`, `stageMeters: 300`): Morgennebel → Goldener Vormittag → Sonnenuntergang →
  Blaue Stunde → Sternennacht mit Glühwürmchen. Boden = Uferweg/Weinbergpfad mit Gras & Laub; Lücken = Donau (`pit` Skin "water", animierte Wellen, Spiegelung, Spritzer).
  Landmarks nutzen: `landmark-abbey`, `landmark-castle`, `landmark-vineyard` (Terrassenhang), `landmark-steamship` (fährt auf der Donau), `landmark-church`
  (getönt, Parallax 0.05–0.2) + prozedurale Weinterrassen/Bäume/Wasser.
* Mechaniken: (1) **Flöße/Boote** (`platform`-Skin "raft": leichtes Wippen `ampY≈6`, sinkt beim Landen (`crumble` ~1.1 s), Reihen über breite Wasserlücken; `ampX` gleitende Boote; Prop `raft`),
  (2) **Rollende Weinfässer** (`walker`-Skin "barrel", vx −300…−520, nicht stompable; `breakable:true` per Dash zerlegbar; Rollanimation über `e.age`; Prop `wine-barrel`),
  (3) **Bienenschwärme** (`flyer` mit `track` ~0.8; Prop `bee-swarm`), (4) **Marillen**-Münzen (Coin-Skin weltspezifisch als Marille; Prop `apricot`), Marillenbaum-Äste als niedrige
  `overhead` (rutschen), (5) Steinmauern/Weinkisten (Blocks; `crate-wine`), (6) Terrassenstufen als Plattform-Treppen, (7) Böen/Blätterwirbel (`wind`, kleine Aufwindzonen),
  (8) Setpieces „Donauüberfahrt“ (5–6 Flöße unterschiedlicher Höhe, Fässer am Ufer) und „Weinberg-Treppe“. ≥ 18 Muster.
* Meta: `name` "Wachau", `music: "wachau"`, Akzent `#f2a33a` (dunkel `#3a2408`), Loop `river`.

## Cyber-Wien 2099 (`cyber`) – Signatur: SCHWERKRAFT-UMKEHR + Phasen-Tore
* `gravityFlip: true`, `groundY: 600`, `ceilY: 140` (Spielfeld 460 px; die Figur läuft auch kopfüber an der Decke – die Engine dreht die Sprites). Look: neonfarbenes Wien der Zukunft:
  Wireframe-Stephansdom (aus `landmark-cathedral` per Offscreen-Canvas stilisieren: Graustufen, Invertieren/Kanten, Cyan/Magenta-Tönung, additives Blenden), Glas-Wolkenkratzer mit Hologramm-Reklamen,
  Datenströme/Code-Regen, Tron-Gitterboden UND Gitterdecke (beide in `drawGround` zeichnen), Laserraster am Himmel, Drohnen im Hintergrund, Puls im Takt (~120 BPM über `view.time`);
  Palette Cyan/Magenta/Violett auf Nachtblau, Bloom-Look mit vorgerenderten Glow-Sprites. 5 Stufen (`stageCount: 5`, `stageMeters: 280`): Neon-Dämmerung → Datenstadt → Serverherz →
  Glitch-Sturm (RGB-Split, bei reducedMotion reduziert) → Singularität.
* Mechaniken: (1) **Gravitationsportale** (`c.portal(dx)`; Muster MÜSSEN gravitationsneutral sein – gerade Portalanzahl; innen Decken-Hindernisse `c.block(..., {ceil:true})` mit eigener `hb`,
  Boden-Hindernisse, Portalpaare mit Hindernissen dazwischen, Zickzack-Sequenzen; Flip-Flug Boden↔Decke dauert ≈ 0.55 s; erste Portale bei diff 0.5–1.2 sehr gnädig), (2) **Phasen-Tore**
  (`zone`, Skin "phase-cyan"/"phase-magenta", rhythmisch aktiv/inaktiv), (3) **Drohnen** (`flyer` mit `track`, Prop `drone-hover`), **Glitch-Würfel** (`zone` loop, Prop `glitch-cube`), Laser-Boden/-Decke
  (`laser-turret`), **Neon-Barrieren** (`barrier-neon`, breakable), Server-Racks (`server-rack`), (4) **Daten-Chips** als Münzen (`data-coin`), Gems als Kristalle, (5) Setpieces „Zickzack-Schacht“ und
  „Serverkorridor“. Keine `pit` und keine `overhead`-Archetypen (Decke ist Spielfläche). ≥ 18 Muster; `auditPatterns(world, { forbid: ["pit","overhead"], evenPortals: true })`.
  `drawEntity` für kind "portal" (Ringe, Energiefeld, Sog-Partikel; `e.state === "used"`).
* Meta: `name` "Cyber-Wien 2099", `music: "cyber"`, Akzent `#22e0ff` (dunkel `#0a0f2e`), Loop `cyber-hum`.

## Abschluss Wien & Prater (Finisher-Agent)
Prüfe beide Welten gegen ihre Briefings (siehe Git-Historie / `WORLDS.md`): Wien = Blitz + Straßenbahn-Surfen, 8 Stufen mit Katastrophen-Dramaturgie, Original-Hintergründe als Fernkulisse, Tauben,
Pfützen, Fiaker, Gullys, Dachziegel; Prater = Pendel, Trampoline, Riesenrad-Gondeln, Kanonen, Geister/Autoscooter, Ring-Bonus, Feuerwerk. Ergänze Fehlendes, poliere Schwächen (Screenshots aller Stufen),
stelle Tests/Bot/Frame-Zeit sicher, nutze passende Landmarks (`landmark-riesenrad` etc.).
