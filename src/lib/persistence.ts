import { randomUUID } from "node:crypto";

import type { AgentStep, PdfArtifactDraft, PdfArtifactOffer } from "./agent-steps";
import { summarizeStepText } from "./agent-steps";
import { UserVisibleError } from "./errors";
import type { ModelRunProvenance } from "./model-settings";
import { getSupabaseServerClient } from "./supabase/server";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ConversationLookupSupabaseClient = {
  from: (table: "conversations") => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<{
          data: { client_id: string | null; title?: string } | null;
          error: unknown;
        }>;
      };
    };
  };
};

function isUuid(value: string): boolean {
  return uuidPattern.test(value);
}

export function isConversationOwnedByClient(
  existingClientId: string | null | undefined,
  clientId: string,
): boolean {
  return !existingClientId || existingClientId === clientId;
}

export async function resolveConversationIdForClient(options: {
  conversationId?: string;
  clientId: string;
  supabase?: unknown;
}): Promise<string> {
  return (await resolveConversationContextForClient(options)).id;
}

export async function resolveConversationContextForClient(options: {
  conversationId?: string;
  clientId: string;
  supabase?: unknown;
}): Promise<{ id: string; title?: string; isNew: boolean }> {
  if (!isUuid(options.clientId)) {
    throw new UserVisibleError("Anmeldung konnte keinem gültigen Benutzer zugeordnet werden.", 401);
  }

  const requestedConversationId = options.conversationId?.trim();
  if (!requestedConversationId) {
    return { id: randomUUID(), isNew: true };
  }
  if (!isUuid(requestedConversationId)) {
    throw new UserVisibleError("Gespräch-ID ist ungültig.", 400);
  }

  const supabase = (options.supabase ?? getSupabaseServerClient()) as ConversationLookupSupabaseClient | null;
  if (!supabase) {
    throw new UserVisibleError("Gesprächszuordnung kann derzeit nicht geprüft werden.", 503);
  }

  const { data: existingConversation, error: lookupError } = await supabase
    .from("conversations")
    .select("client_id,title")
    .eq("id", requestedConversationId)
    .maybeSingle();
  if (lookupError) {
    throw new UserVisibleError("Gesprächszuordnung konnte nicht geprüft werden.", 503);
  }
  if (!isConversationOwnedByClient(existingConversation?.client_id, options.clientId)) {
    throw new UserVisibleError("Dieses Gespräch gehört nicht zu deinem Konto.", 403);
  }
  return {
    id: requestedConversationId,
    ...(existingConversation?.title ? { title: existingConversation.title } : {}),
    isNew: !existingConversation?.client_id,
  };
}

type PersistedStep = {
  agent_run_id: string;
  step_order: number;
  step_type: string;
  title: string;
  content: string;
  tool_name: string | null;
  success: boolean | null;
  arguments: string | null;
  tools: string[] | null;
};

type DatabaseError = {
  code?: unknown;
  message?: unknown;
};

function isMissingAgentTraceRelation(
  error: unknown,
  relation: "agent_runs" | "agent_steps",
): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const databaseError = error as DatabaseError;
  const code = typeof databaseError.code === "string" ? databaseError.code : "";
  const message = typeof databaseError.message === "string" ? databaseError.message : "";
  return (code === "42P01" || code === "PGRST205")
    && message.toLowerCase().includes(relation);
}

function sanitizeTraceText(value: unknown, maxLength: number): string {
  return summarizeStepText(value, maxLength * 2)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9._-]{8,}/giu, "sk-[redacted]")
    .slice(0, maxLength);
}

function sanitizeSteps(agentRunId: string, steps: AgentStep[]): PersistedStep[] {
  return steps.slice(0, 100).map((step, index) => ({
    agent_run_id: agentRunId,
    step_order: index,
    step_type: step.type,
    title: sanitizeTraceText(step.title, 200),
    content: sanitizeTraceText(step.content, 4_000),
    tool_name: step.type === "tool_call" || step.type === "tool_result"
      ? sanitizeTraceText(step.toolName, 120)
      : null,
    success: step.type === "tool_result" ? step.success : null,
    arguments: step.type === "tool_call" && step.arguments !== undefined
      ? sanitizeTraceText(step.arguments, 1_000)
      : null,
    tools: step.type === "tools"
      ? (step.tools ?? []).slice(0, 30).map((tool) => sanitizeTraceText(tool, 120))
      : null,
  }));
}

export type PersistedConversationTurn = {
  assistantMessageId: number;
  agentRunId: string;
  pdfArtifacts: PdfArtifactOffer[];
  artifactsPersisted: boolean;
};

