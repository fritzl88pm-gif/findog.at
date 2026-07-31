#!/usr/bin/env node
import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const watch = process.argv.includes("--watch");

/** @type {esbuild.BuildOptions} */
const config = {
  entryPoints: [resolve(root, "src/workers/telegram.ts")],
  outfile: resolve(root, "dist/telegram-worker.mjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  minify: false,
  sourcemap: true,
  external: [],
  alias: {
    "@": resolve(root, "src"),
  },
  banner: {
    js: `import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
`,
  },
};

if (watch) {
  const ctx = await esbuild.context(config);
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await esbuild.build(config);
  console.log("Build complete: dist/telegram-worker.mjs");
}
