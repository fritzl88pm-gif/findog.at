import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  deleteTelegramIntegration,
  getTelegramIntegration,
  registerTelegramIntegration,
  replaceTelegramBot,
} from "@/lib/telegram/settings";

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
      throw new UserVisibleError("Datenbankzugang ist derzeit nicht verfügbar.", 503);
    }
    const user = await authenticateSupabaseRequest(request, supabase);
    const integration = await getTelegramIntegration(user.id);
    if (!integration) {
      return json({ integration: null }, 404);
    }
    return json({ integration });
  } catch (error) {
    if (error instanceof UserVisibleError) {
      return json({ error: error.message }, error.status);
    }
    return json({ error: "Telegram-Einstellungen konnten nicht geladen werden." }, 500);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Datenbankzugang ist derzeit nicht verfügbar.", 503);
    }
    const user = await authenticateSupabaseRequest(request, supabase);

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      throw new UserVisibleError("Ungültiges JSON.", 400);
    }

    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) {
      throw new UserVisibleError("Bot-Token ist erforderlich.", 400);
    }

    const replaceExistingWebhook = body.replaceExistingWebhook === true;

    // Detect existing integration — route to in-place replacement
    const existingIntegration = await getTelegramIntegration(user.id);

    let result: { status: string; deepLink?: string; pairingExpiresAt?: string; conflict?: string };
    if (existingIntegration) {
      result = await replaceTelegramBot(user.id, token, undefined, {
        replaceExistingWebhook,
      });
    } else {
      result = await registerTelegramIntegration(user.id, token, undefined, {
        replaceExistingWebhook,
      });
    }

    if (result.conflict === "foreign_webhook") {
      return json({
        integration: { status: result.status },
        conflict: "foreign_webhook",
      }, 409);
    }

    return json({ integration: result }, 200);
  } catch (error) {
    if (error instanceof UserVisibleError) {
      return json({ error: error.message }, error.status);
    }
    return json({ error: "Telegram-Integration konnte nicht registriert werden." }, 500);
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Datenbankzugang ist derzeit nicht verfügbar.", 503);
    }
    const user = await authenticateSupabaseRequest(request, supabase);

    const result = await deleteTelegramIntegration(user.id);

    if (!result.deleted) {
      return json({ deleted: false, error: result.error }, 502);
    }

    return json({ deleted: true });
  } catch (error) {
    if (error instanceof UserVisibleError) {
      return json({ error: error.message }, error.status);
    }
    return json({ error: "Telegram-Integration konnte nicht entfernt werden." }, 500);
  }
}
