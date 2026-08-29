import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import {
  DASHBOARD_NEWS_SELECT,
  mapDashboardNewsItem,
  type DashboardKnowledgeStatus,
  type DashboardNewsKind,
  type DashboardNewsRow,
  type DashboardPayload,
} from "@/lib/dashboard";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getWeKnoraDashboard } from "@/lib/weknora/dashboard";

export const runtime = "nodejs";

function json(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Vary: "Authorization",
    },
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Die Startseite ist derzeit nicht verfügbar.", 503);
    }
    const user = await authenticateSupabaseRequest(request, supabase);
    const now = new Date().toISOString();

    const [reasoningsResult, downloadsResult, productResult, legalResult, knowledgeResult] = await Promise.all([
      supabase
        .from("user_reasonings")
        .select("id", { count: "exact", head: true })
        .eq("client_id", user.id),
      supabase
        .from("download_documents")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null),
      readPublishedNews(supabase, "product", now),
      readPublishedNews(supabase, "legal", now),
      getWeKnoraDashboard()
        .then((dashboard): DashboardKnowledgeStatus => ({
          status: dashboard.stale
            ? "stale"
            : dashboard.totals.processing > 0
              ? "processing"
              : "current",
          fetchedAt: dashboard.fetchedAt,
        }))
        .catch((): DashboardKnowledgeStatus => ({ status: "unavailable", fetchedAt: null })),
    ]);

    const sectionErrors: NonNullable<DashboardPayload["sectionErrors"]> = {};
    if (reasoningsResult.error) sectionErrors.reasonings = "Textbausteine konnten nicht geladen werden.";
    if (downloadsResult.error) sectionErrors.downloads = "Downloads konnten nicht geladen werden.";
    if (productResult.error) sectionErrors.productNews = "Produktmeldungen konnten nicht geladen werden.";
    if (legalResult.error) sectionErrors.legalNews = "Rechtsmeldungen konnten nicht geladen werden.";
    if (knowledgeResult.status === "unavailable") sectionErrors.knowledge = "Der Wissensstand ist derzeit nicht verfügbar.";

    const payload: DashboardPayload = {
      counts: {
        reasonings: reasoningsResult.error ? 0 : reasoningsResult.count ?? 0,
        downloads: downloadsResult.error ? 0 : downloadsResult.count ?? 0,
      },
      knowledge: knowledgeResult,
      news: {
        product: productResult.error ? [] : productResult.items,
        legal: legalResult.error ? [] : legalResult.items,
      },
      ...(Object.keys(sectionErrors).length > 0 ? { sectionErrors } : {}),
    };
    return json(payload);
  } catch (error) {
    if (error instanceof UserVisibleError) {
      return json({ error: error.message }, error.status);
    }
    return json({ error: "Die Startseite ist derzeit nicht verfügbar." }, 500);
  }
}

async function readPublishedNews(
  supabase: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  kind: DashboardNewsKind,
  now: string,
): Promise<{ items: ReturnType<typeof mapDashboardNewsItem>[]; error: boolean }> {
  const { data, error } = await supabase
    .from("dashboard_news_items")
    .select(DASHBOARD_NEWS_SELECT)
    .eq("kind", kind)
    .eq("status", "published")
    .is("deleted_at", null)
    .lte("published_at", now)
    .order("pinned", { ascending: false })
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(3);
  return {
    items: error ? [] : ((data ?? []) as unknown as DashboardNewsRow[]).map(mapDashboardNewsItem),
    error: Boolean(error),
  };
}
