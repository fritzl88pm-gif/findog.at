import { NextResponse, type NextRequest } from "next/server";

import {
  buildMaintenanceApiResponse,
  buildMaintenanceHtml,
  isMaintenanceModeEnabled,
  maintenanceHeaders,
} from "@/lib/maintenance-mode";

// Next.js buffers the body of every request this proxy matches and cuts it off after
// experimental.proxyClientMaxBodySize (10 MB by default) before the route handler reads it.
// The upload routes accept larger multipart bodies, so they bypass the proxy and apply the
// maintenance check themselves; every other path keeps the small buffering cap.
// Next.js reads this config statically, so the matcher must stay a string literal.
export const config = {
  matcher: ["/((?!api/scanning$|api/fred/chat$|api/admin/downloads/documents$).*)"],
};

export function proxy(request: NextRequest): NextResponse {
  if (!isMaintenanceModeEnabled()) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (
    pathname === "/maintenance"
    || pathname === "/fred-maintenance.png"
    || pathname.startsWith("/_next/")
    || pathname === "/api/health"
    || pathname.startsWith("/api/webhooks/telegram/")
  ) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return buildMaintenanceApiResponse();
  }

  return new NextResponse(buildMaintenanceHtml(), {
    status: 503,
    headers: maintenanceHeaders("text/html; charset=utf-8"),
  });
}
