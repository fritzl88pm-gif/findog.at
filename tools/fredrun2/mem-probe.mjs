/** QA: misst Canvas-Speicher (Offscreen-Caches der Welten) je Welt und in der Weltreise. */
import { build } from "esbuild";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(root + "/package.json");
const tmp = "/tmp/fr2-harness";
await build({ entryPoints: [path.join(root, "src/game/fredrun2/harness.ts")], bundle: true, format: "iife", outfile: path.join(tmp, "harness.js"), logLevel: "error", target: "es2022" });
const html = `<!doctype html><meta charset=utf-8><style>html,body{margin:0}#stage{width:1280px;height:720px}#c{width:100%;height:100%}</style><div id=stage><canvas id=c></canvas></div><script>
window.__cv=[];const oc=document.createElement.bind(document);document.createElement=function(t,o){const e=oc(t,o);if(String(t).toLowerCase()==='canvas')window.__cv.push(new WeakRef(e));return e;};
</script><script src=/harness.js></script>`;
const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  if (url === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end(html); return; }
  const file = url === "/harness.js" ? path.join(tmp, "harness.js") : path.join(root, "public", url);
  try { const d = await readFile(file); res.writeHead(200, { "content-type": file.endsWith(".webp") ? "image/webp" : file.endsWith(".json") ? "application/json" : file.endsWith(".js") ? "text/javascript" : "application/octet-stream" }); res.end(d); } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { chromium } = require("/opt/node22/lib/node_modules/playwright");
const b = await chromium.launch({ headless: true, args: ["--enable-precise-memory-info", "--js-flags=--expose-gc"] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: Number(process.env.DPR ?? 1) });
await p.goto(`http://127.0.0.1:${server.address().port}/`);
await p.waitForFunction(() => document.title === "ready");
const stats = () => p.evaluate(() => { let px = 0, n = 0; for (const w of window.__cv) { const c = w.deref(); if (c) { px += c.width * c.height; n++; } } return { canvases: n, MPix: +(px / 1e6).toFixed(1), approxMB: Math.round((px * 4) / 1048576), heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576) }; });
console.log("start", JSON.stringify(await stats()));
for (const w of ["wien", "alpen", "finanzamt", "prater", "wachau", "cyber", "winter", "oper"]) {
  await p.evaluate(async (w) => { await window.__fr2.game.debugRun({ world: w, seed: 2, startMeters: 0 }); }, w);
  for (const wm of [0, 300, 700, 1200]) { await p.evaluate((wm) => { const s = window.__fr2.game.debugSim; s.worldStartDist = s.dist - wm * 60; window.__fr2.game.debugAdvance(0.3); }, wm); }
  console.log(w, JSON.stringify(await stats()));
}
await p.evaluate(async () => { await window.__fr2.game.debugRun({ mode: "tour", world: "wien", seed: 2 }); window.__fr2.game.debugAdvance(1); });
console.log("tour(all loaded)", JSON.stringify(await stats()));
await b.close(); server.close();
