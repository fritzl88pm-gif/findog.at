import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { POST } from "./route";

vi.mock("@/lib/auth/server", () => ({
  authenticateSupabaseRequest: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: vi.fn(),
}));

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONVERSATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function request(overrides: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/feedback", {
    method: "POST",
    headers: {
      Authorization: "Bearer access-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      conversationId: CONVERSATION_ID,
      userRequest: "Wie ist diese Ausgabe zu behandeln?",
      assistantResponse: "Freds Antwort",
      feedback: "Die angeführte Rechtsfolge ist nicht korrekt.",
      ...overrides,
    }),
  });
}

function supabaseClient(options: {
  conversation?: { id: string } | null;
  conversationError?: unknown;
  insertError?: unknown;
} = {}) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: options.conversation === undefined ? { id: CONVERSATION_ID } : options.conversation,
    error: options.conversationError ?? null,
  });
  const conversationQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle,
  };
  conversationQuery.select.mockReturnValue(conversationQuery);
  conversationQuery.eq.mockReturnValue(conversationQuery);
  const insert = vi.fn().mockResolvedValue({ data: null, error: options.insertError ?? null });
  const from = vi.fn((table: string) => (
    table === "fred_conversations" ? conversationQuery : { insert }
  ));
  return { client: { from }, from, conversationQuery, insert };
}

describe("POST /api/feedback", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({
      id: USER_ID,
      email: "user@example.at",
    });
  });

  it("stores negative Fred feedback for an owned conversation", async () => {
    const supabase = supabaseClient();
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client as never);

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({
      message: "Danke für deine Rückmeldung.",
    });
    expect(supabase.conversationQuery.eq).toHaveBeenNthCalledWith(1, "id", CONVERSATION_ID);
    expect(supabase.conversationQuery.eq).toHaveBeenNthCalledWith(2, "client_id", USER_ID);
    expect(supabase.insert).toHaveBeenCalledWith({
      user_id: USER_ID,
      conversation_id: CONVERSATION_ID,
      user_request: "Wie ist diese Ausgabe zu behandeln?",
      assistant_response: "Freds Antwort",
      user_feedback: "Die angeführte Rechtsfolge ist nicht korrekt.",
    });
  });

  it("does not store feedback for a conversation outside the authenticated user scope", async () => {
    const supabase = supabaseClient({ conversation: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client as never);

    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(supabase.insert).not.toHaveBeenCalled();
  });

  it("rejects empty feedback and unknown fields", async () => {
    const supabase = supabaseClient();
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client as never);

    const emptyResponse = await POST(request({ feedback: "   " }));
    const extraResponse = await POST(request({ rating: "negative" }));

    expect(emptyResponse.status).toBe(400);
    expect(extraResponse.status).toBe(400);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("returns authentication errors without querying conversations", async () => {
    const supabase = supabaseClient();
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client as never);
    vi.mocked(authenticateSupabaseRequest).mockRejectedValue(
      new UserVisibleError("Bitte zuerst anmelden.", 401),
    );

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("does not leak database errors", async () => {
    const supabase = supabaseClient({
      insertError: { code: "XX000", message: "sensitive database detail" },
    });
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabase.client as never);

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Feedback konnte nicht gespeichert werden.",
    });
  });
});
