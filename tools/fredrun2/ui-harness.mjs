#!/usr/bin/env node
/**
 * UI-Harness für Fredrun 2.0: bündelt src/components/fredrun2/FredRun2.tsx per esbuild aus dem AKTUELLEN Arbeitsbaum
 * und liefert die Seite unter /fredrun2 plus public/ über einen kleinen Static-Server – ohne `next build`/`next dev`.
 * Damit laufen Playwright-Prüfungen (Layout-Probe, Fokus-Probe, Screenshots, e2e.mjs) gegen den Stand der Quellen.
 *
 *   node tools/fredrun2/ui-harness.mjs --port 3130
 *   node tools/fredrun2/e2e.mjs --base http://localhost:3130            (Menü-Teil und Lauf)
 *
 * Optionen:
 *   --port <n>             Port (Standard 3130)
 *   --host <h>             Bind-Adresse (Standard 127.0.0.1)
 *   --watch                bei jedem Laden von /fredrun2 neu bündeln (Quellen ändern, Seite neu laden); bei Fehlern bleibt der letzte
 *                          gute Stand erhalten (andere Agenten/Pakete bearbeiten parallel Dateien)
 *   --component-dir <dir>  alternatives Verzeichnis mit FredRun2.tsx samt CSS-Modulen (A/B-Vergleich gegen einen früheren Stand,
 *                          z. B. `git archive <rev> src/components/fredrun2 | tar -x -C <ziel>`); `@/…` zeigt weiter auf src
 *   --supabase             echten Supabase-Browserclient bündeln (Dummy-Konfiguration http://localhost:54321 / "dummy", wie in
 *                          board-e2e.mjs verlangt) statt des Ersatzes ohne Sitzung
 *
 * Seite: /fredrun2?debug=1 setzt window.__fr2.game wie die echte Seite. Zusätzlich:
 *   ?embedded=1[&w=<px>]   rendert <FredRun2 embedded /> in einem Container (Standard: volle Breite, w = feste Breite in px)
 *
 * Gebündelt wird alles im Speicher: es werden keine Dateien geschrieben (kein eigener TMPDIR nötig, keine Kollision zwischen
 * mehreren Harness-Instanzen auf verschiedenen Ports).
 * Ersetzt: next/link (schlichter <a>) und, ohne --supabase, @/lib/supabase/browser (nicht konfiguriert -> keine Sitzung, keine globale Liste).
 * /api/* antwortet 404; wer die Bestenlisten-API braucht, fängt sie mit page.route ab (siehe board-e2e.mjs).
 */
import { context } from "esbuild";
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]);
    return acc;
  }, []),
);
const port = Number(args.port ?? 3130);
const host = args.host ?? "127.0.0.1";
const watch = args.watch === "true";
const withSupabase = args.supabase === "true";
const componentDir = path.resolve(args["component-dir"] ?? path.join(root, "src/components/fredrun2"));
const publicDir = path.join(root, "public");

/** Ersatzmodule (Namespace "stub"): so wenig wie möglich von der Next-/Supabase-Laufzeit nachbauen. */
const STUBS = {
  "next/link": `import { createElement, forwardRef } from "react";
export default forwardRef(function Link({ href, prefetch, replace, scroll, children, ...rest }, ref) {
  return createElement("a", { ...rest, href: typeof href === "string" ? href : String(href?.pathname ?? "/"), ref }, children);
});`,
  "@/lib/supabase/browser": `export function isSupabaseBrowserConfigured() { return false; }
export function getSupabaseBrowserClient() { return null; }`,
};

