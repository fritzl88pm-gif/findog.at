import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  fileURLToPath(new URL("../../app/page.tsx", import.meta.url)),
  "utf8",
);

function composerSource(): string {
  const start = pageSource.indexOf('<form className="composer"');
  const end = pageSource.indexOf("\n          </form>", start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return pageSource.slice(start, end).replace(/\s+/g, " ");
}

describe("composer public UI", () => {
  it("hides attachment file inputs from keyboard and assistive technology", () => {
    const composer = composerSource();

    for (const inputRef of ["pdfInputRef", "imageInputRef"]) {
      const input = composer.match(
        new RegExp(`<input[^>]*ref=\\{${inputRef}\\}[^>]*/>`),
      )?.[0];

      expect(input).toBeDefined();
      expect(input).toContain("tabIndex={-1}");
      expect(input).toContain("aria-hidden={true}");
    }
  });

  it("exposes only the two real attachment actions behind one compact trigger", () => {
    const composer = composerSource();

    expect(composer).toContain('aria-label="Anhänge hinzufügen"');
    expect(composer).toContain('role="menu"');
    expect(composer.match(/>\s*PDF anhängen\s*</g)).toHaveLength(1);
    expect(composer.match(/>\s*Bild anhängen\s*</g)).toHaveLength(1);
    expect(composer).not.toContain("PDFs anhängen");
    expect(composer).not.toContain("Bilder anhängen");
  });

  it("renders exactly the available real models in an accessible custom menu", () => {
    const composer = composerSource();

    expect(composer).toContain("AVAILABLE_MODELS.map((model) => (");
    expect(composer).toContain('role="menuitemradio"');
    expect(composer.match(/DeepSeek v4 Flash/g)).toHaveLength(1);
    expect(composer.match(/DeepSeek v4 Pro/g)).toHaveLength(1);
    expect(composer).not.toContain('id="composer-model"');
    expect(composer).not.toMatch(/<select\b/);
    expect(composer).not.toMatch(/>Modell</);
  });
});
