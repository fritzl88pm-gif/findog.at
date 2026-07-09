import { randomUUID } from "node:crypto";

import type { AgentStep } from "./agent-steps";
import { summarizeStepText } from "./agent-steps";
import { UserVisibleError } from "./errors";
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

export async function persistConversationTurn(options: {
  conversationId?: string;
  clientId?: string;
  userMessage?: string;
  assistantMessage: string;
  title?: string;
  model?: string;
  steps?: AgentStep[];
  startedAt?: string;
  completedAt?: string;
}): Promise<void> {
  const supabase = getSupabaseServerClient();
  if (!supabase || !options.conversationId || !options.clientId || !options.userMessage) {
    return;
  }
  if (!isUuid(options.conversationId) || !isUuid(options.clientId)) {
    return;
  }

  const { data: existingConversation, error: lookupError } = await supabase
    .from("conversations")
    .select("client_id,title")
    .eq("id", options.conversationId)
    .maybeSingle();
  if (lookupError) {
    console.error("Supabase conversation ownership check failed");
    return;
  }
  if (!isConversationOwnedByClient(existingConversation?.client_id, options.clientId)) {
    console.error("Supabase conversation ownership mismatch");
    return;
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
      return;
    }
  } else {
    const { error: conversationError } = await supabase
      .from("conversations")
      .update({ updated_at: now })
      .eq("id", options.conversationId)
      .eq("client_id", options.clientId);
    if (conversationError) {
      console.error("Supabase conversation persistence failed");
      return;
    }
  }

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
      },
    ])
    .select("id,role");
  if (messageError) {
    console.error("Supabase message persistence failed");
    return;
  }

  const assistantMessageId = (insertedMessages ?? []).find(
    (message) => message.role === "assistant",
  )?.id;
  if (!assistantMessageId || !options.model) {
    return;
  }

  const { data: agentRun, error: runError } = await supabase
    .from("agent_runs")
    .insert({
      conversation_id: options.conversationId,
      client_id: options.clientId,
      assistant_message_id: assistantMessageId,
      model: options.model,
      status: "completed",
      started_at: options.startedAt ?? now,
      completed_at: now,
    })
    .select("id")
    .single();
  if (runError || !agentRun) {
    console.error("Supabase agent run persistence failed");
    return;
  }

  const steps = sanitizeSteps(agentRun.id, options.steps ?? []);
  if (steps.length === 0) {
    return;
  }
  const { error: stepsError } = await supabase.from("agent_steps").insert(steps);
  if (stepsError) {
    console.error("Supabase agent step persistence failed");
  }
}
