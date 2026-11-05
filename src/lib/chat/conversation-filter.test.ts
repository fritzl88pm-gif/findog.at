import { describe, expect, it } from "vitest";

import { filterConversationsByTitle } from "./conversation-filter";

const conversations = [
  { id: "1", title: "Pendlerpauschale für Wien" },
  { id: "2", title: "Familienbonus Plus – Änderung" },
  { id: "3", title: "Straße und Größe" },
  { id: "4", title: "Pendlereuro Graz" },
];

const ids = (list: { id: string }[]) => list.map((entry) => entry.id);

describe("filterConversationsByTitle", () => {
  it("returns the original list for empty or whitespace-only queries", () => {
    expect(filterConversationsByTitle(conversations, "")).toBe(conversations);
    expect(filterConversationsByTitle(conversations, "   ")).toBe(conversations);
  });

  it("matches case-insensitively and trims the query", () => {
    expect(ids(filterConversationsByTitle(conversations, "  PENDLERPAUSCHALE "))).toEqual(["1"]);
  });

  it("ignores diacritics in both directions", () => {
    expect(ids(filterConversationsByTitle(conversations, "aenderung"))).toEqual([]);
    expect(ids(filterConversationsByTitle(conversations, "anderung"))).toEqual(["2"]);
    expect(ids(filterConversationsByTitle(conversations, "Änderung"))).toEqual(["2"]);
    expect(ids(filterConversationsByTitle(conversations, "fur"))).toEqual(["1"]);
  });

  it("treats ß as ss", () => {
    expect(ids(filterConversationsByTitle(conversations, "strasse"))).toEqual(["3"]);
    expect(ids(filterConversationsByTitle(conversations, "große"))).toEqual(["3"]);
    expect(ids(filterConversationsByTitle(conversations, "grosse"))).toEqual(["3"]);
  });

  it("requires all whitespace-separated terms to match", () => {
    expect(ids(filterConversationsByTitle(conversations, "pendler wien"))).toEqual(["1"]);
    expect(ids(filterConversationsByTitle(conversations, "wien  pendler"))).toEqual(["1"]);
    expect(ids(filterConversationsByTitle(conversations, "pendler"))).toEqual(["1", "4"]);
    expect(filterConversationsByTitle(conversations, "pendler familienbonus")).toEqual([]);
  });
});
