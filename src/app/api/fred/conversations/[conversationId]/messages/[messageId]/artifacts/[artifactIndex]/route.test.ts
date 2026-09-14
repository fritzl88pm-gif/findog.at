import "server-only";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { UserVisibleError } from "@/lib/errors";
import { GET } from "./route";

const userId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const messageId = "42";
const params = (artifactIndex: string) => ({ params: Promise.resolve({ conversationId, messageId, artifactIndex }) });

function supabaseFor(message: unknown, conversation = { id: conversationId, weknora_session_id: "session-1", client_id: userId }) {
  let call = 0;
  const builder = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockImplementation(async () => call++ === 0 ? { data: conversation, error: null } : { data: message, error: null }),
  };
  return { from: vi.fn().mockReturnValue(builder) };
}

describe("generated artifact download", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.WEKNORA_API_KEY = "test-key";
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: userId });
  });

  it("rejects signed-out and malformed/sparse indexes before upstream", async () => {
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabaseFor(null) as never);
    vi.mocked(authenticateSupabaseRequest).mockRejectedValue(new UserVisibleError("Bitte zuerst anmelden.", 401));
    expect((await GET(new Request("https://findog.at"), params("3"))).status).toBe(401);

    const fetchMock = vi.spyOn(globalThis, "fetch");
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: userId });
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabaseFor({ artifacts: [
      { id: "a", upstreamMessageId: "up", upstreamIndex: 3, fileName: "a.txt", fileType: ".txt", sourceUri: "resource://a" },
    ] }) as never);
    expect((await GET(new Request("https://findog.at"), params("2"))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not reveal a conversation owned by another user", async () => {
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabaseFor(null, null as never) as never);
    const fetchMock = vi.spyOn(globalThis, "fetch");
    expect((await GET(new Request("https://findog.at", { headers: { Authorization: "Bearer token" } }), params("3"))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns owned sparse artifact bytes and filename using its upstream index", async () => {
    vi.mocked(getSupabaseServerClient).mockReturnValue(supabaseFor({ artifacts: [
      { id: "a", upstreamMessageId: "up", upstreamIndex: 3, fileName: "a.txt", fileType: ".txt", sourceUri: "resource://a" },
      { id: "b", upstreamMessageId: "up", upstreamIndex: 7, fileName: "b.pdf", fileType: ".pdf", sourceUri: "resource://b" },
    ] }) as never);
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([9, 8, 7]), {
      status: 200, headers: { "content-length": "3" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(new Request("https://findog.at", { headers: { Authorization: "Bearer token" } }), params("7"));
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([9, 8, 7]));
    expect(response.headers.get("content-disposition")).toContain("b.pdf");
    expect(fetchMock).toHaveBeenCalled();
  });
});
