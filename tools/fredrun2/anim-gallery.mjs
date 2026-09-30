/**
 * QA: rendert alle Figuren-Zustände (run, jump, apex, glide, doublejump, slide, dash, stomp, hurt) im echten Spielcode
 * und legt Ausschnitte unter <TMP>/fr2-gallery ab (danach z.B. mit PIL zu einem Kontaktbogen montieren).
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const tmp = path.join(process.env.TMPDIR ?? "/tmp", "fr2-harness");
mkdirSync(tmp, { recursive: true });
await build({ entryPoints: [path.join(root, "src/game/fredrun2/harness.ts")], bundle: true, format: "iife", outfile: path.join(tmp, "harness.js"), logLevel: "error", target: "es2022" });
const html = `<!doctype html><meta charset=utf-8><style>html,body{margin:0;background:#000}#stage{width:1280px;height:720px}#c{width:100%;height:100%}</style><div id=stage><canvas id=c></canvas></div><script src=/harness.js></script>`;
const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  if (url === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end(html); return; }
  const file = url === "/harness.js" ? path.join(tmp, "harness.js") : path.join(root, "public", url);
  try { const d = await readFile(file); res.writeHead(200, { "content-type": file.endsWith(".webp") ? "image/webp" : file.endsWith(".json") ? "application/json" : file.endsWith(".js") ? "text/javascript" : "application/octet-stream" }); res.end(d); } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { chromium } = require(path.join(process.env.PLAYWRIGHT_NODE_PATH ?? "/opt/node22/lib/node_modules", "playwright"));
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto(`http://127.0.0.1:${server.address().port}/`);
await p.waitForFunction(() => document.title === "ready");
const out = path.join(process.env.TMPDIR ?? "/tmp", "fr2-gallery");
mkdirSync(out, { recursive: true });
const chars = ["fred", "frida", "superfred", "cyberfred", "superfrida"];
for (const ch of chars) {
  await p.evaluate(async (c) => { await window.__fr2.game.debugRun({ world: "alpen", character: c, seed: 3, bot: false, startMeters: 0 }); const s = window.__fr2.game.debugSim; s.ents = []; s.spawner.cursor = 1e9; }, ch);
  const shots = [];
  const grab = async (name, fn) => { await p.evaluate(fn); const clip = { x: 100, y: 240, width: 420, height: 380 }; await p.locator("#c").screenshot({ path: `${out}/g-${ch}-${name}.png`, clip }); shots.push(name); };
  await p.evaluate(() => window.__fr2.game.debugAdvance(0.5, { input: { jump: false, jumpPressed: false, slide: false, slidePressed: false, dashPressed: false } }));
  await grab("run", () => window.__fr2.game.debugAdvance(0.2, { input: { jump: false, jumpPressed: false, slide: false, slidePressed: false, dashPressed: false } }));
  await grab("jump", () => { window.__fr2.game.debugAdvance(0.06, { input: { jump: true, jumpPressed: true, slide: false, slidePressed: false, dashPressed: false } }); window.__fr2.game.debugAdvance(0.16, { input: { jump: true, jumpPressed: false, slide: false, slidePressed: false, dashPressed: false } }); });
  await grab("apex", () => window.__fr2.game.debugAdvance(0.24, { input: { jump: true, jumpPressed: false, slide: false, slidePressed: false, dashPressed: false } }));
  await grab("glide", () => window.__fr2.game.debugAdvance(0.4, { input: { jump: true, jumpPressed: false, slide: false, slidePressed: false, dashPressed: false } }));
  await p.evaluate(() => window.__fr2.game.debugAdvance(1.2, { input: { jump: false, jumpPressed: false, slide: false, slidePressed: false, dashPressed: false } }));
  await grab("dbl", () => { window.__fr2.game.debugAdvance(0.05, { input: { jump: true, jumpPressed: true, slide: false, slidePressed: false, dashPressed: false } }); window.__fr2.game.debugAdvance(0.2, { input: { jump: true, jumpPressed: false, slide: false, slidePressed: false, dashPressed: false } }); window.__fr2.game.debugAdvance(0.02, { input: { jump: true, jumpPressed: true, slide: false, slidePressed: false, dashPressed: false } }); window.__fr2.game.debugAdvance(0.12, { input: { jump: true, jumpPressed: false, slide: false, slidePressed: false, dashPressed: false } }); });
  await p.evaluate(() => window.__fr2.game.debugAdvance(1.3, { input: { jump: false, jumpPressed: false, slide: false, slidePressed: false, dashPressed: false } }));
  await grab("slide", () => { window.__fr2.game.debugAdvance(0.02, { input: { jump: false, jumpPressed: false, slide: true, slidePressed: true, dashPressed: false } }); window.__fr2.game.debugAdvance(0.25, { input: { jump: false, jumpPressed: false, slide: true, slidePressed: false, dashPressed: false } }); });
  await p.evaluate(() => window.__fr2.game.debugAdvance(1.0, { input: { jump: false, jumpPressed: false, slide: false, slidePressed: false, dashPressed: false } }));
  await grab("dash", () => { window.__fr2.game.debugAdvance(0.02, { input: { jump: false, jumpPressed: false, slide: false, slidePressed: false, dashPressed: true } }); window.__fr2.game.debugAdvance(0.14, { input: { jump: false, jumpPressed: false, slide: false, slidePressed: false, dashPressed: false } }); });
  await p.evaluate(() => window.__fr2.game.debugAdvance(1.0, { input: { jump: false, jumpPressed: false, slide: false, slidePressed: false, dashPressed: false } }));
  await grab("stomp", () => { window.__fr2.game.debugAdvance(0.05, { input: { jump: true, jumpPressed: true, slide: false, slidePressed: false, dashPressed: false } }); window.__fr2.game.debugAdvance(0.3, { input: { jump: true, jumpPressed: false, slide: false, slidePressed: false, dashPressed: false } }); window.__fr2.game.debugAdvance(0.02, { input: { jump: false, jumpPressed: false, slide: true, slidePressed: true, dashPressed: false } }); window.__fr2.game.debugAdvance(0.06, { input: { jump: false, jumpPressed: false, slide: true, slidePressed: false, dashPressed: false } }); });
  await p.evaluate(() => window.__fr2.game.debugAdvance(1.0, { input: { jump: false, jumpPressed: false, slide: false, slidePressed: false, dashPressed: false } }));
  await p.evaluate(() => { const s = window.__fr2.game.debugSim; s.player.invuln = 0; s.spawn({ kind: "block", skin: "crate", x: 40, y: s.groundY - 80, w: 60, h: 80, harmful: true }, s.playerWorldX); });
  await grab("hurt", () => window.__fr2.game.debugAdvance(0.28, { input: { jump: false, jumpPressed: false, slide: false, slidePressed: false, dashPressed: false } }));
}
await b.close(); server.close();
console.log("done");
