import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

import { MAX_FRED_NATIVE_MULTIPART_BYTES } from "@/lib/attachments/fred-upload-limits";
import { MAX_FILE_BYTES } from "@/lib/attachments/validation";
import { MAX_FORM_MULTIPART_BYTES } from "@/lib/forms/config";
import { buildMaintenanceHtml } from "@/lib/maintenance-mode";
import { MAX_SCANNING_MULTIPART_BYTES } from "@/lib/scanning/config";
import nextConfig from "../next.config";
import { config, proxy } from "./proxy";

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
    const response = proxy(request("/api/fred/conversations"));

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
  // Next.js buffers the body of every request the proxy matcher selects and cuts it off
  // after experimental.proxyClientMaxBodySize (10 MB when unset) before the route reads it.
  const DEFAULT_PROXY_BODY_LIMIT = 10 * 1_024 * 1_024;

  function proxyRuns(pathname: string): boolean {
    return unstable_doesMiddlewareMatch({ config, nextConfig, url: `https://findog.at${pathname}` });
  }

  it("keeps the default buffering cap instead of raising it for every path", () => {
    expect(nextConfig.experimental?.proxyClientMaxBodySize).toBeUndefined();
    expect(MAX_FORM_MULTIPART_BYTES).toBeLessThanOrEqual(DEFAULT_PROXY_BODY_LIMIT);
  });

  it.each([
    ["/api/scanning", MAX_SCANNING_MULTIPART_BYTES],
    ["/api/fred/chat", MAX_FRED_NATIVE_MULTIPART_BYTES],
    ["/api/admin/downloads/documents", MAX_FILE_BYTES],
  ])("lets %s bypass the proxy so its upload reaches the handler in full", (pathname, maxBytes) => {
    expect(maxBytes).toBeGreaterThan(DEFAULT_PROXY_BODY_LIMIT);
    expect(proxyRuns(pathname)).toBe(false);
  });

  it.each([
    "/",
    "/pricing",
    "/maintenance",
    "/_next/static/chunks/main.js",
    "/api/health",
    "/api/feedback",
    "/api/forms/generate",
    "/api/tools/pdf",
    "/api/webhooks/telegram/2c97d568-d0a5-4a64-92e6-97f4d3189dd8",
    "/api/fred/conversations",
    "/api/fred/chats",
    "/api/fred/chat/extra",
    "/api/scanning/",
    "/api/scanning.json",
    "/api/admin/downloads/categories",
    "/api/admin/downloads/documents/extra",
    "/_next/data/build-id/api/scanning.json",
    "/scanning",
  ])("still runs the proxy for %s", (pathname) => {
    expect(proxyRuns(pathname)).toBe(true);
  });
});
