import { describe, expect, it } from "vitest";

import { applyConversationDeletion, chunkIds } from "./deletion";

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

describe("chunkIds", () => {
  it("splits ids into chunks of at most the given size", () => {
    const ids = Array.from({ length: 250 }, (_, index) => `id-${index}`);
    const chunks = chunkIds(ids, 100);

    expect(chunks.map((chunk) => chunk.length)).toEqual([100, 100, 50]);
    expect(chunks.flat()).toEqual(ids);
  });

  it("returns no chunks for an empty list and a single chunk for exact fits", () => {
    expect(chunkIds([], 100)).toEqual([]);
    expect(chunkIds(["a", "b"], 2)).toEqual([["a", "b"]]);
  });
});
