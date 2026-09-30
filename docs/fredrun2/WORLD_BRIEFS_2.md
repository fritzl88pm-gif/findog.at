# Fredrun 2.0 – Briefings für die Welten 7 und 8 (`winter`, `oper`)

Zusätzlich zu `WORLDS.md` (Vertrag, Pflichtlektüre) und `WORLD_BRIEFS.md` (Vorbilder und Qualitätsbar der Welten 1–6). Diese beiden Welten
sind **bildgestützt**: Ihre Kulissen und Props wurden mit GPT Image 2 (fal.ai) gemalt und liegen fertig im Repo. Die Weltmodule sollen daraus
eine AAA-würdige Optik bauen (Parallax, Licht, Wetter, Animation) und die Signatur-Mechaniken in faire, gut lesbare Muster gießen.

## Fertige Kulissen (`public/fredrun2/worlds/<id>/<ebene>.webp`, Größen in `manifest.json` desselben Ordners)

Alle Ebenen sind horizontal **nahtlos kachelbar** (Kachelbreite = Bildbreite; `tile: true` im Manifest) und ~2240×768 px (Böden 1472×512, Himmel
1680×576). Höhe 768 wird auf die logische Höhe skaliert (Faktor ≈ 0.94; Fernebenen dürfen größer skaliert werden). Ebenen mit `alpha: true`
haben transparenten Himmel und stehen unten auf der Bildunterkante – Unterkante der Ebene auf/leicht unter die Bodenlinie legen
(Mittelgrund-Objekte sollen „auf dem Boden“ stehen; die Bodenlinie `groundY` = 590 ⇒ Ebene so verschieben, dass die Objekt-Füße bei ≈ groundY liegen).
Böden (`ground`, `ice`, `ground-parquet`, `ground-carpet`) sind Streifen von der oberen Kante (Randlinie) nach unten: ab `groundY` kacheln;
Lücken (`pits`) sauber ausschneiden (Clip) und Tiefe zeichnen.

* **winter**: `sky-dusk`, `sky-night` (opak, Himmel), `far-city` (RGBA, Skyline Wien/Rathaus, Dunst), `mid-market` (Stände + Laternen),
  `mid-rink` (Eislaufplatz mit Riesenbaum, ohne Beschriftung), `mid-krampus` (dunkler Markt mit Fackeln/Perchtenmasken), `near-fir` (dunkle Tannen,
  schnelle Parallax), `ground` (Schnee-Kopfstein), `ice` (Eisfläche als Streifen).
* **oper**: `far-ballroom`, `far-foyer`, `far-boxes`, `far-mirror`, `far-midnight` (alle OPAK, ganze Saalwände inkl. Boden im unteren Bilddrittel; je
  eine pro Stimmungsstufe, Stufenwechsel per Überblendung), `mid-columns`, `mid-tables` (RGBA), `near-curtain` (RGBA, Vorhänge/Balustraden),
  `ground-parquet`, `ground-carpet`.

**Speicher/Performance**: Jede Ebene entspricht ~7 MB dekodiert. Lade nur, was für die aktuelle + nächste Stufe gebraucht wird
(`load(assets)` nach Bedarf, Rest lazy per `assets.image`) und gib nicht mehr benötigte Ebenen frei (Referenz droppen). Pro Frame höchstens
~8 Vollbild-Blits; `drawImage` direkt aus dem Bild (GPU) ist okay, gemischte Tönungen (Stimmungsfarbe, Dunst) einmal je Stufe auf Offscreen
vorrendern und cachen. Ziel Welt-Zeichnen < 6 ms (Software-Rendering: `node tools/fredrun2/shot.mjs … --fps`).

## Fertige Props (`public/fredrun2/props/manifest.json`, IDs mit Weltpräfix; Format/Anker siehe `ASSETS.md`)

Alle sind Einzelbilder mit Alpha (`assets.props.draw(g, id, x, y, {h|w, flipX, …})`), Blickrichtung rechts, Comic-Optik mit schwarzer Kontur.
Es gibt **keine Frame-Animationen**: animiere prozedural (Wippen/Squash&Stretch/Drehen, Dampf, Funken, Flackern, Schatten).

