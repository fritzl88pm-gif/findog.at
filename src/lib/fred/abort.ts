export function abortFredRequest(ref: { current: AbortController | null }): void {
  const controller = ref.current;
  ref.current = null;
  controller?.abort();
}

export function beginFredRun(ref: { current: number }): number {
  ref.current += 1;
  return ref.current;
}

export function invalidateFredRun(ref: { current: number }): void {
  ref.current += 1;
}

export function isCurrentFredRun(ref: { current: number }, runId: number): boolean {
  return ref.current === runId;
}
