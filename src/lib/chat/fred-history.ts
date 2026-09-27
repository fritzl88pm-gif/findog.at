import type {
  FredNativeAttachment,
  FredNativeMessage,
} from "@/components/fred-native-chat-view";
import { parseStoredFredExecutionTrace } from "@/lib/fred/execution-trace";
import { parseStoredFredArtifacts } from "@/lib/fred-native-stream";
import { isFredAgentKey } from "@/lib/weknora/fred-agent";
import {
  parseStoredFredResearchTrace,
  parseStoredFredSources,
} from "@/lib/weknora/fred-research";

function normalizeFredAttachments(value: unknown): FredNativeAttachment[] {
  if (!Array.isArray(value) || value.length > 10) return [];
  return value.flatMap((candidate): FredNativeAttachment[] => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const item = candidate as Record<string, unknown>;
    if (
      (item.kind !== "image" && item.kind !== "file")
      || typeof item.name !== "string"
      || typeof item.mimeType !== "string"
      || typeof item.sizeBytes !== "number"
      || (item.sha256 !== undefined && typeof item.sha256 !== "string")
    ) return [];
    return [{
      kind: item.kind,
      name: item.name,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      ...(typeof item.sha256 === "string" ? { sha256: item.sha256 } : {}),
    }];
  });
}

/** Normalizes the messages returned by GET /api/fred/conversations/:id. */
export function normalizeFredMessages(value: unknown): FredNativeMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((message): FredNativeMessage[] => {
    if (!message || typeof message !== "object" || Array.isArray(message)) return [];
    const item = message as Record<string, unknown>;
    if (
      (item.role !== "user" && item.role !== "assistant")
      || typeof item.content !== "string"
    ) return [];
    const messageId = typeof item.id === "number" && Number.isFinite(item.id) && item.id > 0 && Number.isSafeInteger(item.id)
      ? item.id
      : undefined;
    const attachments = item.role === "user" ? normalizeFredAttachments(item.attachments) : [];
    return [{
      ...(messageId !== undefined ? { id: messageId } : {}),
      role: item.role,
      content: item.content,
      createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
      agentKey: isFredAgentKey(item.agentKey) ? item.agentKey : "fred",
      ...(attachments.length ? { attachments } : {}),
      ...(item.role === "assistant" ? {
        artifacts: parseStoredFredArtifacts(item.artifacts),
        // Stored answers render the same research trace and sources as live ones.
        researchTrace: parseStoredFredResearchTrace(item.researchTrace),
        executionTrace: parseStoredFredExecutionTrace(item.executionTrace),
        sourceReferences: parseStoredFredSources(item.sourceReferences),
      } : {}),
      ...(item.role === "user" && item.webSearchEnabled === true
        ? { webSearchEnabled: true }
        : {}),
      ...(item.role === "user" && item.proModeEnabled === true
        ? { proModeEnabled: true }
        : {}),
    }];
  });
}
