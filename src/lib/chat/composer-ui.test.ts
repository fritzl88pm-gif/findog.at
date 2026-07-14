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

  it("accepts pasted clipboard images through the existing image attachment pipeline", () => {
    const composer = composerSource();
    const attachmentHandlers = pageSource.slice(
      pageSource.indexOf("function addImageAttachments("),
      pageSource.indexOf("function openFormsView("),
    );

    expect(composer).toContain("onPaste={handleComposerPaste}");
    expect(attachmentHandlers).toContain("clipboardImageFiles(event.clipboardData.items)");
    expect(attachmentHandlers.match(/addImageAttachments\(files\)/g)).toHaveLength(1);
    expect(attachmentHandlers).not.toContain("preventDefault");
  });

  it("renders only centrally enabled model descriptors in an accessible custom menu", () => {
    const composer = composerSource();

    expect(composer).toContain("enabledModels.map((model) => (");
    expect(composer).toContain("{model.label}");
    expect(composer).toContain('updateSetting("model", model.id)');
    expect(composer).toContain('role="menuitemradio"');
    expect(composer).not.toContain("AVAILABLE_MODELS");
    expect(composer).not.toContain('model === "deepseek-v4-pro"');
    expect(composer).not.toContain('id="composer-model"');
    expect(composer).not.toMatch(/<select\b/);
    expect(composer).not.toMatch(/>Modell</);
  });
});
