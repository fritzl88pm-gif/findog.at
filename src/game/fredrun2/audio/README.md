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
audio.stopStingers();                  // Jingle (Game Over/Highscore/Weltwechsel) ausblenden, Musik-Duck aufheben (Neustart/Menü)
audio.music.setMuffle(1, 0.12);        // Musik dämpfen (Pause/Zeitlupe): Tiefpass 900 Hz, -5 dB; 0 = frei; play()/stop() setzen zurück
audio.prefetch({ music: ["wien"] });   // Dateien vorwärmen (nur Download, vor dem Entsperren erlaubt); auch preloadAudio() aus index.ts
```

Dateien: `types.ts` (API + Namenslisten), `themes.ts` (Kompositionsdaten: Akkordfolgen, Melodien, Drum-Patterns – reine Daten),
`notation.ts` (Parser der Notenstrings), `music.ts` (Look-ahead-Scheduler über `AudioContext.currentTime`, robust gegen Tab-Throttling),
`synth.ts` (Instrumente), `sfx.ts` (Effekte), `loops.ts` (Dauerklänge), `voice.ts`/`dsp.ts`/`noise.ts`/`graph.ts` (Bausteine, Master-Graph),
`engine.ts` (Lebenszyklus, Lautstärken, Ducking, Tempo-Skalierung), `tracks.ts` (aufgenommene Musik, `MusicLibrary`, Jingles). Tests:
`themes.test.ts` (Takte füllen exakt ihre Steps, Namenslisten, Scheduler-Monotonie), `graph.test.ts`/`engine.test.ts`/`tracks.test.ts`
(Fake-Kontext). Rauchtest im echten Browser: `node tools/fredrun2/audio-smoke.mjs`.

## Engine-Mechanik (Entsperren, Stinger, Dämpfung, Vorwärmen)

* **Entsperren ist wiederholbar.** `unlock()` wartet höchstens ≈ 1,2 s auf `ctx.resume()`; das Zeitlimit beendet nur das Promise. Läuft der
  Kontext erst später (langsames Gerät, Safari/iOS, Bluetooth), entscheidet `onstatechange`: beim ersten „running“ wird `everRunning`
  gesetzt und alles Gemerkte (`music.play()`/`loop()` vor dem Entsperren) startet; bei jedem weiteren Wechsel auf „running“ wird das
  Gemerkte erneut geleert (`flushPending`). Jeder weitere `unlock()`-Aufruf (nächste Geste) versucht `resume()` erneut, `sfx()` vor dem
  „running“ ebenfalls (gedrosselt auf 500 ms). `unlocked` bleibt „Kontext war einmal running“.
* **Stinger** (`gameover`, `highscore`, `world-transition`) laufen über `graph.stingerBus` (Pegel = Musiklautstärke, kein Duck) statt über
  `sfxDry`: Musik aus ⇒ kein Jingle (auch kein synthetischer Ersatz), Effekte aus ⇒ Jingle bleibt. Der Effekt-Anteil des Weltwechsels
  (Bank/Synthese) bleibt am Effekt-Regler. `JinglePlayer.play` liefert ein `JingleHandle` (`stop(fadeSec)`), `stopAll(fadeSec)`/`stopOf(name)`
  blenden per `setTargetAtTime` (τ = fade/4) aus und stoppen die Quelle nach 1,25·fade + 30 ms. `audio.stopStingers(fadeSec = 0.3)` ruft
  `stopAll`, setzt `graph.duckUntil = 0` und führt `duckDry`/`duckWet` mit τ 0,12 s auf 1 zurück (`releaseDuck`). `gameover`/`highscore` lösen
  einen noch laufenden Weltwechsel-Jingle selbst ab.
* **Dämpfung** (`music.setMuffle(amount 0..1, rampSec = 0.12)`): Tiefpass (`musicLP`, Hall-Pfad `musicWetLP`, Q −3 dB) und Pegelstufe
  (`muffleDry`/`muffleWet`) zwischen Musikbus und Duck; 0 = offen (22 kHz, höchstens Nyquist), 1 = 900 Hz und −5 dB, dazwischen logarithmisch
  in der Frequenz und linear in dB. `rampSec` ist die Zeitkonstante (`setTargetAtTime`); ≈ 3 · τ bis zum Ziel. `music.play()`/`music.stop()`
  setzen auf 0 zurück, ein Aufruf vor dem Entsperren gilt, sobald der Graph existiert. SFX und Stinger werden nicht gedämpft.
* **Vorwärmen** (`audio.prefetch({ music?: string[] })`, `preloadAudio()` in `index.ts`): lädt per `fetch(…, { priority: "low" })` SFX-Bank
  (Manifest + MP3 unter derselben URL wie `bank.ts`), `music.json` und je Stück **eine** Variante in den HTTP-Cache – ohne Dekodieren (kein
  zusätzlicher Speicher), ohne AudioContext und ohne Geste. Die Wahl merkt `MusicLibrary` (`nextVariant`), `music.play()` spielt dieselbe Datei
  (Cache-Treffer). `music` fehlt ⇒ nur das Menüstück, `[]` ⇒ nur Bank und Manifest; ohne `fetch` (SSR) ein No-Op. Engine und `preloadAudio` teilen
  eine Bibliothek, damit eine vor dem Entsperren gewärmte Variante auch gespielt wird.
* **iOS-Stummschalter:** `unlock()` setzt (Feature-Check, try/catch) `navigator.audioSession.type = "playback"`, solange nicht stummgeschaltet
  und nicht pausiert; `setMuted(true)`, `suspend()` (verstecktes Tab) und `dispose()` stellen auf „auto“ zurück, `resume()`/`setMuted(false)`
  wieder auf „playback“. Nur per Code geprüft – vor dem Merge am echten iPhone testen (Stummschalter an). Hinweis: „playback“ kann auf iOS
  Hintergrundmusik anderer Apps unterbrechen (Audio-Session-Spezifikation); Ton-Taste/Lautstärkeregler bleiben maßgeblich.
* **Prüfung:** Vitest mit Fake-Kontext (`graph.test.ts`, `engine.test.ts`, `tracks.test.ts`); im echten Chromium `node tools/fredrun2/audio-smoke.mjs`
  (Szenarien `bank`, `fallback`, `48k`, `gapless` sowie `stinger-stop`, `late-resume`, `muffle`, `stinger-bus`, `prefetch`, einzeln per `--only`).

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
