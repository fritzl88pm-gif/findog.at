import { describe, expect, it } from "vitest";

import {
  MAINTENANCE_RETRY_AFTER_SECONDS,
  buildMaintenanceHtml,
} from "@/lib/maintenance-mode";
import { GET } from "./route";

describe("GET /maintenance", () => {
  it("returns the complete dedicated maintenance page", async () => {
    const response = GET();
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).toBe(buildMaintenanceHtml());
    expect(body.length).toBeGreaterThan(0);
    expect(body).toContain("Wir sind gleich wieder da.");
    expect(body).toContain("Findog/Fred wird gerade gewartet. Bitte versuche es später noch einmal.");
    expect(body).toContain('<img src="/fred-maintenance.png"');
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Retry-After")).toBe(String(MAINTENANCE_RETRY_AFTER_SECONDS));
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });
});
