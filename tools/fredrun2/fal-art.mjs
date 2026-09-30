#!/usr/bin/env node
/**
 * Bilderzeugung über fal.ai (GPT Image 2, `openai/gpt-image-2`) mit Kosten-Buchführung.
 * Der Schlüssel kommt ausschließlich aus der Umgebung (FAL_KEY="<id>:<secret>") – nie ins Repo.
 *
 *   FAL_KEY=… node tools/fredrun2/fal-art.mjs gen --name oper-sky-1 --size 2304x768 --quality high \
 *       --prompt "…" [--transparent] [--n 1] --out /tmp/art
 *   FAL_KEY=… node tools/fredrun2/fal-art.mjs batch tools/fredrun2/art_prompts/<datei>.json --out /tmp/art [--only a,b] [--budget 9]
 *   node tools/fredrun2/fal-art.mjs ledger --out /tmp/art
 *
 * Kosten (Schätzung, fal-Preisliste): 0,02 $ (low) / 0,07 $ (medium) / 0,19 $ (high) je 1024×1024, skaliert mit der Pixelzahl.
 * Jede Erzeugung wird in <out>/ledger.json protokolliert; ab `--budget` (USD, Standard 9) wird nichts mehr gestartet.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const KEY = process.env.FAL_KEY;
const argv = process.argv.slice(2);
const cmd = argv.shift();
const opt = {};
const pos = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) {
    const k = argv[i].slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    opt[k] = v;
  } else pos.push(argv[i]);
}
const outDir = opt.out ?? "/tmp/fr2-art";
const BASE = { low: 0.02, medium: 0.07, high: 0.19 };
const ENDPOINT = "https://fal.run/openai/gpt-image-2";

function estimate(w, h, quality, n = 1) {
  return (BASE[quality] ?? BASE.high) * ((w * h) / (1024 * 1024)) * n;
}

let ledgerLock = Promise.resolve();
/** Serialisiert Lesen-Ändern-Schreiben des Ledgers (parallele Aufträge). */
function withLedger(fn) {
  const run = ledgerLock.then(async () => {
    const l = await ledger();
    const res = await fn(l);
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, "ledger.json"), JSON.stringify(l, null, 2));
    return res;
  });
  ledgerLock = run.catch(() => undefined);
  return run;
}

async function ledger() {
  try {
    return JSON.parse(await readFile(path.join(outDir, "ledger.json"), "utf8"));
  } catch {
    return { entries: [] };
  }
}
const spent = (l) => l.entries.reduce((a, e) => a + e.cost, 0);