* **winter**: `winter-stall`, `winter-snowman`, `winter-presents`, `winter-tree`, `winter-sled`, `winter-iceblock`, `winter-candycane` (Hindernisse),
  `winter-icicles` (hängend, Anker oben), `winter-snowball` (Geschoss), `winter-kessel` (Glühwein-Kessel, Dampf selbst zeichnen),
  `winter-krampus`, `winter-elf`, `winter-gingerbread` (Gegner, nach rechts blickend – zum Entgegenkommen spiegeln), `winter-star` (Münz-Skin),
  `winter-lantern` (Deko). Vorhanden aus früheren Welten und nutzbar: `lebkuchenherz` (Gem-Skin), `heart`, `coin`, Gast-Gegner (`GUEST_PROP_IDS`).
* **oper**: `oper-piano`, `oper-champagne`, `oper-cakecart`, `oper-harp`, `oper-bouquet`, `oper-rope` (Hindernisse), `oper-chandelier` (hängend,
  Anker oben), `oper-spotlight`, `oper-cork` (Geschoss), `oper-waiter`, `oper-dancers` (Gegner, nach rechts blickend – spiegeln), `oper-note`
  (Münz-Skin), `oper-mask` (Gem-Skin).

**Weitere Bilder** dürfen erzeugt werden (Budget je Agent **1,00 $**, streng einhalten!):
`. /tmp/claude-0/-home-user-findog-at/c1dabfb9-633c-5337-860d-fefa6648499e/scratchpad/fal.env && export FAL_KEY && node tools/fredrun2/fal-art.mjs gen --name <welt>-<name> --size 1024x1024 --quality medium --transparent --budget 1.0 --out <eigenes-Verzeichnis> --prompt "<Stilzeile aus tools/fredrun2/art_prompts/<welt>.json> …"`
(Kosten: medium 1024² ≈ 0,07 $, Kulisse 2304×768 medium ≈ 0,12 $, high ≈ 0,32 $; `ledger` zeigt die Summe). Danach als Eintrag in
`tools/fredrun2/props_spec.json` (`kind: static`, `src: <dir>/<name>.png`, `tags`) aufnehmen und mit
`python3 tools/fredrun2/pack_props.py --src <Verzeichnis-mit-Unterordnern> --only <id>` packen (Manifest wird ergänzt). Den Schlüssel NIE ausgeben/committen.

## Audio

Musik `winter` und `oper` (aufgenommene Stücke, Fallback prozedural) und alle SFX/Loops aus `audio/types.ts`. Sonderklänge über
`sim.emit("custom", x, y, {tag: "sfx:<name>"})`; Dauerklänge `sim.vars["loop:<name>"]` (`wind`, `crowd-fair`, `river`, …). Die Musik ist
NICHT mit der Simulation synchronisiert – Gameplay-Rhythmen nie an die Musik koppeln, nur an Zeit (`c.t(sec)`, `sim.time`).

## Integration (bereits erledigt – nicht anfassen)

`WORLD_IDS`/`TOUR_ORDER` enthalten `winter` und `oper` (Tour-Reihenfolge …, cyber, winter, oper), Registry `worlds/index.ts` verweist auf die
Platzhalter `worlds/winter.ts` / `worlds/oper.ts` (BasicWorld). **Diese beiden Dateien ersetzt du** (Export-Namen `WORLD_WINTER` / `WORLD_OPER`
bleiben), Ordner `worlds/<id>/` gehört dir. Todesursachen-Namen: `worlds/<id>/death-names.ts` (Array `[RegExp, "Deutscher Name"]` für alle deine
harmful-Skins; der Test `death-names.test.ts` prüft Vollständigkeit; die temporäre Platzhalterzeile löschen). Tour-Tor: `e.p.to` ist der Index in
`TOUR_ORDER` (0 wien … 6 winter, 7 oper), Skin `"gateway"` darfst du zeichnen (Standardtor sonst).

---

## Christkindlmarkt (`winter`) – „Glühwein, Glitzer und der Krampus ist los.“

* `name`: "Christkindlmarkt", `tagline`: „Glühwein, Glitzer – und der Krampus ist los.“, Akzent `#8fd3ff`, dunkel `#0b1f3a`, `music: "winter"`,
  `stageMeters: 300`, `stageCount: 5`, Stufen: **Dämmerung am Rathausplatz** (`sky-dusk`, `far-city` warm, `mid-market`, leichter Schneefall) →
  **Marktgetümmel** (Nacht, alle Lichter, dichter Fernblick) → **Eistraum** (`mid-rink`, Eisflächen häufig, Eiskristall-Glitzer) →
  **Schneesturm** (Whiteout: starker Schnee, Windböen, Fernebenen verblassen, Sichtweite sinkt, aber Gefahren bleiben klar) →
  **Krampuslauf** (`sky-night` mit Polarlicht/roter Glut, `mid-krampus`, Fackeln, Krampus-Verfolgung).
