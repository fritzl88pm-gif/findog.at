import { NextResponse } from "next/server";

import { UserVisibleError } from "@/lib/errors";
import { authenticateFindogAgentAdmin } from "@/lib/findog-agent/auth";
import { applyFindogAgentSecretPatch } from "@/lib/findog-agent/credentials";
import {
  listFindogAgentSecretNames,
  normalizeFindogAgentSettings,
  toRedactedFindogAgentSettings,
} from "@/lib/findog-agent/settings";
import { createFindogAgentStore, FindogAgentStoreError } from "@/lib/findog-agent/store";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type ServerClient = NonNullable<ReturnType<typeof getSupabaseServerClient>>;

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function errorResponse(error: unknown) {
  if (error instanceof UserVisibleError) {
    return json({ error: error.message }, error.status);
  }
  if (error instanceof FindogAgentStoreError) {
    return json({ error: error.message, code: error.code }, error.status);
  }
  return json({ error: "Die Findog-Agent-Konfiguration konnte nicht verarbeitet werden." }, 500);
}

/**
 * Connects to Supabase, authenticates the bearer token and re-checks current
 * administrator membership before any settings work happens. Every response is
 * `no-store`, and secrets are only ever returned as presence flags.
 */
function requireStore(): {
  store: ReturnType<typeof createFindogAgentStore>;
  client: ServerClient;
} {
  const client = getSupabaseServerClient();
  if (!client) {
    throw new UserVisibleError("Administration ist derzeit nicht verfügbar.", 503);
  }
  return { store: createFindogAgentStore(client), client };
}

function parseBody(body: unknown): {
  expectedRevision: number | null;
  settings: unknown;
  secrets: Record<string, unknown>;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new UserVisibleError("Die Anfrage enthält keine gültige Konfiguration.", 400);
  }

  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!["expectedRevision", "settings", "secrets"].includes(key)) {
      throw new UserVisibleError(`Unbekanntes Feld "${key}" in der Anfrage.`, 400);
    }
  }

  if (!("expectedRevision" in record)) {
    throw new UserVisibleError("Die erwartete Revision fehlt.", 400);
  }
  const expectedRevision = record.expectedRevision;
  if (
    expectedRevision !== null
    && (typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision) || expectedRevision < 0)
  ) {
    throw new UserVisibleError("Die erwartete Revision ist ungültig.", 400);
  }

  if (!("settings" in record)) {
    throw new UserVisibleError("Die Konfiguration fehlt.", 400);
  }

  const secrets = record.secrets ?? {};
  if (!secrets || typeof secrets !== "object" || Array.isArray(secrets)) {
    throw new UserVisibleError("Die Zugangsdaten-Angabe ist ungültig.", 400);
  }

  return {
    expectedRevision: expectedRevision as number | null,
    settings: record.settings,
    secrets: secrets as Record<string, unknown>,
  };
}

export async function GET(request: Request) {
  try {
    const { store, client } = requireStore();
    await authenticateFindogAgentAdmin(request, client);
    const snapshot = await store.getSettings();
    return json({
      revision: snapshot.revision,
      updatedAt: snapshot.updatedAt,
      settings: toRedactedFindogAgentSettings(snapshot.settings, snapshot.encryptedCredentials),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const { store, client } = requireStore();
    const user = await authenticateFindogAgentAdmin(request, client);

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      throw new UserVisibleError("Die Anfrage enthält kein gültiges JSON.", 400);
    }

    const { expectedRevision, settings: rawSettings, secrets } = parseBody(rawBody);
    const settings = normalizeFindogAgentSettings(rawSettings);
    const snapshot = await store.getSettings();

    // Omission preserves the stored ciphertext, null removes it, blank is rejected.
    const encryptedCredentials = applyFindogAgentSecretPatch(
      snapshot.encryptedCredentials,
      listFindogAgentSecretNames(settings),
      secrets as Record<string, string | null>,
    );

    const updated = await store.updateSettings({
      expectedRevision,
      createdBy: user.id,
      settings,
      encryptedCredentials,
    });

    return json({
      revision: updated.revision,
      updatedAt: updated.createdAt,
      settings: toRedactedFindogAgentSettings(settings, encryptedCredentials),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
