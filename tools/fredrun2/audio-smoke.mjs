#!/usr/bin/env node
/**
 * Rauchtest der Audio-Engine im headless Chromium (echter AudioContext, gebündelt per esbuild).
 *
 *   node tools/fredrun2/audio-smoke.mjs [--only bank,fallback,48k,gapless,stinger-stop,late-resume,muffle,stinger-bus,prefetch] [--ffmpeg <Pfad>]
 *
 * Szenario 1 (Bank da): alle SFX, Loops und Musikthemen laufen ohne Fehler; die Sample-Bank (public/fredrun2/audio/sfx-bank.*)
 * lädt, jede Variante beginnt/endet sauber (kein Knacken), bleibt unter -1.7 dBFS, "knackige" Effekte setzen in < 15 ms ein,
 * der Encoder-Delay-Ausgleich (Sync-Puls) liegt unter 3 ms, jeder gemappte Name spielt aus der Bank, alle anderen synthetisch,
 * und nach Ende der Effekte sind alle Stimmen wieder frei (kein Leck).
 * Szenario 2 (Bank blockiert): alle SFX spielen weiter prozedural (Fallback), ohne Fehler.
 * Szenario 3 (AudioContext mit 48 kHz): decodeAudioData resampelt den Sprite (44,1 -> 48 kHz), Schnitte und Sync müssen trotzdem sitzen.
 * Szenario 4 (nur mit ffmpeg: --ffmpeg <Pfad> oder $FFMPEG): dieselbe MP3 OHNE Xing/LAME-Kopf, sodass der Browser den Encoder-Delay
 * nicht herausrechnen kann (wie manche Safari-/Firefox-Versionen) – der Sync-Puls muss ~25 ms Versatz messen und ausgleichen,
 * danach müssen alle Slices wieder sauber beginnen/enden.
 *
 * Szenarien der Engine-Mechanik (laufen gegen die echte Engine mit echtem AudioContext, Pegel über einen AnalyserNode am Master):
 *   stinger-stop  Tod-Jingle läuft, 1 s später „Neustart“ (stopStingers + music.play): 0,6 s danach ist keine Jingle-Quelle (5-20 s) mehr
 *                 aktiv, der Ausgangspegel 1-6 s danach liegt innerhalb ±1,5 dB der Lauf-Referenz. Kontrolllauf ohne stopStingers zeigt den Fehler.
 *   late-resume   AudioContext startet suspendiert, resume() antwortet erst nach 2,5 s (Safari/langsames Gerät): die gemerkte Musik startet
 *                 spätestens 1 s nach dem Resume, SFX bei Folgeklicks klingen.
 *   muffle        music.setMuffle(1): Anteil > 3 kHz fällt binnen 0,4 s um >= 10 dB (stationäres Rauschen und echte Musik), setMuffle(0)
 *                 kehrt auf ±1 dB zurück.
 *   stinger-bus   Jingles hängen am Musik-Regler: music=0 -> Spitze <= -60 dBFS, sfx=0/music=0.6 -> hörbar, Weltwechsel-Effekt bleibt am Effekt-Regler.
 *   prefetch      8 Mbit/s, 80 ms: audio.prefetch() vor dem Entsperren lädt SFX-Bank, Manifest und genau eine Variante (je Datei eine
 *                 Server-Anfrage); die Musik startet danach <= 1,2 s nach music.play() (kalt: ca. 1,8 s).
 */
import { build } from "esbuild";
import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const argv = process.argv.slice(2);
const ffmpegPath = argv.includes("--ffmpeg") ? argv[argv.indexOf("--ffmpeg") + 1] : process.env.FFMPEG;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const tmp = path.join(process.env.TMPDIR ?? "/tmp", "fr2-audio-smoke");
await mkdir(tmp, { recursive: true });
await writeFile(path.join(tmp, "entry.ts"), `import { createEngine, resolveContextCtor } from ${JSON.stringify(path.join(root, "src/game/fredrun2/audio/engine.ts"))};
import { SFX_NAMES, LOOP_NAMES, WORLD_MUSIC_IDS } from ${JSON.stringify(path.join(root, "src/game/fredrun2/audio/types.ts"))};
(window as any).__t = { createEngine, resolveContextCtor, SFX_NAMES, LOOP_NAMES, WORLD_MUSIC_IDS };
document.title = "ready";`);
await build({ entryPoints: [path.join(tmp, "entry.ts")], bundle: true, format: "iife", outfile: path.join(tmp, "entry.js"), logLevel: "error", target: "es2022" });

