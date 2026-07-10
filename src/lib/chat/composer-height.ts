export const COMPOSER_MIN_HEIGHT = 48;
export const COMPOSER_MAX_HEIGHT = 240;

export function clampComposerHeight(contentHeight: number): number {
  return Math.min(
    COMPOSER_MAX_HEIGHT,
    Math.max(COMPOSER_MIN_HEIGHT, contentHeight),
  );
}
