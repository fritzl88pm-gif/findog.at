#!/usr/bin/env node
/**
 * Browser-Test der globalen Bestenliste (headless Chromium, echte Seite /fredrun2, API und Anmeldung simuliert).
 * Voraussetzung: Produktions-Build MIT gesetzten Supabase-Variablen (nur für den Test, Dummy-Werte genügen):
 *   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy npx next build && npx next start -p 3112
 *   node tools/fredrun2/board-e2e.mjs --base http://localhost:3112 [--shots /tmp/x]
 * Geprüft: alte lokale Highscores werden zurückgesetzt, ohne Anmeldung nur lokale Liste, mit Anmeldung Einreichung nach dem Lauf
 * (POST mit gültiger runId), weltweiter Platz im Ergebnis-Dialog, globale Tabelle im Bestenliste-Tab inkl. „(du)“-Markierung.
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

let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " – " + extra : ""}`);
  if (!ok) failed += 1;
};

const OLD_PROFILE = {
  version: 1, name: "Alt", coins: 321, unlocked: ["fred", "frida", "cyberfred"], character: "fred", world: "wien", mode: "world",
  best: { "world:wien": 9999 }, top: { "world:wien": [{ name: "Alt", score: 9999, meters: 999, character: "fred", date: "2026-01-01" }] },
  settings: { master: 0.85, music: 0.6, sfx: 0.9, muted: true, reducedMotion: false, quality: "low", showFps: false, hints: true },
  lifetime: { runs: 5, meters: 100, coins: 10, stomps: 1, nearMisses: 1, playSeconds: 10 }, seenIntro: true, dailyKey: "",
};

async function open(browser, { token }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  const posts = [];
  const gets = [];
  await ctx.addInitScript(
    ({ profile, token }) => {
      try {
        if (!localStorage.getItem("findog.fredrun2.profile.v1")) localStorage.setItem("findog.fredrun2.profile.v1", JSON.stringify(profile));
        if (token) {
          localStorage.setItem(
            "sb-localhost-auth-token",
            JSON.stringify({
              access_token: token, refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 86400,
              user: { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "t@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
            }),
          );
        }
      } catch {
        /* ignore */
      }
    },
    { profile: OLD_PROFILE, token },
  );
  await page.route("**/api/fredrun2/highscores**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const board = url.searchParams.get("board") ?? "world:wien";
    if (req.method() === "POST") posts.push(JSON.parse(req.postData() ?? "{}"));
    else gets.push(board);
    const entries = [
      { rank: 1, name: "Anna", score: 9000, meters: 700, character: "frida", me: false },
      { rank: 2, name: "Berta", score: 5000, meters: 400, character: "fred", me: false },
    ];
    const posted = posts.at(-1);
    if (posted) entries.push({ rank: 3, name: posted.name || "Fredi", score: posted.score, meters: posted.meters, character: posted.character, me: true });
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ board, entries, me: posted ? { rank: 3, score: posted.score } : null, playerName: "Fredi", ...(req.method() === "POST" ? { submitted: true } : {}) }),
    });
  });
  // Nameneffekt der App (Original-Fredrun) neutral beantworten
  await page.route("**/api/fredrun/highscores**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ world: "vienna", entries: [], playerName: "" }) }));
  await page.goto(`${base}/fredrun2?debug=1`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__fr2 && window.__fr2.game.getSnapshot().phase === "menu", null, { timeout: 90000 });
  return { ctx, page, errors, posts, gets };
}

const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

