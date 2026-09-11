import { authenticateFindogAgentAdmin } from "@/lib/findog-agent/auth";
import {
  findogAgentErrorResponse,
  findogAgentJson,
  parseFindogAgentUuid,
  requireFindogAgentStore,
  toFindogAgentRunDto,
} from "@/lib/findog-agent/api";

export const runtime = "nodejs";

/**
 * Owner-bound Stop. The SQL function is the single authority: it terminalises a
 * queued/running run, clears the fence and removes partial assistant output
 * while keeping the user question. `request.signal` only cancels this request's
 * own I/O; it is never used as the stored generation to abort.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  try {
    const { store, client } = requireFindogAgentStore();
    const user = await authenticateFindogAgentAdmin(request, client);
    const runId = parseFindogAgentUuid((await context.params).runId, "runId");

    const run = await store.cancelRun({ ownerId: user.id, runId });
    return findogAgentJson({ run: toFindogAgentRunDto(run) });
  } catch (error) {
    return findogAgentErrorResponse(error);
  }
}
