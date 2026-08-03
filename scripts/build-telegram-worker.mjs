#!/usr/bin/env node
import * as esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const watch = process.argv.includes("--watch");
const outfile = resolve(root, "dist/telegram-worker.mjs");

/** @type {esbuild.BuildOptions} */
const config = {
  entryPoints: [resolve(root, "src/workers/telegram.ts")],
  outfile,
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
    js: `import { createRequire as createNodeRequire } from 'node:module';
const require = createNodeRequire(import.meta.url);
`,
  },
};

if (watch) {
  const ctx = await esbuild.context(config);
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await esbuild.build(config);
  const syntaxCheck = spawnSync(process.execPath, ["--check", outfile], {
    encoding: "utf8",
  });
  if (syntaxCheck.status !== 0) {
    throw new Error(syntaxCheck.stderr || "Telegram worker syntax check failed");
  }
  console.log("Build complete: dist/telegram-worker.mjs");
}