export async function persistConversationTurn(options: {
  conversationId?: string;
  clientId?: string;
  userMessage?: string;
  assistantMessage: string;
  title?: string;
  modelProvenance?: ModelRunProvenance;
  steps?: AgentStep[];
  pdfArtifacts?: PdfArtifactDraft[];
  startedAt?: string;
  completedAt?: string;
}): Promise<PersistedConversationTurn | null> {
  const supabase = getSupabaseServerClient();
  if (
    !supabase
    || !options.conversationId
    || !options.clientId
    || !options.userMessage
    || !options.modelProvenance
  ) {
    return null;
  }
  if (!isUuid(options.conversationId) || !isUuid(options.clientId)) {
    return null;
  }

  const { data: existingConversation, error: lookupError } = await supabase
    .from("conversations")
    .select("client_id,title")
    .eq("id", options.conversationId)
    .maybeSingle();
  if (lookupError) {
    console.error("Supabase conversation ownership check failed");
    return null;
  }
  if (!isConversationOwnedByClient(existingConversation?.client_id, options.clientId)) {
    console.error("Supabase conversation ownership mismatch");
    return null;
  }

  const now = options.completedAt ?? new Date().toISOString();
  if (!existingConversation?.client_id) {
    const title = options.title?.trim().slice(0, 80)
      || options.userMessage.replace(/\s+/gu, " ").trim().slice(0, 80)
      || "Neue Unterhaltung";
    const { error: conversationError } = await supabase.from("conversations").upsert(
      {
        id: options.conversationId,
        client_id: options.clientId,
        title,
        updated_at: now,
      },
      { onConflict: "id" },
    );
    if (conversationError) {
      console.error("Supabase conversation persistence failed");
      return null;
    }
  } else {
    const { error: conversationError } = await supabase
      .from("conversations")
      .update({ updated_at: now })
      .eq("id", options.conversationId)
      .eq("client_id", options.clientId);
    if (conversationError) {
      console.error("Supabase conversation persistence failed");
      return null;
    }
  }

  const provenance = options.modelProvenance;
  const { data: insertedMessages, error: messageError } = await supabase
    .from("messages")
    .insert([
      {
        conversation_id: options.conversationId,
        client_id: options.clientId,
        role: "user",
        content: options.userMessage,
      },
      {
        conversation_id: options.conversationId,
        client_id: options.clientId,
        role: "assistant",
        content: options.assistantMessage,
        model: provenance.model,
        model_provider: provenance.provider,
        upstream_model: provenance.upstreamModel,
        reasoning_setting: provenance.reasoning,
        model_settings_revision: provenance.settingsRevision,
        model_settings_source: provenance.settingsSource,
      },
    ])
    .select("id,role");
  if (messageError) {
    console.error("Supabase message persistence failed");
    return null;
  }

  const assistantMessageId = (insertedMessages ?? []).find(
    (message) => message.role === "assistant",
  )?.id;
  if (!assistantMessageId) {
    return null;
  }

  const { data: agentRun, error: runError } = await supabase
    .from("agent_runs")
    .insert({
      conversation_id: options.conversationId,
      client_id: options.clientId,
      assistant_message_id: assistantMessageId,
      status: "completed",
      started_at: options.startedAt ?? now,
      completed_at: now,
    })
    .select("id")
    .single();
  if (runError || !agentRun) {
    if (!isMissingAgentTraceRelation(runError, "agent_runs")) {
      console.error("Supabase agent run persistence failed");
    }
    return null;
  }

  const steps = sanitizeSteps(agentRun.id, options.steps ?? []);
  if (steps.length > 0) {
    const { error: stepsError } = await supabase.from("agent_steps").insert(steps);
    if (stepsError && !isMissingAgentTraceRelation(stepsError, "agent_steps")) {
      console.error("Supabase agent step persistence failed");
    }
  }

  const artifactDrafts = (options.pdfArtifacts ?? []).slice(0, 3);
  if (artifactDrafts.length === 0) {
    return {
      assistantMessageId,
      agentRunId: agentRun.id,
      pdfArtifacts: [],
      artifactsPersisted: true,
    };
  }

  const { data: insertedArtifacts, error: artifactsError } = await supabase
    .from("document_artifacts")
    .insert(artifactDrafts.map((artifact) => ({
      id: artifact.id,
      conversation_id: options.conversationId,
      client_id: options.clientId,
      assistant_message_id: assistantMessageId,
      agent_run_id: agentRun.id,
      kind: "pdf",
      title: artifact.title,
      filename: artifact.filename,
      content_markdown: artifact.contentMarkdown,
      content_sha256: artifact.contentSha256,
      stichtag: artifact.stichtag,
      provenance: artifact.provenance,
    })))
    .select("id,title,filename");
  if (artifactsError) {
    console.error("Supabase document artifact persistence failed");
    return {
      assistantMessageId,
      agentRunId: agentRun.id,
      pdfArtifacts: [],
      artifactsPersisted: false,
    };
  }

  return {
    assistantMessageId,
    agentRunId: agentRun.id,
    pdfArtifacts: (insertedArtifacts ?? []).map((artifact) => ({
      id: artifact.id,
      title: artifact.title,
      filename: artifact.filename,
    })),
    artifactsPersisted: (insertedArtifacts ?? []).length === artifactDrafts.length,
  };
}
