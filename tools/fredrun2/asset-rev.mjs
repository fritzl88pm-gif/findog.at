#!/usr/bin/env node
/**
 * Asset-Revisionen für public/fredrun2 (Cache-Busting).
 *
 * Die Dateien unter /fredrun2/* werden vom Browser bis zu einen Tag ungeprüft aus dem Cache bedient (next.config.ts).
 * Ohne Versionierung sähen wiederkehrende Spieler nach einem Update alte Manifeste (→ neue Props „ohne Textur“).
 * Darum hängt der Client jeder Asset-URL `?v=<Revision>` an (src/game/fredrun2/asset-rev.ts). Die Revision ist ein
 * Inhalts-Hash je Gruppe (erstes Verzeichnis unter public/fredrun2: chars, props, worlds, audio, previews, sonst „root“) –
 * eine Änderung an den Props lädt so nicht auch die Musik neu.
 *
 *   node tools/fredrun2/asset-rev.mjs           schreibt src/game/fredrun2/asset-rev.generated.ts neu
 *   node tools/fredrun2/asset-rev.mjs --check   Exit-Code 1, wenn die Datei veraltet ist (auch als Test: asset-rev.test.ts)
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const ASSETS = path.join(REPO, "public/fredrun2");
const OUT = path.join(REPO, "src/game/fredrun2/asset-rev.generated.ts");

/** Alle Dateien unterhalb von dir (sortiert, relativ, mit „/“). */
function walk(dir, rel = "") {
  const out = [];
  for (const e of readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(dir, r));
    else if (e.name !== ".DS_Store") out.push(r);
  }
  return out;
}

export function computeRevs(root = ASSETS) {
  const groups = new Map();
  for (const rel of walk(root)) {
    const g = rel.includes("/") ? rel.slice(0, rel.indexOf("/")) : "root";
    if (!groups.has(g)) groups.set(g, createHash("sha1"));
    const h = groups.get(g);
    h.update(rel);
    h.update("\0");
    h.update(readFileSync(path.join(root, rel)));
    h.update("\0");
  }
  const revs = {};
  for (const g of [...groups.keys()].sort()) revs[g] = groups.get(g).digest("hex").slice(0, 8);
  return revs;
}

export function render(revs) {
  const body = Object.entries(revs)
    .map(([g, v]) => `  ${g}: "${v}",`)
    .join("\n");
  return (
    `// GENERIERT von tools/fredrun2/asset-rev.mjs – nicht von Hand ändern (nach Änderungen an public/fredrun2 neu erzeugen).\n` +
    `export const ASSET_REVS: Readonly<Record<string, string>> = {\n${body}\n};\n`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const next = render(computeRevs());
  if (process.argv.includes("--check")) {
    const cur = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
    if (cur !== next) {
      console.error("asset-rev.generated.ts ist veraltet – `node tools/fredrun2/asset-rev.mjs` ausführen.");
      process.exit(1);
    }
    console.log("asset-rev.generated.ts aktuell");
  } else {
    writeFileSync(OUT, next);
    console.log(next);
  }
}
