import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { resetFredEmbedCachesForTests } from "@/lib/weknora/fred-embed-cache";
import { GET } from "./route";

const userId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const chunkId = "2d9470d0-2723-444a-8bfa-fcced491c15d";
const kbId = "e0282ab8-b94f-4553-962e-68705201cf9a";
const tag = `<kb doc="DBA_Deutschland_Fassung_2026-07-13.md" chunk_id="${chunkId}" kb_id="${kbId}" />`;
const stored = `Aussage ${tag}. Web <web url="https://example.test/seite" title="Seite" /> Ende.`;

const params = (index: string, messageId = "42", conversation = conversationId) => ({
  params: Promise.resolve({ conversationId: conversation, messageId, index }),
});

function request(): Request {
  return new Request("https://findog.at/api", { headers: { Authorization: "Bearer token" } });
}

function supabaseFor(options: {
  conversation?: Record<string, unknown> | null;
  message?: Record<string, unknown> | null;
} = {}) {
  const conversation = options.conversation === undefined
    ? { id: conversationId, agent_key: "fred" }
    : options.conversation;
  const message = options.message === undefined
    ? { role: "assistant", content: stored, display_content: stored }
    : options.message;
  const eqCalls: Array<[string, unknown]> = [];
  let call = 0;
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn((column: string, value: unknown) => {
      eqCalls.push([column, value]);
      return builder;
    }),
    maybeSingle: vi.fn().mockImplementation(async () => ({
      data: call++ === 0 ? conversation : message,
      error: null,
    })),
  };
  return { client: { from: vi.fn().mockReturnValue(builder) }, eqCalls };
}

function chunkResponse(content: string, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    success: true,
    data: {
      id: chunkId,
      content,
      chunk_index: 3,
      knowledge_base_id: kbId,
      knowledge_id: "99999999-9999-4999-8999-999999999999",
      start_at: 0,
      end_at: 100,
      ...extra,
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function embedFetch(chunk: () => Response) {
  return vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    void _init;
    const url = String(input);
    if (url.endsWith("/exchange")) {
      return new Response(JSON.stringify({
        success: true,
        data: { session_token: "ems_test_session_token_1234567890", expires_in: 1800 },
      }), { status: 200 });
    }
    return chunk();
  });
}

