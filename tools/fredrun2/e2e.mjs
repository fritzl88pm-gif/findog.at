#!/usr/bin/env node
/**
 * End-to-End-Test der echten Seite (/fredrun2) im headless Chromium.
 * Voraussetzung: laufender Server, z.B. `npx next start -p 3112` (nach `next build`) oder `npx next dev -p 3111`.
 *   node tools/fredrun2/e2e.mjs --base http://localhost:3112 [--shots /tmp/x]
 */
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith("--") ? [...a, [x.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]] : a), []));
const base = args.base ?? "http://localhost:3112";
const shots = args.shots;
const { chromium } = require(path.join(process.env.PLAYWRIGHT_NODE_PATH ?? "/opt/node22/lib/node_modules", "playwright"));
if (shots) await mkdir(shots, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
let failed = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " – " + extra : ""}`); if (!ok) failed += 1; };
const snap = () => page.evaluate(() => window.__fr2.game.getSnapshot());
const shot = async (n) => { if (shots) await page.screenshot({ path: path.join(shots, `e2e-${n}.png`) }); };

await page.goto(`${base}/fredrun2?debug=1`, { waitUntil: "load" });
await page.waitForFunction(() => window.__fr2 && window.__fr2.game.getSnapshot().phase === "menu", null, { timeout: 90000 });
check("Menü lädt", true);
await shot("menu");

// Tabs
for (const t of ["Welten", "Charaktere", "Bestenliste", "Einstellungen", "Anleitung", "Spielen"]) {
  await page.getByRole("tab", { name: t }).click();
}
check("alle Tabs klickbar", true);

// Welten
await page.getByRole("tab", { name: "Welten" }).click();
const worldCards = await page.locator("button[aria-pressed]").count();
check("6 Welt-Karten", worldCards === 6, String(worldCards));
await shot("worlds");
await page.locator("button[aria-pressed]").nth(5).click();
await page.waitForTimeout(1200);
check("Welt wählbar (Cyber)", (await snap()).profile.world === "cyber");
await page.locator("button[aria-pressed]").nth(0).click();
await page.waitForTimeout(800);

// Charaktere: Kauf ohne Münzen scheitert
await page.getByRole("tab", { name: "Charaktere" }).click();
await shot("characters");
const owned0 = (await snap()).profile.unlocked.length;
await page.getByRole("button", { name: /kaufen/ }).first().click();
check("Kauf ohne Münzen abgelehnt", (await snap()).profile.unlocked.length === owned0);
await page.getByRole("button", { name: "Wählen" }).first().click();
await page.waitForTimeout(600);
check("Frida wählbar", (await snap()).profile.character === "frida");

// Start
await page.getByRole("tab", { name: "Spielen" }).click();
await page.getByRole("button", { name: /Los geht/ }).click();
await page.getByRole("button", { name: "Überspringen" }).click();
await page.waitForFunction(() => window.__fr2.game.getSnapshot().phase === "countdown");
check("Countdown startet", true);
await page.waitForFunction(() => window.__fr2.game.getSnapshot().phase === "running", null, { timeout: 15000 });
check("Lauf beginnt", true);
await page.keyboard.down("Space");
await page.waitForTimeout(260);
const h0 = await page.evaluate(() => window.__fr2.game.debugSim.player.hgt);
await page.keyboard.up("Space");
check("Sprung per Leertaste (gehalten)", h0 > 60, `hgt=${Math.round(h0)}`);
await page.waitForTimeout(700);
await page.waitForTimeout(3000);
await shot("run");
// Pause
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
check("Pause per Esc", (await snap()).phase === "paused");
await shot("pause");
const d1 = await page.evaluate(() => window.__fr2.game.debugSim.dist);
await page.waitForTimeout(500);
const d2 = await page.evaluate(() => window.__fr2.game.debugSim.dist);
check("Spiel steht in Pause", Math.abs(d2 - d1) < 1);
await page.keyboard.press("Enter");
await page.waitForFunction(() => window.__fr2.game.getSnapshot().phase === "running", null, { timeout: 8000 });
check("Weiter nach Pause", true);
// Game Over
await page.evaluate(() => { const s = window.__fr2.game.debugSim; s.player.hearts = 1; s.player.invuln = 0; s.hurt("crate"); });
await page.waitForFunction(() => window.__fr2.game.getSnapshot().phase === "gameover", null, { timeout: 8000 });
check("Game Over", true);
await page.waitForTimeout(600);
await shot("gameover");
const res = (await snap()).result;
check("Ergebnis vorhanden", !!res && res.score >= 0, res ? `score=${res.score}` : "");
// Neustart
await page.keyboard.press("Enter");
await page.waitForFunction(() => window.__fr2.game.getSnapshot().phase === "running", null, { timeout: 15000 });
check("Neustart per Enter", true);
await page.evaluate(() => window.__fr2.game.toMenu());
await page.waitForTimeout(500);
// Persistenz
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => window.__fr2 && window.__fr2.game.getSnapshot().phase === "menu", null, { timeout: 90000 });
const prof = (await snap()).profile;
check("Profil bleibt nach Reload (Charakter, Lebensdaten, Bestwert)", prof.character === "frida" && prof.lifetime.runs >= 1 && Object.keys(prof.best).length >= 1, `runs=${prof.lifetime.runs}`);
await page.getByRole("tab", { name: "Bestenliste" }).click();
await shot("board");
// Weltreise
await page.evaluate(() => window.__fr2.game.setMode("tour"));
await page.evaluate(() => window.__fr2.game.startRun({ mode: "tour" }));
await page.waitForFunction(() => window.__fr2.game.getSnapshot().phase === "running", null, { timeout: 60000 });
check("Weltreise startet (alle Welten laden)", true);
check("keine Konsolen-/Seitenfehler", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failed ? `\n${failed} Prüfung(en) fehlgeschlagen` : "\nalles grün");
process.exit(failed ? 1 : 0);
