import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

import { GET } from "./route";

const token = "t".repeat(40);

function get(query: string): ReturnType<typeof GET> {
  return GET(new NextRequest(new URL(`/maintenance/bypass${query}`, "https://findog.at")));
}

describe("GET /maintenance/bypass", () => {
  afterEach(() => {
    delete process.env.FINDOG_MAINTENANCE_BYPASS_TOKEN;
  });

  it("sets an HttpOnly bypass cookie and redirects home for the right token", () => {
    process.env.FINDOG_MAINTENANCE_BYPASS_TOKEN = token;
    const response = get(`?token=${token}`);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://findog.at/");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`findog_maintenance_bypass=${token}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
  });

  it("returns 404 without setting a cookie for a wrong or missing token", () => {
    process.env.FINDOG_MAINTENANCE_BYPASS_TOKEN = token;
    for (const query of ["", "?token=wrong"]) {
      const response = get(query);
      expect(response.status).toBe(404);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });
});
