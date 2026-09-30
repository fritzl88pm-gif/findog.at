#!/usr/bin/env node
/**
 * Erzeugt die Vorschaubilder der Welt-Karten (public/fredrun2/previews/<welt>.webp, 640×256) aus dem echten Spiel (headless Chromium).
 *   node tools/fredrun2/previews.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tmp = path.join(process.env.TMPDIR ?? "/tmp", "fr2-previews");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
mkdirSync(path.join(root, "public/fredrun2/previews"), { recursive: true });
// Welt → [Weltmeter (Stufe), Sekunden Bot-Spiel]
const PLAN = { wien: [300, 7], alpen: [80, 7], finanzamt: [140, 7], prater: [330, 7], wachau: [430, 7], cyber: [40, 9] };
for (const [world, [wm, secs]] of Object.entries(PLAN)) {
  execFileSync("node", [path.join(root, "tools/fredrun2/shot.mjs"), "--world", world, "--world-meters", String(wm), "--seconds", String(secs), "--seed", "4", "--clean", "--out", path.join(tmp, "p")], { stdio: "inherit" });
}
execFileSync("python3", [
  "-c",
  `
import glob, os
from PIL import Image
for f in sorted(glob.glob(${JSON.stringify(tmp)} + "/p-*.png")):
    world = os.path.basename(f).split("-")[1]
    im = Image.open(f).convert("RGB")
    w, h = im.size
    # Ausschnitt 5:2 mit Figur/Boden (oben leicht abgeschnitten, HUD-Bereich vermeiden)
    im = im.crop((25, 118, 1255, 610)).resize((640, 256), Image.LANCZOS)
    out = os.path.join(${JSON.stringify(path.join(root, "public/fredrun2/previews"))}, world + ".webp")
    im.save(out, "WEBP", quality=80, method=6)
    print(out, os.path.getsize(out) // 1024, "KB")
`,
], { stdio: "inherit" });
