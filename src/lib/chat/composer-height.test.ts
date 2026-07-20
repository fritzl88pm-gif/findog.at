import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  autosizeComposer,
  clampComposerHeight,
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
  it("uses the minimum height for short content", () => {
    expect(clampComposerHeight(COMPOSER_MIN_HEIGHT - 12)).toBe(COMPOSER_MIN_HEIGHT);
  });

  it("preserves a content height between the limits", () => {
    expect(clampComposerHeight(80)).toBe(80);
  });

  it("passes through long content without capping", () => {
    // No maximum cap — long content grows unbounded.
    expect(clampComposerHeight(600)).toBe(600);
    expect(clampComposerHeight(2048)).toBe(2048);
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

  it("grows to large scrollHeight without capping", () => {
    const textarea = { style: { height: "" }, scrollHeight: 600 } as HTMLTextAreaElement;
    autosizeComposer(textarea);
    expect(textarea.style.height).toBe("600px");
  });

  it("preserves an intermediate scrollHeight", () => {
    const textarea = { style: { height: "" }, scrollHeight: 80 } as HTMLTextAreaElement;
    autosizeComposer(textarea);
    expect(textarea.style.height).toBe("80px");
  });
});

describe("composer textarea source assertions", () => {
  it("starts with one visible text row (rows=1)", () => {
    // The <textarea> in the component should have rows={1} so it starts
    // at exactly one line instead of two.
    const textareaMatch = componentSource.match(/rows\s*=\s*\{?\d+\}?/u);
    expect(textareaMatch).not.toBeNull();
    // Accept either rows={1} or rows="1" or rows=1
    expect(textareaMatch![0]).toMatch(/1/u);
    expect(textareaMatch![0]).not.toMatch(/2/u);
  });

  it("has no max-height on .composer textarea in globals.css", () => {
    // Find the .composer textarea rule block and ensure no max-height
    const blockStart = cssSource.indexOf(".composer textarea");
    expect(blockStart).not.toBe(-1);
    const blockEnd = cssSource.indexOf("}", blockStart);
    const block = cssSource.slice(blockStart, blockEnd);
    expect(block).not.toMatch(/max-height/u);
  });

  it("does not have overflow-y: auto on .composer textarea (uses hidden)", () => {
    const blockStart = cssSource.indexOf(".composer textarea");
    expect(blockStart).not.toBe(-1);
    const blockEnd = cssSource.indexOf("}", blockStart);
    const block = cssSource.slice(blockStart, blockEnd);
    expect(block).not.toMatch(/overflow-y\s*:\s*auto/u);
    expect(block).toMatch(/overflow-y\s*:\s*hidden/u);
  });
});
