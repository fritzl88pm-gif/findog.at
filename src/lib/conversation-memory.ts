import type { SupabaseClient } from "@supabase/supabase-js";

type ServerSupabaseClient = Pick<SupabaseClient, "from">;

/** How many of the most recent agent runs to draw memory from. */
export const MAX_MEMORY_RUNS = 3;
/** Maximum number of prior successful research results to carry forward. */
export const MAX_MEMORY_STEPS = 10;
/** Total character budget for the carried-forward memory block. */
export const MAX_MEMORY_CHARS = 10_000;
/** Per-entry cap (agent_steps.content is already truncated server-side). */
const MAX_ENTRY_CHARS = 4_000;

export type ResearchMemoryEntry = {
  toolName: string | null;
  title: string;
  content: string;
};

type AgentRunIdRow = { id: string };
type AgentStepRow = {
  agent_run_id: string;
  step_order: number;
  step_type: string;
  title: unknown;
  content: unknown;
  tool_name: unknown;
  success: unknown;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Loads prior successful research results (persisted tool_result steps) for a
 * conversation so the agent can carry them into follow-up turns instead of
 * re-retrieving from scratch.  Reuses the same agent_runs/agent_steps read
 * pattern as the conversation GET route and is strictly best-effort: any
 * error, or a missing agent-trace relation, yields an empty memory.
 */
export async function loadConversationResearchMemory(options: {
  supabase: ServerSupabaseClient;
  conversationId: string;
  clientId: string;
}): Promise<ResearchMemoryEntry[]> {
  const { supabase, conversationId, clientId } = options;
  try {
    const { data: runs, error: runsError } = await supabase
      .from("agent_runs")
      .select("id")
      .eq("conversation_id", conversationId)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(MAX_MEMORY_RUNS);
    if (runsError || !runs || runs.length === 0) {
      return [];
    }

    const runIds = (runs as AgentRunIdRow[]).map((run) => run.id);
    // Index by position so the newest run's findings are preferred when the
    // character budget is exhausted.
    const runOrder = new Map(runIds.map((id, index) => [id, index]));

    const { data: steps, error: stepsError } = await supabase
      .from("agent_steps")
      .select("agent_run_id,step_order,step_type,title,content,tool_name,success")
      .in("agent_run_id", runIds)
      .eq("step_type", "tool_result")
      .eq("success", true)
      .order("step_order", { ascending: true });
    if (stepsError || !steps) {
      return [];
    }

    const orderedSteps = (steps as AgentStepRow[])
      .filter((row) => asText(row.content))
      .sort((a, b) => {
        const runDelta =
          (runOrder.get(a.agent_run_id) ?? Number.MAX_SAFE_INTEGER)
          - (runOrder.get(b.agent_run_id) ?? Number.MAX_SAFE_INTEGER);
        return runDelta !== 0 ? runDelta : a.step_order - b.step_order;
      });

    const entries: ResearchMemoryEntry[] = [];
    let usedChars = 0;
    for (const row of orderedSteps) {
      if (entries.length >= MAX_MEMORY_STEPS) {
        break;
      }
      const content = asText(row.content).slice(0, MAX_ENTRY_CHARS);
      if (usedChars + content.length > MAX_MEMORY_CHARS) {
        break;
      }
      usedChars += content.length;
      entries.push({
        toolName: asText(row.tool_name) || null,
        title: asText(row.title),
        content,
      });
    }
    return entries;
  } catch {
    return [];
  }
}

/**
 * Renders carried-forward research memory as a clearly labelled, lower-authority
 * context block.  Returns undefined when there is nothing to carry forward.
 */
export function formatResearchMemory(
  entries: ResearchMemoryEntry[],
): string | undefined {
  if (entries.length === 0) {
    return undefined;
  }

  return [
    "===== Bekannte Fundstellen aus früheren Runden dieses Gesprächs =====",
    "",
    "Diese Ergebnisse stammen aus vorherigen Recherche-Runden desselben Gesprächs.",
    "Sie können veraltet sein und ersetzen weder eine frische Findok-Verifikation noch eine aktuelle Recherche.",
    "Nutze sie, um redundante Abfragen zu vermeiden; recherchiere bei Zweifeln erneut.",
    "",
    ...entries.map((entry, index) => {
      const source = entry.toolName ? ` [${entry.toolName}]` : "";
      const title = entry.title ? ` ${entry.title}` : "";
      return `${index + 1}.${source}${title}\n${entry.content}`;
    }),
  ].join("\n");
}
