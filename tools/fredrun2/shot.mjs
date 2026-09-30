#!/usr/bin/env node
/**
 * QA-Screenshots für Fredrun 2.0 (headless Chromium, echter Spielcode, Bot-gesteuert).
 *
 * Beispiele:
 *   node tools/fredrun2/shot.mjs --world wien --meters 0,300,900 --out /tmp/shots/wien
 *   node tools/fredrun2/shot.mjs --world cyber --meters 500 --seconds 3,6,9 --char cyberfred --out /tmp/shots/cyber
 *   node tools/fredrun2/shot.mjs --mode tour --seconds 40,80 --out /tmp/shots/tour
 *
 * Optionen:
 *   --world <id>        wien|alpen|finanzamt|prater|wachau|cyber   (Standard wien)
 *   --mode <m>          world|tour                                  (Standard world)
 *   --char <id>         Figur (Standard fred)
 *   --meters a,b,c      Startdistanzen in Metern (je ein neuer Lauf, danach --seconds Sek. Bot-Spiel)
 *   --world-meters n    Meter in der Welt (wählt die Stimmungsstufe, z.B. 780 = Stufe 3 bei stageMeters 260)
 *   --seconds a,b,c     nacheinander: Screenshots nach jeweils zusätzlich a,b,c Sekunden
 *   --seed n            Zufallssamen (Standard 1)
 *   --size WxH          Viewport (Standard 1280x720)
 *   --dpr n             Pixeldichte (Standard 1)
 *   --out <prefix>      Ausgabepräfix (Datei = <prefix>-<meters>m-<sekunden>s.png)
 *   --fps               Framezeit-Messung ausgeben (Sim+Render pro Frame, synchron)
 *   --live <sek>        Echtzeit-Messung: Bot spielt <sek> Sekunden über requestAnimationFrame; gibt fps/p95/p99 aus
 */
import { build } from "esbuild";
import http from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]);
    return acc;
  }, []),
);
const world = args.world ?? "wien";
const mode = args.mode ?? "world";
const character = args.char ?? "fred";
const meters = (args.meters ?? "0").split(",").map(Number);
const seconds = (args.seconds ?? "4").split(",").map(Number);
const seed = Number(args.seed ?? 1);
const worldMetersList = args["world-meters"] !== undefined ? args["world-meters"].split(",").map(Number) : [undefined];
const [vw, vh] = (args.size ?? "1280x720").split("x").map(Number);
const dpr = Number(args.dpr ?? 1);
const outPrefix = args.out ?? "/tmp/fr2-shot";

const tmp = path.join(process.env.TMPDIR ?? "/tmp", "fr2-harness");
await mkdir(tmp, { recursive: true });
await build({
  entryPoints: [path.join(root, "src/game/fredrun2/harness.ts")],
  bundle: true,
  format: "iife",
  outfile: path.join(tmp, "harness.js"),
  sourcemap: "inline",
  target: "es2022",
  logLevel: "error",
});
const html = `<!doctype html><meta charset=utf-8><style>html,body{margin:0;background:#000;overflow:hidden}#stage{width:${vw}px;height:${vh}px;position:relative}#c{width:100%;height:100%;display:block}</style><div id=stage><canvas id=c></canvas></div><script src=/harness.js></script>`;
const mime = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  let file;
  if (url === "/" || url === "/index.html") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
    return;
  }
  if (url === "/harness.js") file = path.join(tmp, "harness.js");
  else file = path.join(root, "public", url);
  try {
    if (!file.startsWith(root) && !file.startsWith(tmp)) throw new Error("forbidden");
    const data = await readFile(file);
    res.writeHead(200, { "content-type": mime[path.extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const { chromium } = require(path.join(process.env.PLAYWRIGHT_NODE_PATH ?? "/opt/node22/lib/node_modules", "playwright"));
const browser = await chromium.launch({ headless: true, args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
page.on("requestfailed", (r) => logs.push(`[requestfailed] ${r.url()}`));
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction(() => document.title === "ready", null, { timeout: 60000 });
await mkdir(path.dirname(outPrefix), { recursive: true });
for (const wmv of worldMetersList) for (const m of meters) {
  await page.evaluate(async ([w, md, ch, m, sd, wm]) => {
    await window.__fr2.game.debugRun({ world: w, mode: md, character: ch, startMeters: m, seed: sd, startWorldMeters: wm });
  }, [world, mode, character, m, seed, wmv]);
  let elapsed = 0;
  for (const s of seconds) {
    const step = Math.max(0.01, s - elapsed);
    const t0 = Date.now();
    const r = await page.evaluate((st) => window.__fr2.game.debugAdvance(st), step);
    elapsed = s;
    const file = `${outPrefix}-${world === "" ? "x" : world}-${wmv !== undefined ? `wm${wmv}` : `${m}m`}-${s}s.png`;
    await page.locator("#c").screenshot({ path: file });
    console.log(`${file}  score=${r.score} m=${Math.round(r.meters)} hearts=${r.hearts} phase=${r.phase} world=${r.worldId} (${Date.now() - t0}ms)`);
  }
}
if (args.live) {
  const secs = Number(args.live);
  await page.evaluate(async ([w, md, ch, sd, wm]) => {
    await window.__fr2.game.debugRun({ world: w, mode: md, character: ch, seed: sd, startMeters: 600, startWorldMeters: wm, live: true });
    window.__fr2.game.setManual(false);
  }, [world, mode, character, seed, worldMetersList[0]]);
  const stats = await page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const times = [];
        let last = performance.now();
        const start = last;
        const tick = (now) => {
          times.push(now - last);
          last = now;
          if (now - start < ms) requestAnimationFrame(tick);
          else {
            const sorted = [...times].sort((a, b) => a - b);
            const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
            resolve({ frames: times.length, avg: times.reduce((a, b) => a + b, 0) / times.length, p95: pct(0.95), p99: pct(0.99), max: sorted[sorted.length - 1], quality: window.__fr2.game.getSnapshot().quality });
          }
        };
        requestAnimationFrame(tick);
      }),
    secs * 1000,
  );
  console.log(`LIVE ${world}: ${stats.frames} Frames, Ø ${stats.avg.toFixed(1)} ms (${(1000 / stats.avg).toFixed(0)} fps), p95 ${stats.p95.toFixed(1)}, p99 ${stats.p99.toFixed(1)}, max ${stats.max.toFixed(1)} ms, Qualität ${stats.quality}`);
  await page.locator("#c").screenshot({ path: `${outPrefix}-${world}-live.png` });
}
if (args.fps) {
  const ms = await page.evaluate(() => {
    const g = window.__fr2.game;
    const cv = document.getElementById("c");
    const cx = cv.getContext("2d");
    const t0 = performance.now();
    for (let i = 0; i < 40; i += 1) {
      g.debugAdvance(1 / 60);
      cx.getImageData(0, 0, 1, 1); // erzwingt Rasterisierung (GPU/Software-Flush) für reproduzierbare Zeiten
    }
    return (performance.now() - t0) / 40;
  });
  console.log(`Ø Frame (Sim+Render inkl. Flush, swiftshader/software): ${ms.toFixed(2)} ms`);
}
if (logs.length) console.log(logs.slice(0, 30).join("\n"));
await browser.close();
server.close();
