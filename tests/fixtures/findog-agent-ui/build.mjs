/**
 * Bundles the fixture harness (real components + real stylesheets) into
 * `tests/fixtures/findog-agent-ui/dist`, which the Playwright script serves
 * from a throwaway local HTTP server. Nothing here is part of the Next.js app.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, "../../..");
const outputDirectory = resolve(here, "dist");

await mkdir(outputDirectory, { recursive: true });

await build({
  entryPoints: [resolve(here, "harness.tsx")],
  outfile: resolve(outputDirectory, "harness.js"),
  bundle: true,
  format: "iife",
  jsx: "automatic",
  target: "es2022",
  sourcemap: false,
  loader: { ".css": "css" },
  alias: { "@": resolve(repository, "src") },
  define: { "process.env.NODE_ENV": '"development"' },
  logLevel: "info",
});

await writeFile(
  resolve(outputDirectory, "index.html"),
  [
    "<!doctype html>",
    '<html lang="de">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Findog Agent UI fixture harness</title>",
    '<link rel="stylesheet" href="./harness.css">',
    "<style>#root{display:flex;flex:1;min-width:0;overflow:auto}</style>",
    "</head>",
    "<body>",
    '<main class="app-shell"><div id="root"></div></main>',
    '<script src="./harness.js"></script>',
    "</body>",
    "</html>",
    "",
  ].join("\n"),
);

console.log(`Fixture harness bundled into ${outputDirectory}`);