* Look-Bausteine: Parallax-Stapel Himmel (0.02) → `far-city` (0.06–0.1) → Mittelgrund (0.3–0.5) → Nahgrund `near-fir` (0.9) → Boden mit `ground`
  (Kopfsteinpflaster im Schnee); Schneefall in 3 Tiefen (Partikel, `view.quality` beachten), Windwehen, Lichtkegel/Glow um Laternen und Lichterketten
  (Glow-Sprites cachen), Atemwölkchen, Dampf aus dem Kessel, Funkenflug der Fackeln, Fußspuren/Schneestaub, Lichterketten-Blinken (nicht bei reducedMotion).
* **Signatur-Mechaniken** (alle fair telegrafiert, ≥ 0.6 s Vorlauf):
  1. **Eisflächen** (`speedzone` mult ≈ 1.3 mit `ice`-Boden `ice.webp`, klare Kante + Glanz + Kristalle): Tempo hoch, Reaktionszeit runter.
     Risiko/Belohnung: Münz-/Stern-Bahnen über dem Eis, Hindernisse dahinter mit Abstand für das höhere Tempo. Eis nie direkt vor unvermeidbarem Doppel-Hindernis.
  2. **Elfen-Schneeballwerfer** (`winter-elf` auf Marktdach/Boden, Wurfarm-Anim, Warnmarker): `projectile` mit Bogenflug (`p.gravity`) → springen oder rutschen,
     Schneeball zerspringt in Partikel.
  3. **Eiszapfen** (`winter-icicles`): hängen an Vordächern; Glitzern/Tropfen (Warnung ~0.7 s), dann fallen (`projectile` mit Gravity) bzw. als `overhead` zum Unterrutschen.
  4. **Glühwein-Kessel** (`winter-kessel`): Dampfsäule = `wind`-Zone (Aufwind) zum Erreichen von Schlitten-Plattformen/Münzen in der Höhe; Dampf-Partikel.
  5. **Rodelschlitten** (`winter-sled`): bewegliche `platform` zum Aufspringen (Schlitten-Surfen, wie Straßenbahn in Wien); Schlitten rutschen mit `vx`.
  6. **Krampus** (`winter-krampus` als Gegner-Skin, `walker`, nicht stompbar, schnell, Warnung) und **Lebkuchenmänner** (`winter-gingerbread`, `walker`, stompbar,
     lassen Sterne fallen); ab Stufe 5 zusätzlich **Krampus-Verfolgung** als `WorldSystem`: ein riesiger Krampus-Schatten holt von links auf (Glockenschlag +
     rote Augen als Warnung, `sim.vars.chaseWarn`), Abstand wächst beim ungehinderten Laufen, sinkt bei Treffern; holt er auf → `sim.hurt("krampus")` + Rückstellen.
  7. Klassische Hindernisse: Schneemann (`block`), Geschenke-Stapel (hoch → Doppelsprung), Christbaum-Kiste, Zuckerstangen-Zaun (niedrig), Eisblock, Marktstand (breit → über Dach hüpfen?).
* Münzen: Skin `winter-star`; Gems: `lebkuchenherz`. Loops: `wind` (Stärke je Stufe, im Sturm hoch), leiser `crowd-fair` in den Marktstufen.
* Muster: ≥ 24, davon 4 Einsteiger, 6 mittlere, 6 schwere, mind. 3 Setpieces („Eisbahn-Slalom“: Eis + Sternenbahn + Zapfen; „Schlittenfahrt“: Plattform-Kette über Lücken;
  „Krampuslauf“: Verfolgung + Fackelgasse), Tags sinnvoll setzen. Todesnamen: Schneemann, Geschenke, Weihnachtsbaum, Zuckerstange, Eisblock, Eiszapfen, Schneeball, Krampus,
  Lebkuchenmann, Glühwein-Kessel, Marktstand, Elf …

## Opernball (`oper`) – „Im Dreivierteltakt zum Highscore.“

