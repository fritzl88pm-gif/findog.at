import { describe, expect, it } from "vitest";

import { isConversationOwnedByClient } from "./persistence";

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
