# Fredrun 2.0 – Musik & Jingles

Die Musik besteht aus **aufgenommenen Stücken** (KI-Komposition mit Suno V5 über kie.ai), die sich taktgenau und nahtlos
wiederholen. Die prozedurale Musik-Engine (`audio/music.ts`, `audio/themes.ts`) bleibt als **Fallback**, falls eine Datei
nicht geladen werden kann (offline, Blocker, fehlende Datei) – dann schaltet die Engine dauerhaft darauf um.

| Stück | Einsatz | Tempo | Charakter |
|-------|---------|-------|-----------|
| `menu` | Hauptmenü, Bestenliste, Einstellungen … | 131 bpm | heroisches Orchester + Elektro-Drums |
| `select` | Charakterauswahl | 107 bpm | cooler Groove (Slap-Bass, Synth, Bläser) |
| `wien` | Wien im Sturm | 153 bpm | Wiener-Walzer-Hybrid-Action, Streicher-Pizzicato, Cembalo, Pauken |
| `alpen` | Alpenpanorama | 140 bpm | Alphorn, Zither, Blasmusik, treibende Snare |
| `finanzamt` | Finanzamt bei Nacht | 133 bpm | Stealth-Heist-Funk, Stempel-/Schreibmaschinen-Perkussion |
| `prater` | Prater | 159 bpm | Kirmes-Orgel, Akkordeon, Zirkus-Polka |
| `wachau` | Wachau | 136 bpm | Gitarre, Akkordeon, Klarinette, sonniger Volks-Pop |
| `cyber` | Cyber-Wien 2099 | 140 bpm | dunkle Synthwave, Arpeggios, Sidechain-Bass |

Jedes Stück gibt es in **zwei Varianten** (`<id>.mp3`, `<id>-2.mp3` – beide Kandidaten des Suno-Auftrags); der Spieler wählt bei jedem
Start zufällig und nie zweimal hintereinander dieselbe, damit sich die Läufe frisch anfühlen. Es wird immer nur die gewählte Variante geladen.

Jingles (`public/fredrun2/audio/jingles/`): `gameover.mp3`, `highscore.mp3`, `transition.mp3` (Weltwechsel in der Weltreise),
`victory.mp3` (Reserve). Sie laufen als Stinger über den SFX-Bus und ducken die Musik.

## Pipeline

```
tools/fredrun2/audio_prompts.json   Prompts (Stil, Titel) für alle Stücke und Jingles
tools/fredrun2/kie-audio.mjs        kie.ai-Client: Suno-Auftrag → Polling → Download (2 Kandidaten je Aufruf, 12 Credits)
tools/fredrun2/make_music.py        Rohstück → taktgenaue Schleife → public/fredrun2/audio/music/<id>.mp3 + music.json
src/game/fredrun2/audio/tracks.ts   Laufzeit: Schleifen-Spieler (Überblendung), Jingle-Spieler
tools/fredrun2/music-smoke.mjs      Browser-Rauchtest (Menü-/Weltmusik hörbar, Downloads, Game-Over-Jingle)
```

```bash
# 1) Rohstücke erzeugen (Schlüssel nur aus der Umgebung, nie ins Repo!)
KIE_API_KEY=… node tools/fredrun2/kie-audio.mjs music --out /tmp/audio [menu wien …]
# 2) Schleifen bauen (ffmpeg via pip imageio-ffmpeg oder --ffmpeg <Pfad>)
python3 tools/fredrun2/make_music.py --src /tmp/audio [--only wien] [--report]
```

`make_music.py` schätzt Tempo und Taktraster (Onset-Kurve + Kammfilter), legt den Schleifenbeginn auf einen Taktanfang, wählt
32–44 Takte (≈ 55–80 s), justiert die Länge um ± 60 ms auf die beste Naht und schreibt `period` (Abstand der Kopien) und `xfade`
(2 Schläge Überblendung) ins Manifest. Lautheit ≈ −15 LUFS, MP3 96 kbps (≈ 0,6–0,9 MB je Variante, 16 Dateien ≈ 13 MB, geladen wird pro Sitzung nur ein Bruchteil).

## Laufzeit

* `TrackMusic` startet alle `period` Sekunden eine neue Kopie des dekodierten Puffers und blendet mit Equal-Power-Kurven über –
  ohne Lücke, Beat bleibt auf dem Raster (MP3-Encoder-Delay spielt keine Rolle, nur Abstände zwischen Startzeiten zählen).
* Es liegt immer nur ein Stück (plus das ausblendende Vorgängerstück) dekodiert im Speicher (≈ 25–35 MB).
* `setIntensity(v)` steuert Klangfarbe (Hochton-Shelf −1,8 … +2 dB) und Pegel (−1 … 0 dB) – die Stücke werden mit steigendem
  Tempo/Schwierigkeit heller und präsenter.
* Ducking (`duck`) wirkt auf die Musik-Bus-Stufe wie bisher; Pause/Tab-Wechsel suspendiert den AudioContext.
* Nur Nutzergeste → `unlock()`; vorher gemerkte `music.play`-Aufrufe starten danach.

## Kosten / Lizenz

Suno über kie.ai: 12 Credits je Aufruf (11 Aufrufe für die Stücke + Jingles, ein weiterer Testaufruf). Die erzeugten Stücke sind
Eigenproduktionen des Projekts (Nutzungsrechte gemäß kie.ai-/Suno-Bedingungen des Kontos). Der API-Schlüssel wird nie
im Repo gespeichert.
