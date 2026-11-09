import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { publicCitedSources, renderCitedAnswer } from "@/lib/fred/citations";
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
    });
    // Historic Pro flags stay in the database but are no longer surfaced.
    expect(payload.messages[0]).not.toHaveProperty("proModeEnabled");
    expect(payload.messages[1]).toMatchObject({
      agentKey: "fred",
      // The stored citation tag becomes a numbered marker (clickable in the UI).
      content: "Ergebnis⟦1⟧",
      citedSources: [{ kind: "knowledge", doc: "EStG.md" }],
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

  it("sanitizes legacy stored execution traces on read: no reasoning, no ids, no raw payloads", async () => {
    const uuid = "6f9619ff-8b86-d011-b42d-00c04fc964ff";
    const conversationQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: "33333333-3333-4333-8333-333333333333",
          title: "Altbestand",
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
        id: 2,
        role: "assistant",
        content: "Antwort",
        display_content: null,
        research_trace: [],
        execution_trace: [
          { id: "analysis:1", kind: "analysis", status: "running", label: "Anfrage wird analysiert", detail: "Ich überlege geheim" },
          {
            id: "knowledge:1", kind: "knowledge", status: "completed", label: "Wissensbasis durchsucht", toolName: "search_knowledge",
            callId: "raw-call-id",
            arguments: JSON.stringify({ queries: ["Pendlerpauschale"], knowledge_base_ids: [uuid] }),
            result: JSON.stringify({ results: [{ knowledge_title: "LStR_2002_idF_2025-12-18_full_verified.md", knowledge_id: uuid, match_snippet: "Rz 250", score: 0.9 }] }),
          },
        ],
        source_references: [
          { kind: "knowledge", doc: "LStR 2002", chunkId: "chunk-secret", knowledgeBaseId: uuid },
        ],
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
    const payload = await response.json();
    const [message] = payload.messages;
    expect(message.executionTrace).toHaveLength(2);
    expect(message.executionTrace[0]).toMatchObject({ kind: "analysis", status: "completed" });
    expect(message.executionTrace[1]).toMatchObject({
      queries: ["Pendlerpauschale"],
      sources: [{ title: "LStR_2002_idF_2025-12-18_full_verified.md", kind: "guideline", score: 0.9 }],
    });
    expect(message.sourceReferences).toEqual([{ kind: "knowledge", doc: "LStR 2002" }]);
    const json = JSON.stringify(payload);
    for (const leaked of ["geheim", uuid, "raw-call-id", "chunk-secret", "knowledge_base_ids"]) {
      expect(json).not.toContain(leaked);
    }
  });
});

