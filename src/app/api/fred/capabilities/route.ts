import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  FredEmbedConfigurationError,
  FredEmbedUpstreamError,
  mintFredEmbedSession,
  readFredEmbedServerConfig,
  readFredProModelId,
  readQuickFredEmbedServerConfig,
} from "@/lib/weknora/fred-embed";
import {
  fetchFredUpstreamConfig,
  type FredUpstreamConfig,
} from "@/lib/weknora/fred-native";

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

function findogFileUploadEnabled(): boolean {
  const mineruToken = process.env.MINERU_API_TOKEN?.trim() ?? "";
  const openrouterKey = process.env.OPENROUTER_API_KEY?.trim() ?? "";
  return mineruToken !== "" && openrouterKey !== "";
}

function fredProModeEnabled(): boolean {
  try {
    readFredProModelId();
    return true;
  } catch {
    return false;
  }
}

async function quickFredModeEnabled(options: {
  fredChannelId: string;
  fredUpstreamConfig: FredUpstreamConfig;
  signal: AbortSignal;
}): Promise<boolean> {
  try {
    const config = readQuickFredEmbedServerConfig();
    if (config.channelId === options.fredChannelId) return false;
    const session = await mintFredEmbedSession({ config, signal: options.signal });
    const upstreamConfig = await fetchFredUpstreamConfig({
      session,
      config,
      signal: options.signal,
    });
    return upstreamConfig.agentId === config.expectedAgentId
      && upstreamConfig.agentId !== options.fredUpstreamConfig.agentId
      && upstreamConfig.allowWebSearch === options.fredUpstreamConfig.allowWebSearch;
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) throw new UserVisibleError("Fred ist derzeit nicht verfügbar.", 503);
    await authenticateSupabaseRequest(request, supabase);
    if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
      throw new UserVisibleError("Diese Fred-Anfrage ist nicht erlaubt.", 403);
    }
    const config = readFredEmbedServerConfig();
    const session = await mintFredEmbedSession({ signal: request.signal });
    const capabilities = await fetchFredUpstreamConfig({
      session,
      config,
      signal: request.signal,
    });
    const quickFred = await quickFredModeEnabled({
      fredChannelId: config.channelId,
      fredUpstreamConfig: capabilities,
      signal: request.signal,
    });
    return json({
      webSearch: capabilities.allowWebSearch,
      fileUpload: findogFileUploadEnabled(),
      proMode: fredProModeEnabled(),
      quickFred,
    });
  } catch (error) {
    if (error instanceof UserVisibleError) return json({ error: error.message }, error.status);
    if (error instanceof FredEmbedConfigurationError) {
      return json({ error: "Fred ist noch nicht vollständig eingerichtet." }, 503);
    }
    if (error instanceof FredEmbedUpstreamError) {
      return json({ error: "Fred ist derzeit nicht erreichbar." }, 502);
    }
    return json({ error: "Fred-Zusatzfunktionen konnten nicht geladen werden." }, 500);
  }
}