// Mini-Server: Testseite + Bundle + die echten Audiodateien aus public/ (Bank, Jingles, Musik)
const publicAudio = path.join(root, "public/fredrun2/audio");
const MIME = { ".mp3": "audio/mpeg", ".json": "application/json", ".js": "text/javascript" };
const hits = new Map(); // Server-Anfragen je Pfad (Netzwerkzugriffe, ohne Browser-Cache-Treffer)
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  hits.set(url.pathname, (hits.get(url.pathname) ?? 0) + 1);
  if (url.pathname === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end('<!doctype html><body><button id=b>go</button><script src=/entry.js></script>'); return; }
  try {
    let file = path.join(tmp, "entry.js");
    if (url.pathname.startsWith("/fredrun2/audio/")) {
      file = path.normalize(path.join(publicAudio, url.pathname.slice("/fredrun2/audio/".length)));
      if (!file.startsWith(publicAudio + path.sep)) throw new Error("außerhalb");
    }
    // wie next.config.ts für /fredrun2/:path*: einen Tag cachebar (Voraussetzung für das Vorwärmen)
    const cache = url.pathname.startsWith("/fredrun2/") ? { "cache-control": "public, max-age=86400" } : {};
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "text/javascript", ...cache });
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { chromium } = require(path.join(process.env.PLAYWRIGHT_NODE_PATH ?? "/opt/node22/lib/node_modules", "playwright"));
const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

