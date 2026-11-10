import { NextResponse, type NextRequest } from "next/server";

import {
  MAINTENANCE_BYPASS_COOKIE,
  MAINTENANCE_BYPASS_MAX_AGE_SECONDS,
  isValidMaintenanceBypassToken,
} from "@/lib/maintenance-mode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: NextRequest): NextResponse {
  const token = request.nextUrl.searchParams.get("token");
  if (!isValidMaintenanceBypassToken(token)) {
    return new NextResponse("Not Found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  // Relative Location: behind the proxy request.url is the internal origin (localhost:3000).
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: "/", "Cache-Control": "no-store" },
  });
  response.cookies.set(MAINTENANCE_BYPASS_COOKIE, token as string, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAINTENANCE_BYPASS_MAX_AGE_SECONDS,
  });
  return response;
}