* `name`: "Opernball", `tagline`: „Im Dreivierteltakt zum Highscore.“, Akzent `#f2c14e`, dunkel `#3a0a12`, `music: "oper"`, `stageMeters: 300`, `stageCount: 5`, Stufen:
  **Foyer & roter Teppich** (`far-foyer`, `ground-carpet`, Marmor/Creme) → **Ballsaal** (`far-ballroom`, `ground-parquet`, Gold) → **Logen** (`far-boxes`, tiefes Rot, dramatischer) →
  **Spiegelsaal** (`far-mirror`, Silber/Champagner, Glitzern, Spiegelungen) → **Mitternachts-Polonaise** (`far-midnight`, Feuerwerk hinter den Fenstern, Konfetti, Magenta/Gold).
  Innenraum: KEIN Wetter; stattdessen Konfetti, Champagner-Perlen, Lichtstaub in Lichtkegeln, Kronleuchter-Funkeln, Flimmern der Kerzen, weiche Vignette.
* Look-Bausteine: Fernebene = `far-*` (Parallax 0.04–0.08, Stufenwechsel per Überblendung), Mittelgrund `mid-columns`/`mid-tables` (0.3–0.5), Nahgrund `near-curtain` (0.9, sparsam),
  Boden `ground-parquet` bzw. `ground-carpet` mit Spiegelung/Glanzstreifen (auf dunklem Boden weiche Reflexion der Gefahren andeuten), Lichtkegel von oben, animierte Kronleuchter-Glitzer.
* **Signatur-Mechaniken** (alle fair telegrafiert):
  1. **Dreiertakt („Walzer“)**: Hindernisse in Dreier-Folgen mit gleichem Zeitabstand (z. B. `c.t(0.52)`): Sprung – Sprung – Rutschen, „1-2-3“; Münzen liegen auf dem Takt und führen den Spieler.
  2. **Kronleuchter** (`oper-chandelier`, `swinger`, Anker oben): pendeln in Dreiertakt-Perioden, tief genug zum Rutschen wenn unten; Kristallglitzer + Schatten am Boden als Vorwarnung.
  3. **Champagner-Korken** (`oper-champagne`/Flasche schüttelt, Schaum-Warnung → `oper-cork` als `projectile` auf Kopf- oder Fußhöhe), Korken zerplatzen zu Schaumpartikeln.
  4. **Kellner** (`oper-waiter`, `walker`, stompbar, hetzt entgegen; wenn gestampft regnen Champagner-Münzen) und **Tanzpaare** (`oper-dancers`, `walker` mit Walzerschritt: `vx` im 1-2-3-Rhythmus
     schnell-schnell-langsam, stompbar, Drehung/Kippen prozedural).
  5. **Flügel-Sprungbrett** (`oper-piano` als `spring`: hoher Bounce mit Klaviertonleiter-Sound) zum Erreichen von Balkon-Plattformen (`platform`) mit Notenmünzen; **Harfe/Bouquet/Torten-Wagen/Samtseil** als Hindernisse
     (Harfe hoch → Doppelsprung, Seil niedrig).
  6. **Spotlight-Kegel** (`oper-spotlight`, `zone` Skin "spot": warn ~0.8 s (Lichtstaub, Kegel deutet sich an), active ~0.5 s, idle): Treffer nur im aktiven Kegel; Kegel visuell klar.
  7. Stufe 4 (Spiegelsaal): reine Optik verstärkt (Spiegelungen/Glitzer) + dichtere Muster; Stufe 5: Polonaise – lange Reihen von Tanzpaaren/Kellnern mit Stampf-Ketten (Combo!), Konfettikanonen als Effekt.
* Münzen: Skin `oper-note`; Gems: `oper-mask`. Loops: dezentes `crowd-fair` (Saalgemurmel, leise).
* Muster: ≥ 24, davon 4 Einsteiger, 6 mittlere, 6 schwere, mind. 3 Setpieces („Ballsaal-Eröffnung“: Tanzpaar-Reihe zum Stampfen; „Klavierkonzert“: Sprungbrett + Balkonbahn; „Mitternachtswalzer“: Dreiertakt-Serie + Kronleuchter + Spot).
  Todesnamen: Flügel, Champagnerturm, Torte, Harfe, Blumenstrauß, Samtseil, Kronleuchter, Scheinwerfer, Korken, Kellner, Tanzpaar …