/** Ein Durchlauf; `mode`: "normal", "blocked" (Bank-Dateien abweisen = Fallback-Test) oder "nogapless" (MP3 ohne LAME-Kopf). */
async function scenario(mode, altMp3, contextRate = 0) {
  const blockBank = mode === "blocked";
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    // die bewusst abgewiesene Bank-Anfrage meldet Chromium als Konsolenfehler – nur im Fallback-Szenario erlaubt
    if (blockBank && /sfx-bank|Failed to load resource/.test(m.text())) return;
    errs.push(m.text());
  });
  if (blockBank) await page.route("**/sfx-bank.*", (r) => r.abort());
  if (mode === "nogapless") await page.route("**/sfx-bank.mp3*", (r) => r.fulfill({ status: 200, contentType: "audio/mpeg", body: altMp3 }));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => document.title === "ready");
  await page.click("#b");
  const res = await page.evaluate(async ([blocked, expectShift, rate]) => {
    const { createEngine, resolveContextCtor, SFX_NAMES, LOOP_NAMES, WORLD_MUSIC_IDS } = window.__t;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const Base = resolveContextCtor();
    const Ctor = rate ? class extends Base { constructor(o) { super({ ...(o ?? {}), sampleRate: rate }); } } : Base;
    const { audio: a, debug } = createEngine(Ctor);
    await a.unlock();
    const out = { unlocked: a.unlocked, sfx: 0, loops: 0, themes: [], problems: [], contextRate: debug.ctx.sampleRate };
    if (rate && debug.ctx.sampleRate !== rate) out.problems.push(`AudioContext läuft mit ${debug.ctx.sampleRate} Hz statt ${rate}`);
    const bank = debug.sfxPlayer.bank;
    for (let i = 0; i < 100 && !bank.ready && !bank.error; i++) await sleep(50);
    out.bank = { ready: bank.ready, error: bank.error, shiftMs: Math.round(bank.appliedShift * 10000) / 10, effects: bank.names().length, variants: 0 };

    if (blocked) {
      if (bank.ready) out.problems.push("Bank sollte blockiert sein");
    } else {
      if (!bank.ready) out.problems.push("Bank nicht geladen: " + bank.error);
      if (!expectShift && Math.abs(bank.appliedShift) > 0.003) out.problems.push(`Sync-Versatz ${bank.appliedShift * 1000} ms (Browser rechnet den Encoder-Delay nicht heraus?)`);
      if (expectShift && !(bank.appliedShift > 0.015 && bank.appliedShift < 0.035)) out.problems.push(`Ohne LAME-Kopf wurde kein Encoder-Delay von ~25 ms gemessen (${bank.appliedShift * 1000} ms)`);
      // ---- Qualität der dekodierten Slices ----
      const SNAPPY = new Set(["ui-click", "ui-hover", "ui-back", "ui-denied", "jump", "doublejump", "land", "coin", "stomp", "stomp-chain", "hurt", "death", "enemy-defeat", "shield-hit", "wallbreak", "cannon", "stamp-thud", "laser-zap", "combo-break", "countdown"]);
      for (const n of bank.names()) {
        bank.variants(n).forEach((buf, i) => {
          out.bank.variants++;
          const d = buf.getChannelData(0);
          let pk = 0, bad = false;
          for (let k = 0; k < d.length; k++) { const v = Math.abs(d[k]); if (!(v <= 4)) bad = true; if (v > pk) pk = v; }
          let att = 0;
          while (att < d.length && Math.abs(d[att]) < 0.25 * pk) att++;
          const attMs = (att / buf.sampleRate) * 1000;
          const head = Math.abs(d[0]), tail = Math.abs(d[d.length - 1]);
          const tag = `${n}#${i}`;
          if (bad) out.problems.push(`${tag}: ungültige Samples`);
          if (buf.numberOfChannels !== 1) out.problems.push(`${tag}: nicht mono`);
          if (head > 0.03) out.problems.push(`${tag}: Anfang nicht stumm (${head.toFixed(3)})`);
          if (tail > 0.02) out.problems.push(`${tag}: Ende nicht stumm (${tail.toFixed(3)})`);
          if (pk > 0.82) out.problems.push(`${tag}: Spitze ${(20 * Math.log10(pk)).toFixed(1)} dBFS über -1.7`);
          if (pk < 0.03) out.problems.push(`${tag}: praktisch stumm`);
          if (SNAPPY.has(n) && attMs > 15) out.problems.push(`${tag}: Attack ${attMs.toFixed(1)} ms > 15 ms`);
        });
      }
    }

    // ---- jeder SFX-Name einzeln: Bank-Namen aus der Bank, alle anderen synthetisch ----
    const inBank = new Set(bank.names());
    const source = {};
    for (const n of SFX_NAMES) {
      // Polyphonie-Cap (24 Stimmen) nicht künstlich reißen: erst weiterspielen, wenn genug Stimmen frei sind
      for (let w = 0; w < 80 && debug.sfxPlayer.activeVoices > 10; w++) await sleep(50);
      const p0 = debug.sfxPlayer.played, b0 = bank.played;
      a.sfx(n);
      out.sfx++;
      await sleep(120);
      const dp = debug.sfxPlayer.played - p0, db = bank.played - b0;
      source[n] = db > 0 ? "bank" : dp > 0 ? "synth" : "verworfen";
      if (inBank.has(n) && db === 0) out.problems.push(`${n}: Bank-Effekt wurde nicht aus der Bank gespielt`);
      if (!inBank.has(n) && n !== "gameover" && n !== "highscore" && dp === 0) out.problems.push(`${n}: synthetischer Fallback spielte nicht`);
    }
    out.source = { bank: Object.keys(source).filter((k) => source[k] === "bank").length, synth: Object.keys(source).filter((k) => source[k] === "synth").length, other: Object.keys(source).filter((k) => source[k] === "verworfen") };

    // ---- Stresstest: Stimmen-Cap, Round-Robin, Pitch-Kette, Pan ----
    for (let i = 0; i < 60; i++) { a.sfx("jump", { pitch: 1 + (i % 5) * 0.05 }); a.sfx("coin", { pan: (i % 7) / 3.5 - 1 }); a.sfx("land", { volume: (i % 10) / 10 }); await sleep(8); }
    a.sfx("near-miss"); a.sfx("near-miss", { pan: 0.5 });

    for (const l of LOOP_NAMES) { a.loop(l, true, 0.5); out.loops++; }
    await sleep(400);
    for (const l of LOOP_NAMES) a.loop(l, false);
    for (const id of WORLD_MUSIC_IDS) {
      a.music.play(id, { intensity: 0.8 });
      await sleep(1500);
      a.music.setIntensity(0.2, 0.2);
      out.themes.push([id, a.music.current]);
    }
    a.setMuted(true); a.setMuted(false); a.duck(0.5, 0.2); a.setTempoScale(1.2); a.suspend(); a.resume();
    a.music.stop(0.2);
    // ---- alle Stimmen müssen nach dem Ausklang wieder frei sein (kein Leck) ----
    await sleep(3500);
    out.activeVoices = debug.sfxPlayer.activeVoices;
    if (out.activeVoices !== 0) out.problems.push(`${out.activeVoices} SFX-Stimmen hängen nach dem Ausklang`);
    a.dispose();
    return out;
  }, [blockBank, mode === "nogapless", contextRate]);
  await page.close();
  return { res, errs };
}

