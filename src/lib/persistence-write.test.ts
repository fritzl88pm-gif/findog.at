import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSupabaseServerClient } from "./supabase/server";
import { persistConversationTurn } from "./persistence";

vi.mock("./supabase/server", () => ({
  getSupabaseServerClient: vi.fn(),
}));

const clientId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";

function awaitedQuery(result: { error: unknown }) {
  const query = {
    eq: vi.fn(() => query),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
  return query;
}

function persistenceClient(existingConversation: { client_id: string; title: string } | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: existingConversation, error: null });
  const ownershipEq = vi.fn().mockReturnValue({ maybeSingle });
  const conversationSelect = vi.fn().mockReturnValue({ eq: ownershipEq });
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const updateQuery = awaitedQuery({ error: null });
  const update = vi.fn().mockReturnValue(updateQuery);
  const messagesSelect = vi.fn().mockResolvedValue({
    data: [{ id: 1, role: "user" }, { id: 2, role: "assistant" }],
    error: null,
  });
  const messagesInsert = vi.fn().mockReturnValue({ select: messagesSelect });
  const runSingle = vi.fn().mockResolvedValue({
    data: { id: "33333333-3333-4333-8333-333333333333" },
    error: null,
  });
  const runInsert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: runSingle }) });
  const stepsInsert = vi.fn().mockResolvedValue({ error: null });

  const from = vi.fn((table: string) => {
    if (table === "conversations") {
      return { select: conversationSelect, upsert, update };
    }
    if (table === "messages") {
      return { insert: messagesInsert };
    }
    if (table === "agent_runs") {
      return { insert: runInsert };
    }
    return { insert: stepsInsert };
  });

  return {
    client: { from },
    upsert,
    update,
    messagesInsert,
    runInsert,
    stepsInsert,
  };
}

describe("persistConversationTurn", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("stores the generated title and sanitized ordered trace for a new conversation", async () => {
    const fake = persistenceClient(null);
    vi.mocked(getSupabaseServerClient).mockReturnValue(fake.client as never);

    await persistConversationTurn({
      conversationId,
      clientId,
      userMessage: "Frage",
      assistantMessage: "Antwort",
      title: "Präziser Titel",
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
      steps: [
        {
          type: "tool_result",
          title: "BFG-Vorabfrage",
          content: "3 Treffer",
          toolName: "hybrid_search",
          success: true,
        },
      ],
    });

    expect(fake.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Präziser Titel" }),
      { onConflict: "id" },
    );
    expect(fake.messagesInsert).toHaveBeenCalledWith([
      expect.objectContaining({ role: "user", content: "Frage" }),
      expect.objectContaining({
        role: "assistant",
        content: "Antwort",
        model: "deepseek-v4-pro",
        model_provider: "deepseek",
        upstream_model: "deepseek-v4-pro",
        reasoning_setting: "high",
        model_settings_revision: 12,
        model_settings_source: "database",
      }),
    ]);
    expect(fake.runInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        assistant_message_id: 2,
        status: "completed",
      }),
    );
    const runPayload = fake.runInsert.mock.calls[0]?.[0];
    expect(runPayload).not.toHaveProperty("model");
    expect(runPayload).not.toHaveProperty("model_provider");
    expect(runPayload).not.toHaveProperty("upstream_model");
    expect(runPayload).not.toHaveProperty("reasoning_setting");
    expect(runPayload).not.toHaveProperty("model_settings_revision");
    expect(runPayload).not.toHaveProperty("model_settings_source");
    expect(fake.stepsInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        step_order: 0,
        step_type: "tool_result",
        tool_name: "hybrid_search",
        success: true,
      }),
    ]);
  });

  it("persists extended tool evidence without expanding ordinary trace steps", async () => {
    const fake = persistenceClient({ client_id: clientId, title: "Bestehender Titel" });
    vi.mocked(getSupabaseServerClient).mockReturnValue(fake.client as never);
    const toolEvidence = `${"x".repeat(32_000)}... [gekürzt]`;

    await persistConversationTurn({
      conversationId,
      clientId,
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
      steps: [
        {
          type: "tool_result",
          title: "Datenbankergebnis",
          content: toolEvidence,
          toolName: "search_laws",
          success: true,
        },
        {
          type: "progress",
          title: "Recherche fortgesetzt",
          content: "y".repeat(5_000),
        },
      ],
    });

    const persistedSteps = fake.stepsInsert.mock.calls[0]?.[0];
    expect(persistedSteps?.[0]?.content).toBe(toolEvidence);
    expect(persistedSteps?.[1]?.content).toHaveLength(4_000);
  });

  it("updates an established conversation without overwriting its title", async () => {
    const fake = persistenceClient({ client_id: clientId, title: "Bestehender Titel" });
    vi.mocked(getSupabaseServerClient).mockReturnValue(fake.client as never);

    await persistConversationTurn({
      conversationId,
      clientId,
      userMessage: "Folgefrage",
      assistantMessage: "Antwort",
      title: "Darf nicht überschreiben",
      modelProvenance: {
        model: "deepseek-v4-pro",
        provider: "deepseek",
        upstreamModel: "deepseek-v4-pro",
        reasoning: "high",
        settingsRevision: 12,
        settingsSource: "database",
      },
      steps: [],
    });

    expect(fake.upsert).not.toHaveBeenCalled();
    expect(fake.update).toHaveBeenCalledWith({ updated_at: expect.any(String) });
  });

  it.each([
    ["agent_runs", { code: "42P01", message: 'relation "public.agent_runs" does not exist' }],
    [
      "agent_steps",
      { code: "PGRST205", message: "Could not find the table 'public.agent_steps' in the schema cache" },
    ],
  ])("quietly skips %s persistence when its relation is unavailable", async (table, error) => {
    const fake = persistenceClient({ client_id: clientId, title: "Bestehender Titel" });
    if (table === "agent_runs") {
      fake.runInsert.mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error }),
        }),
      });
    } else {
      fake.stepsInsert.mockResolvedValue({ error });
    }
    vi.mocked(getSupabaseServerClient).mockReturnValue(fake.client as never);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await persistConversationTurn({
      conversationId,
      clientId,
      userMessage: "Folgefrage",
      assistantMessage: "Antwort",
      modelProvenance: {
        model: "deepseek-v4-pro",
        provider: "deepseek",
        upstreamModel: "deepseek-v4-pro",
        reasoning: "high",
        settingsRevision: 12,
        settingsSource: "database",
      },
      steps: [
        {
          type: "tool_result",
          title: "BFG-Vorabfrage",
          content: "3 Treffer",
          toolName: "hybrid_search",
          success: true,
        },
      ],
    });

    expect(fake.messagesInsert).toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
