export type FredAgentKey = "fred" | "quickfred";

export function fredAgentName(agentKey: FredAgentKey): "Fred" | "QuickFred" {
  return agentKey === "quickfred" ? "QuickFred" : "Fred";
}

export function isFredAgentKey(value: unknown): value is FredAgentKey {
  return value === "fred" || value === "quickfred";
}