const results = [];
// --only bank,fallback,48k,gapless  (Standard: alle; "gapless" braucht ffmpeg)
const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1].split(",") : null;
const want = (k) => !only || only.includes(k);
if (want("bank")) results.push({ label: "Szenario Bank:", ...(await scenario("normal")) });
if (want("fallback")) results.push({ label: "Szenario Fallback (Bank blockiert):", ...(await scenario("blocked")) });
if (want("48k")) results.push({ label: "Szenario Bank bei 48 kHz (Resampling):", ...(await scenario("normal", null, 48000)) });
if (want("gapless") && ffmpegPath) {
  // MP3 ohne Xing/LAME-Kopf (Stream-Kopie): Decoder kennt den Encoder-Delay nicht mehr
  const stripped = execFileSync(ffmpegPath, ["-v", "error", "-i", path.join(publicAudio, "sfx-bank.mp3"), "-c", "copy", "-write_xing", "0", "-id3v2_version", "0", "-f", "mp3", "-"], { maxBuffer: 64 << 20 });
  results.push({ label: "Szenario ohne Gapless-Kopf (Encoder-Delay ausgleichen):", ...(await scenario("nogapless", stripped)) });
} else if (want("gapless")) {
  console.log("Szenario ohne Gapless-Kopf übersprungen (kein ffmpeg: --ffmpeg <Pfad> oder $FFMPEG)");
}

// =====================================================================================================================
// Engine-Mechanik: Jingle-Stopp, später Resume, Dämpfung, Stinger-Bus, Vorwärmen (eigene Seite je Szenario, echter AudioContext)
// =====================================================================================================================
/** In jede Seite eingespielt: Quellen-Protokoll (start/ended) und Messhelfer (Pegel, Spektrum). */
const PROBE = `(() => {
  const P = (window.__p = { starts: [] });
  const os = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...a) {
    const rec = { perf: performance.now(), dur: this.buffer ? this.buffer.duration : 0, ended: false };
    P.starts.push(rec);
    this.addEventListener("ended", () => { rec.ended = true; rec.endedAt = performance.now(); });
    return os.apply(this, a);
  };
  P.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  P.db = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -180);
  P.round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
  P.tap = (ctx, node, fft) => { const an = ctx.createAnalyser(); an.fftSize = fft || 2048; an.smoothingTimeConstant = 0; node.connect(an); return an; };
  /** RMS (dBFS, Leistungsmittel) und Spitze (dBFS) über ms */
  P.level = async (an, ms, every = 30) => {
    const buf = new Float32Array(an.fftSize);
    let sum = 0, n = 0, peak = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      an.getFloatTimeDomainData(buf);
      let s = 0;
      for (const v of buf) { s += v * v; const a = Math.abs(v); if (a > peak) peak = a; }
      sum += s / buf.length; n++;
      await P.sleep(every);
    }
    return { rms: P.db(Math.sqrt(sum / Math.max(1, n))), peak: P.db(peak) };
  };
  /** Leistung oberhalb von hz (dB, über Frames gemittelt) */
  P.band = async (an, hz, frames = 1, every = 40) => {
    const sr = an.context.sampleRate;
    const arr = new Float32Array(an.frequencyBinCount);
    const k0 = Math.ceil((hz * an.fftSize) / sr);
    let pw = 0;
    for (let f = 0; f < frames; f++) {
      an.getFloatFrequencyData(arr);
      let s = 0;
      for (let k = k0; k < arr.length; k++) s += 10 ** (arr[k] / 10);
      pw += s;
      if (f < frames - 1) await P.sleep(every);
    }
    return 10 * Math.log10(pw / frames + 1e-30);
  };
  P.waitFor = async (fn, timeout = 8000) => { const t0 = performance.now(); while (performance.now() - t0 < timeout) { if (fn()) return true; await P.sleep(20); } return false; };
  /** Quellen mit Dauer 5-20 s = Jingles (Musik-Schleifen sind > 60 s, SFX-Samples < 5 s) */
  P.jingles = () => P.starts.filter((s) => s.dur > 5 && s.dur < 20);
  P.music = () => P.starts.filter((s) => s.dur > 20);
})();`;

async function probePage({ throttle = false } = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await page.addInitScript(PROBE);
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => document.title === "ready");
  if (throttle) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 80, downloadThroughput: 1_000_000, uploadThroughput: 1_000_000 }); // 8 Mbit/s
  }
  return { page, context, errs };
}

/**
 * Tod, nach 1 s „Neustart“ (so wie game.startRun: stopStingers, dann music.play). `mode`: "stop" (Jingle + stopStingers), "control"
 * (Jingle, ohne stopStingers = altes Verhalten) oder "plain" (derselbe Ablauf ganz ohne Jingle = Lauf-Referenz mit gleicher Variante).
 */