async function gen({ name, prompt, size = "1024x1024", quality = "high", transparent = false, n = 1, format = "png" }, budget) {
  if (!KEY) throw new Error("FAL_KEY fehlt");
  const [w, h] = size.split("x").map(Number);
  const est = estimate(w, h, quality, n);
  // Kosten vorab reservieren, damit parallele Aufträge das Budget nicht gemeinsam überschreiten
  await withLedger((l) => {
    if (spent(l) + est > budget) throw new Error(`Budget überschritten: ${spent(l).toFixed(2)} + ${est.toFixed(2)} > ${budget} $ (${name})`);
    l.entries.push({ name, size, quality, transparent, n, cost: est, reserved: true, when: new Date().toISOString(), files: [] });
  });
  const refund = () => withLedger((l) => {
    const i = l.entries.findIndex((e) => e.name === name && e.reserved);
    if (i >= 0) l.entries.splice(i, 1);
  });
  const body = { prompt, image_size: { width: w, height: h }, quality, num_images: n, output_format: format, background: transparent ? "transparent" : "opaque" };
  const t0 = Date.now();
  const res = await fetch(ENDPOINT, { method: "POST", headers: { Authorization: `Key ${KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    await refund();
    throw new Error(`${name}: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  if (!res.ok || !json.images?.length) {
    await refund();
    throw new Error(`${name}: HTTP ${res.status} ${JSON.stringify(json).slice(0, 400)}`);
  }
  await mkdir(outDir, { recursive: true });
  const files = [];
  for (let i = 0; i < json.images.length; i++) {
    const img = json.images[i];
    const r = await fetch(img.url);
    const buf = Buffer.from(await r.arrayBuffer());
    const file = path.join(outDir, `${name}${json.images.length > 1 ? `-${i + 1}` : ""}.${format}`);
    await writeFile(file, buf);
    files.push(file);
  }
  const total = await withLedger((l) => {
    const i = l.entries.findIndex((e) => e.name === name && e.reserved);
    const entry = { name, size, quality, transparent, n, cost: est, seconds: Math.round((Date.now() - t0) / 1000), when: new Date().toISOString(), files };
    if (i >= 0) l.entries[i] = entry;
    else l.entries.push(entry);
    return spent(l);
  });
  console.log(`✓ ${name} ${size} ${quality}${transparent ? " transparent" : ""} ≈ ${est.toFixed(3)} $ (gesamt ${total.toFixed(2)} $) → ${files.map((f) => path.basename(f)).join(", ")}`);
  return files;
}

if (cmd === "gen") {
  await gen({ name: opt.name, prompt: opt.prompt, size: opt.size, quality: opt.quality, transparent: opt.transparent === "true", n: Number(opt.n ?? 1), format: opt.format }, Number(opt.budget ?? 9));
} else if (cmd === "batch") {
  const spec = JSON.parse(await readFile(pos[0], "utf8"));
  const only = opt.only ? new Set(opt.only.split(",")) : null;
  const budget = Number(opt.budget ?? 9);
  const { existsSync } = await import("node:fs");
  let jobs = spec.jobs.filter((j) => !only || only.has(j.name));
  if (opt.force !== "true") {
    const have = jobs.filter((j) => existsSync(path.join(outDir, `${j.name}.${j.format ?? "png"}`)));
    if (have.length) console.log(`übersprungen (vorhanden): ${have.map((j) => j.name).join(", ")}`);
    // vorhandene Dateien im Ledger nachtragen (Kostenschätzung), falls dort noch nicht verbucht
    await withLedger((l) => {
      for (const j of have) {
        if (l.entries.some((e) => e.name === j.name)) continue;
        const [w, h] = (j.size ?? "1024x1024").split("x").map(Number);
        l.entries.push({ name: j.name, size: j.size ?? "1024x1024", quality: j.quality ?? "high", transparent: !!j.transparent, n: 1, cost: estimate(w, h, j.quality ?? "high"), imported: true, files: [] });
      }
    });
    jobs = jobs.filter((j) => !have.includes(j));
  }
  const par = Number(opt.par ?? 6);
  let next = 0;
  const failures = [];
  await Promise.all(
    Array.from({ length: Math.min(par, jobs.length) }, async () => {
      while (next < jobs.length) {
        const j = jobs[next++];
        const style = (j.style && spec.styles?.[j.style]) ?? spec.style ?? "";
        try {
          await gen({ ...j, prompt: `${style ? style + " " : ""}${j.prompt}` }, budget);
        } catch (e) {
          failures.push(j.name);
          console.error(`✗ ${j.name}: ${e.message}`);
        }
      }
    }),
  );
  if (failures.length) console.error(`Fehlgeschlagen: ${failures.join(", ")}`);
} else if (cmd === "ledger") {
  const l = await ledger();
  for (const e of l.entries) console.log(`${e.name.padEnd(28)} ${e.size.padEnd(10)} ${e.quality.padEnd(6)} ${e.cost.toFixed(3)} $`);
  console.log(`Summe (geschätzt): ${spent(l).toFixed(2)} $`);
} else {
  console.error("Verwendung: gen | batch <json> | ledger  (siehe Kopfkommentar)");
  process.exit(1);
}
