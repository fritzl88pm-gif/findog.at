import { NextResponse, type NextRequest } from "next/server";

import {
  MAINTENANCE_BYPASS_COOKIE,
  MAINTENANCE_MESSAGE,
  MAINTENANCE_RETRY_AFTER_SECONDS,
  buildMaintenanceHtml,
  isMaintenanceModeEnabled,
  isValidMaintenanceBypassToken,
} from "@/lib/maintenance-mode";

function maintenanceHeaders(contentType?: string): Headers {
  const headers = new Headers();
  if (contentType) headers.set("Content-Type", contentType);
  headers.set("Cache-Control", "no-store");
  headers.set("Retry-After", String(MAINTENANCE_RETRY_AFTER_SECONDS));
  headers.set("X-Robots-Tag", "noindex, nofollow");
  return headers;
}

export function proxy(request: NextRequest): NextResponse {
  if (!isMaintenanceModeEnabled()) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (
    pathname === "/maintenance"
    || pathname === "/maintenance/bypass"
    || pathname === "/fred-maintenance.png"
    || pathname.startsWith("/_next/")
    || pathname === "/api/health"
    || pathname.startsWith("/api/webhooks/telegram/")
  ) {
    return NextResponse.next();
  }

  if (isValidMaintenanceBypassToken(request.cookies.get(MAINTENANCE_BYPASS_COOKIE)?.value)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: MAINTENANCE_MESSAGE },
      { status: 503, headers: maintenanceHeaders() },
    );
  }

  return new NextResponse(buildMaintenanceHtml(), {
    status: 503,
    headers: maintenanceHeaders("text/html; charset=utf-8"),
  });
}