async function stingerStop(mode) {
  const { page, context, errs } = await probePage();
  const res = await page.evaluate(async (mode) => {
    const { createEngine, resolveContextCtor } = window.__t, P = window.__p;
    Math.random = () => 0; // Variantenwahl festlegen: erst „wien“, beim Neustart die andere (Pegel der Varianten unterscheidet sich leicht)
    const { audio: a, debug } = createEngine(resolveContextCtor());
    await a.unlock();
    a.setMusicVolume(0.6); a.setSfxVolume(0.9); a.setMasterVolume(0.85);
    const out = { problems: [] };
    a.music.play("wien", { intensity: 0.5, crossfadeSec: 0.2 });
    if (!(await P.waitFor(() => P.music().length > 0))) out.problems.push("Musik startete nicht");
    const an = P.tap(debug.ctx, debug.graph.master, 2048);
    await P.sleep(1500);
    out.ref = P.round((await P.level(an, 3000)).rms); // laufende Musik vor dem Tod
    debug.jingles.prefetch();
    if (!(await P.waitFor(() => debug.jingles.ready.size >= 3, 8000))) out.problems.push("Jingles nicht geladen");
    // Tod: Jingle (+ Duck), die Musik klingt aus
    if (mode !== "plain") a.sfx("gameover");
    a.music.stop(1.4);
    out.jingleStarted = P.jingles().length;
    if (mode !== "plain" && out.jingleStarted < 1) out.problems.push("Game-Over-Jingle startete nicht");
    out.duckAfterJingle = P.round(debug.graph.duckUntil - debug.ctx.currentTime);
    await P.sleep(1000);
    // Neustart nach 1 s
    if (mode === "stop") a.stopStingers();
    a.music.play("wien", { intensity: 0.5, crossfadeSec: 0.6 });
    await P.sleep(600);
    out.activeJinglesAfter600ms = P.jingles().filter((s) => !s.ended).length;
    out.duckUntilAfterStop = P.round(debug.graph.duckUntil, 3);
    out.duckGainAt600ms = P.round(debug.graph.duckDry.gain.value, 2); // 1 = Musik nicht mehr abgesenkt
    await P.sleep(400);
    out.after = P.round((await P.level(an, 5000)).rms); // 1-6 s nach dem Neustart
    out.deltaDb = P.round(out.after - out.ref);
    a.dispose();
    return out;
  }, mode);
  await context.close();
  return { res, errs };
}

async function lateResume() {
  const { page, context, errs } = await probePage();
  const res = await page.evaluate(async () => {
    const { createEngine, resolveContextCtor } = window.__t, P = window.__p;
    const Base = resolveContextCtor();
    let resumeDoneAt = 0, resumeCalls = 0;
    // Kontext startet suspendiert, resume() antwortet erst nach 2,5 s (rt-slowresume.mjs)
    class Slow extends Base {
      constructor(o) { super(o); Base.prototype.suspend.call(this); }
      resume() {
        resumeCalls++;
        return new Promise((res) => setTimeout(() => Base.prototype.resume.call(this).then(() => { resumeDoneAt = performance.now(); res(); }, res), 2500));
      }
    }
    const { audio: a, debug } = createEngine(Slow);
    const out = { problems: [] };
    a.music.play("wien");               // vor dem Entsperren gemerkt
    const t0 = performance.now();
    await a.unlock();                   // schließt nach ca. 1,2 s ab, der Kontext läuft noch nicht
    out.unlockMs = Math.round(performance.now() - t0);
    out.stateAfterUnlock = debug.ctx.state;
    out.unlockedAfterUnlock = a.unlocked;
    out.musicSourcesAfterUnlock = P.music().length;
    if (out.stateAfterUnlock === "running") out.problems.push("Testaufbau: Kontext lief schon beim Ende von unlock() (Resume nicht verzögert)");
    // erneuter Geste-Versuch (Folgeklick): darf nichts kaputt machen
    void a.unlock();
    if (!(await P.waitFor(() => P.music().length > 0, 8000))) out.problems.push("Musik startete nach dem späten Resume nie");
    const music = P.music()[0];
    out.musicStartAfterResumeMs = music ? Math.max(0, Math.round(music.perf - resumeDoneAt)) : null;
    out.resumeCalls = resumeCalls;
    out.ctxState = debug.ctx.state;
    out.unlockedFinal = a.unlocked;
    // SFX bei Folgeklicks
    await P.sleep(300);
    const played0 = debug.sfxPlayer.played, short0 = P.starts.filter((s) => s.dur <= 5).length;
    a.sfx("coin"); await P.sleep(150); a.sfx("jump"); await P.sleep(300);
    out.sfxPlayed = debug.sfxPlayer.played - played0;
    out.shortSourcesAdded = P.starts.filter((s) => s.dur <= 5).length - short0;
    if (out.sfxPlayed < 2) out.problems.push(`SFX nach dem späten Resume: nur ${out.sfxPlayed} von 2 gespielt`);
    if (out.musicStartAfterResumeMs !== null && out.musicStartAfterResumeMs > 1000) out.problems.push(`Musik startete erst ${out.musicStartAfterResumeMs} ms nach dem Resume (> 1000)`);
    if (!out.unlockedFinal) out.problems.push("unlocked blieb false");
    a.dispose();
    return out;
  });
  await context.close();
  return { res, errs };
}

