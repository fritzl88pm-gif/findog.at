import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { verifyBfgCitations } from "@/lib/findok/bfg-citations";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { GET } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/findok/bfg-citations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/findok/bfg-citations")>();
  return { ...actual, verifyBfgCitations: vi.fn() };
});
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: vi.fn() }));

describe("GET /api/fred/conversations/[conversationId]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "user-1" });
    vi.mocked(verifyBfgCitations).mockResolvedValue({ verified: [], rejected: [] });
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

  it("re-verifies and links BFG citations in legacy assistant messages", async () => {
    const conversationQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: "33333333-3333-4333-8333-333333333333",
          title: "BFG-Fundstellen",
          created_at: "2026-07-18T07:00:00.000Z",
          updated_at: "2026-07-18T07:01:00.000Z",
        },
        error: null,
      }),
    };
    const messageResult = {
      data: [{
        id: 1,
        role: "assistant",
        content: "Siehe RV/1100290/2023 und RV/9999999/2023.",
        display_content: null,
        research_trace: [],
        source_references: [],
        provider_created_at: "2026-07-18T07:01:00.000Z",
        created_at: "2026-07-18T07:01:00.000Z",
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
    vi.mocked(verifyBfgCitations).mockResolvedValue({
      verified: [{
        gz: "RV/1100290/2023",
        title: "Entscheidung",
        documentTitle: "Entscheidung",
        dokumentId: "doc-1",
        segmentId: "segment-1",
        indexName: "findok-bfg",
        fullTextUrl: "https://findok.bmf.gv.at/findok/volltext?gz=RV%2F1100290%2F2023",
        pdfUrl: "https://findok.bmf.gv.at/findok/resources/pdf/doc-1.pdf",
      }],
      rejected: [{
        status: "not_found",
        gz: "RV/9999999/2023",
        reason: "Nicht gefunden",
      }],
    });

    const response = await GET(
      new Request("https://findog.at/api/fred/conversations/33333333-3333-4333-8333-333333333333", {
        headers: { Authorization: "Bearer token", "Sec-Fetch-Site": "same-origin" },
      }),
      { params: Promise.resolve({ conversationId: "33333333-3333-4333-8333-333333333333" }) },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(verifyBfgCitations).toHaveBeenCalledWith([
      "RV/1100290/2023",
      "RV/9999999/2023",
    ]);
    expect(payload.messages[0].content).toBe(
      "Siehe [RV/1100290/2023](https://findok.bmf.gv.at/findok/volltext?gz=RV%2F1100290%2F2023) und RV/9999999/2023.",
    );
    expect(payload.messages[0].sourceReferences).toContainEqual({
      kind: "web",
      url: "https://findok.bmf.gv.at/findok/volltext?gz=RV%2F1100290%2F2023",
      title: "BFG RV/1100290/2023: Entscheidung",
    });
  });
});
