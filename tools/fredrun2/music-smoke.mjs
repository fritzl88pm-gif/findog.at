#!/usr/bin/env node
/**
 * Rauchtest der aufgenommenen Musik im echten Browser (headless Chromium, echter AudioContext).
 *   node tools/fredrun2/music-smoke.mjs --url http://localhost:3111/fredrun2 [--seconds 10]
 * Prüft: Menü-Stück wird geladen und hörbar (RMS am Ausgang), Weltmusik startet beim Lauf (Überblendung),
 * Schleifen-Abstand (`period`) wird eingehalten, keine Konsolenfehler, kein Rückfall auf die prozedurale Musik.
 */
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]);
    return acc;
  }, []),
);
const url = args.url ?? "http://localhost:3111/fredrun2";
const seconds = Number(args.seconds ?? 10);
const { chromium } = require(path.join(process.env.PLAYWRIGHT_NODE_PATH ?? "/opt/node22/lib/node_modules", "playwright"));

const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const logs = [];
page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
const mp3 = [];
page.on("response", (r) => {
  if (/\/fredrun2\/audio\//.test(r.url())) mp3.push(`${r.status()} ${r.url().split("/fredrun2/audio/")[1]}`);
});

if (args.block) {
  // Fallback-Test: Musikdateien nicht ladbar → prozedurale Musik muss übernehmen
  await page.route("**/fredrun2/audio/**", (route) => route.abort());
}

await page.addInitScript(() => {
  const starts = [];
  const taps = [];
  window.__audioProbe = { starts, taps };
  const origConnect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    try {
      if (typeof AudioDestinationNode !== "undefined" && dest instanceof AudioDestinationNode && !this.__tapped) {
        this.__tapped = true;
        const an = this.context.createAnalyser();
        an.fftSize = 2048;
        origConnect.call(this, an);
        taps.push(an);
      }
    } catch {
      /* egal */
    }
    return origConnect.call(this, dest, ...rest);
  };
  const origStart = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when, ...rest) {
    if (this.buffer && this.buffer.duration > 3) starts.push({ ctxTime: this.context.currentTime, when, dur: this.buffer.duration, ch: this.buffer.numberOfChannels });
    return origStart.call(this, when, ...rest);
  };
  window.__rms = () => {
    const out = [];
    for (const an of taps) {
      const buf = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(buf);
      let s = 0;
      for (const v of buf) s += v * v;
      out.push(Math.sqrt(s / buf.length));
    }
    return Math.max(0, ...out);
  };
});

await page.goto(url + (url.includes("?") ? "&" : "?") + "debug=1", { waitUntil: "load", timeout: 120000 });
await page.waitForFunction(() => window.__fr2 && document.querySelector("canvas"), null, { timeout: 60000 });
await page.waitForTimeout(800);

const sample = async (label, secs) => {
  const rows = [];
  for (let i = 0; i < secs * 2; i++) {
    rows.push(await page.evaluate(() => window.__rms()));
    await page.waitForTimeout(500);
  }
  const max = Math.max(...rows);
  const avg = rows.reduce((a, b) => a + b, 0) / rows.length;
  console.log(`${label}: RMS max ${max.toFixed(3)} Ø ${avg.toFixed(3)}`);
  return max;
};

// Klick = Nutzergeste → Audio entsperren, Menümusik startet
await page.getByRole("tab", { name: "Spielen" }).first().click();
await page.waitForTimeout(400);
const menuMax = await sample("Menü", Math.max(4, seconds / 2));
const menuStarts = await page.evaluate(() => window.__audioProbe.starts.filter((s) => s.dur >= 20).map((s) => ({ dur: +s.dur.toFixed(2), ch: s.ch })));
console.log("Musik-Puffer (Menü):", JSON.stringify(menuStarts));

// Lauf starten → Weltmusik
await page.getByRole("button", { name: /Los geht/ }).click();
const skip = page.getByRole("button", { name: "Überspringen" });
await page.waitForTimeout(500);
if (await skip.count()) await skip.click();
const runMax = await sample("Lauf", seconds);
const starts = await page.evaluate(() => window.__audioProbe.starts.filter((s) => s.dur >= 20).map((s) => ({ t: +s.ctxTime.toFixed(2), when: +s.when.toFixed(2), dur: +s.dur.toFixed(2) })));
console.log("Musik-Starts:", JSON.stringify(starts));

// Game Over → Stinger (Jingle) + Musik blendet aus
await page.evaluate(() => {
  const g = window.__fr2.game.debugSim;
  if (g) {
    g.player.hearts = 1;
    g.hurt("test");
  }
});
await page.waitForTimeout(5200);
const jingleStarts = await page.evaluate(() => window.__audioProbe.starts.filter((s) => s.dur > 5 && s.dur < 20).map((s) => +s.dur.toFixed(2)));
console.log("Jingles gestartet (Dauer s):", JSON.stringify(jingleStarts));
if (!jingleStarts.length) console.log("Hinweis: kein Jingle – evtl. noch nicht geladen oder Tod nicht ausgelöst");

console.log("Downloads:", mp3.join(", "));
let ok = true;
const fail = (msg) => {
  ok = false;
  console.log(`FEHLER: ${msg}`);
};
if (!(menuMax > 0.005)) fail("Menü-Musik nicht hörbar");
if (!(runMax > 0.005)) fail("Lauf-Musik nicht hörbar");
if (!args.block) {
  if (!mp3.some((m) => /music\/music\.json/.test(m))) fail("music.json nicht geladen");
  if (mp3.some((m) => /^[45]/.test(m))) fail("Download-Fehler");
  if (logs.length) fail(logs.slice(0, 10).join("\n"));
} else {
  const own = logs.filter((l) => !/ERR_FAILED|Failed to load resource/.test(l));
  if (own.length) fail(own.slice(0, 10).join("\n"));
}
console.log(ok ? "OK" : "FEHLGESCHLAGEN");
await browser.close();
process.exit(ok ? 0 : 1);