async function muffle() {
  const { page, context, errs } = await probePage();
  const res = await page.evaluate(async () => {
    const { createEngine, resolveContextCtor } = window.__t, P = window.__p;
    const { audio: a, debug } = createEngine(resolveContextCtor());
    await a.unlock();
    a.setMusicVolume(0.6); a.setSfxVolume(0.9); a.setMasterVolume(0.85);
    const ctx = debug.ctx, an = P.tap(ctx, debug.graph.master, 4096);
    const out = { problems: [], noise: {}, music: {} };
    // --- stationäres Rauschen in den Musikbus (reproduzierbar, unterhalb der Kompressor-Schwelle) ---
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.3;
    const noise = ctx.createBufferSource();
    noise.buffer = buf; noise.loop = true;
    noise.connect(debug.graph.musicDry);
    noise.start();
    await P.sleep(500);
    a.music.setMuffle(0);
    const b0 = await P.band(an, 3000, 15, 40);
    a.music.setMuffle(1, 0.12);
    const t0 = performance.now();
    const trace = {};
    for (const ms of [100, 200, 300, 400]) { await P.sleep(Math.max(0, ms - (performance.now() - t0))); trace[ms] = P.round(b0 - (await P.band(an, 3000, 1))); }
    out.noise.dropDbAt = trace; // Abfall des Anteils > 3 kHz (positiv = leiser) nach 100/200/300/400 ms
    await P.sleep(1200);
    out.noise.dropDbSettled = P.round(b0 - (await P.band(an, 3000, 15, 40)));
    out.noise.cutoffHz = Math.round(debug.graph.musicLP.frequency.value);
    a.music.setMuffle(0, 0.3);
    await P.sleep(2000);
    const back = await P.band(an, 3000, 15, 40);
    out.noise.backDb = P.round(back - b0, 2); // Rückkehr: Abweichung von der Ausgangslage
    out.noise.cutoffHzBack = Math.round(debug.graph.musicLP.frequency.value);
    if (!(trace[400] >= 10)) out.problems.push(`Rauschen: Anteil > 3 kHz fiel nach 0,4 s nur um ${trace[400]} dB (< 10)`);
    if (!(Math.abs(out.noise.backDb) <= 1)) out.problems.push(`Rauschen: nach setMuffle(0) ${out.noise.backDb} dB Abweichung (> ±1)`);
    noise.stop(); noise.disconnect();
    // --- echte Musik ---
    a.music.play("wien", { intensity: 0.5, crossfadeSec: 0.2 });
    if (!(await P.waitFor(() => P.music().length > 0))) out.problems.push("Musik startete nicht");
    await P.sleep(2500);
    const m0 = await P.band(an, 3000, 40, 40);
    a.music.setMuffle(1, 0.12);
    await P.sleep(300);
    out.music.dropDbAt400ms = P.round(m0 - (await P.band(an, 3000, 4, 30))); // Fenster 0,3-0,42 s
    await P.sleep(1000);
    out.music.dropDbSettled = P.round(m0 - (await P.band(an, 3000, 20, 40)));
    a.music.setMuffle(0, 0.3);
    await P.sleep(2000);
    out.music.backDb = P.round((await P.band(an, 3000, 40, 40)) - m0, 2);
    if (!(out.music.dropDbAt400ms >= 10)) out.problems.push(`Musik: Anteil > 3 kHz fiel nach 0,4 s nur um ${out.music.dropDbAt400ms} dB (< 10)`);
    // play() setzt die Dämpfung zurück
    a.music.setMuffle(1);
    a.music.play("alpen", { crossfadeSec: 0.2 });
    out.muffleAfterPlay = debug.graph.muffle;
    if (out.muffleAfterPlay !== 0) out.problems.push("music.play() setzte die Dämpfung nicht zurück");
    a.dispose();
    return out;
  });
  await context.close();
  return { res, errs };
}