// 1) ohne Anmeldung: alte Highscores weg, Münzen/Helden bleiben, nur lokale Liste
{
  const { ctx, page, errors, posts } = await open(browser, { token: "" });
  const snap = await page.evaluate(() => window.__fr2.game.getSnapshot());
  check("Alte lokale Highscores zurückgesetzt", Object.keys(snap.profile.best).length === 0 && Object.keys(snap.profile.top).length === 0);
  check("Münzen, Helden und Einstellungen bleiben", snap.profile.coins === 321 && snap.profile.unlocked.includes("cyberfred") && snap.profile.settings.quality === "low");
  await page.getByRole("tab", { name: "Bestenliste" }).first().click();
  await page.waitForTimeout(400);
  const text = await page.locator("body").innerText();
  check("Ohne Anmeldung: Hinweis auf lokale Liste", /Nur dieses Gerät/.test(text));
  check("Ohne Anmeldung: kein Eintrag „Alt“", !/Alt\b.*9\.?999/.test(text));
  if (shots) await page.screenshot({ path: path.join(shots, "board-local.png") });
  check("Ohne Anmeldung: keine Einreichung", posts.length === 0);
  check("Keine Seitenfehler (lokal)", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

// 2) mit Anmeldung: Lauf einreichen, Platz anzeigen, globale Tabelle
{
  const { ctx, page, errors, posts, gets } = await open(browser, { token: "test-token" });
  await page.getByRole("tab", { name: "Bestenliste" }).first().click();
  await page.waitForFunction(() => /Anna/.test(document.body.innerText), null, { timeout: 10000 }).catch(() => undefined);
  let text = await page.locator("body").innerText();
  check("Mit Anmeldung: weltweite Tabelle geladen", /Weltweit/.test(text) && /Anna/.test(text) && /Berta/.test(text), gets.join(","));
  if (shots) await page.screenshot({ path: path.join(shots, "board-global.png") });
  await page.getByRole("tab", { name: "Spielen" }).first().click();
  await page.getByRole("button", { name: /Los geht/ }).click();
  await page.waitForFunction(() => window.__fr2.game.getSnapshot().phase === "running", null, { timeout: 30000 });
  // ein paar Sekunden laufen (Score > 0): Sprung-Eingaben, damit der Lauf nicht sofort endet
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press("Space");
    await page.waitForTimeout(700);
  }
  await page.evaluate(() => {
    const s = window.__fr2.game.debugSim;
    s.player.hearts = 1;
    s.player.invuln = 0;
    s.hurt("crate");
  });
  await page.waitForFunction(() => window.__fr2.game.getSnapshot().phase === "gameover", null, { timeout: 10000 });
  await page.waitForFunction(() => /Weltweit Platz/.test(document.body.innerText), null, { timeout: 10000 }).catch(() => undefined);
  text = await page.locator("body").innerText();
  const res = await page.evaluate(() => window.__fr2.game.getSnapshot().result);
  check("Einreichung genau einmal", posts.length === 1, `n=${posts.length}`);
  const p = posts[0] ?? {};
  check("Einreichung: Board, gültige runId, Score, Meter, Held", p.board === "world:wien" && /^[0-9a-f-]{36}$/.test(p.runId ?? "") && p.score === Math.floor(res.score) && p.meters === Math.floor(res.meters) && typeof p.character === "string", JSON.stringify(p));
  check("Ergebnis-Dialog zeigt weltweiten Platz", /Weltweit Platz 3/.test(text));
  if (shots) await page.screenshot({ path: path.join(shots, "board-gameover.png") });
  await page.getByRole("button", { name: "Menü" }).click();
  await page.waitForFunction(() => window.__fr2.game.getSnapshot().phase === "menu", null, { timeout: 5000 });
  await page.getByRole("tab", { name: "Bestenliste" }).first().click();
  await page.waitForFunction(() => /\(du\)/.test(document.body.innerText), null, { timeout: 10000 }).catch(() => undefined);
  text = await page.locator("body").innerText();
  check("Bestenliste markiert den eigenen Eintrag", /\(du\)/.test(text));
  await page.getByRole("button", { name: "Weltreise" }).first().click().catch(() => undefined);
  await page.waitForTimeout(500);
  check("Board-Wechsel lädt die Weltreise-Liste", gets.includes("tour"), gets.join(","));
  if (shots) await page.screenshot({ path: path.join(shots, "board-global-me.png") });
  check("Keine Seitenfehler (angemeldet)", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

await browser.close();
console.log(failed ? `\n${failed} Prüfung(en) fehlgeschlagen` : "\nAlle Prüfungen bestanden");
process.exit(failed ? 1 : 0);