describe("GET /api/fred/conversations/[conversationId] citations", () => {
  const conversationId = "33333333-3333-4333-8333-333333333333";
  const chunkA = "2d9470d0-2723-444a-8bfa-fcced491c15d";
  const chunkB = "3e9470d0-2723-444a-8bfa-fcced491c15e";
  const kbId = "e0282ab8-b94f-4553-962e-68705201cf9a";
  const tagA = `<kb doc="DBA_Deutschland_Fassung_2026-07-13.md" chunk_id="${chunkA}" kb_id="${kbId}" />`;
  const tagB = `<kb doc="EStG_1988.md" chunk_id="${chunkB}" kb_id="${kbId}" />`;
  const stored = `Erstens ${tagA}. Zweitens ${tagB}. Wieder ${tagA}.`;

  async function load(message: Record<string, unknown>) {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "user-1" });
    vi.mocked(verifyBfgCitations).mockResolvedValue({ verified: [], rejected: [] });
    const conversationQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: conversationId, title: "T", created_at: "2026-07-19T07:00:00.000Z",
          updated_at: "2026-07-19T07:01:00.000Z", agent_key: "fred", origin: "web", telegram_integration_id: null,
        },
        error: null,
      }),
    };
    const messageResult = {
      data: [{
        id: 5, role: "assistant", content: stored, display_content: stored, research_trace: [],
        source_references: [], provider_created_at: "2026-07-19T07:01:00.000Z",
        created_at: "2026-07-19T07:01:00.000Z", attachments: [], web_search_enabled: false, artifacts: [],
        ...message,
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
      from: vi.fn((table: string) => table === "fred_conversations" ? conversationQuery : messagesQuery),
    } as never);
    const response = await GET(
      new Request(`https://findog.at/api/fred/conversations/${conversationId}`, {
        headers: { Authorization: "Bearer token", "Sec-Fetch-Site": "same-origin" },
      }),
      { params: Promise.resolve({ conversationId }) },
    );
    expect(response.status).toBe(200);
    return (await response.json()).messages[0] as Record<string, unknown>;
  }

  beforeEach(() => vi.resetAllMocks());

  it("returns the same marker text and numbering as the live final event", async () => {
    const message = await load({});
    expect(message.content).toBe("Erstens⟦1⟧. Zweitens⟦2⟧. Wieder⟦1⟧.");
    expect(message.citedSources).toEqual([
      { kind: "knowledge", doc: "DBA_Deutschland_Fassung_2026-07-13.md" },
      { kind: "knowledge", doc: "EStG_1988.md" },
    ]);
    // Identical to what the turn service sends for the same stored text.
    const live = renderCitedAnswer(stored);
    expect(message.content).toBe(live.text);
    expect(message.citedSources).toEqual(publicCitedSources(live.cited));
    expect(JSON.stringify(message.content)).not.toMatch(/<kb|chunk_id/u);
  });

  it("falls back to the raw content for legacy rows without display_content", async () => {
    const message = await load({ display_content: null });
    expect(message.content).toBe("Erstens⟦1⟧. Zweitens⟦2⟧. Wieder⟦1⟧.");
  });

  it("never sends chunk or knowledge-base ids in citedSources, in simple or advanced mode", async () => {
    const simple = await load({});
    expect(JSON.stringify(simple.citedSources)).not.toMatch(new RegExp(`${chunkA}|${kbId}`, "u"));
    const advanced = await load({
      execution_trace: [{ id: "s1", kind: "planning", status: "completed", label: "Plan" }],
    });
    expect(JSON.stringify(advanced.citedSources)).not.toMatch(new RegExp(`${chunkA}|${kbId}`, "u"));
    expect(JSON.stringify(advanced.sourceReferences)).not.toMatch(new RegExp(`${chunkA}|${kbId}`, "u"));
  });
});

describe("GET /api/fred/conversations/[conversationId] Gedankengang", () => {
  const conversationId = "33333333-3333-4333-8333-333333333333";
  const german = "Ich prüfe die Pendlerpauschale nach § 16 Abs. 1 Z 6 EStG.";

  async function load(detail: string = german) {
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "user-1" });
    vi.mocked(verifyBfgCitations).mockResolvedValue({ verified: [], rejected: [] });
    const conversationQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: conversationId, title: "T", created_at: "2026-07-19T07:00:00.000Z",
          updated_at: "2026-07-19T07:01:00.000Z", agent_key: "fred", origin: "web", telegram_integration_id: null,
        },
        error: null,
      }),
    };
    const messageResult = {
      data: [{
        id: 5, role: "assistant", content: "Antwort", display_content: "Antwort", research_trace: [],
        execution_trace: [
          { id: "analysis:phase", kind: "analysis", status: "completed", label: "Anfrage analysiert" },
          { id: "thinking:a:1", kind: "thinking", status: "completed", label: "Gedankengang", detail, afterId: "analysis:phase" },
        ],
        source_references: [], provider_created_at: "2026-07-19T07:01:00.000Z",
        created_at: "2026-07-19T07:01:00.000Z", attachments: [], web_search_enabled: false, artifacts: [],
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
      from: vi.fn((table: string) => table === "fred_conversations" ? conversationQuery : messagesQuery),
    } as never);
    const response = await GET(
      new Request(`https://findog.at/api/fred/conversations/${conversationId}`, {
        headers: { Authorization: "Bearer token", "Sec-Fetch-Site": "same-origin" },
      }),
      { params: Promise.resolve({ conversationId }) },
    );
    expect(response.status).toBe(200);
    return await response.json() as { messages: Array<{ executionTrace: Array<{ kind: string; detail?: string }> }> };
  }

  beforeEach(() => vi.resetAllMocks());

  it("returns stored German Gedankengang steps to every user (no admin lookup)", async () => {
    const payload = await load();
    expect(payload.messages[0].executionTrace.map((step) => step.kind)).toEqual(["analysis", "thinking"]);
    expect(payload.messages[0].executionTrace[1].detail).toBe(german);
  });

  it("re-sanitizes stored thinking text on read", async () => {
    const payload = await load("Siehe weknora://doc/99ada6f9-5075-445c-b071-ccc7718f4b02 und knowledge_search.");
    const text = payload.messages[0].executionTrace[1].detail ?? "";
    expect(text).not.toMatch(/weknora|99ada6f9|knowledge_search/u);
  });
});
