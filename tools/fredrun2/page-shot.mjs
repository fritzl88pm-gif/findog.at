#!/usr/bin/env node
/**
 * Screenshot der echten Next-Seite (/fredrun2) inkl. Menü/UI. Voraussetzung: `npx next dev -p 3111` läuft.
 *   node tools/fredrun2/page-shot.mjs --url http://localhost:3111/fredrun2 --out /tmp/x/menu --steps menu,worlds,characters,board,settings,help,play,pause,gameover
 */
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]);
    return acc;
  }, []),
);
const url = args.url ?? "http://localhost:3111/fredrun2";
const out = args.out ?? "/tmp/fr2-page";
const steps = (args.steps ?? "menu").split(",");
const [vw, vh] = (args.size ?? "1280x720").split("x").map(Number);
const { chromium } = require(path.join(process.env.PLAYWRIGHT_NODE_PATH ?? "/opt/node22/lib/node_modules", "playwright"));
const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, hasTouch: args.touch === "true", isMobile: args.touch === "true" });
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") logs.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
page.on("requestfailed", (r) => logs.push(`[requestfailed] ${r.url()}`));
await mkdir(path.dirname(out), { recursive: true });
await page.goto(url + (url.includes("?") ? "&" : "?") + "debug=1", { waitUntil: "load", timeout: 120000 });
await page.waitForFunction(() => window.__fr2 && document.querySelector("canvas"), null, { timeout: 60000 });
await page.waitForTimeout(2500);
const shot = async (name) => { await page.screenshot({ path: `${out}-${name}.png` }); console.log(`${out}-${name}.png`); };
const clickText = async (text) => { await page.getByRole("tab", { name: text }).first().click(); await page.waitForTimeout(500); };
for (const s of steps) {
  if (s === "menu") await shot("menu");
  else if (["worlds", "characters", "board", "settings", "help"].includes(s)) {
    const label = { worlds: "Welten", characters: "Charaktere", board: "Bestenliste", settings: "Einstellungen", help: "Anleitung" }[s];
    await clickText(label); await page.waitForTimeout(600); await shot(s);
  } else if (s === "play") {
    await page.getByRole("tab", { name: "Spielen" }).first().click();
    await page.getByRole("button", { name: /Los geht/ }).click();
    await page.waitForTimeout(400);
    const skip = page.getByRole("button", { name: "Überspringen" });
    if (await skip.count()) await skip.click();
    await page.waitForTimeout(700); await shot("countdown");
    await page.waitForTimeout(3600); await shot("run1");
    await page.keyboard.press("Space"); await page.waitForTimeout(300); await shot("run-jump");
  } else if (s === "pause") { await page.keyboard.press("Escape"); await page.waitForTimeout(500); await shot("pause"); await page.keyboard.press("Enter"); await page.waitForTimeout(2200); }
  else if (s === "gameover") {
    await page.evaluate(() => { const g = window.__fr2.game.debugSim; if (g) { g.player.hearts = 1; g.hurt("test"); } });
    await page.waitForTimeout(4500); await shot("gameover");
  } else if (s.startsWith("wait")) await page.waitForTimeout(Number(s.slice(4)) || 1000);
}
if (logs.length) console.log(logs.slice(0, 20).join("\n"));
await browser.close();