async function stingerBus() {
  const { page, context, errs } = await probePage();
  const res = await page.evaluate(async () => {
    const { createEngine, resolveContextCtor } = window.__t, P = window.__p;
    const { audio: a, debug } = createEngine(resolveContextCtor());
    await a.unlock();
    const out = { problems: [] };
    a.setMasterVolume(0.85);
    debug.jingles.prefetch();
    const bank = debug.sfxPlayer.bank;
    if (!(await P.waitFor(() => debug.jingles.ready.size >= 3 && (bank.ready || bank.error), 8000))) out.problems.push("Jingles/Bank nicht geladen");
    const an = P.tap(debug.ctx, debug.graph.master, 2048);
    const run = async (label, vol, name, ms = 2500) => {
      a.setMusicVolume(vol.music); a.setSfxVolume(vol.sfx);
      await P.sleep(200);
      const before = P.jingles().length;
      a.sfx(name);
      const lv = await P.level(an, ms, 25);
      out[label] = { jingleSources: P.jingles().length - before, peakDb: P.round(lv.peak), rmsDb: P.round(lv.rms) };
      a.stopStingers(0.05);
      await P.sleep(500);
    };
    await run("musicOff", { music: 0, sfx: 0.9 }, "gameover");
    await run("sfxOff", { music: 0.6, sfx: 0 }, "gameover");
    await run("default", { music: 0.6, sfx: 0.9 }, "gameover");
    await run("musicOffTransition", { music: 0, sfx: 0.9 }, "world-transition", 1500);
    if (out.musicOff.peakDb > -60) out.problems.push(`music=0: Jingle-Spitze ${out.musicOff.peakDb} dBFS (> -60)`);
    if (out.musicOff.jingleSources !== 0) out.problems.push("music=0: Jingle-Quelle gestartet");
    if (!(out.sfxOff.peakDb > -40) || out.sfxOff.jingleSources !== 1) out.problems.push(`sfx=0/music=0.6: Jingle nicht hörbar (${out.sfxOff.peakDb} dBFS, ${out.sfxOff.jingleSources} Quellen)`);
    if (!(out.default.peakDb > -40)) out.problems.push(`Standard: Jingle nicht hörbar (${out.default.peakDb} dBFS)`);
    if (!(out.musicOffTransition.peakDb > -50)) out.problems.push(`Weltwechsel bei music=0: Effekt-Anteil nicht hörbar (${out.musicOffTransition.peakDb} dBFS)`);
    if (out.musicOffTransition.jingleSources !== 0) out.problems.push("Weltwechsel bei music=0: Jingle-Quelle gestartet");
    out.musicOffTransitionNote = "Weltwechsel bei music=0: nur der Effekt-Anteil (Bank/Synth) am Effekt-Regler";
    a.dispose();
    return out;
  });
  await context.close();
  return { res, errs };
}

/** Kalt (kein Vorwärmen) gegen vorgewärmt, 8 Mbit/s, 80 ms Latenz; Server-Treffer je Datei zählen die echten Netzwerkanfragen. */
async function prefetchScenario(warm) {
  const { page, context, errs } = await probePage({ throttle: true });
  hits.clear();
  const res = await page.evaluate(async (warm) => {
    const { createEngine, resolveContextCtor } = window.__t, P = window.__p;
    const { audio: a, debug } = createEngine(resolveContextCtor());
    const out = { problems: [] };
    if (warm) {
      const t0 = performance.now();
      a.prefetch({ music: ["wien"] });          // vor dem Entsperren, nur Download
      const done = () => performance.getEntriesByType("resource").filter((e) => /sfx-bank\.mp3|music\/wien(-2)?\.mp3/.test(e.name)).length >= 2;
      if (!(await P.waitFor(done, 20000))) out.problems.push("Vorwärmen wurde nicht fertig");
      out.warmMs = Math.round(performance.now() - t0);
      out.ctxBeforeUnlock = debug.ctx === null ? "kein AudioContext" : "AudioContext vorhanden";
    }
    await a.unlock();
    const t1 = performance.now();
    a.music.play("wien");
    if (!(await P.waitFor(() => P.music().length > 0, 20000))) out.problems.push("Musik startete nicht");
    out.musicStartMs = P.music().length ? Math.round(P.music()[0].perf - t1) : null;
    out.variant = debug.tracks.current;
    await P.sleep(500);
    a.dispose();
    return out;
  }, warm);
  await context.close();
  res.serverHits = Object.fromEntries([...hits].filter(([p]) => /\.(mp3|json)$/.test(p) && p.startsWith("/fredrun2/audio/")));
  const mp3 = Object.entries(res.serverHits).filter(([p]) => p.includes("/music/") && p.endsWith(".mp3"));
  res.musicMp3Requests = mp3.map(([p, n]) => `${p.split("/").pop()}:${n}`);
  if (mp3.length !== 1 || mp3[0][1] !== 1) res.problems.push(`Musik: erwartet genau eine MP3-Anfrage, gezählt ${JSON.stringify(res.musicMp3Requests)}`);
  if (warm) {
    const bank = res.serverHits["/fredrun2/audio/sfx-bank.mp3"];
    if (bank !== 1) res.problems.push(`SFX-Bank-MP3: ${bank} Anfragen (erwartet 1)`);
    if (res.musicStartMs !== null && res.musicStartMs > 1200) res.problems.push(`vorgewärmt: Musik startete ${res.musicStartMs} ms nach play() (> 1200)`);
  }
  return { res, errs };
}

