import { authenticateFindogAgentAdmin } from "@/lib/findog-agent/auth";
import {
  findogAgentErrorResponse,
  findogAgentJson,
  parseFindogAgentUuid,
  requireFindogAgentStore,
  toFindogAgentRunDto,
} from "@/lib/findog-agent/api";

export const runtime = "nodejs";

/** Owner-scoped run status. Reading never enqueues or resumes work. */
export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  try {
    const { store, client } = requireFindogAgentStore();
    const user = await authenticateFindogAgentAdmin(request, client);
    const runId = parseFindogAgentUuid((await context.params).runId, "runId");

    const run = await store.getRun({ ownerId: user.id, runId });
    return findogAgentJson({ run: toFindogAgentRunDto(run) });
  } catch (error) {
    return findogAgentErrorResponse(error);
  }
}
