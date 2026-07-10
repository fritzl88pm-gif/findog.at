import { describe, expect, it } from "vitest";

import { applyConversationDeletion } from "./deletion";

describe("applyConversationDeletion", () => {
  it("removes deleted summaries and selections and reports an active deletion", () => {
    const result = applyConversationDeletion({
      conversations: [{ id: "one" }, { id: "two" }, { id: "three" }],
      selectedIds: ["one", "two", "stale"],
      activeConversationId: "two",
      deletedIds: ["two", "three"],
    });

    expect(result.conversations).toEqual([{ id: "one" }]);
    expect(result.selectedIds).toEqual(["one", "stale"]);
    expect(result.activeConversationDeleted).toBe(true);
  });

  it("leaves active state intact when another conversation is deleted", () => {
    expect(applyConversationDeletion({
      conversations: [{ id: "one" }, { id: "two" }],
      selectedIds: ["two"],
      activeConversationId: "one",
      deletedIds: ["two"],
    })).toEqual({
      conversations: [{ id: "one" }],
      selectedIds: [],
      activeConversationDeleted: false,
    });
  });
});