const extra = [];
if (want("stinger-stop")) {
  const main = await stingerStop("stop");
  const plain = await stingerStop("plain");     // Lauf-Referenz: gleicher Ablauf (gleiche Variante, gleiche Stelle im Stück) ohne Jingle
  const control = await stingerStop("control"); // Kontrolle: Jingle ohne stopStingers (altes Verhalten)
  const r = main.res;
  r.refRunning = r.ref;                         // laufende Musik vor dem Tod (andere Variante als nach dem Neustart)
  r.refSameFlowNoJingle = plain.res.after;
  r.deltaVsReferenceDb = Math.round((r.after - plain.res.after) * 10) / 10;
  r.control = { activeJinglesAfter600ms: control.res.activeJinglesAfter600ms, duckGainAt600ms: control.res.duckGainAt600ms, afterDb: control.res.after, deltaVsReferenceDb: Math.round((control.res.after - plain.res.after) * 10) / 10, duckUntilAfterStop: control.res.duckUntilAfterStop };
  if (r.activeJinglesAfter600ms !== 0) r.problems.push(`${r.activeJinglesAfter600ms} Jingle-Quelle(n) 0,6 s nach stopStingers noch aktiv`);
  if (!(Math.abs(r.deltaVsReferenceDb) <= 1.5)) r.problems.push(`Pegel 1-6 s nach Neustart ${r.deltaVsReferenceDb} dB gegenüber der Lauf-Referenz (> ±1,5)`);
  if (r.duckUntilAfterStop > 0.01) r.problems.push("duckUntil nach stopStingers nicht 0");
  if (!(r.duckGainAt600ms >= 0.95)) r.problems.push(`Musik 0,6 s nach stopStingers noch abgesenkt (Duck-Pegel ${r.duckGainAt600ms})`);
  if (!(control.res.duckGainAt600ms < 0.6)) r.problems.push("Kontrolle ohne stopStingers: Musik nicht abgesenkt (Messaufbau prüft nichts)");
  if (control.res.activeJinglesAfter600ms < 1) r.problems.push("Kontrolle ohne stopStingers: Jingle nicht mehr aktiv (Messaufbau prüft nichts)");
  extra.push({ label: "Szenario stinger-stop (Jingle-Stopp beim Neustart):", res: r, errs: [...main.errs, ...plain.errs, ...control.errs] });
}
if (want("late-resume")) extra.push({ label: "Szenario late-resume (resume() antwortet nach 2,5 s):", ...(await lateResume()) });
if (want("muffle")) extra.push({ label: "Szenario muffle (Tiefpass/Dämpfung der Musik):", ...(await muffle()) });
if (want("stinger-bus")) extra.push({ label: "Szenario stinger-bus (Jingles am Musik-Regler):", ...(await stingerBus()) });
if (want("prefetch")) {
  const cold = await prefetchScenario(false);
  const warm = await prefetchScenario(true);
  warm.res.cold = { musicStartMs: cold.res.musicStartMs, musicMp3Requests: cold.res.musicMp3Requests };
  extra.push({ label: "Szenario prefetch (8 Mbit/s, 80 ms; kalt gegen vorgewärmt):", res: { cold: cold.res, warm: warm.res, problems: [...cold.res.problems.filter((p) => !/vorgewärmt/.test(p)).map((p) => "kalt: " + p), ...warm.res.problems.map((p) => "warm: " + p)] }, errs: [...cold.errs, ...warm.errs] });
}
for (const e of extra) results.push({ ...e, plain: true });

let failed = false;
for (const { label, res, errs, plain } of results) {
  console.log(label);
  console.log(JSON.stringify(res));
  const problems = [...res.problems, ...errs.map((e) => "Konsolenfehler: " + e)];
  if (!plain && !res.unlocked) problems.push("Engine nicht entsperrt");
  if (!plain && res.sfx < 51) problems.push(`nur ${res.sfx} SFX gespielt`);
  console.log(problems.length ? "PROBLEME:\n  " + problems.join("\n  ") : "keine Fehler");
  if (problems.length) failed = true;
}
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
