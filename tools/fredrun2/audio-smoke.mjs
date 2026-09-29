#!/usr/bin/env node
/** Rauchtest der prozeduralen Audio-Engine im headless Chromium: alle SFX, Loops und Musikthemen ohne Fehler. */
import { build } from "esbuild";
import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const tmp = path.join(process.env.TMPDIR ?? "/tmp", "fr2-audio-smoke");
await mkdir(tmp, { recursive: true });
await writeFile(path.join(tmp, "entry.ts"), `import { createAudio } from ${JSON.stringify(path.join(root, "src/game/fredrun2/audio/index.ts"))};
import { SFX_NAMES, LOOP_NAMES, WORLD_MUSIC_IDS } from ${JSON.stringify(path.join(root, "src/game/fredrun2/audio/types.ts"))};
(window as any).__t = { createAudio, SFX_NAMES, LOOP_NAMES, WORLD_MUSIC_IDS };
document.title = "ready";`);
await build({ entryPoints: [path.join(tmp, "entry.ts")], bundle: true, format: "iife", outfile: path.join(tmp, "entry.js"), logLevel: "error", target: "es2022" });
const server = http.createServer(async (req, res) => {
  if (req.url === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end('<!doctype html><body><button id=b>go</button><script src=/entry.js></script>'); return; }
  try { res.writeHead(200, { "content-type": "text/javascript" }); res.end(await readFile(path.join(tmp, "entry.js"))); } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { chromium } = require(path.join(process.env.PLAYWRIGHT_NODE_PATH ?? "/opt/node22/lib/node_modules", "playwright"));
const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => document.title === "ready");
await page.click("#b");
const res = await page.evaluate(async () => {
  const { createAudio, SFX_NAMES, LOOP_NAMES, WORLD_MUSIC_IDS } = window.__t;
  const a = createAudio();
  await a.unlock();
  const out = { unlocked: a.unlocked, sfx: 0, loops: 0, themes: [] };
  for (const n of SFX_NAMES) { a.sfx(n); out.sfx++; }
  for (const l of LOOP_NAMES) { a.loop(l, true, 0.5); out.loops++; }
  await new Promise((r) => setTimeout(r, 400));
  for (const l of LOOP_NAMES) a.loop(l, false);
  for (const id of WORLD_MUSIC_IDS) {
    a.music.play(id, { intensity: 0.8 });
    await new Promise((r) => setTimeout(r, 1500));
    a.music.setIntensity(0.2, 0.2);
    out.themes.push([id, a.music.current]);
  }
  a.setMuted(true); a.setMuted(false); a.duck(0.5, 0.2); a.setTempoScale(1.2); a.suspend(); a.resume();
  a.music.stop(0.2);
  a.dispose();
  return out;
});
console.log(JSON.stringify(res));
console.log(errs.length ? "FEHLER:\n" + errs.join("\n") : "keine Fehler");
await browser.close();
server.close();
process.exit(errs.length ? 1 : 0);
