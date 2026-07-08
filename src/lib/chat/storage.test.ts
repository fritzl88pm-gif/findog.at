import { describe, expect, it } from "vitest";

import { chatHistoryStorageKey } from "./storage";

describe("chatHistoryStorageKey", () => {
  it("scopes chat history by authenticated Supabase user id", () => {
    expect(chatHistoryStorageKey("11111111-1111-4111-8111-111111111111")).toBe(
      "findog.history.v1.11111111-1111-4111-8111-111111111111",
    );
    expect(chatHistoryStorageKey("22222222-2222-4222-8222-222222222222")).not.toBe(
      chatHistoryStorageKey("11111111-1111-4111-8111-111111111111"),
    );
  });
});
