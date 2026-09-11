/**
 * Evidence registry: the only source of citation IDs.
 *
 * Source IDs are assigned server-side, are immutable for the run and are only
 * created for successful retrievals. Failed tool results never register
 * evidence, so a model can never cite something the run did not actually read.
 */

export type FindogAgentSourceKind = "knowledge" | "wiki" | "web" | "mcp";

export type FindogAgentSourceRecord = {
  id: string;
  kind: FindogAgentSourceKind;
  /** Adapter identity, e.g. `weknora`, `exa` or `mcp:docs`. */
  provider: string;
  title: string;
  text: string;
  truncated: boolean;
  /** `http(s)` only; anything else is stored as null. */
  url: string | null;
  retrievedAt: string;
  provenance: Record<string, string>;
};

export type FindogAgentSourceCandidate = Omit<FindogAgentSourceRecord, "id" | "retrievedAt">;

const CITATION_TOKEN = /src_[0-9]+/g;
const CITATION_GROUP = /\[([^[\]]*)\]/g;

export function sanitizeFindogAgentSourceUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    if (!parsed.hostname) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export class FindogAgentEvidenceRegistry {
  private readonly records: FindogAgentSourceRecord[] = [];
  private readonly known = new Map<string, string>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  private static keyOf(candidate: FindogAgentSourceCandidate): string {
    return [candidate.kind, candidate.provider, JSON.stringify(candidate.provenance)].join("|");
  }

  register(candidate: FindogAgentSourceCandidate): { record: FindogAgentSourceRecord; created: boolean } {
    const key = FindogAgentEvidenceRegistry.keyOf(candidate);
    const existingId = this.known.get(key);
    if (existingId) {
      const existing = this.records.find((record) => record.id === existingId);
      if (existing) {
        return { record: existing, created: false };
      }
    }

    const record: FindogAgentSourceRecord = {
      ...candidate,
      url: sanitizeFindogAgentSourceUrl(candidate.url),
      id: `src_${this.records.length + 1}`,
      retrievedAt: new Date(this.now()).toISOString(),
    };
    this.records.push(record);
    this.known.set(key, record.id);
    return { record, created: true };
  }

  list(): FindogAgentSourceRecord[] {
    return [...this.records];
  }

  get(id: string): FindogAgentSourceRecord | undefined {
    return this.records.find((record) => record.id === id);
  }

  get size(): number {
    return this.records.length;
  }
}

/**
 * Extracts bracketed citation IDs from a final answer and reports which of them
 * do not exist in the evidence registry.
 */
export function findogAgentCitationIds(
  answer: string,
  knownIds: Iterable<string> = [],
): {
  cited: string[];
  unknown: string[];
} {
  const known = new Set(knownIds);
  const cited: string[] = [];
  const seen = new Set<string>();
  for (const group of answer.matchAll(CITATION_GROUP)) {
    const content = group[1] ?? "";
    for (const token of content.match(CITATION_TOKEN) ?? []) {
      if (!seen.has(token)) {
        seen.add(token);
        cited.push(token);
      }
    }
  }
  return { cited, unknown: cited.filter((id) => !known.has(id)) };
}
