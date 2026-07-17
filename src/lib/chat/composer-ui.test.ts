import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  fileURLToPath(new URL("../../app/page.tsx", import.meta.url)),
  "utf8",
);

const cssSource = readFileSync(
  fileURLToPath(new URL("../../app/globals.css", import.meta.url)),
  "utf8",
);

function cssRule(selector: string): string {
  const start = cssSource.indexOf(`${selector} {`);
  const end = cssSource.indexOf("\n}", start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return cssSource.slice(start, end);
}

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

  it("accepts built-in and opaque dynamic model descriptors from authenticated settings", () => {
    const normalizer = pageSource.slice(
      pageSource.indexOf("function normalizeEnabledModelDescriptors("),
      pageSource.indexOf("async function fetchAuthenticatedSettings("),
    );

    expect(normalizer).toContain("(!isSupportedModel(item.id) && !isDynamicModelId(item.id))");
  });

  it("renders only centrally enabled model descriptors in an accessible custom menu", () => {
    const composer = composerSource();

    expect(composer).toContain("enabledModels.map((model) => (");
    expect(composer).toContain("{model.label}");
    expect(composer).toContain('setSettings({ model: model.id, followsDefault: false })');
    expect(composer).toContain('className="composer-model-icon"');
    expect(composer).toContain('role="menuitemradio"');
    expect(composer).not.toContain("AVAILABLE_MODELS");
    expect(composer).not.toContain('model === "deepseek-v4-pro"');
    expect(composer).not.toContain('id="composer-model"');
    expect(composer).not.toMatch(/<select\b/);
    expect(composer).not.toMatch(/>Modell</);
  });
});

describe("composer attachment chips CSS", () => {
  it("renders attachment chips in a single horizontal row without wrapping", () => {
    const chips = cssRule(".attachment-chips");
    expect(chips).toContain("flex-wrap: nowrap");
    expect(chips).toContain("overflow-x: auto");
  });

  it("prevents individual chips from shrinking below their content", () => {
    expect(cssRule(".attachment-chip")).toContain("flex: 0 0 auto");
  });
});

describe("composer submit-reset path", () => {
  it("resets textarea height immediately in handleSubmit after setComposer", () => {
    const handleSubmitBlock = pageSource.slice(
      pageSource.indexOf("async function handleSubmit("),
      pageSource.indexOf("async function handleComposerPaste("),
    );

    const setComposerLine = handleSubmitBlock.indexOf('setComposer("")');
    expect(setComposerLine).toBeGreaterThanOrEqual(0);

    const resetWindow = handleSubmitBlock.slice(setComposerLine, setComposerLine + 120);
    expect(resetWindow).toContain("resetComposerHeight(composerRef.current)");
  });
});

describe("composer retry button", () => {
  it("shows a retry button labeled 'Erneut versuchen' only when lastFailedRequest is set and not sending/deleting", () => {
    const containerStart = pageSource.indexOf('<div className="composer-container">');
    const containerEnd = pageSource.indexOf('<form className="composer"', containerStart);
    const containerContent = pageSource.slice(containerStart, containerEnd);

    expect(containerContent).toContain('Erneut versuchen');
    expect(containerContent).toContain('lastFailedRequest && error === lastFailedRequest.errorMessage');
    expect(containerContent).toContain('!isSending && !isDeleting');
    expect(containerContent).toContain('className="retry-button"');
    expect(containerContent).toContain('onClick={handleRetry}');
  });

  it("stores the prepared request on failure in sendPreparedChatRequest catch", () => {
    const sendBlock = pageSource.slice(
      pageSource.indexOf("async function sendPreparedChatRequest("),
      pageSource.indexOf("async function handleSubmit("),
    );

    expect(sendBlock).toContain("setLastFailedRequest({ request, errorMessage })");
  });

  it("handleRetry calls sendPreparedChatRequest without constructing a user message", () => {
    const retryBlock = pageSource.slice(
      pageSource.indexOf("async function handleRetry("),
      pageSource.indexOf("async function downloadAssistantPdf("),
    );

    expect(retryBlock).toContain("sendPreparedChatRequest(lastFailedRequest.request, accessToken)");
    expect(retryBlock).not.toContain("userMessage");
  });
});
