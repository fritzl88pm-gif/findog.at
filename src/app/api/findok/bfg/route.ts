import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import {
  fetchBfgDecisions,
  FindokUpstreamError,
  normalizeFindokQuery,
  type BfgSearchFilters,
  type BfgSort,
} from "@/lib/findok/bfg-decisions";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
const MAX_FINDOK_QUERY_CHARS = 200;
const MAX_FINDOK_PAGE = 1_000;
const MAX_FINDOK_PAGE_SIZE = 20;
const MAX_FINDOK_FILTER_CHARS = 200;

const FINDOK_SORTS = new Set<BfgSort>(["1", "2", "3", "4", "7", "10"]);

function invalidRequest(): UserVisibleError {
  return new UserVisibleError("Die Findok-Anfrage ist ungültig.", 400);
}

function singleParameter(url: URL, key: string): string | null {
  const values = url.searchParams.getAll(key);
  return values.length === 1 ? values[0] ?? null : null;
}

function optionalParameter(url: URL, key: string): string | undefined {
  const values = url.searchParams.getAll(key);
  if (values.length > 1) {
    throw invalidRequest();
  }
  return values[0];
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

function strictFilterValue(value: string | undefined): string | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }
  if (
    !value
    || value.length > MAX_FINDOK_FILTER_CHARS
    || value !== value.trim()
    || value.includes(",")
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw invalidRequest();
  }
  return value;
}

function approvedSort(value: string | undefined): BfgSort | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }
  if (!FINDOK_SORTS.has(value as BfgSort)) {
    throw invalidRequest();
  }
  return value as BfgSort;
}

function requestParameters(request: Request): {
  query: string;
  page: number;
  pageSize: number;
  sort?: BfgSort;
  filters?: BfgSearchFilters;
} {
  const url = new URL(request.url);
  const allowedParameters = new Set([
    "q",
    "page",
    "size",
    "sort",
    "materie",
    "documentType",
    "norm",
    "withHeadnote",
    "timeframe",
  ]);
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
  const result: ReturnType<typeof requestParameters> = {
    query,
    page: positiveInteger(singleParameter(url, "page"), MAX_FINDOK_PAGE),
    pageSize: positiveInteger(singleParameter(url, "size"), MAX_FINDOK_PAGE_SIZE),
  };
  const sort = approvedSort(optionalParameter(url, "sort"));
  if (sort) {
    result.sort = sort;
  }

  const materie = strictFilterValue(optionalParameter(url, "materie"));
  const documentType = strictFilterValue(optionalParameter(url, "documentType"));
  const norm = strictFilterValue(optionalParameter(url, "norm"));
  const rawWithHeadnote = optionalParameter(url, "withHeadnote");
  const rawTimeframe = optionalParameter(url, "timeframe");
  if (typeof rawWithHeadnote !== "undefined" && rawWithHeadnote !== "true") {
    throw invalidRequest();
  }
  if (typeof rawTimeframe !== "undefined" && !/^[1-7]$/.test(rawTimeframe)) {
    throw invalidRequest();
  }
  const filters: BfgSearchFilters = {
    ...(materie ? { materie } : {}),
    ...(documentType ? { documentType } : {}),
    ...(norm ? { norm } : {}),
    ...(rawWithHeadnote ? { withHeadnote: rawWithHeadnote } : {}),
    ...(rawTimeframe ? { timeframe: rawTimeframe as BfgSearchFilters["timeframe"] } : {}),
  };
  if (Object.keys(filters).length > 0) {
    result.filters = filters;
  }
  return result;
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
