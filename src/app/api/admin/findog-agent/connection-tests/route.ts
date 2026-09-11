import { UserVisibleError } from "@/lib/errors";
import { authenticateFindogAgentAdmin } from "@/lib/findog-agent/auth";
import {
  findogAgentErrorResponse,
  findogAgentJson,
  parseFindogAgentConnectionTestBody,
  requireFindogAgentStore,
} from "@/lib/findog-agent/api";
import { decryptFindogAgentSecret } from "@/lib/findog-agent/credentials";
import { runFindogAgentConnectionTest } from "@/lib/findog-agent/discovery";
import {
  FINDOG_AGENT_ALLOWED_PRIVATE_ORIGINS_ENV,
  createFindogAgentHttpTransport,
  parseFindogAgentAllowedPrivateOrigins,
} from "@/lib/findog-agent/network";

export const runtime = "nodejs";

/**
 * Explicit, administrator-triggered connection test / discovery.
 *
 * The request names one saved settings revision and one configured entry; the
 * destination, headers and payload come exclusively from that revision. No test
 * ever runs on save or on a GET, and no request field can redirect a call.
 */
export async function POST(request: Request) {
  try {
    const { store, client } = requireFindogAgentStore();
    await authenticateFindogAgentAdmin(request, client);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new UserVisibleError("Die Anfrage enthält kein gültiges JSON.", 400);
    }
    const input = parseFindogAgentConnectionTestBody(body);

    const snapshot = await store.getSettingsSnapshotByRevision({ revision: input.revision });

    // One decryption per requested secret, in server memory only.
    const result = await runFindogAgentConnectionTest({
      snapshot,
      kind: input.kind,
      id: input.id,
      deps: {
        transport: createFindogAgentHttpTransport({
          allowedPrivateOrigins: parseFindogAgentAllowedPrivateOrigins(
            process.env[FINDOG_AGENT_ALLOWED_PRIVATE_ORIGINS_ENV],
          ),
        }),
        decryptSecret: decryptFindogAgentSecret,
      },
    });

    // The test itself always executed: `ok`/`code` describe the upstream result.
    return findogAgentJson(result);
  } catch (error) {
    return findogAgentErrorResponse(error);
  }
}
