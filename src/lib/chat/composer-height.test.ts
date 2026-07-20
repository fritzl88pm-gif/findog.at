import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  autosizeComposer,
  clampComposerHeight,
  COMPOSER_MAX_HEIGHT,
  COMPOSER_MIN_HEIGHT,
  resetComposerHeight,
} from "@/lib/chat/composer-height";

const cssSource = readFileSync(
  fileURLToPath(new URL("../../app/globals.css", import.meta.url)),
  "utf8",
);

const componentSource = readFileSync(
  fileURLToPath(
    new URL("../../components/fred-native-chat-view.tsx", import.meta.url),
  ),
  "utf8",
);

describe("clampComposerHeight", () => {
  it("caps the composer height at 120px", () => {
    expect(COMPOSER_MAX_HEIGHT).toBe(120);
  });

  it("uses the minimum height for short content", () => {
    expect(clampComposerHeight(COMPOSER_MIN_HEIGHT - 12)).toBe(COMPOSER_MIN_HEIGHT);
  });

  it("preserves a content height between the limits", () => {
    expect(clampComposerHeight(80)).toBe(80);
  });

  it("caps long content at COMPOSER_MAX_HEIGHT", () => {
    expect(clampComposerHeight(600)).toBe(COMPOSER_MAX_HEIGHT);
    expect(clampComposerHeight(2048)).toBe(COMPOSER_MAX_HEIGHT);
  });
});

describe("resetComposerHeight", () => {
  it("resets a stale 240px height to 48px even when composer text state would not change", () => {
    const textarea = {
      style: { height: "240px" },
      scrollHeight: 240,
    } as unknown as HTMLTextAreaElement;
    resetComposerHeight(textarea);
    expect(textarea.style.height).toBe(`${COMPOSER_MIN_HEIGHT}px`);
  });
});

describe("autosizeComposer", () => {
  it("clamps small scrollHeight to COMPOSER_MIN_HEIGHT", () => {
    const textarea = { style: { height: "" }, scrollHeight: 10 } as HTMLTextAreaElement;
    autosizeComposer(textarea);
    expect(textarea.style.height).toBe(`${COMPOSER_MIN_HEIGHT}px`);
  });

  it("caps a large scrollHeight at COMPOSER_MAX_HEIGHT", () => {
    const textarea = { style: { height: "" }, scrollHeight: 600 } as HTMLTextAreaElement;
    autosizeComposer(textarea);
    expect(textarea.style.height).toBe(`${COMPOSER_MAX_HEIGHT}px`);
  });

  it("preserves an intermediate scrollHeight", () => {
    const textarea = { style: { height: "" }, scrollHeight: 80 } as HTMLTextAreaElement;
    autosizeComposer(textarea);
    expect(textarea.style.height).toBe("80px");
  });
});

describe("composer textarea source assertions", () => {
  it("starts with one visible text row (rows=1)", () => {
    const textareaMatch = componentSource.match(/rows\s*=\s*\{?\d+\}?/u);
    expect(textareaMatch).not.toBeNull();
    expect(textareaMatch![0]).toMatch(/1/u);
    expect(textareaMatch![0]).not.toMatch(/2/u);
  });

  it("caps .composer textarea at 120px in globals.css", () => {
    const blockStart = cssSource.indexOf(".composer textarea");
    expect(blockStart).not.toBe(-1);
    const blockEnd = cssSource.indexOf("}", blockStart);
    const block = cssSource.slice(blockStart, blockEnd);
    expect(block).toMatch(/max-height\s*:\s*120px/u);
  });

  it("scrolls overflowing .composer textarea content instead of hiding it", () => {
    const blockStart = cssSource.indexOf(".composer textarea");
    expect(blockStart).not.toBe(-1);
    const blockEnd = cssSource.indexOf("}", blockStart);
    const block = cssSource.slice(blockStart, blockEnd);
    expect(block).toMatch(/overflow-y\s*:\s*auto/u);
    expect(block).not.toMatch(/overflow-y\s*:\s*hidden/u);
  });

  it("disables height transitions so autosizing can shrink synchronously", () => {
    const blockStart = cssSource.indexOf(".composer textarea");
    expect(blockStart).not.toBe(-1);
    const blockEnd = cssSource.indexOf("}", blockStart);
    const block = cssSource.slice(blockStart, blockEnd);
    expect(block).toMatch(/transition\s*:\s*none/u);
  });

  it("resets the composer height immediately after clearing on submit", () => {
    expect(componentSource).toMatch(
      /setComposer\(""\);\s*resetComposerHeight\(composerRef\.current\);/u,
    );
  });
});
