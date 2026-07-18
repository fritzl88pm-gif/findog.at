import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSupabaseServerClient } from "./supabase/server";
import { persistConversationTurn, type PersistConversationTurnOptions } from "./persistence";
import { createResearchEvidenceDraft } from "./research-evidence";
import type { ResearchMemoryCard } from "./research-memory-cards";

vi.mock("./supabase/server", () => ({
  getSupabaseServerClient: vi.fn(),
}));

const clientId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const turnKey = "33333333-3333-4333-8333-333333333333";

type RpcResult = { data: unknown; error: unknown; status?: number };
type AtomicPayload = Record<string, unknown> & {
  agent_run: Record<string, unknown>;
  research_evidence: Array<Record<string, unknown>>;
  document_artifacts: Array<Record<string, unknown>>;
};
type RpcArguments = { payload: AtomicPayload };

function completedRpcResult(pdfArtifacts: unknown[] = []): RpcResult {
  return {
    data: {
      assistantMessageId: 2,
      agentRunId: turnKey,
      pdfArtifacts,
      artifactsPersisted: true,
    },
    error: null,
  };
}

function persistenceClient(result: RpcResult = completedRpcResult()) {
  const query = {
    abortSignal: vi.fn((signal: AbortSignal) => {
      void signal;
      return query;
    }),
    then: (
      resolve: (value: typeof result) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  const rpc = vi.fn((functionName: string, args: RpcArguments) => {
    void functionName;
    void args;
    return query;
  });
  const from = vi.fn(() => {
    throw new Error("persistConversationTurn must not write tables directly");
  });
  return { client: { rpc, from }, rpc, from, query };
}

function baseOptions(overrides: Partial<PersistConversationTurnOptions> = {}): PersistConversationTurnOptions {
  return {
    conversationId,
    clientId,
    turnKey,
    userMessage: "Frage",
    assistantMessage: "Antwort",
    modelProvenance: {
      model: "deepseek-v4-pro",
      provider: "deepseek",
      upstreamModel: "deepseek-v4-pro",
      reasoning: "high",
      settingsRevision: 12,
      settingsSource: "database",
    },
    startedAt: "2026-07-09T10:00:00.000Z",
    completedAt: "2026-07-09T10:01:00.000Z",
    ...overrides,
  };
}

describe("persistConversationTurn", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("does not start the atomic RPC when persistence was already aborted", async () => {
    const fake = persistenceClient();
    vi.mocked(getSupabaseServerClient).mockReturnValue(fake.client as never);
    const controller = new AbortController();
    const reason = new Error("persistence deadline reached");
    controller.abort(reason);

    await expect(persistConversationTurn(baseOptions({ signal: controller.signal })))
      .rejects.toBe(reason);

    expect(fake.rpc).not.toHaveBeenCalled();
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("passes AbortSignal to the one in-flight RPC and propagates its reason", async () => {
    const controller = new AbortController();
    const reason = new Error("persistence deadline reached");
    let querySignal: AbortSignal | undefined;
    const query = {
      abortSignal: vi.fn((signal: AbortSignal) => {
        querySignal = signal;
        return query;
      }),
      then: (
        _resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => new Promise((_resolve, rejectPromise) => {
        querySignal?.addEventListener(
          "abort",
          () => rejectPromise(querySignal?.reason),
          { once: true },
        );
      }).then(_resolve, reject),
    };
    const rpc = vi.fn(() => query);
    const from = vi.fn();
    vi.mocked(getSupabaseServerClient).mockReturnValue({ rpc, from } as never);

    const persistence = persistConversationTurn(baseOptions({ signal: controller.signal }));
    await vi.waitFor(() => expect(query.abortSignal).toHaveBeenCalledWith(controller.signal));
    controller.abort(reason);

    await expect(persistence).rejects.toBe(reason);
    expect(rpc).toHaveBeenCalledOnce();
    expect(from).not.toHaveBeenCalled();
  });

  it("writes a complete turn through exactly one RPC and no direct table request", async () => {
    const fake = persistenceClient();
    vi.mocked(getSupabaseServerClient).mockReturnValue(fake.client as never);

    const result = await persistConversationTurn(baseOptions({
      title: "Präziser Titel",
      steps: [{
        type: "tool_result",
        title: "RIS-Recherche",
        content: "Bearer secret-token; sk-secretvalue123",
        toolName: "search_ris",
        success: true,
      }],
    }));

    expect(fake.rpc).toHaveBeenCalledOnce();
    expect(fake.from).not.toHaveBeenCalled();
    expect(fake.rpc).toHaveBeenCalledWith("persist_conversation_turn", {
      payload: expect.objectContaining({
        conversation_id: conversationId,
        client_id: clientId,
        title: "Präziser Titel",
        user_message: "Frage",
        assistant_message: {
          content: "Antwort",
          model: "deepseek-v4-pro",
          model_provider: "deepseek",
          upstream_model: "deepseek-v4-pro",
          reasoning_setting: "high",
          model_settings_revision: 12,
          model_settings_source: "database",
        },
        agent_run: expect.objectContaining({
          id: turnKey,
          started_at: "2026-07-09T10:00:00.000Z",
          completed_at: "2026-07-09T10:01:00.000Z",
        }),
        agent_steps: [expect.objectContaining({
          step_order: 0,
          step_type: "tool_result",
          tool_name: "search_ris",
          success: true,
          content: "Bearer [redacted]; sk-[redacted]",
        })],
        research_evidence: [],
        document_artifacts: [],
      }),
    });
    expect(result).toEqual(completedRpcResult().data);
  });

  it("places the run snapshot and complete evidence/card provenance in the atomic payload", async () => {
    const fake = persistenceClient();
    vi.mocked(getSupabaseServerClient).mockReturnValue(fake.client as never);
    const stichtag = {
      kind: "explicit" as const,
      stichtag: "2024-12-31",
      matchedText: "31.12.2024",
    };
    const semanticArguments = { query: "VwGH Pendlerpauschale", requestedLimit: 40 };
    const effectiveArguments = {
      query: "VwGH Pendlerpauschale",
      kb_id: "ris-judikatur-kb",
      limit: 7,
    };
    const structuredContent = { hits: [{ id: "RIS-VWGHT-2024-001", score: 0.91 }] };
    const evidence = createResearchEvidenceDraft({
      id: "44444444-4444-4444-8444-444444444444",
      resultStepOrder: 0,
      evidenceOrder: 0,
      semanticToolName: "search_ris_judikatur",
      semanticArguments,
      rawToolName: "hybrid_search",
      effectiveArguments,
      source: {
        key: "ris_judikatur",
        name: "RIS Judikatur",
        kbId: "ris-judikatur-kb",
        system: "ris",
      },
      stichtag,
      resultText: "Vollständiger Rechercheinhalt mit Primärquellenhinweis.",
      structuredContent,
      resultLimit: 7,
      retrievedAt: "2026-07-09T10:00:30.000Z",
    });
    const memoryCard: ResearchMemoryCard = {
      id: "66666666-6666-4666-8666-666666666666",
      summary: "Der Treffer betrifft die Pendlerpauschale; vor Verwendung erneut im RIS prüfen.",
      topics: ["Pendlerpauschale", "VwGH"],
      evidenceIds: [evidence.id],
      generatedBy: "llm",
      requeryRequired: true,
    };

    await persistConversationTurn(baseOptions({
      userMessage: "Wie war die Rechtslage zum 31.12.2024?",
      researchResultLimit: 7,
      researchResultLimitSource: "database",
      researchStichtag: stichtag,
      steps: [{
        type: "tool_result",
        title: "RIS-Judikatur",
        content: "gekürzte UI-Vorschau",
        toolName: "search_ris_judikatur",
        success: true,
      }],
      researchEvidence: [evidence],
      researchMemoryCards: [memoryCard],
    }));

    const payload = fake.rpc.mock.calls[0]?.[1].payload;
    expect(payload.agent_run).toEqual(expect.objectContaining({
      id: turnKey,
      research_result_limit: 7,
      research_result_limit_source: "database",
      research_stichtag: "2024-12-31",
      research_stichtag_kind: "explicit",
      research_stichtag_reason: null,
      research_stichtag_matched_text: "31.12.2024",
      research_reference_year: null,
    }));
    expect(payload.research_evidence).toEqual([expect.objectContaining({
      id: evidence.id,
      result_step_order: 0,
      evidence_order: 0,
      semantic_tool_name: "search_ris_judikatur",
      raw_tool_name: "hybrid_search",
      semantic_arguments: semanticArguments,
      effective_arguments: effectiveArguments,
      structured_content: structuredContent,
      content: evidence.content,
      content_sha256: evidence.contentSha256,
      original_content_sha256: evidence.originalContentSha256,
      card_summary: memoryCard.summary,
      card_topics: memoryCard.topics,
      card_generation: "llm",
      card_model: "deepseek-v4-pro",
      card_model_provider: "deepseek",
      card_upstream_model: "deepseek-v4-pro",
      card_reasoning: "disabled",
      card_prompt_version: 1,
    })]);
    expect(payload.research_evidence[0]).not.toHaveProperty("agent_run_id");
    expect(payload.research_evidence[0]).not.toHaveProperty("conversation_id");
    expect(payload.research_evidence[0]).not.toHaveProperty("client_id");
  });

  it("rejects the whole write instead of silently dropping unscoped evidence", async () => {
    const fake = persistenceClient();
    vi.mocked(getSupabaseServerClient).mockReturnValue(fake.client as never);
    const stichtag = {
      kind: "implicit" as const,
      stichtag: "2026-07-18",
      reason: "default_current" as const,
    };
    const evidence = createResearchEvidenceDraft({
      id: "44444444-4444-4444-8444-444444444444",
      resultStepOrder: 0,
      evidenceOrder: 0,
      semanticToolName: "search_ris",
      semanticArguments: { query: "EStG" },
      rawToolName: "hybrid_search",
      effectiveArguments: { query: "EStG", limit: 5 },
      source: { key: "ris", name: "RIS", kbId: "ris-kb" },
      stichtag,
      resultText: "Rechercheinhalt",
      resultLimit: 5,
      retrievedAt: "2026-07-18T08:00:00.000Z",
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await persistConversationTurn(baseOptions({
      researchResultLimit: 5,
      researchResultLimitSource: "fallback",
      researchStichtag: stichtag,
      steps: [{
        type: "tool_result",
        title: "RIS",
        content: "Fehler",
        toolName: "search_ris",
        success: false,
      }],
      researchEvidence: [evidence],
    }));

    expect(result).toBeNull();
    expect(fake.rpc).not.toHaveBeenCalled();
    expect(fake.from).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      "Supabase atomic conversation persistence validation failed",
    );
    consoleError.mockRestore();
  });

  it("sends PDF content in the same RPC and returns only persisted offers", async () => {
    const artifact = {
      id: "55555555-5555-4555-8555-555555555555",
      title: "Aufstellung",
      filename: "Aufstellung.pdf",
      contentMarkdown: "# Aufstellung\n\nEigenständiger Inhalt.",
      contentSha256: "a".repeat(64),
      stichtag: "2024-12-31",
      provenance: { version: 1, basis: "conversation" },
    };
    const offer = { id: artifact.id, title: artifact.title, filename: artifact.filename };
    const fake = persistenceClient(completedRpcResult([offer]));
    vi.mocked(getSupabaseServerClient).mockReturnValue(fake.client as never);

    const result = await persistConversationTurn(baseOptions({ pdfArtifacts: [artifact] }));

    expect(fake.rpc).toHaveBeenCalledOnce();
    expect(fake.rpc.mock.calls[0]?.[1].payload.document_artifacts).toEqual([{
      id: artifact.id,
      kind: "pdf",
      title: artifact.title,
      filename: artifact.filename,
      content_markdown: artifact.contentMarkdown,
      content_sha256: artifact.contentSha256,
      stichtag: "2024-12-31",
      provenance: artifact.provenance,
    }]);
    expect(result).toEqual({
      assistantMessageId: 2,
      agentRunId: turnKey,
      pdfArtifacts: [offer],
      artifactsPersisted: true,
    });
  });

  it("reuses an explicit turn key with an byte-equivalent payload for uncertain retries", async () => {
    const fake = persistenceClient();
    vi.mocked(getSupabaseServerClient).mockReturnValue(fake.client as never);
    const options = baseOptions({
      steps: [{ type: "progress", title: "Prüfung", content: "Inhalt" }],
    });

    await persistConversationTurn(options);
    await persistConversationTurn(options);

    expect(fake.rpc).toHaveBeenCalledTimes(2);
    expect(fake.rpc.mock.calls[0][0]).toBe("persist_conversation_turn");
    expect(fake.rpc.mock.calls[1][0]).toBe("persist_conversation_turn");
    expect(fake.rpc.mock.calls[1][1]).toEqual(fake.rpc.mock.calls[0][1]);
  });

  it("does not fall back to partial table writes when the atomic RPC fails", async () => {
    const fake = persistenceClient({
      data: null,
      error: { code: "23514", message: "scope mismatch" },
    });
    vi.mocked(getSupabaseServerClient).mockReturnValue(fake.client as never);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(persistConversationTurn(baseOptions())).resolves.toBeNull();

    expect(fake.rpc).toHaveBeenCalledOnce();
    expect(fake.from).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith("Supabase atomic conversation persistence failed");
    consoleError.mockRestore();
  });

  it("throws a resolved status-0 transport failure so the stable-key caller can reconcile", async () => {
    const fake = persistenceClient({
      data: null,
      error: { message: "TypeError: fetch failed" },
      status: 0,
    });
    vi.mocked(getSupabaseServerClient).mockReturnValue(fake.client as never);

    await expect(persistConversationTurn(baseOptions())).rejects.toThrow(
      "Supabase atomic conversation persistence transport failed",
    );

    expect(fake.rpc).toHaveBeenCalledOnce();
    expect(fake.from).not.toHaveBeenCalled();
  });
});
