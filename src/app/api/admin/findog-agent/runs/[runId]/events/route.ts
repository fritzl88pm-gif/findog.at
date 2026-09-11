import { authenticateFindogAgentAdmin } from "@/lib/findog-agent/auth";
import {
  FINDOG_AGENT_API_LIMITS,
  findogAgentErrorResponse,
  findogAgentJson,
  parseFindogAgentAfterSequenceParam,
  parseFindogAgentLimitParam,
  parseFindogAgentUuid,
  requireFindogAgentStore,
  toFindogAgentEventDto,
} from "@/lib/findog-agent/api";

export const runtime = "nodejs";

/**
 * Owner-scoped event cursor for reconnectable polling. The batch is bounded and
 * `hasMore` is truthful; a disconnected poller can simply resume after the last
 * sequence it saw. This endpoint never starts, resumes or cancels a run.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  try {
    const { store, client } = requireFindogAgentStore();
    const user = await authenticateFindogAgentAdmin(request, client);
    const runId = parseFindogAgentUuid((await context.params).runId, "runId");

    const url = new URL(request.url);
    const afterSequence = parseFindogAgentAfterSequenceParam(url.searchParams.get("afterSequence"));
    const limit = parseFindogAgentLimitParam(
      url.searchParams.get("limit"),
      FINDOG_AGENT_API_LIMITS.eventListDefault,
      FINDOG_AGENT_API_LIMITS.eventListMax,
    );

    // A foreign or unknown run id yields an empty, indistinguishable event page.
    const events = await store.listRunEvents({ ownerId: user.id, runId, afterSequence });
    const page = events.slice(0, limit);

    return findogAgentJson({
      events: page.map(toFindogAgentEventDto),
      afterSequence,
      limit,
      hasMore: events.length > limit,
    });
  } catch (error) {
    return findogAgentErrorResponse(error);
  }
}
