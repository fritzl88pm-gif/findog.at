# Fredrun 2.0 – Audio (prozedural, Web Audio)

Keine Audiodateien, keine Bibliotheken: alle Klänge und die Musik entstehen zur Laufzeit aus Oszillatoren, gefiltertem Rauschen,
einem prozedural erzeugten Hall (Convolver) und einem Master-Kompressor/Limiter.

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
