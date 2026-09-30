import { execFileSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { withRev } from "./asset-rev";
import { ASSET_REVS } from "./asset-rev.generated";

describe("Asset-Revisionen", () => {
  it("sind aktuell (node tools/fredrun2/asset-rev.mjs ausführen, wenn public/fredrun2 geändert wurde)", () => {
    const script = path.resolve(__dirname, "../../../tools/fredrun2/asset-rev.mjs");
    expect(() => execFileSync(process.execPath, [script, "--check"], { stdio: "pipe" })).not.toThrow();
  });

  it("deckt alle Asset-Gruppen ab", () => {
    for (const g of ["chars", "props", "worlds", "audio"]) expect(ASSET_REVS[g], g).toMatch(/^[0-9a-f]{8}$/);
  });

  it("hängt die Gruppen-Revision an und fasst fremde URLs nicht an", () => {
    expect(withRev("/fredrun2/props/manifest.json")).toBe(`/fredrun2/props/manifest.json?v=${ASSET_REVS.props}`);
    expect(withRev("/fredrun2/audio/music/wien.mp3")).toBe(`/fredrun2/audio/music/wien.mp3?v=${ASSET_REVS.audio}`);
    expect(withRev("/fredrun2/audio/sfx.mp3?v=abc")).toBe("/fredrun2/audio/sfx.mp3?v=abc");
    expect(withRev("/fredrun2/logo.webp")).toBe(`/fredrun2/logo.webp?v=${ASSET_REVS.root}`);
    expect(withRev("sprites/fred.png")).toBe("sprites/fred.png");
    expect(withRev("/fredrun/x.png")).toBe("/fredrun/x.png");
  });
});
