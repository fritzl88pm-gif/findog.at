// Kept free of Next.js imports so the standalone Telegram worker bundle can
// read the same switch as the web application.
export const MAINTENANCE_ENV_VAR = "FINDOG_MAINTENANCE_MODE";

const ENABLED_MAINTENANCE_VALUES = new Set(["1", "true", "on"]);

export function parseMaintenanceMode(value: string | undefined): boolean {
  return value !== undefined && ENABLED_MAINTENANCE_VALUES.has(value.trim().toLowerCase());
}

export function isMaintenanceModeEnabled(): boolean {
  return parseMaintenanceMode(process.env[MAINTENANCE_ENV_VAR]);
}
