import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import {
  extractBfgGzCandidates,
  linkVerifiedBfgCitations,
  verifyBfgCitations,
  type VerifiedBfgCitation,
} from "@/lib/findok/bfg-citations";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  mergeFredSources,
  parseStoredFredResearchTrace,
  parseStoredFredSources,
  transformWeKnoraAnswer,
} from "@/lib/weknora/fred-research";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_LEGACY_BFG_CITATIONS_PER_CONVERSATION = 40;

type FredConversationRow = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type FredMessageRow = {
  id: number;
  role: "user" | "assistant";
  content: string;
  display_content: string | null;
  research_trace: unknown;
  source_references: unknown;
  provider_created_at: string | null;
  created_at: string;
  attachments: unknown;
  web_search_enabled: boolean;
};

type PreparedFredMessage = FredMessageRow & {
  rawTransformation: ReturnType<typeof transformWeKnoraAnswer>;
  displayTransformation: ReturnType<typeof transformWeKnoraAnswer>;
  legacyBfgCandidates: string[];
};

function verifiedCitationSources(citations: VerifiedBfgCitation[]) {
  return citations.map((citation) => ({
    kind: "web" as const,
    url: citation.fullTextUrl,
    title: `BFG ${citation.gz}: ${citation.title}`.slice(0, 512),
  }));
}

function attachmentMetadata(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const item = candidate as Record<string, unknown>;
    if (
      (item.kind !== "image" && item.kind !== "file")
      || typeof item.name !== "string"
      || typeof item.mime_type !== "string"
      || typeof item.size_bytes !== "number"
      || typeof item.sha256 !== "string"
    ) return [];
    return [{
      kind: item.kind,
      name: item.name,
      mimeType: item.mime_type,
      sizeBytes: item.size_bytes,
      sha256: item.sha256,
    }];
  });
}

function json(payload: unknown, status = 200): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

async function contextFor(request: Request, conversationId: string) {
  if (!UUID_PATTERN.test(conversationId)) {
    throw new UserVisibleError("Gespräch-ID ist ungültig.", 400);
  }
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    throw new UserVisibleError("Der Fred-Verlauf ist derzeit nicht verfügbar.", 503);
  }
  const user = await authenticateSupabaseRequest(request, supabase);
  return { supabase, user };
}

export async function GET(
  request: Request,
  routeContext: { params: Promise<{ conversationId: string }> },
) {
  try {
    const { conversationId } = await routeContext.params;
    const { supabase, user } = await contextFor(request, conversationId);
    const { data: conversation, error: conversationError } = await supabase
      .from("fred_conversations")
      .select("id,title,created_at,updated_at")
      .eq("id", conversationId)
      .eq("client_id", user.id)
      .maybeSingle();
    if (conversationError) {
      throw new UserVisibleError("Fred-Unterhaltung konnte nicht geladen werden.", 503);
    }
    if (!conversation) {
      throw new UserVisibleError("Fred-Unterhaltung wurde nicht gefunden.", 404);
    }
    const { data: messages, error: messagesError } = await supabase
      .from("fred_messages")
      .select("id,role,content,display_content,research_trace,source_references,provider_created_at,created_at,attachments,web_search_enabled")
      .eq("conversation_id", conversationId)
      .eq("client_id", user.id)
      .order("provider_created_at", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true });
    if (messagesError) {
      throw new UserVisibleError("Fred-Nachrichten konnten nicht geladen werden.", 503);
    }
    const preparedMessages = ((messages ?? []) as FredMessageRow[]).map((message): PreparedFredMessage => {
      const rawTransformation = message.role === "assistant"
        ? transformWeKnoraAnswer(message.content)
        : { text: message.content, sources: [] };
      const displayTransformation = message.role === "assistant" && message.display_content
        ? transformWeKnoraAnswer(message.display_content)
        : rawTransformation;
      return {
        ...message,
        rawTransformation,
        displayTransformation,
        legacyBfgCandidates: message.role === "assistant" && !message.display_content
          ? extractBfgGzCandidates(displayTransformation.text)
          : [],
      };
    });
    const legacyCandidates = [...new Set(
      preparedMessages.flatMap((message) => message.legacyBfgCandidates),
    )].slice(0, MAX_LEGACY_BFG_CITATIONS_PER_CONVERSATION);
    const verifiedLegacyCitations = legacyCandidates.length > 0
      ? (await verifyBfgCitations(legacyCandidates)).verified
      : [];
    const row = conversation as FredConversationRow;
    return json({
      conversation: {
        id: row.id,
        title: row.title,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
      messages: preparedMessages.map((message) => {
        const candidateSet = new Set(message.legacyBfgCandidates);
        const messageCitations = verifiedLegacyCitations.filter((citation) => candidateSet.has(citation.gz));
        const displayContent = messageCitations.length > 0
          ? linkVerifiedBfgCitations(
              message.displayTransformation.text,
              messageCitations,
              { target: "fullText" },
            )
          : message.displayTransformation.text;
        return {
          id: message.id,
          role: message.role,
          content: displayContent.trim(),
          createdAt: message.provider_created_at ?? message.created_at,
          attachments: attachmentMetadata(message.attachments),
          webSearchEnabled: message.web_search_enabled,
          researchTrace: parseStoredFredResearchTrace(message.research_trace),
          sourceReferences: mergeFredSources(
            parseStoredFredSources(message.source_references),
            message.rawTransformation.sources,
            message.displayTransformation.sources,
            verifiedCitationSources(messageCitations),
          ),
        };
      }),
    });
  } catch (error) {
    if (error instanceof UserVisibleError) return json({ error: error.message }, error.status);
    return json({ error: "Fred-Unterhaltung konnte nicht geladen werden." }, 500);
  }
}

export async function DELETE(
  request: Request,
  routeContext: { params: Promise<{ conversationId: string }> },
) {
  try {
    const { conversationId } = await routeContext.params;
    const { supabase, user } = await contextFor(request, conversationId);
    const { data, error } = await supabase
      .from("fred_conversations")
      .delete()
      .eq("id", conversationId)
      .eq("client_id", user.id)
      .select("id");
    if (error) {
      throw new UserVisibleError("Fred-Unterhaltung konnte nicht gelöscht werden.", 503);
    }
    const deletedIds = ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
    if (deletedIds.length === 0) {
      throw new UserVisibleError("Fred-Unterhaltung wurde nicht gefunden.", 404);
    }
    return json({ deletedIds });
  } catch (error) {
    if (error instanceof UserVisibleError) return json({ error: error.message }, error.status);
    return json({ error: "Fred-Unterhaltung konnte nicht gelöscht werden." }, 500);
  }
}
