#!/usr/bin/env node
/**
 * Rauchtest der Audio-Engine im headless Chromium (echter AudioContext, gebündelt per esbuild).
 *
 *   node tools/fredrun2/audio-smoke.mjs
 *
 * Szenario 1 (Bank da): alle SFX, Loops und Musikthemen laufen ohne Fehler; die Sample-Bank (public/fredrun2/audio/sfx-bank.*)
 * lädt, jede Variante beginnt/endet sauber (kein Knacken), bleibt unter -1.7 dBFS, "knackige" Effekte setzen in < 15 ms ein,
 * der Encoder-Delay-Ausgleich (Sync-Puls) liegt unter 3 ms, jeder gemappte Name spielt aus der Bank, alle anderen synthetisch,
 * und nach Ende der Effekte sind alle Stimmen wieder frei (kein Leck).
 * Szenario 2 (Bank blockiert): alle SFX spielen weiter prozedural (Fallback), ohne Fehler.
 * Szenario 3 (nur mit ffmpeg: --ffmpeg <Pfad> oder $FFMPEG): dieselbe MP3 OHNE Xing/LAME-Kopf, sodass der Browser den Encoder-Delay
 * nicht herausrechnen kann (wie manche Safari-/Firefox-Versionen) – der Sync-Puls muss ~25 ms Versatz messen und ausgleichen,
 * danach müssen alle Slices wieder sauber beginnen/enden.
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
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end('<!doctype html><body><button id=b>go</button><script src=/entry.js></script>'); return; }
  try {
    let file = path.join(tmp, "entry.js");
    if (url.pathname.startsWith("/fredrun2/audio/")) {
      file = path.normalize(path.join(publicAudio, url.pathname.slice("/fredrun2/audio/".length)));
      if (!file.startsWith(publicAudio + path.sep)) throw new Error("außerhalb");
    }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "text/javascript" });
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { chromium } = require(path.join(process.env.PLAYWRIGHT_NODE_PATH ?? "/opt/node22/lib/node_modules", "playwright"));
const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

/** Ein Durchlauf; `mode`: "normal", "blocked" (Bank-Dateien abweisen = Fallback-Test) oder "nogapless" (MP3 ohne LAME-Kopf). */
async function scenario(mode, altMp3) {
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
  const res = await page.evaluate(async ([blocked, expectShift]) => {
    const { createEngine, resolveContextCtor, SFX_NAMES, LOOP_NAMES, WORLD_MUSIC_IDS } = window.__t;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const { audio: a, debug } = createEngine(resolveContextCtor());
    await a.unlock();
    const out = { unlocked: a.unlocked, sfx: 0, loops: 0, themes: [], problems: [] };
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
  }, [blockBank, mode === "nogapless"]);
  await page.close();
  return { res, errs };
}

const results = [];
results.push({ label: "Szenario Bank:", ...(await scenario("normal")) });
results.push({ label: "Szenario Fallback (Bank blockiert):", ...(await scenario("blocked")) });
if (ffmpegPath) {
  // MP3 ohne Xing/LAME-Kopf (Stream-Kopie): Decoder kennt den Encoder-Delay nicht mehr
  const stripped = execFileSync(ffmpegPath, ["-v", "error", "-i", path.join(publicAudio, "sfx-bank.mp3"), "-c", "copy", "-write_xing", "0", "-id3v2_version", "0", "-f", "mp3", "-"], { maxBuffer: 64 << 20 });
  results.push({ label: "Szenario ohne Gapless-Kopf (Encoder-Delay ausgleichen):", ...(await scenario("nogapless", stripped)) });
} else {
  console.log("Szenario ohne Gapless-Kopf übersprungen (kein ffmpeg: --ffmpeg <Pfad> oder $FFMPEG)");
}
let failed = false;
for (const { label, res, errs } of results) {
  console.log(label);
  console.log(JSON.stringify(res));
  const problems = [...res.problems, ...errs.map((e) => "Konsolenfehler: " + e)];
  if (!res.unlocked) problems.push("Engine nicht entsperrt");
  if (res.sfx < 51) problems.push(`nur ${res.sfx} SFX gespielt`);
  console.log(problems.length ? "PROBLEME:\n  " + problems.join("\n  ") : "keine Fehler");
  if (problems.length) failed = true;
}
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
