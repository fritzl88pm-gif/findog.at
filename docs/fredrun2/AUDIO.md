# Fredrun 2.0 – Klangeffekte (Sample-Bank)

Die Klangeffekte bestehen zum größten Teil aus **echten, nachbearbeiteten Samples** statt reiner Synthese. Alle Effekte stecken in
**einer** Sprite-Datei; die früheren prozeduralen Stimmen (`src/game/fredrun2/audio/sfx.ts`) bleiben als Fallback.

| Datei | Inhalt | Größe |
|-------|--------|-------|
| `public/fredrun2/audio/sfx-bank.mp3` | alle Varianten hintereinander, mono, 44,1 kHz, libmp3lame CBR 112 kbps (mit LAME-Kopf), 52,0 s | 712 KB |
| `public/fredrun2/audio/sfx-bank.json` | Manifest: Version, Sample-Rate, Sync-Puls, je Effekt Varianten `{start, dur}` + Standardwerte | 6 KB |

47 Effekte in 89 Varianten (Nutzsignal 38 s, dazwischen 150 ms Stille). `SFX_NAMES` (`audio/types.ts`) führt 53 Namen: die 47 der Bank, die Jingles `gameover` und `highscore`, die prozeduralen `bee-buzz`, `pigeon`, `dash-ready`, `heartbeat`
(`world-transition` ist beides: Bank-Effekt plus Jingle). Im Speicher bleiben nach dem Laden nur die einzelnen mono-Slices
(≈ 7 MB bei 48 kHz); der große Sprite-Puffer (≈ 10 MB) wird sofort wieder freigegeben. Der Download ist einmalig und wird vom Browser
gecacht (Manifest verweist mit `?v=<Hash>` auf die MP3).

## Quellen und Lizenz

