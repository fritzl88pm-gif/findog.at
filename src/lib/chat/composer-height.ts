export const COMPOSER_MIN_HEIGHT = 48;
export const COMPOSER_MAX_HEIGHT = 120;

export function clampComposerHeight(contentHeight: number): number {
  return Math.min(
    COMPOSER_MAX_HEIGHT,
    Math.max(COMPOSER_MIN_HEIGHT, contentHeight),
  );
}

export function resetComposerHeight(textarea: HTMLTextAreaElement | null): void {
  if (!textarea) return;
  textarea.style.height = `${COMPOSER_MIN_HEIGHT}px`;
}

export function autosizeComposer(textarea: HTMLTextAreaElement): void {
  resetComposerHeight(textarea);
  textarea.style.height = `${clampComposerHeight(textarea.scrollHeight)}px`;
}
