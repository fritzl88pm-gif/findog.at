import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

import { MAX_FRED_NATIVE_MULTIPART_BYTES } from "@/lib/attachments/fred-upload-limits";
import { MAX_FILE_BYTES } from "@/lib/attachments/validation";
import { buildMaintenanceHtml } from "@/lib/maintenance-mode";
import { MAX_SCANNING_MULTIPART_BYTES } from "@/lib/scanning/config";
import nextConfig from "../next.config";
import { proxy } from "./proxy";

function request(pathname: string): NextRequest {
  return new NextRequest(new URL(pathname, "https://findog.at"));
}

describe("maintenance proxy", () => {
  afterEach(() => {
    delete process.env.FINDOG_MAINTENANCE_MODE;
  });

  it("passes requests through when maintenance is disabled", () => {
    const response = proxy(request("/"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("returns the complete maintenance page directly with a 503 response", async () => {
    process.env.FINDOG_MAINTENANCE_MODE = " TRUE ";
    const url = new URL("/pricing?plan=pro", "https://findog.at");
    const response = proxy(new NextRequest(url));
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).toBe(buildMaintenanceHtml());
    expect(body.length).toBeGreaterThan(0);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Retry-After")).toBe("300");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("returns the exact API maintenance payload", async () => {
    process.env.FINDOG_MAINTENANCE_MODE = "1";
    const response = proxy(request("/api/fred/chat"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Findog/Fred wird gerade gewartet. Bitte versuche es später noch einmal.",
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Retry-After")).toBe("300");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it.each([
    "/api/health",
    "/fred-maintenance.png",
    "/_next/static/chunks/main.js",
    "/maintenance",
    "/api/webhooks/telegram/2c97d568-d0a5-4a64-92e6-97f4d3189dd8",
  ])("keeps %s reachable while maintenance is enabled", (pathname) => {
    process.env.FINDOG_MAINTENANCE_MODE = "on";
    const response = proxy(request(pathname));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });
});

describe("proxy request body buffering", () => {
  it("lets every accepted upload body reach its route handler in full", () => {
    // Next.js cuts proxied request bodies off at this limit (10 MB when unset).
    const limit = nextConfig.experimental?.proxyClientMaxBodySize;

    expect(typeof limit).toBe("number");
    expect(limit).toBeGreaterThanOrEqual(MAX_SCANNING_MULTIPART_BYTES);
    expect(limit).toBeGreaterThanOrEqual(MAX_FRED_NATIVE_MULTIPART_BYTES);
    expect(limit).toBeGreaterThanOrEqual(MAX_FILE_BYTES + 1_024 * 1_024);
  });
});
