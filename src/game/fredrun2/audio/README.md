# Fredrun 2.0 – Audio (Web Audio)

Drei Schichten, alle ohne Bibliotheken:

* **Musik:** aufgenommene, taktgenaue Schleifen (Suno über kie.ai, je Stück zwei Varianten) mit Equal-Power-Überblendung – `tracks.ts`,
  Pipeline und Details in `docs/fredrun2/MUSIC.md`. Game-Over-/Highscore-/Weltwechsel-Jingles laufen als Stinger.
* **Klangeffekte:** Sample-Bank aus nachbearbeiteten CC0-Klängen (Kenney) – `bank.ts`, `docs/fredrun2/AUDIO.md`.
* **Fallback und Dauerklänge:** die prozedurale Engine (Oszillatoren, gefiltertes Rauschen, Convolver-Hall, Master-Kompressor/Limiter)
  spielt Effekte ohne Sample, die Dauerklänge (Regen, Wind, Fluss …) und – falls die Musikdateien nicht laden – die prozedurale Musik.

```ts
const audio = createAudio();           // Browser: Engine, Node/SSR/ohne AudioContext: stummes No-Op-Objekt
await audio.unlock();                  // aus einer User-Geste (Klick/Touch/Taste), iOS-/Safari-sicher
audio.music.play("wien", { intensity: 0.3 });   // menu | wien | alpen | finanzamt | prater | wachau | cyber
audio.music.setIntensity(0.8, 0.6);    // 0..1: Pad → +Bass → +Drums → +Lead/Arpeggio (weich überblendet)
audio.sfx("coin", { pitch: 1.2 });     // 51 Effekte, siehe SFX_NAMES; Polyphonie-Cap + Drosselung gegen Überlast
audio.loop("rain", true, 0.6);         // Dauerklänge (rain, wind, avalanche, magnet, laser-hum, crowd-fair, river, …)
```

Dateien: `types.ts` (API + Namenslisten), `themes.ts` (Kompositionsdaten: Akkordfolgen, Melodien, Drum-Patterns – reine Daten),
`notation.ts` (Parser der Notenstrings), `music.ts` (Look-ahead-Scheduler über `AudioContext.currentTime`, robust gegen Tab-Throttling),
`synth.ts` (Instrumente), `sfx.ts` (Effekte), `loops.ts` (Dauerklänge), `voice.ts`/`dsp.ts`/`noise.ts`/`graph.ts` (Bausteine, Master-Graph),
`engine.ts` (Lebenszyklus, Lautstärken, Ducking, Tempo-Skalierung). Tests: `themes.test.ts` (Takte füllen exakt ihre Steps, Namenslisten,
Scheduler-Monotonie). Rauchtest im echten Browser: `node tools/fredrun2/audio-smoke.mjs`.

Die App (Game-Controller) speichert Lautstärken/Stummschaltung selbst (`profile.ts`) und verknüpft Sim-Ereignisse mit Effekten (`game.ts`).
Welten lösen Klänge über `sim.emit("custom", x, y, { tag: "sfx:<name>" })` und Dauerklänge über `sim.vars["loop:<name>"]` aus.

## Sample-Bank (Klangeffekte)

Die meisten Effekte klingen nicht mehr synthetisch: `bank.ts` spielt **echte, nachbearbeitete Samples** (Kenney, CC0), die in einer
einzigen Sprite-Datei liegen – `public/fredrun2/audio/sfx-bank.mp3` (mono, 112 kbps, ≈ 52 s, 712 KB) + `sfx-bank.json` (Manifest: je
Effekt 1–4 Varianten `{start, dur}` in Sekunden, `pitchJitter`, `reverb`, `pan`/`sweep`, `gain`). Gebaut wird sie von
`tools/fredrun2/build_sfx_bank.py` (Rezepte im Skript), Details, Quellen, Rezepte-Überblick und Pegel: `docs/fredrun2/AUDIO.md`.

```
unlock() ─► ensureContext() ─► SfxPlayer.enableBank() ─► SfxBank.load()   fetch Manifest → fetch MP3 → decodeAudioData
                                                                          → je Variante ein mono AudioBuffer (Sprite wird freigegeben)
audio.sfx(name) ─► SfxPlayer.play()   Priorität/Cooldown/Polyphonie/Ducking wie bisher (SFX_META)
                     ├─ bank.has(name)? ─► SfxVoice (Lautstärke, Pan, Reverb-Send) + bank.play(): Variante ohne unmittelbare
                     │                     Wiederholung, Tonhöhe × Zufalls-Jitter, Pan-Fahrt (near-miss, portal, barrel-roll)
                     └─ sonst / Bank nicht geladen ─► prozedurales Rezept aus sfx.ts (Fallback)
```

* **Fallback**: Ladefehler (offline, blockiert, kaputtes Manifest) werden still geschluckt (`bank.error`); dann laufen die prozeduralen
  Stimmen wie zuvor. Ohne Sample bleiben auch `bee-buzz` und `pigeon` synthetisch; `gameover`/`highscore`/`world-transition` sind
  Musik-Jingles (`tracks.ts`, Engine) und gehören nicht zur Bank.
* **Encoder-Delay**: MP3-Encoder fügen ≈ 25 ms Vorlauf ein. Chromium/Firefox/Safari lesen den LAME-Kopf und schneiden ihn ab; falls ein
  Browser das nicht tut, misst `bank.ts` einen Sync-Puls (Manifest `sync.at`) und verschiebt alle Schnitte entsprechend
  (`syncShift`, getestet mit einer MP3 ohne LAME-Kopf im Rauchtest).
* **Testbar ohne AudioContext**: `parseManifest`, `VariantPicker`, `detectSync`/`syncShift`, `sliceFrames`, `jitterRate` sind reine
  Funktionen; `bank.test.ts` prüft sie, `SfxBank`/`SfxPlayer` gegen einen Fake-Kontext und die ausgelieferten Dateien (Namen ∈ `SFX_NAMES`,
  keine Jingle-Namen, Hash/Größe der MP3).
