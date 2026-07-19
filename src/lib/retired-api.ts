import { NextResponse } from "next/server";

export function retiredApiResponse(): NextResponse {
  return NextResponse.json(
    { error: "Dieser Endpunkt wurde durch den WeKnora-Fred ersetzt." },
    {
      status: 410,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
