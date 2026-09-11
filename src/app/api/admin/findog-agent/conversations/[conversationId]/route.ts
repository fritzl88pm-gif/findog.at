import { authenticateFindogAgentAdmin } from "@/lib/findog-agent/auth";
import {
  FINDOG_AGENT_API_LIMITS,
  findogAgentErrorResponse,
  findogAgentJson,
  parseFindogAgentLimitParam,
  parseFindogAgentUuid,
  requireFindogAgentStore,
  toFindogAgentConversationDto,
  toFindogAgentMessageDto,
  toFindogAgentRunDto,
} from "@/lib/findog-agent/api";

export const runtime = "nodejs";

/**
 * Canonical, owner-scoped conversation view: the most recent messages (bounded)
 * plus the single active run, if any. Reading never enqueues work.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  try {
    const { store, client } = requireFindogAgentStore();
    const user = await authenticateFindogAgentAdmin(request, client);
    const conversationId = parseFindogAgentUuid((await context.params).conversationId, "conversationId");

    const limit = parseFindogAgentLimitParam(
      new URL(request.url).searchParams.get("limit"),
      FINDOG_AGENT_API_LIMITS.messageListDefault,
      FINDOG_AGENT_API_LIMITS.messageListMax,
    );

    const conversation = await store.getConversation({ ownerId: user.id, conversationId });
    const window = await store.listMessages({ ownerId: user.id, conversationId, limit });
    const activeRun = await store.getActiveRun({ ownerId: user.id, conversationId });

    return findogAgentJson({
      conversation: toFindogAgentConversationDto(conversation),
      messages: window.messages.map(toFindogAgentMessageDto),
      messagesTruncated: window.hasMore,
      limit,
      activeRun: activeRun ? toFindogAgentRunDto(activeRun) : null,
    });
  } catch (error) {
    return findogAgentErrorResponse(error);
  }
}
