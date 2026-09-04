export function createWorkerHealth(now = Date.now) {
  const lanes = new Map<string, { at: number; healthy: boolean }>();
  let fatal = false;
  return {
    record(lane: "generation" | "control", healthy: boolean) {
      lanes.set(lane, { at: now(), healthy });
    },
    fail() { fatal = true; },
    isHealthy() {
      return !fatal && ["generation", "control"].every((lane) => {
        const state = lanes.get(lane);
        return state?.healthy === true && now() - state.at < 90_000;
      });
    },
  };
}
