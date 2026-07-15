import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { MAX_REQUEST_BYTES } from "@/lib/config";
import { POST } from "./route";

vi.mock("@/lib/auth/server", () => ({
  authenticateSupabaseRequest: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: vi.fn(),
}));

describe("POST /api/feedback", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      email: "user@example.at",
    });
  });

  it("inserts negative feedback and returns the thank-you message", async () => {
    const insert = vi.fn().mockResolvedValue({ data: null, error: null });
    const from = vi.fn().mockReturnValue({ insert });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never);

    const response = await POST(
      new Request("http://localhost/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer access-token",
        },
        body: JSON.stringify({
          conversationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          userRequest: "Frage zu Steuern",
          assistantResponse: "Antwort zur Steuerfrage",
          feedback: "Die Antwort war nicht hilfreich.",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: "Danke für dein Feedback",
    });
    expect(insert).toHaveBeenCalledWith({
      user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      conversation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      user_request: "Frage zu Steuern",
      assistant_response: "Antwort zur Steuerfrage",
      user_feedback: "Die Antwort war nicht hilfreich.",
    });
  });

  it("rejects malformed JSON with 400", async () => {
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn() } as never);

    const response = await POST(
      new Request("http://localhost/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer access-token",
        },
        body: "not-json",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: expect.stringMatching(/json|gültig|ungültig/i),
    });
  });

  it("rejects invalid conversationId UUID", async () => {
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn() } as never);

    const response = await POST(
      new Request("http://localhost/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer access-token",
        },
        body: JSON.stringify({
          conversationId: "not-a-uuid",
          userRequest: "Frage",
          assistantResponse: "Antwort",
          feedback: "Nicht hilfreich.",
        }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects empty feedback", async () => {
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn() } as never);

    const response = await POST(
      new Request("http://localhost/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer access-token",
        },
        body: JSON.stringify({
          conversationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          userRequest: "Frage",
          assistantResponse: "Antwort",
          feedback: "   ",
        }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects over-limit userRequest", async () => {
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn() } as never);

    const response = await POST(
      new Request("http://localhost/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer access-token",
        },
        body: JSON.stringify({
          conversationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          userRequest: "a".repeat(100001),
          assistantResponse: "Antwort",
          feedback: "Nicht hilfreich.",
        }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects over-limit feedback", async () => {
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn() } as never);

    const response = await POST(
      new Request("http://localhost/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer access-token",
        },
        body: JSON.stringify({
          conversationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          userRequest: "Frage",
          assistantResponse: "Antwort",
          feedback: "a".repeat(10001),
        }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it("rejects requests exceeding MAX_REQUEST_BYTES with 413 before processing", async () => {
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn() } as never);

    const response = await POST(
      new Request("http://localhost/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer access-token",
        },
        body: "x".repeat(MAX_REQUEST_BYTES + 1),
      }),
    );

    expect(response.status).toBe(413);
  });

  it("rejects oversized requests without Content-Length header with 413", async () => {
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn() } as never);

    const request = new Request("http://localhost/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "z".repeat(MAX_REQUEST_BYTES + 1),
    });

    const response = await POST(request);
    expect(response.status).toBe(413);
  });

  it("rejects unauthenticated requests with 401", async () => {
    vi.mocked(authenticateSupabaseRequest).mockRejectedValue(
      new (await import("@/lib/errors")).UserVisibleError(
        "Bitte zuerst anmelden.",
        401,
      ),
    );
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from: vi.fn() } as never);

    const response = await POST(
      new Request("http://localhost/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          userRequest: "Frage",
          assistantResponse: "Antwort",
          feedback: "Nicht hilfreich.",
        }),
      }),
    );

    expect(response.status).toBe(401);
  });

  it("returns a user-visible error on database failure without leaking details", async () => {
    const insert = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });
    const from = vi.fn().mockReturnValue({ insert });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never);

    const response = await POST(
      new Request("http://localhost/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer access-token",
        },
        body: JSON.stringify({
          conversationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          userRequest: "Frage",
          assistantResponse: "Antwort",
          feedback: "Nicht hilfreich.",
        }),
      }),
    );

    expect(response.status).toBe(503);
    const json = await response.json();
    expect(json.error).toBeTypeOf("string");
    expect(json.error).not.toContain("duplicate key value violates unique constraint");
  });
});