Alle Samples stammen aus den freien Klangpaketen von **Kenney (www.kenney.nl), Lizenz CC0 1.0** (frei nutzbar, auch kommerziell, Nennung
nicht verpflichtend, aber gern gesehen): *Interface Sounds*, *Impact Sounds*, *Digital Audio*, *Sci-Fi Sounds*, *RPG Audio*, *Casino Audio*
(https://kenney.nl/assets). Die Rohdateien liegen **nicht** im Repo, nur das Ergebnis der Bearbeitung. Zusätzlich erzeugt das Skript
Rauschen und Hall-Impulse offline (numpy, deterministisch): rosa Rauschen für Luft-Whooshes (die Kenney-Triebwerksdateien bestehen fast
nur aus Bass-Grollen), braunes Rauschen für Rumpeln, exponentiell abklingende Faltungshalle.

Nicht in der Bank: `bee-buzz` und `pigeon` (kein passendes Sample – bleiben prozedural), `dash-ready` und `heartbeat` (Hinweistöne, rein synthetisch in `sfx.ts`), `gameover`, `highscore` und `world-transition`
(Musik-Jingles über `tracks.ts`; bei `world-transition` spielt zusätzlich der Bank-Effekt, deshalb ist er bewusst **atonal**: Riser +
Einschlag + Glitzerrauschen ohne Tonhöhen, die sich mit dem Jingle reiben könnten).

## Rezepte-Überblick

Werkzeugkasten des Skripts: Trimmen, Ein-/Ausblenden, Hoch-/Tiefpass, Peak-/Shelf-EQ, gleitende Filter (Whoosh/Riser),
Tonhöhe/Tempo per Resampling, „Tape-Stop“-Gleiten (Doppler, Zeitlupe), Reverse, Layering mit wahrnehmungsnaher Pegelanpassung (`lv()`),
Arpeggios aus gestimmten Zupf-/Glas-Samples, Faltungshall, Bit-Reduktion, Lookahead-Limiter. Jeder Effekt ist ein `@fx`-Rezept im Skript.

| Gruppe | Effekte (Varianten) | Aufbau |
|--------|---------------------|--------|
| UI | `ui-click` (3), `ui-hover` (2), `ui-back` (2), `ui-denied` (2) | Interface-Samples (`select`, `click`, `tick`, `back`, `error`) + Klick-Transiente, weich tiefpassgefiltert; `ui-denied` zwei dumpfe Zupfer abwärts. `ui-buy` (1): Münzklimpern (`handleCoins`) + Bestätigungston + Glas-Glitzern + kurzer Hall |
| Bewegung | `jump` (4), `doublejump` (2), `land` (4), `slide` (3), `dash` (3) | Sprung: Abstoß-Schritt (Footstep-Transiente, sofortiger Einsatz) + Stoff-Flick (`cloth`) + Luft-Whoosh + leiser Retro-Aufwärtsschub (`phaseJump`). Landung: weicher Aufprall + Schuh-Transiente + Scharren. Rutschen: Stoff + fallendes Reibungsrauschen. Dash: Whoosh + Kraftfeld + Sub |
| Aufpralle | `stomp` (3), `stomp-chain` (2), `wallbreak`, `spring`, `portal` | schwere Platte/Sub/Crunch (`impactPlate_heavy`, `impactSoft_heavy`, `explosionCrunch`, sci-fi `impactMetal`) + Kurzraum; Kombo-Stampfer mit Zupf-Terzkette; Wand: Crunch mit gleitendem Tiefpass + Planke + gestreute Brocken; Feder: `phaseJump`-Boing + Metall-Twang; Portal: Kraftfeld + rückwärts laufendes Glas + Rausch-Riser |
| Pickups | `coin` (4), `gem` (2), `heart`, `powerup`, `shield-on`, `shield-hit` (2), `slowmo-on`, `slowmo-off`, `magnet-on` | Münze: zwei Zupftöne (B5→E6, Quarte) + gestimmter Glas-Nachklang + Chip-Klick (Casino); Edelstein/Power-up/Combo: Zupf-Arpeggien (C-Dur-Pentatonik) mit Glas; Zeitlupe: `zap2` gleitet wie ein Tape-Stop nach unten/oben; Magnet: Kraftfeld mit 22-Hz-Tremolo + `metalLatch` |
| Treffer | `hurt` (3), `death`, `near-miss` (2), `combo-up` (2), `combo-break` | Faustschlag + Sub + kurzer Zap (`laserSmall`, −5 Halbtöne) + Crunch; Tod: Crunch mit fallendem Tiefpass + Sub-Boom + absackender Ton + Hall; Beinahe-Treffer: Whoosh mit Doppler-Glide (Pan-Fahrt macht die Laufzeit, Richtung zufällig) |
| Ablauf | `countdown`, `go`, `checkpoint`, `world-transition` | gestimmte Zupf-/Glas-Töne (A5-Tick, C-Dur-Akkord, G-C-E-G-Arpeggio); Weltwechsel: rückwärts laufender Crunch + Riser → Einschlag mit Sub |
| Hinweise | `dash-ready`, `heartbeat` | nicht in der Bank, Rezepte in `sfx.ts`: `dash-ready` zwei weiche Glockentöne (Quarte aufwärts, G5 → C6, kaum Metallanteil); `heartbeat` „lub-dub“ aus Sub-Tönen (78/70 Hz) plus Mittenanteil (150/135 Hz, Dreieck) und kurzem dumpfen Anschlag, damit er unter dem Bass der Musik und auf kleinen Lautsprechern hörbar bleibt |
| Welten | `lightning-warn`, `thunder`, `tram-bell` (2), `stamp-thud` (3), `laser-zap` (3), `paper-flutter` (3), `cannon`, `splash` (2), `barrel-roll`, `glitch` (3), `avalanche-warn`, `rockfall`, `crumble` (3), `enemy-defeat` (3) | Blitz: Zap-Summen + flackernde Statik; Donner: scharfer Knall + verlangsamtes, tiefpassgleitendes Grollen + langer Hall; Straßenbahn: `impactBell_heavy` +10 Halbtöne, dreifach; Stempel: Buch-Klatschen + Holz + Sub; Laser: `laserRetro`/`laserSmall`; Papier: Karten-Fächer/Buchblätter; Kanone: Crunch + Sub + Metall + Hall; Platsch: Rausch-Whoosh + Drop-Blubbern; Fass: Holz-Schläge mit beschleunigter Folge über Rumpeln; Glitch: gestotterte Mini-Glitches über bit-reduziertem „Weltraum-Müll“; Steinschlag/Bröckeln: `impactMining`-Brocken |

## Pegel

Jeder Effekt hat eine **Ziel-Lautheit** (`lufs`, lautester 200-ms-Abschnitt, K-bewertet) und eine **Spitzengrenze** (`ceil`, immer ≤ −2 dBFS,
Lookahead-Limiter). Varianten eines Effekts werden vorher auf gleiche Lautheit gebracht (±4 dB). Ebenen innerhalb eines Effekts werden über `lv()`
auf einen gemeinsamen wahrnehmungsnahen Bezug gebracht, die Rezepte geben nur Pegelabstände an.

| Kategorie | Ziel (LUFS) | Spitze | Beispiele |
|-----------|-------------|--------|-----------|
| UI leise | −37 … −27 | −12 … −5 dBFS | `ui-hover` −37, `ui-click` −30, `ui-denied` −27 |
| häufig, dezent | −28 … −23 | −8 … −5 | `jump` −27, `land` −26, `coin` −26, `slide` −28, `dash` −23 |
| Pickups / Ablauf | −23 … −20 | −5 … −3 | `gem` −22, `powerup` −21, `go` −22 |
| Treffer / Explosionen | −20 … −15 | −3 … −2 | `stomp` −19, `hurt` −17, `death` −15,5, `cannon` −15 |

Feinabgleich ohne Neubau: `gain` je Effekt im Manifest oder `SFX_META.gain` in `sfx.ts`; ein Ziel dauerhaft ändern: `lufs`/`ceil` im `@fx`-Rezept
und neu bauen. Der Bericht (`--report`) zeigt je Effekt Spitze, Lautheit, Ziel, Limiter-Eingriff (soll ≈ 0 dB sein) und Attack.
Die Tabelle gibt die Ziele der Bank an; die häufigen Rückmeldungen (Sprung, Münze, Countdown …) tragen seit der Verbesserungsrunde zusätzlich einen `SFX_META.gain` über 1 (Abschnitt „Mix“).

## Bank neu bauen

```bash
# Kenney-Pakete entpacken (je <paket>/Audio/*.ogg), ffmpeg per pip: pip install imageio-ffmpeg
python3 tools/fredrun2/build_sfx_bank.py --src /pfad/zu/kenney [--report /tmp/sfx-report] [--wav /tmp/sfx-wav]
python3 tools/fredrun2/build_sfx_bank.py --src … --only jump,coin --report /tmp/x   # nur analysieren, Bank bleibt unberührt
```

Der Lauf dauert ≈ 15 s und ist **deterministisch** (feste Zufallsquellen je Effekt, `bitexact`-Kodierung): gleiche Quellen ⇒ gleiche Dateien.
Am Ende dekodiert das Skript die MP3 wieder und prüft für jede Variante per Kreuzkorrelation, dass der Schnitt sample-genau sitzt und der Ausklang stumm
endet (Selbsttest, Abbruch bei Abweichung). `--report` schreibt `report.txt` (Spitze, Lautheit, Länge, Attack, Gleichanteil) und Spektrogramm-Kontaktbögen
je Kategorie (PNG); `--wav` je Variante eine WAV zum Anhören. Neue Effekte: `@fx`-Rezept schreiben (Namen aus `SFX_NAMES`), bauen, fertig – die Laufzeit
nimmt jeden Namen aus dem Manifest.

## Laufzeit (kurz)

`unlock()` → `SfxPlayer.enableBank()` → Manifest + MP3 laden, dekodieren (Promise- **und** Callback-Variante für ältere Safari), in Slices zerlegen.
`SfxPlayer.play()` behandelt Priorität, Cooldown, Polyphonie und Ducking wie zuvor; ist der Effekt in der Bank, spielt eine `SfxVoice` (Lautstärke, Pan,
Reverb-Send) die Sample-Stimme: Variante per „Zufalls-Beutel“ (nie zweimal dieselbe hintereinander), Tonhöhe × Zufalls-Jitter (`pitchJitter`, z. B. ±4 % bei
`jump`, 0 bei melodischen Effekten), Pan-Fahrt (`sweep`). Nicht geladen/nicht gemappt ⇒ prozedurales Rezept. Details: `src/game/fredrun2/audio/README.md`.

**MP3-Encoder-Delay:** der Sprite beginnt mit 0,25 s Stille und einem Sync-Puls (bei 60 ms). Browser, die den LAME-Kopf auswerten (Chromium, Firefox,
Safari), liefern die Schnitte sample-genau; Browser, die das nicht tun, verschieben alles um ≈ 25 ms – die Laufzeit misst den Puls und gleicht das aus.

## Engine-API (Verbesserungsrunde)

```ts
const audio = createAudio();                    // Browser: Engine, Node/SSR/ohne AudioContext: stummes No-Op-Objekt
await audio.unlock();                           // aus einer Geste; wiederholbar (siehe unten)
audio.unlocked;                                 // true, sobald der Kontext einmal "running" war
audio.sfx("coin", { pitch: 1.2, volume: 0.8, pan: -0.3 });
audio.stopStingers(0.3);                        // Jingles ausblenden und Musik-Absenkung aufheben (Neustart, Menü)
audio.music.setMuffle(1, 0.12);                 // Musik dämpfen: 0 = offen … 1 = Tiefpass 900 Hz und −5 dB
audio.prefetch({ music: ["wien"] });            // Dateien in den HTTP-Cache laden; auch preloadAudio() aus audio/index.ts
```

Der Hub spricht die Engine über das strukturelle Interface `AudioLike` (`game.ts`) an; `stopStingers`, `prefetch` und `music.setMuffle` sind dort optional, damit Attrappen und ältere Engines weiter passen.

* **`unlock()` ist wiederholbar.** Es wartet höchstens ≈ 1,2 s auf `ctx.resume()`; das Zeitlimit beendet nur das Promise. Läuft der Kontext erst später (langsames Gerät, Safari/iOS, Bluetooth), entscheidet `onstatechange`: bei jedem Wechsel auf
  „running“ startet das Gemerkte (`music.play()`/`loop()` vor dem Entsperren). `sfx()` vor dem „running“ versucht ebenfalls ein `resume()` (gedrosselt auf 500 ms). Der Hub ruft `unlock()` bei jeder Geste erneut auf, solange `unlocked === false` (höchstens alle 300 ms).
  Wo vorhanden, setzt `unlock()` `navigator.audioSession.type = "playback"` (iOS-Stummschalter); stumm, pausiert oder entsorgt: „auto“ – nur per Code geprüft.
* **Stinger** (`gameover`, `highscore`, `world-transition`) laufen über `graph.stingerBus` (Pegel = Musiklautstärke, kein Duck) statt über den Effekt-Bus: Musik aus ⇒ kein Jingle (auch kein synthetischer Ersatz), Effekte aus ⇒ Jingle bleibt. Der Effekt-Anteil des
  Weltwechsels bleibt am Effekt-Regler. `JinglePlayer.play` liefert ein `JingleHandle` (`stop(fadeSec)`), `stopAll`/`stopOf` blenden aus (Zeitkonstante `fadeSec / 4`, Quelle stoppt nach 1,25 · `fadeSec` + 30 ms). `gameover`/`highscore` lösen einen noch klingenden Weltwechsel-Jingle ab.
  `stopStingers(fadeSec = 0,3)` ruft `stopAll`, setzt `duckUntil` zurück und führt beide Duck-Stufen mit τ 0,12 s auf 1 (`releaseDuck`).
* **Dämpfung** (`music.setMuffle`): Tiefpass (`musicLP`, Hall-Pfad `musicWetLP`, Q −3 dB) und Pegelstufe (`muffleDry`/`muffleWet`) zwischen Musikbus und Duck. 0 = offen (22 kHz, höchstens Nyquist), 1 = 900 Hz und −5 dB, dazwischen logarithmisch in der Frequenz und
  linear in dB. `rampSec` ist die Zeitkonstante (Standard 0,12 s). `music.play()` und `music.stop()` setzen auf 0 zurück, ein Aufruf vor dem Entsperren gilt, sobald der Graph existiert. Effekte und Stinger werden nicht gedämpft. Der Hub dämpft in Pause und
  Resume-Countdown voll (1; beim Pausieren mit Zeitkonstante 0,12 s), in der Zeitlupe mit 0,6 und hebt beim Lauf-/Menüwechsel und am Ende des Resume-Countdowns auf.
* **Vorwärmen** (`prefetch({ music?: string[] })`, `preloadAudio()`): lädt per `fetch(…, { priority: "low" })` SFX-Bank (Manifest + MP3 unter derselben URL wie `bank.ts`), `music.json` und je Stück **eine** Variante in den HTTP-Cache – ohne Dekodieren,
  ohne AudioContext, ohne Geste. Die Wahl merkt `MusicLibrary` (`nextVariant`), `music.play()` spielt dieselbe Datei. `music` fehlt ⇒ nur das Menüstück, `[]` ⇒ nur Bank und Manifest; ohne `fetch` (SSR) ein No-Op. Der Hub ruft es im Leerlauf nach dem Laden
  (`["menu", <Weltmusik>]`), bei der Weltwahl und in der Weltreise für die Musik der nächsten Welt.
* **Dauerklänge** (`LOOP_NAMES`, 11): `rain`, `wind`, `avalanche`, `magnet`, `laser-hum`, `crowd-fair`, `river`, `office-hum`, `cyber-hum`, `dash-whoosh`, `slide-scrape`. Der Hub schaltet `dash-whoosh` (0,8) bei Dash/Turbo, `slide-scrape` (0,7) beim Rutschen, `magnet` (0,5)
  mit Magnet und die `loop:<Name>`-Variablen der Welten.

## Ereignis → Ton (`game-audio.ts`, `audio/cues.ts`)

`createGameAudio(audio, { cuesEnabled })` ersetzt die frühere Zuordnung in `game.ts`. Es kennt nur strukturelle Typen (`AudioSink`, `GameAudioEvent`) und ist mit einer Attrappe testbar (`game-audio.test.ts`). Der Hub ruft `onEvent` je Sim-Ereignis (nicht in der Demo)
und `tick(dt, sim, paused)` einmal je Frame.

| Sim-Ereignis | Ton |
|--------------|-----|
| `jump`, `doublejump`, `slide`, `dash`, `stomp-land`, `portal`, `heart`, `shield-on`, `shield-hit`, `near-miss`, `combo-break` | gleichnamiger Effekt (`stomp-land` → `stomp`) |
| `land` | `land`, Lautstärke `min(1, Aufprall / 1000)` |
| `dash-denied` | `ui-denied` mit Lautstärke 0,5 |
| `stomp-start` | `dash` mit Tonhöhe 0,75 und Lautstärke 0,45 (leiser, tiefer Whoosh bis zum Aufprall) |
| `bounce` | `stomp-chain`, Tonhöhe nach Kettenlänge (`stompChainPitch`: Pentatonik C-Dur, 6 Stufen) |
| `coin` | `coin`, Tonhöhe nach Münzkette (`coinPitch`: Leiter 0, 2, 4, 7, 9, 12, 14, 16 Halbtöne, danach abwechselnd 12/16; Obergrenze 2,5), Pan nach `x` |
| `combo-up` | `combo-up`, Tonhöhe nach Stufe (`comboPitch`, Stufen 2 … 8) |
| `powerup` | `powerup`, bei Tag `slowmo` zusätzlich `slowmo-on`, bei `magnet` zusätzlich `magnet-on` |
| `hurt`, `death` | `hurt` bzw. `death`, dazu `duck(0,5; 0,25 s)` bzw. `duck(0,9; 1,2 s)` |
| `enemy-defeat`, `wallbreak`, `spring`, `gem` | gleichnamiger Effekt mit Pan nach `x` |
| `pit-fall` | `splash` |
| `world-transition` | `world-transition` und Musikwechsel auf die Musik der neuen Welt (Überblendung 2 s) |
| `milestone` | `checkpoint` |
| `custom` mit Tag `sfx:<Name>` | der Effekt `<Name>` mit Pan nach `x`; Tag `crumble` → `crumble` |
| `custom` mit Tag `zone-warn:<skin>` / `zone-active:<skin>` | Zonen-Ton (unten) |
| `start` | setzt Hinweis-Zustand und Zonen-Sperren zurück |

**Zonen-Töne** (`zoneCue`, `zoneGroup`): die Gruppe ergibt sich aus dem Skin-Namen (`bolt|lightning|blitz`, `stamp|stempel`, `laser|beam`, `rock|stein`, `phase`).

| Gruppe | Warnung | aktiv |
|--------|---------|-------|
| Blitz | `lightning-warn` | `thunder` |
| Stempel | `paper-flutter` | `stamp-thud` |
| Laser | `laser-zap`, Tonhöhe 0,6, halbe Lautstärke („Aufladen“) | `laser-zap` |
| Steinschlag | `rockfall`, Tonhöhe 1,15, 0,55 · Lautstärke | `rockfall` |
| Phase (Cyber) | – | `glitch`, Lautstärke 0,45, nur im Bild |

Die Lautstärke sinkt mit dem Abstand zum Bildrand (`1,15 − Abstand / 450`, Boden 0,2). Das Zonen-Ton-Budget (`game-audio.ts`): ein aktiver Ton derselben Gruppe frühestens nach 0,35 s (`ZONE_MIN_GAP_SEC`); über alle Gruppen höchstens zwei Töne je Sekunde
(`ZONE_WINDOW_SEC`), wobei ein aktiver Takt („jetzt gefährlich“) mit einem freien von zwei Plätzen auskommt und eine Warnung nur in einer ganz freien Sekunde spielt; Töne unter Lautstärke 0,25 (`ZONE_AUDIBLE_VOLUME`) werden weder gespielt noch gezählt. Begründung und
Bot-Messung stehen im Kommentar der Konstanten.

**Zustands-Hinweise** (`CueTracker`, nur mit Einstellung „Signaltöne“; der Tracker läuft auch bei ausgeschalteten Signaltönen mit, damit beim Einschalten nichts nachgeholt wird): `dash-ready` (Dash wieder einsatzbereit: genug Energie und keine Abklingzeit),
`heartbeat` (alle 1,3 s beim letzten Herz, der erste einen Takt nach dem Wechsel; Aufruf mit Lautstärke 0,4) und `slowmo-off` (Zeitlupe vorbei, Bank-Effekt). In der Pause und in den ersten 2 s eines Laufs (`CUE_QUIET_SEC`) kommt nichts; Wechsel in dieser Zeit lösen später nichts nach.

## Mix

Master-Graph unverändert (Musik-/Effekt-Trim 1,0, Hall-Rückführung 0,9, Kompressor, Soft-Clipper, Master hinter der Begrenzung); neu darin: Dämpfungsstufen und `stingerBus` (siehe `graph.ts`). Die Pegel der Runde, jeweils als eigene Konstante einzeln zurückdrehbar:

| Wert | Datei · Name | Stand |
|------|--------------|-------|
| Pegel der aufgenommenen Musik | `audio/tracks.ts` · `TRACK_TRIM` | 1,2 (vorher 1,6; Zwischenstand 1,25) |
| Effekt-Pegel (`SFX_META.gain`) | `audio/sfx.ts` · `G_JUMP` 1,5 · `G_DOUBLEJUMP` 1,35 · `G_SLIDE` 1,5 · `G_DASH` 1,35 · `G_STOMP_CHAIN` 1,35 · `G_COIN` 1,25 · `G_GEM` 1,3 · `G_COUNTDOWN` 1,6 · `G_GO` 1,25 · `G_HEARTBEAT` 1,5 | Obergrenze ist der Stimmen-Clamp 1,5 (`SfxVoice`): 1,6 wirkt wie 1,5; der Herzschlag wird mit Lautstärke 0,4 gespielt (wirkt wie 0,6) |
| Musik-Absenkung durch Rückmeldungen | `audio/sfx.ts` · `DUCK_COUNT` [0,3; 0,2 s] (`countdown`, `go`) · `DUCK_MICRO` [0,25; 0,25 s] (`heart`, `powerup`, `near-miss`, `combo-up`) | nicht für die Münze (3,9 pro Sekunde) |
| Lawine | `audio/loops.ts` · `avalanche.base` | 0,5 (vorher 0,7, −2,9 dB): bei Level 0,6 lag sie ca. 4 dB über der Musik |
| Dämpfung / Duck-Aufhebung | `audio/graph.ts` · `MUFFLE_HZ` 900, `MUFFLE_DB` −5, `MUFFLE_TAU` 0,12, `DUCK_RELEASE_TAU` 0,12 | |
| Zonen-Budget, Signale | `game-audio.ts`, `audio/cues.ts` | Abschnitt „Ereignis → Ton“ |

Die Werte beruhen laut Kommentaren auf Offline-Renderings des echten Graphen (1/3-Oktav-Marge über dem Median der Musik, Master-Spitze ≤ −2 dBFS); nach Gehör sind sie nicht abgenommen (siehe „Bekannte Schwächen“).

## Prüfung

* `npx vitest run src/game/fredrun2/audio` – `bank.test.ts`: Manifest-Validierung, Varianten-Wiederholungsfreiheit, Sync-/Slice-Rechnung, `SfxBank`/`SfxPlayer` gegen einen
  Fake-Kontext, ausgelieferte Dateien (Namen ∈ `SFX_NAMES`, keine Jingle-Namen, Hash und Größe der MP3). Seit der Verbesserungsrunde zusätzlich `cues.test.ts` (Leitern, Zonen-Töne, Hinweis-Automat),
  `engine.test.ts`/`graph.test.ts`/`tracks.test.ts` (Entsperren, Stinger, Dämpfung, Vorwärmen, Jingle-Abbruch gegen den Fake-Kontext) und, eine Ebene höher, `game-audio.test.ts` (Zuordnung und Zonen-Budget gegen eine Attrappe).
* `FFMPEG=<pfad> node tools/fredrun2/audio-smoke.mjs [--only bank,fallback,48k,gapless,stinger-stop,late-resume,muffle,stinger-bus,prefetch]` – echtes Chromium: (1) Bank lädt, alle 89 Varianten beginnen/enden sauber, bleiben ≤ −1,7 dBFS, „knackige“
  Effekte setzen in < 15 ms ein, jeder gemappte Name spielt aus der Bank, alle anderen synthetisch, nach dem Ausklang hängt keine Stimme; (2) Bank blockiert ⇒
  vollständiger prozeduraler Fallback ohne Fehler; (3) AudioContext mit 48 kHz ⇒ der Browser resampelt den Sprite, Schnitte sitzen trotzdem; (4) MP3 ohne LAME-Kopf ⇒
  Encoder-Delay (≈ 25 ms) wird gemessen und ausgeglichen. Szenarien der Engine-Mechanik gegen die echte Engine (Pegel über einen `AnalyserNode` am Master): `stinger-stop` (Neustart nach Tod-Jingle: 0,6 s später keine Jingle-Quelle mehr,
  Pegel 1 … 6 s danach innerhalb ±1,5 dB der Lauf-Referenz; Kontrolllauf ohne `stopStingers` zeigt den Fehler), `late-resume` (`resume()` antwortet erst nach 2,5 s: gemerkte Musik startet ≤ 1 s danach), `muffle` (Anteil > 3 kHz fällt binnen 0,4 s um ≥ 10 dB,
  `setMuffle(0)` kehrt auf ±1 dB zurück), `stinger-bus` (Jingles hängen am Musik-Regler; Weltwechsel-Effekt am Effekt-Regler), `prefetch` (8 Mbit/s, 80 ms: Bank, Manifest und genau eine Variante je Stück werden vor dem Entsperren geladen; Musik startet danach ≤ 1,2 s
  nach `music.play()`, kalt ca. 1,8 s). Die Schwellen stehen im Kopfkommentar von `audio-smoke.mjs`.
* Ohren-frei-QA des Baus: Pegel-/Längen-/Attack-Tabelle und Spektrogramme (`--report`), Klick-/DC-/Clipping-Kontrolle im Skript.

## Bekannte Schwächen

* Die Effekte wurden ohne Anhören gebaut (Auswahl nach Spektrum, Hüllkurve und Attack). Vor allem die Misch-Effekte (`portal`, `slowmo-*`, `magnet-on`,
  `splash`, `barrel-roll`, `lightning-warn`, `glitch`) sollten einmal probegehört und über `lufs`/Rezept nachgeschärft werden.
* Kenneys Digital-Audio-Pakete klingen retro; sie stecken nur leise als Charakter-Schicht in `jump`/`spring`/`powerup`/`slowmo-*`.
* Melodische Effekte sind in C-Dur/Pentatonik gestimmt, die aufgenommene Musik hat je Stück eigene Tonarten – kurze Zupfer stören das kaum, ein Nachstimmen
  wäre über `hz("…")` in den Rezepten möglich.
* Tiefe Effekte (`thunder`, `avalanche-warn`, `rockfall`, `cannon`) tragen auf Handy-Lautsprechern nur über ihre Mitten/Transienten; die Sub-Ebenen sind bewusst
  unterhalb der Mitten-Ebenen gemischt.
* Beim allerersten Sound nach dem Entsperren (bis die Bank geladen ist, < 1 s) klingt der Effekt noch synthetisch.
* Der Pegel-Feinabgleich der Verbesserungsrunde (`TRACK_TRIM`, `G_*`, Lawine, Signaltöne) stammt aus Offline-Rendering-Messungen, nicht aus einer Abnahme nach Gehör; die Kommentare verweisen auf `impl/pkg-audio-mix/measure.json`, die nicht im Repo liegt.
  `dash-ready` und `heartbeat` sind rein synthetisch (kein Bank-Sample) und ebenfalls nicht probegehört.
* `navigator.audioSession` (iOS-Stummschalter) ist nur per Code geprüft; „playback“ kann auf iOS Hintergrundmusik anderer Apps unterbrechen (Details: `src/game/fredrun2/audio/README.md`).

## Anhang: Pegel-/Längentabelle (Ausgabe von `--report`)

Lautheit = lautester 200-ms-Abschnitt (K-bewertet, LUFS-Näherung), Attack = Zeit bis 25 % der Spitze. Gleichanteil < 0,002, Limiter-Eingriff ≤ 2 dB (Kanone), kein Effekt über −2 dBFS.

| Effekt | Var. | Länge (s) | Spitze (dBFS) | Lautheit (LUFS) | Attack (ms) |
|---|---|---|---|---|---|
| `ui-click` | 3 | 0.04 / 0.04 / 0.04 | -7.6 | -30.0 | 0.3 |
| `ui-hover` | 2 | 0.02 / 0.01 | -13.0 | -37.0 | 0.2 |
| `ui-back` | 2 | 0.07 / 0.08 | -8.6 | -30.0 | 0.3 |
| `ui-buy` | 1 | 0.37 | -7.4 | -24.0 | 20.1 |
| `ui-denied` | 2 | 0.22 / 0.13 | -10.2 | -27.0 | 0.2 |
| `jump` | 4 | 0.20 / 0.20 / 0.20 / 0.20 | -10.5 | -27.0 | 0.6 |
| `doublejump` | 2 | 0.22 / 0.22 | -9.5 | -26.0 | 11.3 |
| `land` | 4 | 0.15 / 0.15 / 0.15 / 0.12 | -5.0 | -26.0 | 0.5 |
| `slide` | 3 | 0.31 / 0.32 / 0.32 | -12.6 | -28.0 | 8.9 |
| `dash` | 3 | 0.30 / 0.30 / 0.30 | -11.5 | -23.0 | 12.6 |
| `stomp` | 3 | 0.35 / 0.31 / 0.41 | -3.0 | -19.0 | 0.5 |
| `stomp-chain` | 2 | 0.43 / 0.42 | -5.4 | -23.0 | 0.8 |
| `spring` | 1 | 0.34 | -12.3 | -22.0 | 0.2 |
| `portal` | 1 | 0.94 | -10.4 | -20.0 | 59.8 |
| `wallbreak` | 1 | 0.59 | -2.1 | -16.0 | 1.2 |
| `coin` | 4 | 0.34 / 0.15 / 0.27 / 0.22 | -7.2 | -26.0 | 0.2 |
| `gem` | 2 | 0.51 / 0.51 | -7.3 | -22.0 | 0.3 |
| `heart` | 1 | 0.59 | -6.2 | -22.0 | 3.7 |
| `powerup` | 1 | 0.61 | -8.0 | -21.0 | 0.3 |
| `shield-on` | 1 | 0.78 | -10.0 | -21.0 | 44.9 |
| `shield-hit` | 2 | 0.27 / 0.27 | -6.4 | -21.0 | 0.2 |
| `slowmo-on` | 1 | 1.12 | -11.7 | -21.0 | 2.1 |
| `slowmo-off` | 1 | 0.76 | -9.9 | -23.0 | 72.8 |
| `magnet-on` | 1 | 0.50 | -8.5 | -22.0 | 43.8 |
| `hurt` | 3 | 0.38 / 0.34 / 0.33 | -2.0 | -17.0 | 0.6 |
| `death` | 1 | 1.01 | -2.0 | -15.6 | 0.5 |
| `near-miss` | 2 | 0.34 / 0.34 | -13.7 | -24.0 | 17.1 |
| `combo-up` | 2 | 0.29 / 0.34 | -6.3 | -25.0 | 0.3 |
| `combo-break` | 1 | 0.35 | -16.5 | -25.0 | 0.3 |
| `countdown` | 1 | 0.22 | -8.1 | -27.0 | 0.2 |
| `go` | 1 | 0.62 | -3.0 | -22.0 | 0.3 |
| `checkpoint` | 1 | 0.73 | -5.2 | -22.0 | 0.3 |
| `world-transition` | 1 | 1.71 | -2.0 | -17.0 | 111.5 |
| `lightning-warn` | 1 | 0.84 | -9.0 | -23.0 | 54.0 |
| `thunder` | 1 | 2.52 | -2.0 | -17.1 | 0.4 |
| `tram-bell` | 2 | 0.49 / 0.50 | -4.9 | -22.0 | 0.2 |
| `stamp-thud` | 3 | 0.24 / 0.32 / 0.21 | -3.0 | -20.1 | 0.3 |
| `laser-zap` | 3 | 0.24 / 0.25 / 0.24 | -8.4 | -23.0 | 0.3 |
| `paper-flutter` | 3 | 0.50 / 0.38 / 0.58 | -10.0 | -33.0 | 158.2 |
| `cannon` | 1 | 0.93 | -2.0 | -15.1 | 0.3 |
| `splash` | 2 | 0.41 / 0.41 | -7.7 | -22.0 | 0.2 |
| `barrel-roll` | 1 | 0.95 | -8.6 | -26.0 | 1.4 |
| `glitch` | 3 | 0.39 / 0.39 / 0.39 | -7.3 | -23.0 | 6.3 |
| `avalanche-warn` | 1 | 1.20 | -6.4 | -21.0 | 159.7 |
| `rockfall` | 1 | 1.07 | -4.2 | -21.0 | 202.4 |
| `crumble` | 3 | 0.55 / 0.54 / 0.55 | -8.2 | -25.0 | 84.4 |
| `enemy-defeat` | 3 | 0.26 / 0.30 / 0.30 | -5.9 | -21.0 | 1.4 |
