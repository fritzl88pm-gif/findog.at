import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

import { loadFredPublicShare } from "./fred-public-share";
import { getSupabaseServerClient } from "./supabase/server";

const shareId = "77777777-7777-4777-8777-777777777777";

function supabaseWithMessages(messages: Array<{ id: number; superseded_at: string | null }>) {
  const shareQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        question_content: "Frage",
        answer_content: "Antwort",
        question_message_id: 1,
        assistant_message_id: 2,
      },
      error: null,
    }),
  };
  let ids: unknown[] = [];
  let onlySuperseded = false;
  const messageQuery = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn((_column: string, values: unknown[]) => {
      ids = values;
      return messageQuery;
    }),
    not: vi.fn((column: string, operator: string, value: unknown) => {
      onlySuperseded = column === "superseded_at" && operator === "is" && value === null;
      return messageQuery;
    }),
    limit: vi.fn(async () => ({
      data: messages.filter((message) => ids.includes(message.id)
        && (!onlySuperseded || message.superseded_at !== null)),
      error: null,
    })),
  };
  return {
    from: vi.fn((table: string) => (table === "fred_public_answer_shares" ? shareQuery : messageQuery)),
  };
}

describe("loadFredPublicShare", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("shows a shared answer that is still part of the transcript", async () => {
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabaseWithMessages([
      { id: 1, superseded_at: null },
      { id: 2, superseded_at: null },
    ]) as never);

    await expect(loadFredPublicShare(shareId)).resolves.toEqual({
      question_content: "Frage",
      answer_content: "Antwort",
    });
  });

  it("no longer shows an answer its owner regenerated", async () => {
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabaseWithMessages([
      { id: 1, superseded_at: "2026-09-27T10:00:00.000Z" },
      { id: 2, superseded_at: "2026-09-27T10:00:00.000Z" },
    ]) as never);

    await expect(loadFredPublicShare(shareId)).rejects.toMatchObject({ status: 404 });
  });
});
