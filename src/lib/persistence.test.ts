import { describe, expect, it } from "vitest";

import { UserVisibleError } from "./errors";
import { isConversationOwnedByClient, resolveConversationIdForClient } from "./persistence";

describe("isConversationOwnedByClient", () => {
  it("allows new conversations and conversations owned by the same authenticated user", () => {
    const clientId = "11111111-1111-4111-8111-111111111111";

    expect(isConversationOwnedByClient(null, clientId)).toBe(true);
    expect(isConversationOwnedByClient(undefined, clientId)).toBe(true);
    expect(isConversationOwnedByClient(clientId, clientId)).toBe(true);
  });

  it("rejects conversation ids that already belong to another authenticated user", () => {
    expect(
      isConversationOwnedByClient(
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
      ),
    ).toBe(false);
  });
});

describe("resolveConversationIdForClient", () => {
  const clientId = "11111111-1111-4111-8111-111111111111";
  const conversationId = "33333333-3333-4333-8333-333333333333";

  function supabaseWithOwner(existingClientId: string | null) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: existingClientId === null ? null : { client_id: existingClientId },
              error: null,
            }),
          }),
        }),
      }),
    };
  }

  it("creates a valid server-side id when the browser sends no conversation id", async () => {
    const resolved = await resolveConversationIdForClient({
      clientId,
      supabase: supabaseWithOwner(null),
    });

    expect(resolved).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("uses a requested id when it is unclaimed or owned by the authenticated user", async () => {
    await expect(
      resolveConversationIdForClient({
        clientId,
        conversationId,
        supabase: supabaseWithOwner(null),
      }),
    ).resolves.toBe(conversationId);

    await expect(
      resolveConversationIdForClient({
        clientId,
        conversationId,
        supabase: supabaseWithOwner(clientId),
      }),
    ).resolves.toBe(conversationId);
  });

  it("rejects a requested id owned by another authenticated user", async () => {
    await expect(
      resolveConversationIdForClient({
        clientId,
        conversationId,
        supabase: supabaseWithOwner("22222222-2222-4222-8222-222222222222"),
      }),
    ).rejects.toBeInstanceOf(UserVisibleError);
  });
});
