import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GET } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

describe("GET /api/fred/conversations/[conversationId]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "user-1" });
  });

  it("returns persisted attachment provenance and the web-search flag", async () => {
    const conversationQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: "33333333-3333-4333-8333-333333333333",
          title: "Beleg prüfen",
          created_at: "2026-07-19T07:00:00.000Z",
          updated_at: "2026-07-19T07:01:00.000Z",
        },
        error: null,
      }),
    };
    const messageResult = {
      data: [{
        id: 1,
        role: "user",
        content: "Was steht in diesem Beleg?",
        provider_created_at: "2026-07-19T07:00:00.000Z",
        created_at: "2026-07-19T07:00:01.000Z",
        attachments: [{
          kind: "file",
          name: "beleg.pdf",
          mime_type: "application/pdf",
          size_bytes: 3,
          sha256: "0".repeat(64),
        }],
        web_search_enabled: true,
        display_content: null,
        research_trace: [],
        source_references: [],
      }, {
        id: 2,
        role: "assistant",
        content: 'Ergebnis <kb doc="EStG.md" chunk_id="chunk-1" kb_id="kb-1" />',
        display_content: null,
        research_trace: [{
          id: "call-1",
          kind: "knowledge",
          status: "completed",
          label: "Wissensbasis durchsucht",
        }],
        source_references: [],
        provider_created_at: "2026-07-19T07:00:02.000Z",
        created_at: "2026-07-19T07:00:02.000Z",
        attachments: [],
        web_search_enabled: false,
      }],
      error: null,
    };
    const messagesQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      then: (resolve: (value: typeof messageResult) => unknown) => resolve(messageResult),
    };
    vi.mocked(getSupabaseServerClient).mockReturnValue({
      from: vi.fn((table: string) => (
        table === "fred_conversations" ? conversationQuery : messagesQuery
      )),
    } as never);

    const response = await GET(
      new Request("https://findog.at/api/fred/conversations/33333333-3333-4333-8333-333333333333", {
        headers: { Authorization: "Bearer token", "Sec-Fetch-Site": "same-origin" },
      }),
      { params: Promise.resolve({ conversationId: "33333333-3333-4333-8333-333333333333" }) },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.messages[0]).toMatchObject({
      attachments: [{
        kind: "file",
        name: "beleg.pdf",
        mimeType: "application/pdf",
        sizeBytes: 3,
        sha256: "0".repeat(64),
      }],
      webSearchEnabled: true,
    });
    expect(payload.messages[1]).toMatchObject({
      content: "Ergebnis",
      researchTrace: [{
        id: "call-1",
        kind: "knowledge",
        status: "completed",
        label: "Wissensbasis durchsucht",
      }],
      sourceReferences: [{
        kind: "knowledge",
        doc: "EStG.md",
        chunkId: "chunk-1",
        knowledgeBaseId: "kb-1",
      }],
    });
    expect(payload.messages[1].content).not.toContain("<kb");
  });
});
