import { isDynamicModelId, isSupportedModel } from "../config";

export type AgentRunMetadata = {
  model: string;
  status: "completed" | "failed";
  startedAt: string;
  completedAt: string | null;
};

export function normalizeAgentRun(value: unknown): AgentRunMetadata | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const run = value as Record<string, unknown>;
  if (
    typeof run.model !== "string"
    || (!isSupportedModel(run.model) && !isDynamicModelId(run.model))
    || (run.status !== "completed" && run.status !== "failed")
    || typeof run.startedAt !== "string"
    || (run.completedAt !== null && typeof run.completedAt !== "string")
  ) {
    return undefined;
  }

  return {
    model: run.model,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  };
}
