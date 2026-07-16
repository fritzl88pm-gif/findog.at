import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { parseSseChunk } from "@/lib/fred/sse";
import { createFredSessionToken } from "@/lib/fred/token";
import { POST } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WEKNORA_SESSION_ID = "wkn-session-123";
const WEKNORA_API_KEY = "test-weknora-key";

function makeValidToken(): string {
  return createFredSessionToken({
    apiKey: WEKNORA_API_KEY,
    userId: USER_ID,
    weknoraSessionId: WEKNORA_SESSION_ID,
  });
}

function authenticatedChatRequest(body: Record<string, unknown>): Request {
  const token = makeValidToken();
  return new Request("http://localhost/api/fred/chat", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-supabase-token",
      "Content-Type": "application/json",
      "X-Fred-Session-Token": token,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/fred/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSupabaseServerClient).mockReturnValue({} as never);
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: USER_ID });
    process.env.WEKNORA_BASE_URL = "https://weknora.example.com/api/v1";
    process.env.WEKNORA_API_KEY = WEKNORA_API_KEY;
  });

  it("rejects requests without a session token header", async () => {
    const request = new Request("http://localhost/api/fred/chat", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-supabase-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "test" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("rejects unauthenticated requests", async () => {
    vi.mocked(authenticateSupabaseRequest).mockRejectedValueOnce(
      new UserVisibleError("Bitte zuerst anmelden.", 401),
    );

    const request = new Request("http://localhost/api/fred/chat", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-supabase-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "test" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("rejects requests with a tampered session token", async () => {
    const request = new Request("http://localhost/api/fred/chat", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-supabase-token",
        "Content-Type": "application/json",
        "X-Fred-Session-Token": "fred_invalid_tampered_token",
      },
      body: JSON.stringify({ query: "test" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("rejects requests with an empty query", async () => {
    const request = authenticatedChatRequest({ query: "" });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("rejects requests with a query exceeding the max length", async () => {
    const longQuery = "x".repeat(5000);
    const request = authenticatedChatRequest({ query: longQuery });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("returns 503 when WEKNORA_BASE_URL is missing", async () => {
    delete (process.env as Record<string, string>).WEKNORA_BASE_URL;

    const request = authenticatedChatRequest({ query: "test" });
    const response = await POST(request);
    expect(response.status).toBe(503);
  });

  it("relays sanitized upstream SSE and sends the fixed Fred contract", async () => {
    const thinkingSecret = "UNIQUE_RAW_THINKING_SECRET";
    const toolCallSecret = "UNIQUE_RAW_TOOL_ARGUMENT_SECRET";
    const toolResultSecret = "UNIQUE_RAW_TOOL_OUTPUT_SECRET";
    const upstreamResponse = new Response(
      "event: message\r\n" +
        `data: {"response_type":"thinking","content":"${thinkingSecret}","data":{"secret":"${thinkingSecret}"}}\r\n\r\n` +
        "event: message\n" +
        `data: {"response_type":"tool_call","content":"${toolCallSecret}","data":{"arguments":"${toolCallSecret}"}}\n\n` +
        "event: message\n" +
        `data: {"response_type":"tool_result","content":"${toolResultSecret}","data":{"output":"${toolResultSecret}"}}\n\n` +
        "event: message\n" +
        "data: {\"response_type\":\"agent_query\",\"assistant_message_id\":\"assistant-123\",\"content\":\"internal query\"}\n\n" +
        "event: message\n" +
        "data: {\"response_type\":\"answer\",\"content\":\"Antwort mit Leerzeichen\"}\n\n" +
        "event: message\n" +
        "data: {\"response_type\":\"complete\",\"data\":{\"raw\":\"secret\"}}\n\n",
      {
        headers: { "Content-Type": "text/event-stream;charset=utf-8" },
      },
    );
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(upstreamResponse);

    const request = authenticatedChatRequest({ query: "  Testfrage  " });
    const response = await POST(request);
    const responseText = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(response.headers.get("Cache-Control")).toContain("no-cache");
    expect(response.headers.get("X-Accel-Buffering")).toBe("no");

    const relayed = parseSseChunk(responseText);
    expect(relayed.remainder).toBe("");
    expect(relayed.events).toContainEqual({
      response_type: "answer",
      content: "Antwort mit Leerzeichen",
    });
    expect(relayed.events).toContainEqual({
      response_type: "agent_query",
      assistant_message_id: "assistant-123",
    });
    expect(relayed.events).toContainEqual({ response_type: "complete" });
    expect(responseText).toContain("event: message\ndata: ");
    expect(responseText).not.toContain(thinkingSecret);
    expect(responseText).not.toContain(toolCallSecret);
    expect(responseText).not.toContain(toolResultSecret);
    expect(responseText).not.toContain("internal query");
    expect(responseText).not.toContain('"raw":"secret"');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(
      `https://weknora.example.com/api/v1/agent-chat/${WEKNORA_SESSION_ID}`,
    );
    expect(init).toMatchObject({
      method: "POST",
      signal: request.signal,
    });
    expect(new Headers(init?.headers).get("X-API-Key")).toBe(WEKNORA_API_KEY);
    expect(new Headers(init?.headers).get("Accept")).toBe("text/event-stream");
    expect(JSON.parse(String(init?.body))).toEqual({
      query: "Testfrage",
      agent_id: "e8b65a4d-dc41-4281-ba62-e01e50b0947a",
      agent_enabled: true,
      knowledge_base_ids: [
        "30ac8ebb-13b6-462a-ada0-a35e63f99dbb",
        "9ddef4d4-79c3-4910-a312-604360720ac3",
        "7e203a75-9e51-4839-afd4-7d24d2e5b033",
      ],
      web_search_enabled: true,
      enable_memory: false,
      channel: "web",
    });
  });
});
