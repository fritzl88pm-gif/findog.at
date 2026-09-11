import { authenticateFindogAgentAdmin } from "@/lib/findog-agent/auth";
import {
  FINDOG_AGENT_API_LIMITS,
  findogAgentErrorResponse,
  findogAgentJson,
  parseFindogAgentLimitParam,
  requireFindogAgentStore,
  toFindogAgentConversationDto,
} from "@/lib/findog-agent/api";

export const runtime = "nodejs";

/** Owner-scoped conversation history with truthful pagination metadata. */
export async function GET(request: Request) {
  try {
    const { store, client } = requireFindogAgentStore();
    const user = await authenticateFindogAgentAdmin(request, client);

    const limit = parseFindogAgentLimitParam(
      new URL(request.url).searchParams.get("limit"),
      FINDOG_AGENT_API_LIMITS.conversationListDefault,
      FINDOG_AGENT_API_LIMITS.conversationListMax,
    );

    const conversations = await store.listConversations({ ownerId: user.id, limit: limit + 1 });
    const hasMore = conversations.length > limit;

    return findogAgentJson({
      conversations: conversations.slice(0, limit).map(toFindogAgentConversationDto),
      limit,
      hasMore,
    });
  } catch (error) {
    return findogAgentErrorResponse(error);
  }
}