describe("GET /api/fred/conversations/[id]/messages/[id]/sources/[index]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
    resetFredEmbedCachesForTests();
    process.env.WEKNORA_FRED_CHANNEL_ID = "fred-channel";
    process.env.WEKNORA_FRED_PUBLISH_TOKEN = "em_publish_token_fixture_1234567890";
    process.env.WEKNORA_FRED_EXCHANGE_ORIGIN = "https://findog.at";
    process.env.WEKNORA_QUICKFRED_CHANNEL_ID = "quick-channel";
    process.env.WEKNORA_QUICKFRED_PUBLISH_TOKEN = "em_quick_publish_token_fixture_12345";
    process.env.WEKNORA_QUICKFRED_AGENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: userId } as never);
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabaseFor().client as never);
  });

  it("requires an authenticated user", async () => {
    vi.mocked(authenticateSupabaseRequest).mockRejectedValue(new UserVisibleError("Bitte zuerst anmelden.", 401));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(request(), params("0"));
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("scopes conversation and message to the authenticated user and hides foreign ones", async () => {
    const { client, eqCalls } = supabaseFor({ conversation: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue(client as never);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(request(), params("0"));
    expect(response.status).toBe(404);
    expect(eqCalls).toContainEqual(["client_id", userId]);
    expect(fetchMock).not.toHaveBeenCalled();

    const foreignMessage = supabaseFor({ message: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue(foreignMessage.client as never);
    expect((await GET(request(), params("42"))).status).toBe(404);
    expect(foreignMessage.eqCalls.filter(([column]) => column === "client_id")).toEqual([
      ["client_id", userId],
      ["client_id", userId],
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 404 for user messages and for an index beyond the cited sources", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(getSupabaseServerClient).mockReturnValue(
      supabaseFor({ message: { role: "user", content: stored, display_content: null } }).client as never,
    );
    expect((await GET(request(), params("0"))).status).toBe(404);

    vi.mocked(getSupabaseServerClient).mockReturnValue(supabaseFor().client as never);
    expect((await GET(request(), params("2"))).status).toBe(404);
    expect((await GET(request(), params("57"))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed identifiers before touching the database", async () => {
    expect((await GET(request(), params("abc"))).status).toBe(400);
    expect((await GET(request(), params("0", "x"))).status).toBe(400);
    expect((await GET(request(), params("0", "42", "not-a-uuid"))).status).toBe(400);
    expect(getSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("fetches the cited chunk through the embed route and returns only doc, location and text", async () => {
    const fetchMock = embedFetch(() => chunkResponse(
      "> DBA Deutschland | Art. 15 | Abs. 1 | Teil 1 | Stichtag: 2026-07-13 | RIS: 20002157\n\nEinkünfte aus unselbständiger Arbeit …  \n",
    ));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request(), params("0"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      doc: "DBA_Deutschland_Fassung_2026-07-13.md",
      location: "DBA Deutschland | Art. 15 | Abs. 1 | Teil 1 | Stichtag: 2026-07-13 | RIS: 20002157",
      text: "Einkünfte aus unselbständiger Arbeit …",
    });
    expect(JSON.stringify(body)).not.toContain(chunkId);
    expect(JSON.stringify(body)).not.toContain(kbId);

    const chunkCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/chunks/"));
    expect(String(chunkCall?.[0])).toBe(
      `https://taxdog.cloud/api/v1/embed/fred-channel/chunks/${chunkId}`,
    );
    expect(chunkCall?.[1]).toMatchObject({
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: "Embed ems_test_session_token_1234567890",
        Origin: "https://findog.at",
      },
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("returns chunks without a location line and caps long text", async () => {
    vi.stubGlobal("fetch", embedFetch(() => chunkResponse(`${"Wort ".repeat(1_500)}`)));
    const body = await (await GET(request(), params("0"))).json();
    expect(body.location).toBeUndefined();
    expect(body.text.length).toBeLessThanOrEqual(4_001);
    expect(body.text.endsWith("…")).toBe(true);
  });

  it("returns web sources without any upstream request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(request(), params("1"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ doc: "Seite", url: "https://example.test/seite" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the QuickFred channel for QuickFred conversations", async () => {
    vi.mocked(getSupabaseServerClient).mockReturnValue(
      supabaseFor({ conversation: { id: conversationId, agent_key: "quickfred" } }).client as never,
    );
    const fetchMock = embedFetch(() => chunkResponse("Text"));
    vi.stubGlobal("fetch", fetchMock);
    expect((await GET(request(), params("0"))).status).toBe(200);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/embed/quick-channel/chunks/"))).toBe(true);
  });

  it.each([
    [403, 404],
    [404, 404],
    [500, 502],
    [502, 502],
  ])("maps an upstream %i to %i with a German message and no ids", async (upstream, expected) => {
    vi.stubGlobal("fetch", embedFetch(() => new Response("{}", { status: upstream })));
    const response = await GET(request(), params("0"));
    expect(response.status).toBe(expected);
    const body = await response.json();
    expect(body.error).toMatch(/Fundstelle/u);
    expect(JSON.stringify(body)).not.toContain(chunkId);
  });

  it("retries once with a fresh embed session when WeKnora rejects the cached one", async () => {
    let chunkCalls = 0;
    const fetchMock = embedFetch(() => (++chunkCalls === 1 ? new Response("{}", { status: 401 }) : chunkResponse("Text")));
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(request(), params("0"));
    expect(response.status).toBe(200);
    expect(chunkCalls).toBe(2);
  });

  it("answers 502 for an unusable upstream payload", async () => {
    vi.stubGlobal("fetch", embedFetch(() => new Response(JSON.stringify({ success: false }), { status: 200 })));
    expect((await GET(request(), params("0"))).status).toBe(502);
  });

  it("answers 502 when no embed session can be minted", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    expect((await GET(request(), params("0"))).status).toBe(502);
  });

  it("rate-limits a user", async () => {
    vi.stubGlobal("fetch", embedFetch(() => chunkResponse("Text")));
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "rate-limited-user" } as never);
    let last = 200;
    for (let attempt = 0; attempt < 70; attempt += 1) {
      last = (await GET(request(), params("1"))).status;
    }
    expect(last).toBe(429);
  });
});
