export function createWorkerHealth(now = Date.now) {
  const lanes = new Map<string, { at: number; healthy: boolean }>();
  let fatal = false;
  let maintenance = false;
  return {
    record(lane: "generation" | "control", healthy: boolean) {
      lanes.set(lane, { at: now(), healthy });
    },
    fail() { fatal = true; },
    /** Generation is paused for maintenance; this does not affect health. */
    setMaintenance(active: boolean) { maintenance = active; },
    isMaintenance() { return maintenance; },
    isHealthy() {
      return !fatal && ["generation", "control"].every((lane) => {
        const state = lanes.get(lane);
        return state?.healthy === true && now() - state.at < 90_000;
      });
    },
  };
}
