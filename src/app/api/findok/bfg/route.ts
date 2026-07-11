import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import {
  fetchBfgDecisions,
  FindokUpstreamError,
  normalizeFindokQuery,
} from "@/lib/findok/bfg-decisions";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const MAX_FINDOK_QUERY_CHARS = 200;
export const MAX_FINDOK_PAGE = 1_000;
export const MAX_FINDOK_PAGE_SIZE = 20;

function invalidRequest(): UserVisibleError {
  return new UserVisibleError("Die Findok-Anfrage ist ungültig.", 400);
}

function singleParameter(url: URL, key: string): string | null {
  const values = url.searchParams.getAll(key);
  return values.length === 1 ? values[0] ?? null : null;
}

function positiveInteger(value: string | null, maximum: number): number {
  if (!value || !/^\d+$/.test(value)) {
    throw invalidRequest();
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw invalidRequest();
  }
  return parsed;
}

function requestParameters(request: Request): { query: string; page: number; pageSize: number } {
  const url = new URL(request.url);
  const allowedParameters = new Set(["q", "page", "size"]);
  if (Array.from(url.searchParams.keys()).some((key) => !allowedParameters.has(key))) {
    throw invalidRequest();
  }
  const rawQuery = singleParameter(url, "q");
  if (rawQuery === null || rawQuery.length > MAX_FINDOK_QUERY_CHARS) {
    throw invalidRequest();
  }
  const query = normalizeFindokQuery(rawQuery);
  if (!query || query.length > MAX_FINDOK_QUERY_CHARS) {
    throw invalidRequest();
  }
  return {
    query,
    page: positiveInteger(singleParameter(url, "page"), MAX_FINDOK_PAGE),
    pageSize: positiveInteger(singleParameter(url, "size"), MAX_FINDOK_PAGE_SIZE),
  };
}

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Die BFG-Suche ist derzeit nicht verfügbar.", 503);
    }
    await authenticateSupabaseRequest(request, supabase);
    const result = await fetchBfgDecisions(requestParameters(request));
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof UserVisibleError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof FindokUpstreamError) {
      return NextResponse.json(
        { error: "Findok ist derzeit nicht erreichbar. Bitte später erneut versuchen." },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: "Die BFG-Suche konnte nicht durchgeführt werden." },
      { status: 500 },
    );
  }
}
