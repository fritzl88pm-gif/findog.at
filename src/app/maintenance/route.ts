import { NextResponse } from "next/server";

import {
  MAINTENANCE_RETRY_AFTER_SECONDS,
  buildMaintenanceHtml,
} from "@/lib/maintenance-mode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(): NextResponse {
  return new NextResponse(buildMaintenanceHtml(), {
    status: 503,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      "Retry-After": String(MAINTENANCE_RETRY_AFTER_SECONDS),
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
