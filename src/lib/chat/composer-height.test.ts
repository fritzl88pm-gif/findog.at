import { describe, expect, it } from "vitest";

import {
  clampComposerHeight,
  COMPOSER_MAX_HEIGHT,
  COMPOSER_MIN_HEIGHT,
} from "@/lib/chat/composer-height";

describe("clampComposerHeight", () => {
  it("uses the minimum height for short content", () => {
    expect(clampComposerHeight(COMPOSER_MIN_HEIGHT - 12)).toBe(COMPOSER_MIN_HEIGHT);
  });

  it("preserves a content height between the limits", () => {
    expect(clampComposerHeight(144)).toBe(144);
  });

  it("uses the maximum height for long content", () => {
    expect(clampComposerHeight(COMPOSER_MAX_HEIGHT + 80)).toBe(COMPOSER_MAX_HEIGHT);
  });
});
