# Fredrun 2.0 – Klangeffekte (Sample-Bank)

Die Klangeffekte bestehen zum größten Teil aus **echten, nachbearbeiteten Samples** statt reiner Synthese. Alle Effekte stecken in
**einer** Sprite-Datei; die früheren prozeduralen Stimmen (`src/game/fredrun2/audio/sfx.ts`) bleiben als Fallback.

| Datei | Inhalt | Größe |
|-------|--------|-------|
| `public/fredrun2/audio/sfx-bank.mp3` | alle Varianten hintereinander, mono, 44,1 kHz, libmp3lame CBR 112 kbps (mit LAME-Kopf), 52,0 s | 712 KB |
| `public/fredrun2/audio/sfx-bank.json` | Manifest: Version, Sample-Rate, Sync-Puls, je Effekt Varianten `{start, dur}` + Standardwerte | 6 KB |

47 Effekte in 89 Varianten (Nutzsignal 38 s, dazwischen 150 ms Stille). Im Speicher bleiben nach dem Laden nur die einzelnen mono-Slices
(≈ 7 MB bei 48 kHz); der große Sprite-Puffer (≈ 10 MB) wird sofort wieder freigegeben. Der Download ist einmalig und wird vom Browser
gecacht (Manifest verweist mit `?v=<Hash>` auf die MP3).

## Quellen und Lizenz

Alle Samples stammen aus den freien Klangpaketen von **Kenney (www.kenney.nl), Lizenz CC0 1.0** (frei nutzbar, auch kommerziell, Nennung
nicht verpflichtend, aber gern gesehen): *Interface Sounds*, *Impact Sounds*, *Digital Audio*, *Sci-Fi Sounds*, *RPG Audio*, *Casino Audio*
(https://kenney.nl/assets). Die Rohdateien liegen **nicht** im Repo, nur das Ergebnis der Bearbeitung. Zusätzlich erzeugt das Skript
Rauschen und Hall-Impulse offline (numpy, deterministisch): rosa Rauschen für Luft-Whooshes (die Kenney-Triebwerksdateien bestehen fast
nur aus Bass-Grollen), braunes Rauschen für Rumpeln, exponentiell abklingende Faltungshalle.

Nicht in der Bank: `bee-buzz` und `pigeon` (kein passendes Sample – bleiben prozedural), `gameover`, `highscore` und `world-transition`
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

## Prüfung

* `npx vitest run src/game/fredrun2/audio` – `bank.test.ts`: Manifest-Validierung, Varianten-Wiederholungsfreiheit, Sync-/Slice-Rechnung, `SfxBank`/`SfxPlayer` gegen einen
  Fake-Kontext, ausgelieferte Dateien (Namen ∈ `SFX_NAMES`, keine Jingle-Namen, Hash und Größe der MP3).
* `FFMPEG=<pfad> node tools/fredrun2/audio-smoke.mjs [--only bank,fallback,48k,gapless]` – echtes Chromium: (1) Bank lädt, alle 89 Varianten beginnen/enden sauber, bleiben ≤ −1,7 dBFS, „knackige“
  Effekte setzen in < 15 ms ein, jeder gemappte Name spielt aus der Bank, alle anderen synthetisch, nach dem Ausklang hängt keine Stimme; (2) Bank blockiert ⇒
  vollständiger prozeduraler Fallback ohne Fehler; (3) AudioContext mit 48 kHz ⇒ der Browser resampelt den Sprite, Schnitte sitzen trotzdem; (4) MP3 ohne LAME-Kopf ⇒
  Encoder-Delay (≈ 25 ms) wird gemessen und ausgeglichen.
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
