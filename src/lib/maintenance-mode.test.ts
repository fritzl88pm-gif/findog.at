import { afterEach, describe, expect, it } from "vitest";

import { parseMaintenanceMode } from "./maintenance-mode";

describe("parseMaintenanceMode", () => {
  afterEach(() => {
    delete process.env.FINDOG_MAINTENANCE_MODE;
  });

  it("accepts only trimmed, case-insensitive enabled values", () => {
    expect(parseMaintenanceMode(undefined)).toBe(false);
    expect(parseMaintenanceMode("")).toBe(false);
    expect(parseMaintenanceMode(" ")).toBe(false);
    expect(parseMaintenanceMode("1")).toBe(true);
    expect(parseMaintenanceMode(" true ")).toBe(true);
    expect(parseMaintenanceMode("ON")).toBe(true);
    expect(parseMaintenanceMode("On")).toBe(true);
    expect(parseMaintenanceMode("yes")).toBe(false);
    expect(parseMaintenanceMode("enabled")).toBe(false);
    expect(parseMaintenanceMode("0")).toBe(false);
    expect(parseMaintenanceMode("FALSE")).toBe(false);
    expect(parseMaintenanceMode("off")).toBe(false);
  });

  it("reads the runtime environment without caching", () => {
    process.env.FINDOG_MAINTENANCE_MODE = "on";
    expect(parseMaintenanceMode(process.env.FINDOG_MAINTENANCE_MODE)).toBe(true);

    process.env.FINDOG_MAINTENANCE_MODE = "off";
    expect(parseMaintenanceMode(process.env.FINDOG_MAINTENANCE_MODE)).toBe(false);
  });
});
