import { NextResponse } from "next/server";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { isAgentStep } from "@/lib/chat-stream";
import { UserVisibleError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ConversationRow = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

type AgentRunRow = {
  id: string;
  assistant_message_id: number | null;
};

type DatabaseError = {
  code?: unknown;
  message?: unknown;
};

type AgentStepRow = {
  agent_run_id: string;
  step_type: string;
  title: string;
  content: string;
  tool_name: string | null;
  success: boolean | null;
  arguments: unknown;
  tools?: unknown;
};

function isMissingAgentTraceRelation(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const databaseError = error as DatabaseError;
  const code = typeof databaseError.code === "string" ? databaseError.code : "";
  const message = typeof databaseError.message === "string" ? databaseError.message : "";
  if (!/agent_(?:runs|steps)/i.test(message)) {
    return false;
  }
  return code === "42P01" || code === "PGRST205";
}

function stepFromRow(row: AgentStepRow) {
  const base = { type: row.step_type, title: row.title, content: row.content };
  const candidate = row.step_type === "tools"
    ? { ...base, tools: Array.isArray(row.tools) ? row.tools : undefined }
    : row.step_type === "tool_call"
      ? { ...base, toolName: row.tool_name, arguments: row.arguments ?? undefined }
      : row.step_type === "tool_result"
        ? { ...base, toolName: row.tool_name, success: row.success }
        : base;
  return isAgentStep(candidate) ? candidate : null;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  try {
    const { conversationId } = await context.params;
    if (!uuidPattern.test(conversationId)) {
      throw new UserVisibleError("Gespräch-ID ist ungültig.", 400);
    }

    const supabase = getSupabaseServerClient();
    if (!supabase) {
      throw new UserVisibleError("Gesprächsverlauf ist derzeit nicht verfügbar.", 503);
    }
    const user = await authenticateSupabaseRequest(request, supabase);
    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .select("id,title,created_at,updated_at")
      .eq("id", conversationId)
      .eq("client_id", user.id)
      .maybeSingle();

    if (conversationError) {
      throw new UserVisibleError("Gespräch konnte nicht geladen werden.", 503);
    }
    if (!conversation) {
      throw new UserVisibleError("Gespräch wurde nicht gefunden.", 404);
    }

    const { data: messages, error: messagesError } = await supabase
      .from("messages")
      .select("id,role,content,created_at")
      .eq("conversation_id", conversationId)
      .eq("client_id", user.id)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (messagesError) {
      throw new UserVisibleError("Nachrichten konnten nicht geladen werden.", 503);
    }

    const { data: runs, error: runsError } = await supabase
      .from("agent_runs")
      .select("id,assistant_message_id")
      .eq("conversation_id", conversationId)
      .eq("client_id", user.id)
      .order("created_at", { ascending: true });
    if (runsError && !isMissingAgentTraceRelation(runsError)) {
      throw new UserVisibleError("Agentenschritte konnten nicht geladen werden.", 503);
    }

    const runRows = runsError ? [] : (runs ?? []) as AgentRunRow[];
    let stepRows: AgentStepRow[] = [];
    if (runRows.length > 0) {
      const { data: storedSteps, error: stepsError } = await supabase
        .from("agent_steps")
        .select("agent_run_id,step_order,step_type,title,content,tool_name,success,arguments,tools")
        .in("agent_run_id", runRows.map((run) => run.id))
        .order("step_order", { ascending: true });
      if (stepsError && !isMissingAgentTraceRelation(stepsError)) {
        throw new UserVisibleError("Agentenschritte konnten nicht geladen werden.", 503);
      }
      if (!stepsError) {
        stepRows = (storedSteps ?? []) as AgentStepRow[];
      }
    }

    const stepsByRun = new Map<string, ReturnType<typeof stepFromRow>[]>();
    for (const row of stepRows) {
      const step = stepFromRow(row);
      if (step) {
        const current = stepsByRun.get(row.agent_run_id) ?? [];
        current.push(step);
        stepsByRun.set(row.agent_run_id, current);
      }
    }
    const stepsByMessage = new Map<number, NonNullable<ReturnType<typeof stepFromRow>>[]>();
    for (const run of runRows) {
      if (run.assistant_message_id === null) {
        continue;
      }
      const steps = (stepsByRun.get(run.id) ?? []).filter(
        (step): step is NonNullable<typeof step> => step !== null,
      );
      if (steps.length > 0) {
        stepsByMessage.set(run.assistant_message_id, steps);
      }
    }

    const conversationRow = conversation as ConversationRow;
    return NextResponse.json({
      conversation: {
        id: conversationRow.id,
        title: conversationRow.title,
        createdAt: conversationRow.created_at,
        updatedAt: conversationRow.updated_at,
      },
      messages: ((messages ?? []) as MessageRow[]).map((message) => {
        const steps = stepsByMessage.get(message.id);
        return {
          id: message.id,
          role: message.role,
          content: message.content,
          createdAt: message.created_at,
          ...(steps?.length ? { steps } : {}),
        };
      }),
    });
  } catch (error) {
    if (error instanceof UserVisibleError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Gespräch konnte nicht geladen werden." }, { status: 500 });
  }
}