const stubPlugin = {
  name: "fr2-ui-stubs",
  setup(b) {
    b.onResolve({ filter: withSupabase ? /^next\/link$/ : /^(next\/link|@\/lib\/supabase\/browser)$/ }, (a) => ({ path: a.path, namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({ contents: STUBS[a.path], loader: "js", resolveDir: root }));
  },
};

const entry = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import "@/app/globals.css";
import FredRun2 from ${JSON.stringify(path.join(componentDir, "FredRun2.tsx"))};

const q = new URLSearchParams(location.search);
const mount = document.getElementById("root");
let node = createElement(FredRun2, q.get("embedded") ? { embedded: true } : {});
if (q.get("embedded")) {
  const w = Number(q.get("w") ?? 0);
  node = createElement("div", { style: { width: w > 0 ? w + "px" : "100%", maxWidth: "100%", margin: "0 auto", padding: "0" } }, node);
}
createRoot(mount).render(node);
`;

const ctx = await context({
  stdin: { contents: entry, resolveDir: root, loader: "tsx", sourcefile: "ui-harness-entry.tsx" },
  bundle: true,
  format: "iife",
  outfile: path.join(root, "__ui-harness__/app.js"),
  write: false,
  sourcemap: "inline",
  target: "es2022",
  jsx: "automatic",
  tsconfig: path.join(root, "tsconfig.json"),
  nodePaths: [path.join(root, "node_modules")],
  loader: { ".css": "css", ".module.css": "local-css" },
  define: {
    "process.env.NODE_ENV": '"production"',
    ...(withSupabase ? { "process.env.NEXT_PUBLIC_SUPABASE_URL": '"http://localhost:54321"', "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '"dummy"' } : {}),
  },
  plugins: [stubPlugin],
  logLevel: "silent",
});

/** @type {{ js: string; css: string }} */
let bundle = { js: "", css: "" };
let building = Promise.resolve();

async function rebuild() {
  const res = await ctx.rebuild();
  const js = res.outputFiles.find((f) => f.path.endsWith(".js"));
  const css = res.outputFiles.find((f) => f.path.endsWith(".css"));
  bundle = { js: js?.text ?? "", css: css?.text ?? "" };
}

try {
  await rebuild();
} catch (e) {
  console.error("ui-harness: Build fehlgeschlagen\n" + (e.errors ? e.errors.map((x) => `${x.location?.file}:${x.location?.line} ${x.text}`).join("\n") : e));
  process.exit(1);
}

const PAGE = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#05060f">
<title>Fredrun 2.0</title>
<link rel="icon" href="/favicon.png">
<link rel="stylesheet" href="/__fr2ui/app.css">
</head>
<body>
<div id="root"></div>
<script src="/__fr2ui/app.js"></script>
</body>
</html>`;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function send(res, status, type, body, extra = {}) {
  res.writeHead(status, { "content-type": type, "content-length": Buffer.byteLength(body), "cache-control": "no-cache", ...extra });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://harness");
    const pathname = decodeURIComponent(url.pathname);
    const head = req.method === "HEAD";
    if (req.method !== "GET" && !head) return send(res, 405, "text/plain", "method not allowed");
    if (pathname === "/") {
      res.writeHead(302, { location: "/fredrun2" });
      return res.end();
    }
    if (pathname === "/fredrun2" || pathname === "/fredrun2/") {
      if (watch) {
        building = building.then(rebuild).catch((e) => console.error("ui-harness: Neubuild fehlgeschlagen (alter Stand bleibt)\n" + (e.errors ? e.errors.map((x) => `${x.location?.file}:${x.location?.line} ${x.text}`).join("\n") : e)));
        await building;
      }
      return send(res, 200, MIME[".html"], head ? "" : PAGE);
    }
    if (pathname === "/__fr2ui/app.js") return send(res, 200, MIME[".js"], head ? "" : bundle.js);
    if (pathname === "/__fr2ui/app.css") return send(res, 200, MIME[".css"], head ? "" : bundle.css);
    if (pathname.startsWith("/api/")) return send(res, 404, "application/json", JSON.stringify({ error: "ui-harness: keine API" }));
    // public/ (nur darunter; kein Verzeichnis-Ausbruch)
    const file = path.normalize(path.join(publicDir, pathname));
    if (!file.startsWith(publicDir + path.sep)) return send(res, 403, "text/plain", "forbidden");
    const st = await stat(file).catch(() => null);
    if (!st || !st.isFile()) return send(res, 404, "text/plain", "not found");
    const data = await readFile(file);
    const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    if (range && data.length) {
      const start = range[1] === "" ? Math.max(0, data.length - Number(range[2])) : Number(range[1]);
      const end = range[1] === "" || range[2] === "" ? data.length - 1 : Math.min(Number(range[2]), data.length - 1);
      if (start > end || start >= data.length) {
        res.writeHead(416, { "content-range": `bytes */${data.length}` });
        return res.end();
      }
      res.writeHead(206, { "content-type": type, "content-length": end - start + 1, "content-range": `bytes ${start}-${end}/${data.length}`, "accept-ranges": "bytes", "cache-control": "no-cache" });
      return res.end(head ? undefined : data.subarray(start, end + 1));
    }
    res.writeHead(200, { "content-type": type, "content-length": data.length, "accept-ranges": "bytes", "cache-control": "no-cache" });
    res.end(head ? undefined : data);
  } catch (e) {
    send(res, 500, "text/plain", String(e));
  }
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, host, resolve);
});
console.log(`ui-harness: http://${host === "127.0.0.1" ? "localhost" : host}:${port}/fredrun2?debug=1  (${watch ? "watch" : "einmal gebündelt"}${withSupabase ? ", Supabase-Dummy" : ""}, Komponenten: ${path.relative(root, componentDir) || "."})`);

const shutdown = async () => {
  server.close();
  await ctx.dispose();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
