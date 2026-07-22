import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const pageSource = readFileSync(fileURLToPath(new URL("../app/page.tsx", import.meta.url)), "utf8");
const viewSource = readFileSync(fileURLToPath(new URL("../components/wo-beschluss-view.tsx", import.meta.url)), "utf8");
const sceneSource = readFileSync(fileURLToPath(new URL("../components/wo-beschluss-scene.ts", import.meta.url)), "utf8");
const manifest = JSON.parse(readFileSync(
  fileURLToPath(new URL("../../public/wo-beschluss/manifest.json", import.meta.url)),
  "utf8",
)) as { assets: Record<string, string> };

describe("Wo Beschluss UI surface", () => {
  it("registers the game in expanded and collapsed navigation", () => {
    expect(pageSource).toContain('"wo-beschluss"');
    expect(pageSource).toContain("onClick={openWoBeschlussView}");
    expect(pageSource).toContain('title="Wo Beschluss?"');
    expect(pageSource).toContain('aria-label="Wo Beschluss?"');
    expect(pageSource).toContain('appView === "wo-beschluss"');
    expect(pageSource).toContain("<WoBeschlussView />");
  });

  it("mounts Phaser only on the client and destroys it on unmount", () => {
    expect(viewSource).toContain('import("phaser")');
    expect(viewSource).toContain("game?.destroy(true)");
    expect(viewSource).toContain('aria-live="polite"');
    expect(sceneSource).toContain("applyWoBeschlussHit");
    expect(sceneSource).toContain("WO_BESCHLUSS_ASSETS");
  });

  it("ships exactly the seven runtime sprite sheets with provenance", () => {
    expect(Object.keys(manifest.assets)).toHaveLength(7);
    for (const [name, hash] of Object.entries(manifest.assets)) {
      expect(hash).toMatch(/^[A-F0-9]{64}$/);
      expect(existsSync(fileURLToPath(new URL(`../../public/wo-beschluss/${name}`, import.meta.url)))).toBe(true);
    }
  });
});
