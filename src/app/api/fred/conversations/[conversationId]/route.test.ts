import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { verifyBfgCitations } from "@/lib/findok/bfg-citations";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { DELETE, GET } from "./route";

vi.mock("@/lib/auth/server", () => ({ authenticateSupabaseRequest: vi.fn() }));
vi.mock("@/lib/findok/bfg-citations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/findok/bfg-citations")>();
  return { ...actual, verifyBfgCitations: vi.fn() };
});

describe("DELETE /api/fred/conversations/[conversationId]", () => {
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const conversationId = "33333333-3333-4333-8333-333333333333";

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: userId });
  });

  it("uses the owner-scoped atomic deletion RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ id: conversationId }], error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);

    const response = await DELETE(
      new Request(`https://findog.at/api/fred/conversations/${conversationId}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer token" },
      }),
      { params: Promise.resolve({ conversationId }) },
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("delete_owned_fred_conversations", {
      p_client_id: userId,
      p_conversation_ids: [conversationId],
    });
    await expect(response.json()).resolves.toEqual({ deletedIds: [conversationId] });
  });

  it("does not reveal another owner's conversation", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc } as never);

    const response = await DELETE(
      new Request(`https://findog.at/api/fred/conversations/${conversationId}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer token" },
      }),
      { params: Promise.resolve({ conversationId }) },
    );

    expect(response.status).toBe(404);
  });
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
          agent_key: "fred",
          origin: "telegram",
          telegram_integration_id: "44444444-4444-4444-8444-444444444444",
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
        pro_mode_enabled: true,
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
        pro_mode_enabled: false,
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
    expect(payload.conversation).toMatchObject({
      origin: "telegram",
      telegramIntegrationId: "44444444-4444-4444-8444-444444444444",
    });
    expect(payload.messages[0]).toMatchObject({
      agentKey: "fred",
      attachments: [{
        kind: "file",
        name: "beleg.pdf",
        mimeType: "application/pdf",
        sizeBytes: 3,
        sha256: "0".repeat(64),
      }],
      webSearchEnabled: true,
      proModeEnabled: true,
    });
    expect(payload.messages[1]).toMatchObject({
      agentKey: "fred",
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
      proModeEnabled: false,
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
          agent_key: "fred",
          origin: "web",
          telegram_integration_id: null,
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
        pro_mode_enabled: false,
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

  it("preserves rewritten display_content containing findog-artifact markers in message history", async () => {
    const artifactId = "77777777-7777-4777-8777-777777777777";
    const conversationQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: "33333333-3333-4333-8333-333333333333",
          client_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          title: "Bild-Frage",
          created_at: "2026-07-18T07:00:00.000Z",
          updated_at: "2026-07-18T07:01:00.000Z",
          agent_key: "default",
          origin: "web",
          telegram_integration_id: null,
        },
        error: null,
      }),
    };
    const messageResult = {
      data: [{
        id: "msg-assistant",
        role: "assistant",
        content: "Raw: ![Beleg](minio://bucket/beleg.png)",
        display_content: `Ergebnis: ![Beleg](findog-artifact://${artifactId})`,
        research_trace: [],
        source_references: [],
        provider_created_at: "2026-07-18T07:01:00.000Z",
        created_at: "2026-07-18T07:01:00.000Z",
        attachments: [],
        web_search_enabled: false,
        pro_mode_enabled: false,
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
    expect(payload.messages[0].content).toBe(`Ergebnis: ![Beleg](findog-artifact://${artifactId})`);
  });

  it("selects and parses execution_trace in conversation message history", async () => {
    const conversationQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: "33333333-3333-4333-8333-333333333333",
          title: "Ausführungsverlauf",
          created_at: "2026-07-18T07:00:00.000Z",
          updated_at: "2026-07-18T07:01:00.000Z",
          agent_key: "fred",
          origin: "web",
          telegram_integration_id: null,
        },
        error: null,
      }),
    };
    const messageResult = {
      data: [{
        id: 1,
        role: "user",
        content: "Frage",
        provider_created_at: "2026-07-18T07:00:00.000Z",
        created_at: "2026-07-18T07:00:01.000Z",
        attachments: [],
        web_search_enabled: false,
        pro_mode_enabled: false,
        display_content: null,
        research_trace: [],
        execution_trace: [],
        source_references: [],
      }, {
        id: 2,
        role: "assistant",
        content: "Antwort",
        display_content: null,
        research_trace: [{
          id: "step-1",
          kind: "knowledge",
          status: "completed",
          label: "Wissensbasis durchsucht",
        }],
        execution_trace: [{
          id: "exec-1",
          kind: "planning",
          status: "completed",
          label: "Rechercheplan aktualisiert",
          detail: "3 Aufgaben geplant",
          counts: { total: 3, completed: 3, inProgress: 0, open: 0 },
        }],
        source_references: [],
        provider_created_at: "2026-07-18T07:00:02.000Z",
        created_at: "2026-07-18T07:00:02.000Z",
        attachments: [],
        web_search_enabled: false,
        pro_mode_enabled: false,
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
    expect(payload.messages[1].executionTrace).toEqual([{
      id: "exec-1",
      kind: "planning",
      status: "completed",
      label: "Rechercheplan aktualisiert",
      detail: "3 Aufgaben geplant",
      counts: { total: 3, completed: 3, inProgress: 0, open: 0 },
    }]);
  });
});
