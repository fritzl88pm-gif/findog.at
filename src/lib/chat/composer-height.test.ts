import { describe, expect, it } from "vitest";

import {
  autosizeComposer,
  clampComposerHeight,
  COMPOSER_MAX_HEIGHT,
  COMPOSER_MIN_HEIGHT,
  resetComposerHeight,
} from "@/lib/chat/composer-height";

describe("clampComposerHeight", () => {
  it("uses the minimum height for short content", () => {
    expect(clampComposerHeight(COMPOSER_MIN_HEIGHT - 12)).toBe(COMPOSER_MIN_HEIGHT);
  });

  it("preserves a content height between the limits", () => {
    expect(clampComposerHeight(80)).toBe(80);
  });

  it("uses the maximum height for long content", () => {
    expect(clampComposerHeight(COMPOSER_MAX_HEIGHT + 80)).toBe(COMPOSER_MAX_HEIGHT);
  });

  it("clamps to exactly 120px as the new maximum", () => {
    expect(COMPOSER_MAX_HEIGHT).toBe(120);
    expect(clampComposerHeight(144)).toBe(120);
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

  it("clamps large scrollHeight to COMPOSER_MAX_HEIGHT", () => {
    const textarea = { style: { height: "" }, scrollHeight: 500 } as HTMLTextAreaElement;
    autosizeComposer(textarea);
    expect(textarea.style.height).toBe(`${COMPOSER_MAX_HEIGHT}px`);
  });

  it("preserves an intermediate scrollHeight", () => {
    const textarea = { style: { height: "" }, scrollHeight: 80 } as HTMLTextAreaElement;
    autosizeComposer(textarea);
    expect(textarea.style.height).toBe("80px");
  });
});
