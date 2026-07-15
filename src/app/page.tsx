"use client";

import { Fragment, type ChangeEvent, type ClipboardEvent, type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import Image from "next/image";
import Link from "next/link";

import { chatHistoryStorageKey } from "@/lib/chat/storage";
import { applyConversationDeletion } from "@/lib/chat/deletion";
import {
  clampComposerHeight,
  COMPOSER_MIN_HEIGHT,
} from "@/lib/chat/composer-height";
import {
  normalizeAgentRun,
  type AgentRunMetadata,
} from "@/lib/chat/agent-run";
import {
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_IMAGE_UPLOADS,
  MAX_PDF_UPLOAD_BYTES,
  MAX_PDF_UPLOADS,
  isDynamicModelId,
  isSupportedModel,
  type ChatModel,
} from "@/lib/config";
import {
  DEFAULT_CHAT_SETTINGS,
  normalizeStoredChatSettings,
  type ChatSettings,
} from "@/lib/chat/settings";
import { ellipsizeFilename } from "@/lib/attachment-names";
import { clipboardImageFiles } from "@/lib/chat/clipboard-images";
import type { AgentStep } from "@/lib/agent-steps";
import { agentStepDisplayLabel } from "@/lib/agent-step-display";
import { AGENT_PLAN_ITEMS, completedAgentPlanItemCount } from "@/lib/agent-plan";
import { parseRichAnswer, type RichBlock, type RichInline } from "@/lib/answer-rendering";
import {
  getSupabaseBrowserClient,
  isSupabaseBrowserConfigured,
} from "@/lib/supabase/browser";
import { CHAT_STREAM_CONTENT_TYPE, parseChatStreamLine } from "@/lib/chat-stream";
import { parsePasswordChangeBody } from "@/lib/auth/password";
import { getWelcomeGreeting } from "@/lib/chat/welcome";
import { shouldOfferChatPdfDownload } from "@/lib/chat/pdf-request";
import { findNearestPrecedingUserMessage } from "@/lib/agent-feedback";
import {
  FORM_IMAGE_MIME_TYPES,
  isFormImageMimeType,
  MAX_FORM_IMAGE_BYTES,
  MAX_SALDO_INPUT_CHARS,
  VERF5_FORM_ID,
  VERF5_FORM_NAME,
} from "@/lib/forms/config";
import { normalizeManualSaldo } from "@/lib/forms/values";
import {
  GERMAN_SV_PENSION_YEARS,
  buildGermanSvPensionPdfDocument,
  calculateGermanSvPension,
  formatGermanSvEuro,
  formatGermanSvRate,
  parseGermanSvAmount,
  type GermanSvPensionMode,
  type GermanSvPensionYear,
} from "@/lib/german-sv-pension";
import {
  calculateGermanPensionOption,
  parseGermanPensionAmount,
  formatGermanPensionEuro,
} from "@/lib/german-pension-option";

import {
  L17B_YEARS,
  getL17bYearEntries,
  convertL17bCurrency,
  formatL17bForeignAmount,
  formatL17bEuro,
  lookupL17bEntry,
  getL17bSourceNote,
  parseL17bGermanAmount,
} from "@/lib/l17b-currency";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  steps?: AgentStep[];
  agentRun?: AgentRunMetadata;
};

type ConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

type AppView = "chat" | "forms" | "bfg-decisions" | "bfg-pro" | "german-sv-pension" | "l17b-currency" | "administration";
type ComposerMenu = "attachments" | "model" | null;

type AuthForm = {
  email: string;
  password: string;
};

type PasswordChangeForm = {
  currentPassword: string;
  newPassword: string;
  confirmation: string;
};

type ChatResponsePayload = {
  answer?: unknown;
  error?: unknown;
  steps?: unknown;
  conversationId?: unknown;
  title?: unknown;
};

type AuthenticatedSettings = {
  isAdmin: boolean;
  enabledModels: EnabledModelDescriptor[];
};

type EnabledModelDescriptor = {
  id: string;
  label: string;
};

type AdminReasoningOption = {
  value: string;
  label: string;
};

type AdminModelSetting = {
  id: string;
  label: string;
  enabled: boolean;
  alwaysEnabled: boolean;
  reasoning: string | null;
  reasoningOptions: AdminReasoningOption[];
  providerConfigured: boolean;
  revision: number;
  updatedAt: string | null;
  provider?: string;
  upstreamModel?: string;
  displayName?: string | null;
  baseUrl?: string;
  accessScope?: "disabled" | "admins" | "all";
};

type AdminUserSummary = {
  id: string;
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
};

type AdminRequestHistoryEntry = {
  id: number;
  conversationId: string;
  content: string;
  createdAt: string;
};

type AdminUserProfile = {
  user: AdminUserSummary;
  requestCount: number;
  requests: AdminRequestHistoryEntry[];
};

type BfgDecision = {
  title: string;
  gz: string;
  documentType: string;
  publicationDate: string;
  snippet: string;
  htmlUrl: string | null;
  pdfUrl: string | null;
};

type BfgSort = "1" | "2" | "3" | "4" | "7" | "10";

type BfgFacetOption = {
  value: string;
  label: string;
  count: number;
};

type BfgFilterFacets = {
  materie: BfgFacetOption[];
  documentType: BfgFacetOption[];
  norm: BfgFacetOption[];
  timeframe: BfgFacetOption[];
  withHeadnote: BfgFacetOption[];
};

type BfgFilterSelection = {
  materie: string;
  documentType: string;
  norm: string;
  timeframe: string;
  withHeadnote: boolean;
};

type BfgDecisionPage = {
  results: BfgDecision[];
  page: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  facets: BfgFilterFacets;
};

type BfgProResult = {
  title: string;
  gz: string;
  documentType: string;
  decisionDate: string;
  publicationDate: string;
  caseSummary: string;
  whyRelevant: string;
  score: number;
  htmlUrl: string | null;
  pdfUrl: string | null;
};

const SETTINGS_STORAGE_KEY = "findog.settings.v1";
const FLASH_MODEL: ChatModel = "deepseek-v4-flash";
const INITIAL_PENDING_TEXT = "Recherche wird vorbereitet";
const BFG_SORT_OPTIONS: ReadonlyArray<{ value: BfgSort; label: string }> = [
  { value: "1", label: "Relevanz" },
  { value: "2", label: "Genehmigungsdatum absteigend" },
  { value: "7", label: "Genehmigungsdatum aufsteigend" },
  { value: "3", label: "In Findok seit absteigend" },
  { value: "4", label: "In Findok seit aufsteigend" },
  { value: "10", label: "Geschäftszahl" },
];

function emptyBfgFilterSelection(): BfgFilterSelection {
  return { materie: "", documentType: "", norm: "", timeframe: "", withHeadnote: false };
}

function availableBfgFilterSelection(
  selection: BfgFilterSelection,
  facets: BfgFilterFacets,
): BfgFilterSelection {
  const availableValue = (value: string, options: BfgFacetOption[]) =>
    options.some((option) => option.value === value) ? value : "";
  return {
    materie: availableValue(selection.materie, facets.materie),
    documentType: availableValue(selection.documentType, facets.documentType),
    norm: availableValue(selection.norm, facets.norm),
    timeframe: availableValue(selection.timeframe, facets.timeframe),
    withHeadnote: selection.withHeadnote && facets.withHeadnote.some((option) => option.value === "true"),
  };
}

function readJson<T>(key: string): T | null {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage can fail in private browsing or constrained environments.
  }
}

function removeStoredValue(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // localStorage can fail in private browsing or constrained environments.
  }
}

function normalizeAgentSteps(value: unknown): AgentStep[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((step): AgentStep[] => {
    if (!step || typeof step !== "object" || Array.isArray(step)) {
      return [];
    }

    const item = step as Record<string, unknown>;
    if (typeof item.type !== "string" || typeof item.title !== "string" || typeof item.content !== "string") {
      return [];
    }

    if (item.type === "pdf_context" || item.type === "attachment_context") {
      return [{ type: item.type, title: item.title, content: item.content }];
    }
    if (item.type === "plan") {
      return [{ type: "plan", title: item.title, content: item.content }];
    }
    if (item.type === "tools") {
      return [
        {
          type: "tools",
          title: item.title,
          content: item.content,
          tools: Array.isArray(item.tools) ? item.tools.filter((tool): tool is string => typeof tool === "string") : undefined,
        },
      ];
    }
    if (item.type === "tool_call" && typeof item.toolName === "string") {
      return [
        {
          type: "tool_call",
          title: item.title,
          content: item.content,
          toolName: item.toolName,
          arguments: item.arguments,
        },
      ];
    }
    if (item.type === "tool_result" && typeof item.toolName === "string" && typeof item.success === "boolean") {
      return [
        {
          type: "tool_result",
          title: item.title,
          content: item.content,
          toolName: item.toolName,
          success: item.success,
        },
      ];
    }
    if (item.type === "progress") {
      return [{ type: "progress", title: item.title, content: item.content }];
    }
    if (item.type === "finalize") {
      return [{ type: "finalize", title: item.title, content: item.content }];
    }
    if (item.type === "citation_verification") {
      return [{ type: "citation_verification", title: item.title, content: item.content }];
    }
    if (item.type === "self_check") {
      return [{ type: "self_check", title: item.title, content: item.content }];
    }
    if (item.type === "answer") {
      return [{ type: "answer", title: item.title, content: item.content }];
    }

    return [];
  });
}

function normalizeMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((message): ChatMessage[] => {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return [];
    }

    const item = message as Partial<ChatMessage>;
    if ((item.role !== "user" && item.role !== "assistant") || typeof item.content !== "string") {
      return [];
    }
    const steps = item.role === "assistant" ? normalizeAgentSteps(item.steps) : [];
    const agentRun = item.role === "assistant" ? normalizeAgentRun(item.agentRun) : undefined;

    return [
      {
        role: item.role,
        content: item.content,
        createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
        ...(agentRun ? { agentRun } : {}),
        ...(steps.length > 0 ? { steps } : {}),
      },
    ];
  });
}

function normalizeConversationSummaries(value: unknown): ConversationSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item): ConversationSummary[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const conversation = item as Record<string, unknown>;
    if (
      typeof conversation.id !== "string" ||
      typeof conversation.title !== "string" ||
      typeof conversation.createdAt !== "string" ||
      typeof conversation.updatedAt !== "string"
    ) {
      return [];
    }
    return [{
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    }];
  });
}

async function fetchConversationHistory(accessToken: string, id: string): Promise<{
  title: string;
  messages: ChatMessage[];
}> {
  const response = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string" ? payload.error : "Gespräch konnte nicht geladen werden.",
    );
  }
  const conversation = payload.conversation;
  const title = conversation && typeof conversation === "object" && !Array.isArray(conversation)
    && typeof (conversation as Record<string, unknown>).title === "string"
    ? ((conversation as Record<string, unknown>).title as string)
    : "Unterhaltung";
  return { title, messages: normalizeMessages(payload.messages) };
}

function normalizeEnabledModelDescriptors(value: unknown): EnabledModelDescriptor[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  return value.flatMap((entry): EnabledModelDescriptor[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }

    const item = entry as Record<string, unknown>;
    const label = typeof item.label === "string" ? item.label.trim() : "";
    if (
      typeof item.id !== "string"
      || (!isSupportedModel(item.id) && !isDynamicModelId(item.id))
      || !label
      || seen.has(item.id)
    ) {
      return [];
    }

    seen.add(item.id);
    return [{ id: item.id, label }];
  });
}

async function fetchAuthenticatedSettings(accessToken: string): Promise<AuthenticatedSettings> {
  const response = await fetch("/api/settings", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string" ? payload.error : "Einstellungen konnten nicht geladen werden.",
    );
  }
  const enabledModels = normalizeEnabledModelDescriptors(payload.enabledModels);
  if (
    typeof payload.isAdmin !== "boolean"
    || enabledModels.length !== (Array.isArray(payload.enabledModels) ? payload.enabledModels.length : -1)
    || !enabledModels.some((model) => model.id === "deepseek-v4-flash")
  ) {
    throw new Error("Die geladenen Einstellungen sind ungültig.");
  }
  return {
    isAdmin: payload.isAdmin,
    enabledModels,
  };
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("de-AT", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatHistoryDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(date);
}

function formatAdminDate(value: string | null): string {
  if (!value) {
    return "Noch nie";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "–";
  }
  return new Intl.DateTimeFormat("de-AT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function normalizeAdminUser(value: unknown): AdminUserSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== "string"
    || typeof item.email !== "string"
    || typeof item.createdAt !== "string"
    || (item.lastSignInAt !== null && typeof item.lastSignInAt !== "string")
  ) {
    return null;
  }
  return {
    id: item.id,
    email: item.email,
    createdAt: item.createdAt,
    lastSignInAt: item.lastSignInAt,
  };
}

function normalizeAdminUserProfile(value: unknown): AdminUserProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const payload = value as Record<string, unknown>;
  const profileUser = normalizeAdminUser(payload.user);
  if (!profileUser || typeof payload.requestCount !== "number" || !Array.isArray(payload.requests)) {
    return null;
  }
  const requests = payload.requests.flatMap((entry): AdminRequestHistoryEntry[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const item = entry as Record<string, unknown>;
    if (
      typeof item.id !== "number"
      || typeof item.conversationId !== "string"
      || typeof item.content !== "string"
      || typeof item.createdAt !== "string"
    ) {
      return [];
    }
    return [{
      id: item.id,
      conversationId: item.conversationId,
      content: item.content,
      createdAt: item.createdAt,
    }];
  });
  if (requests.length !== payload.requests.length || payload.requestCount !== requests.length) {
    return null;
  }
  return { user: profileUser, requestCount: payload.requestCount, requests };
}

function normalizeAdminModels(value: unknown): AdminModelSetting[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const seenModels = new Set<string>();
  const models = value.flatMap((entry): AdminModelSetting[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }

    const item = entry as Record<string, unknown>;
    if (
      typeof item.id !== "string"
      || (!isSupportedModel(item.id) && !isDynamicModelId(item.id))
      || seenModels.has(item.id)
      || typeof item.label !== "string"
      || !item.label.trim()
      || typeof item.enabled !== "boolean"
      || typeof item.alwaysEnabled !== "boolean"
      || (item.reasoning !== null && typeof item.reasoning !== "string")
      || !Array.isArray(item.reasoningOptions)
      || typeof item.providerConfigured !== "boolean"
      || typeof item.revision !== "number"
      || !Number.isSafeInteger(item.revision)
      || item.revision <= 0
      || (item.updatedAt !== null && typeof item.updatedAt !== "string")
    ) {
      return [];
    }

    const seenOptions = new Set<string>();
    const reasoningOptions = item.reasoningOptions.flatMap((entry): AdminReasoningOption[] => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return [];
      }
      const option = entry as Record<string, unknown>;
      if (
        typeof option.value !== "string"
        || !option.value
        || seenOptions.has(option.value)
        || typeof option.label !== "string"
        || !option.label.trim()
      ) {
        return [];
      }
      seenOptions.add(option.value);
      return [{ value: option.value, label: option.label.trim() }];
    });

    if (
      reasoningOptions.length !== item.reasoningOptions.length
      || (item.reasoning !== null && !seenOptions.has(item.reasoning))
    ) {
      return [];
    }

    seenModels.add(item.id);
    return [{
      id: item.id,
      label: item.label.trim(),
      enabled: item.alwaysEnabled ? true : item.enabled,
      alwaysEnabled: item.alwaysEnabled,
      reasoning: item.reasoning,
      reasoningOptions,
      providerConfigured: item.providerConfigured,
      revision: item.revision,
      updatedAt: item.updatedAt,
      ...(typeof item.provider === "string" ? { provider: item.provider } : {}),
      ...(typeof item.upstreamModel === "string" ? { upstreamModel: item.upstreamModel } : {}),
      ...((typeof item.displayName === "string" || item.displayName === null) ? { displayName: item.displayName } : {}),
      ...(typeof item.baseUrl === "string" ? { baseUrl: item.baseUrl } : {}),
      ...((item.accessScope === "disabled" || item.accessScope === "admins" || item.accessScope === "all") ? { accessScope: item.accessScope } : {}),
    }];
  });

  return models.length === value.length ? models : null;
}

function normalizeBfgFacetOptions(value: unknown): BfgFacetOption[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const options = value.flatMap((entry): BfgFacetOption[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const item = entry as Record<string, unknown>;
    if (
      typeof item.value !== "string"
      || typeof item.label !== "string"
      || typeof item.count !== "number"
      || !Number.isSafeInteger(item.count)
      || item.count < 0
    ) {
      return [];
    }
    return [{ value: item.value, label: item.label, count: item.count }];
  });
  return options.length === value.length ? options : null;
}

function normalizeBfgFacets(value: unknown): BfgFilterFacets | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const payload = value as Record<string, unknown>;
  const materie = normalizeBfgFacetOptions(payload.materie);
  const documentType = normalizeBfgFacetOptions(payload.documentType);
  const norm = normalizeBfgFacetOptions(payload.norm);
  const timeframe = normalizeBfgFacetOptions(payload.timeframe);
  const withHeadnote = normalizeBfgFacetOptions(payload.withHeadnote);
  return materie && documentType && norm && timeframe && withHeadnote
    ? { materie, documentType, norm, timeframe, withHeadnote }
    : null;
}

function normalizeBfgDecisionPage(value: unknown): BfgDecisionPage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const payload = value as Record<string, unknown>;
  const facets = normalizeBfgFacets(payload.facets);
  if (
    !Array.isArray(payload.results)
    || typeof payload.page !== "number"
    || typeof payload.pageSize !== "number"
    || typeof payload.totalPages !== "number"
    || typeof payload.totalCount !== "number"
    || !facets
  ) {
    return null;
  }
  const results = payload.results.flatMap((value): BfgDecision[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return [];
    }
    const item = value as Record<string, unknown>;
    if (
      typeof item.title !== "string"
      || typeof item.gz !== "string"
      || typeof item.documentType !== "string"
      || typeof item.publicationDate !== "string"
      || typeof item.snippet !== "string"
      || (item.htmlUrl !== null && typeof item.htmlUrl !== "string")
      || (item.pdfUrl !== null && typeof item.pdfUrl !== "string")
    ) {
      return [];
    }
    return [{
      title: item.title,
      gz: item.gz,
      documentType: item.documentType,
      publicationDate: item.publicationDate,
      snippet: item.snippet,
      htmlUrl: item.htmlUrl,
      pdfUrl: item.pdfUrl,
    }];
  });
  return results.length === payload.results.length
    ? {
        results,
        page: payload.page,
        pageSize: payload.pageSize,
        totalPages: payload.totalPages,
        totalCount: payload.totalCount,
        facets,
      }
    : null;
}

function normalizeBfgProResults(value: unknown): BfgProResult[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const payload = value as Record<string, unknown>;
  if (!Array.isArray(payload.results) || payload.results.length > 10) {
    return null;
  }
  const results = payload.results.flatMap((value): BfgProResult[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return [];
    }
    const item = value as Record<string, unknown>;
    if (
      typeof item.title !== "string"
      || typeof item.gz !== "string"
      || typeof item.documentType !== "string"
      || typeof item.decisionDate !== "string"
      || typeof item.publicationDate !== "string"
      || typeof item.caseSummary !== "string"
      || !item.caseSummary.trim()
      || item.caseSummary.length > 400
      || typeof item.whyRelevant !== "string"
      || typeof item.score !== "number"
      || item.score < 0
      || item.score > 100
      || (item.htmlUrl !== null && typeof item.htmlUrl !== "string")
      || (item.pdfUrl !== null && typeof item.pdfUrl !== "string")
    ) {
      return [];
    }
    return [{
      title: item.title,
      gz: item.gz,
      documentType: item.documentType,
      decisionDate: item.decisionDate,
      publicationDate: item.publicationDate,
      caseSummary: item.caseSummary,
      whyRelevant: item.whyRelevant,
      score: item.score,
      htmlUrl: item.htmlUrl,
      pdfUrl: item.pdfUrl,
    }];
  });
  return results.length === payload.results.length ? results : null;
}

function formatBfgPublicationDate(value: string): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

async function readChatStream(
  response: Response,
  onStep: (step: AgentStep) => void,
): Promise<ChatResponsePayload> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Der Antwortstream konnte nicht gelesen werden.");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let finalPayload: ChatResponsePayload | null = null;

  const processLine = (line: string) => {
    const event = parseChatStreamLine(line);
    if (!event) {
      return;
    }

    if (event.type === "step") {
      onStep(event.step);
      return;
    }

    if (event.type === "error") {
      throw new Error(event.error || "Die Streaming-Antwort konnte nicht verarbeitet werden.");
    }

    finalPayload = {
      answer: event.answer,
      steps: event.steps,
      conversationId: event.conversationId,
      ...(event.title ? { title: event.title } : {}),
    };
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      processLine(line);
    }
  }

  buffer += decoder.decode();
  processLine(buffer);

  if (!finalPayload) {
    throw new Error("Der Antwortstream wurde ohne finale Antwort beendet.");
  }

  return finalPayload;
}

function renderUserMessageContent(content: string): ReactNode {
  return (
    <p className="message-body">
      {content.split("\n").map((line, index) => {
        const match = /^(PDF-Anhang|Bild-Anhang):\s*(.+)$/.exec(line);
        const prefix = index > 0 ? "\n" : "";

        if (!match) {
          return <Fragment key={`${index}-${line}`}>{prefix}{line}</Fragment>;
        }

        const label = match[1];
        const filename = match[2];
        return (
          <Fragment key={`${index}-${line}`}>
            {prefix}
            <span className="attachment-message-line">
              <span>{label}: </span>
              <span className="inline-attachment-name" title={filename}>
                {ellipsizeFilename(filename)}
              </span>
            </span>
          </Fragment>
        );
      })}
    </p>
  );
}

function renderRichInline(nodes: RichInline[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;

    if (node.type === "text") {
      return <span key={key}>{node.text}</span>;
    }
    if (node.type === "strong") {
      return <strong key={key}>{renderRichInline(node.children, key)}</strong>;
    }
    if (node.type === "code") {
      return <code key={key}>{node.text}</code>;
    }
    if (node.type === "highlight") {
      return <mark key={key}>{renderRichInline(node.children, key)}</mark>;
    }
    return (
      <a key={key} href={node.href} target="_blank" rel="noreferrer noopener">
        {renderRichInline(node.children, key)}
      </a>
    );
  });
}

function renderRichBlock(block: RichBlock, index: number): ReactNode {
  if (block.type === "heading") {
    const HeadingTag = `h${block.level}` as "h2" | "h3" | "h4";
    return (
      <HeadingTag key={`heading-${index}`}>
        {renderRichInline(block.children, `heading-${index}`)}
      </HeadingTag>
    );
  }

  if (block.type === "paragraph") {
    return <p key={`paragraph-${index}`}>{renderRichInline(block.children, `paragraph-${index}`)}</p>;
  }

  if (block.type === "unordered-list") {
    return (
      <ul key={`unordered-list-${index}`}>
        {block.items.map((item, itemIndex) => (
          <li key={`unordered-list-${index}-${itemIndex}`}>
            {renderRichInline(item, `unordered-list-${index}-${itemIndex}`)}
          </li>
        ))}
      </ul>
    );
  }

  if (block.type === "ordered-list") {
    return (
      <ol key={`ordered-list-${index}`}>
        {block.items.map((item, itemIndex) => (
          <li key={`ordered-list-${index}-${itemIndex}`}>
            {renderRichInline(item, `ordered-list-${index}-${itemIndex}`)}
          </li>
        ))}
      </ol>
    );
  }

  if (block.type === "table") {
    return (
      <div className="answer-table-scroll" key={`table-${index}`}>
        <table>
          <thead>
            <tr>
              {block.headers.map((cell, cellIndex) => (
                <th key={`table-${index}-head-${cellIndex}`} scope="col">
                  {renderRichInline(cell, `table-${index}-head-${cellIndex}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={`table-${index}-row-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`table-${index}-row-${rowIndex}-${cellIndex}`}>
                    {renderRichInline(cell, `table-${index}-row-${rowIndex}-${cellIndex}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <blockquote className="answer-callout" key={`blockquote-${index}`}>
      {renderRichInline(block.children, `blockquote-${index}`)}
    </blockquote>
  );
}

function RichAnswer({ content }: { content: string }) {
  const blocks = parseRichAnswer(content);

  if (blocks.length === 0) {
    return <p className="message-body"></p>;
  }

  return <div className="answer-content">{blocks.map(renderRichBlock)}</div>;
}

function AgentStepsPanel({ steps }: { steps: AgentStep[] }) {
  const hasPlan = steps.some((step) => step.type === "plan");
  const completedPlanItems = completedAgentPlanItemCount(steps);
  const progressSteps = hasPlan ? steps.filter((step) => step.type !== "plan") : steps;

  return (
    <details className="agent-steps">
      <summary>Rechercheverlauf ({steps.length})</summary>
      {hasPlan ? (
        <ol className="agent-plan" aria-label="Arbeitsplan">
          {AGENT_PLAN_ITEMS.map((item, index) => {
            const isCompleted = index < completedPlanItems;
            return (
              <li
                className={isCompleted ? "is-complete" : undefined}
                aria-label={`${item}, ${isCompleted ? "abgeschlossen" : "ausstehend"}`}
                key={item}
              >
                <span className="agent-plan-marker" aria-hidden="true">
                  {isCompleted ? "✓" : ""}
                </span>
                <span className="agent-plan-label">{item}</span>
              </li>
            );
          })}
        </ol>
      ) : null}
      {progressSteps.length > 0 ? (
        <ol className="agent-progress-list">
          {progressSteps.map((step, index) => (
            <li key={`${step.type}-${index}`}>{agentStepDisplayLabel(step)}</li>
          ))}
        </ol>
      ) : null}
    </details>
  );
}

function L17bCurrencyView() {
  const [selectedYear, setSelectedYear] = useState("2025");
  const [selectedCode, setSelectedCode] = useState("");
  const [amountInput, setAmountInput] = useState("");

  const entries = getL17bYearEntries(selectedYear) ?? [];
  const amount = parseL17bGermanAmount(amountInput);
  const entry = selectedCode ? lookupL17bEntry(selectedYear, selectedCode) : undefined;
  const result = entry !== undefined && amount !== null ? convertL17bCurrency(selectedYear, selectedCode, amount) : null;
  const hasInvalidInput = amountInput.trim() !== "" && amount === null;

  function handleYearChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const newYear = event.target.value;
    setSelectedYear(newYear);
    const newEntries = getL17bYearEntries(newYear) ?? [];
    const stillAvailable = selectedCode && newEntries.some((e) => e.currencyCode === selectedCode);
    if (!stillAvailable) {
      setSelectedCode("");
    }
  }

  function handleCountryChange(event: React.ChangeEvent<HTMLSelectElement>) {
    setSelectedCode(event.target.value);
  }

  function handleAmountChange(event: React.ChangeEvent<HTMLInputElement>) {
    setAmountInput(event.target.value);
  }

  return (
    <section className="forms-panel" aria-labelledby="l17b-currency-view-title">
      <div className="forms-view l17b-currency-view">
        <header className="forms-view-header bfg-view-header">
          <div className="bfg-view-header-copy">
            <h1 id="l17b-currency-view-title">L17b Währungsrechner</h1>
          </div>
          <Image
            className="bfg-view-header-illustration"
            src="/fred_l17b.png"
            alt=""
            width={376}
            height={376}
            unoptimized
          />
        </header>
        <div className="german-sv-calculator-card l17b-calculator-card">
          <div className="field-group">
            <label htmlFor="l17b-year-select">Jahr</label>
            <select
              id="l17b-year-select"
              value={selectedYear}
              onChange={handleYearChange}
              autoComplete="off"
            >
              {L17B_YEARS.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
          <div className="field-group">
            <label htmlFor="l17b-country-select">Land</label>
            <select
              id="l17b-country-select"
              value={selectedCode}
              onChange={handleCountryChange}
              autoComplete="off"
            >
              <option value="">— Land auswählen —</option>
              {entries.map((e) => (
                <option key={e.currencyCode} value={e.currencyCode}>
                  {e.country} ({e.currencyCode}, {e.currencyName})
                </option>
              ))}
            </select>
          </div>
          <div className="field-group">
            <label htmlFor="l17b-amount-input">
              {entry
                ? `Betrag in ${entry.currencyName} (${entry.currencyCode})`
                : "Betrag"}
            </label>
            <input
              id="l17b-amount-input"
              type="text"
              inputMode="decimal"
              value={amountInput}
              onChange={handleAmountChange}
              placeholder="z. B. 1.308,70"
              autoComplete="off"
              aria-describedby={hasInvalidInput ? "l17b-amount-error" : undefined}
            />
            {hasInvalidInput ? (
              <span className="field-help" id="l17b-amount-error" role="alert">
                Ungültige Eingabe. Bitte einen gültigen Zahlenwert eingeben (z. B. 1.308,70).
              </span>
            ) : null}
          </div>
          <div className="german-sv-results l17b-result" aria-live="polite">
            <article>
              <h2>Ergebnis in Euro</h2>
              <output>{entry !== undefined && result !== null ? formatL17bEuro(result) : "—"}</output>
              {entry !== undefined && result !== null ? (
                <p className="l17b-calculation-basis">
                  Steuerwert {entry.steuerwertRaw} EUR/{entry.currencyCode} × {formatL17bForeignAmount(amount!, entry.currencyCode)} = {formatL17bEuro(result)}
                </p>
              ) : null}
            </article>
          </div>

          <p className="l17b-source-note">
            Quelle: {getL17bSourceNote(selectedYear)}. Verwendet wird ausschließlich der Steuerwert {selectedYear}.
          </p>
        </div>
      </div>
    </section>
  );
}

type GermanSvPensionViewProps = {
  downloadError: string;
  isDownloadingPdf: boolean;
  onDownloadPdf: (
    year: GermanSvPensionYear,
    mode: GermanSvPensionMode,
    amount: number,
  ) => Promise<void>;
};

function GermanSvPensionView({
  downloadError,
  isDownloadingPdf,
  onDownloadPdf,
}: GermanSvPensionViewProps) {
  const [year, setYear] = useState<GermanSvPensionYear>(2026);
  const [mode, setMode] = useState<GermanSvPensionMode>("kv");
  const [amountInput, setAmountInput] = useState("");
  const pdfDownloadPendingRef = useRef(false);
  const amount = parseGermanSvAmount(amountInput);
  const calculation = amount === null ? null : calculateGermanSvPension(year, mode, amount);
  const displayMoney = (value: number | undefined) =>
    value === undefined ? "— €" : formatGermanSvEuro(value);
  const inputLabel = mode === "kv" ? "KV-Beitrag" : "Rentenbrutto / AEOI-KM";

  async function downloadPdf() {
    if (amount === null || isDownloadingPdf || pdfDownloadPendingRef.current) {
      return;
    }
    pdfDownloadPendingRef.current = true;
    try {
      await onDownloadPdf(year, mode, amount);
    } finally {
      pdfDownloadPendingRef.current = false;
    }
  }

  return (
    <section className="forms-panel" aria-labelledby="german-sv-pension-view-title">
      <div className="forms-view german-sv-pension-view">
        <header className="forms-view-header bfg-view-header german-sv-pension-header">
          <div className="bfg-view-header-copy">
            <h1 id="german-sv-pension-view-title">Kennzahl 453 &amp; 184</h1>
          </div>
          <Image
            className="bfg-view-header-illustration"
            src="/fred-german-sv-pension.png"
            alt=""
            width={376}
            height={376}
            unoptimized
          />
        </header>

        <div className="german-sv-year-control" role="group" aria-label="Veranlagungsjahr">
          <span>Veranlagungsjahr</span>
          <div className="german-sv-year-options">
            {GERMAN_SV_PENSION_YEARS.map((option) => (
              <button
                className={year === option ? "active" : undefined}
                type="button"
                aria-pressed={year === option}
                onClick={() => setYear(option)}
                key={option}
              >
                {option === 2024 ? "bis 2024" : option}
              </button>
            ))}
          </div>
        </div>

        <div className="german-sv-calculator-card">
          <p className="german-sv-rate-line">
            <span>KV-Beitragssatz lt. § 73a ASVG: <strong>{formatGermanSvRate(year)}</strong></span>
            <span>Jahr: <strong>{year}</strong></span>
          </p>

          <fieldset className="german-sv-mode">
            <legend>Eingabe entweder …</legend>
            <label className={mode === "kv" ? "active" : undefined}>
              <input
                type="radio"
                name="german-sv-pension-mode"
                value="kv"
                checked={mode === "kv"}
                onChange={() => setMode("kv")}
              />
              <span>
                <strong>KV-Beitrag</strong>
                <small>österr. Krankenversicherungsbeitrag gem. § 73a ASVG</small>
              </span>
            </label>
            <label className={mode === "rentenbrutto" ? "active" : undefined}>
              <input
                type="radio"
                name="german-sv-pension-mode"
                value="rentenbrutto"
                checked={mode === "rentenbrutto"}
                onChange={() => setMode("rentenbrutto")}
              />
              <span>
                <strong>Rentenbrutto / AEOI-KM</strong>
                <small>dt. Bemessungsgrundlage lt. AJ-Web bzw. KV-Bmgl</small>
              </span>
            </label>
          </fieldset>

          <div className="field-group german-sv-amount-field">
            <label htmlFor="german-sv-pension-amount">{inputLabel}</label>
            <div className="german-sv-amount-input">
              <span aria-hidden="true">€</span>
              <input
                id="german-sv-pension-amount"
                type="text"
                inputMode="decimal"
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value)}
                placeholder="0,00"
                autoComplete="off"
                aria-describedby="german-sv-pension-amount-help"
              />
            </div>
            <span className="field-help" id="german-sv-pension-amount-help">Betrag in Euro, z. B. 1.308,70</span>
          </div>

          <div className="german-sv-calculation-trail" aria-label="Berechnungsschritte" aria-live="polite">
            <div>
              <span className="german-sv-step-number">1</span>
              <span>
                <strong>Krankenversicherung gem. § 73a ASVG</strong>
                <small>{mode === "kv" ? "Eingabe" : "= Rentenbrutto × Beitragssatz"}</small>
              </span>
              <output>{displayMoney(calculation?.kvBeitrag)}</output>
            </div>
            <div>
              <span className="german-sv-step-number">2</span>
              <span>
                <strong>dt. Zuschuss zur Krankenversicherung</strong>
                <small>{mode === "kv" ? "= KV-Beitrag ÷ 2" : "= Rentenbrutto × halber Beitragssatz"}</small>
              </span>
              <output>{displayMoney(calculation?.zuschuss)}</output>
            </div>
            <div>
              <span className="german-sv-step-number">3</span>
              <span>
                <strong>dt. „Jahresbetrag der Rente“ = Bmgl. KV</strong>
                <small>{mode === "kv" ? "= KV-Beitrag ÷ Beitragssatz" : "Eingabe (Rentenbrutto / AEOI-KM)"}</small>
              </span>
              <output>{displayMoney(calculation?.bmgl)}</output>
            </div>
          </div>

          <div className="german-sv-results" aria-live="polite">
            <article>
              <p>Kz 453</p>
              <h2>Steuerpflichtige Einkünfte</h2>
              <output>{displayMoney(calculation?.kz453)}</output>
            </article>
            <article>
              <p>Kz 184</p>
              <h2>Sozialversicherungsbeiträge (KV-Beitrag)</h2>
              <output>{displayMoney(calculation?.kz184)}</output>
            </article>
          </div>

          <p className="german-sv-check-line">
            {calculation
              ? <>Vereinfachte Berechnung: Kz 453 = <strong>{(calculation.simplifiedFactor * 100).toLocaleString("de-AT", { maximumFractionDigits: 6 })} %</strong> von KV-Bmgl / AEOI-KM.</>
              : "Vereinfachte Kontrollrechnung erscheint hier, sobald ein Betrag eingegeben ist."}
          </p>

          <div className="german-sv-pdf-actions">
            <button
              className="primary-button"
              type="button"
              onClick={() => void downloadPdf()}
              disabled={calculation === null || isDownloadingPdf}
            >
              {isDownloadingPdf ? "PDF wird erstellt…" : "Berechnung als PDF herunterladen"}
            </button>
          </div>

          {downloadError ? (
            <div className="error-box" role="alert" aria-live="polite">
              {downloadError}
            </div>
          ) : null}
        </div>

        <p className="german-sv-source">Stand 26.06.2026</p>

        <GermanPensionOptionView />

      </div>
    </section>
  );
}

function GermanPensionOptionView() {
  const [currentYearInput, setCurrentYearInput] = useState("");
  const [firstFullYearInput, setFirstFullYearInput] = useState("");
  const [firstFullGrossInput, setFirstFullGrossInput] = useState("");
  const [currentAnnualGrossInput, setCurrentAnnualGrossInput] = useState("");

  const parseYear = (value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) && Number.isInteger(n) ? n : null;
  };

  const currentYear = parseYear(currentYearInput);
  const firstFullPensionYear = parseYear(firstFullYearInput);
  const firstFullGrossPension = parseGermanPensionAmount(firstFullGrossInput);
  const currentAnnualGrossPension = parseGermanPensionAmount(currentAnnualGrossInput);

  const inputReady = currentYear !== null
    && firstFullPensionYear !== null
    && firstFullGrossPension !== null
    && currentAnnualGrossPension !== null;

  const calculation = inputReady
    ? calculateGermanPensionOption({
        currentYear,
        firstFullPensionYear,
        firstFullGrossPension,
        currentAnnualGrossPension,
      })
    : null;

  const displayEuro = (value: number | undefined): string =>
    value === undefined ? "—" : formatGermanPensionEuro(value);

  const displayBool = (value: boolean | undefined): string => {
    if (value === undefined) return "—";
    return value ? "Ja" : "Nein";
  };

  const formatPercent = (value: number): string =>
    `${(value * 100).toLocaleString("de-AT", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    })} %`;

  const hasResult = calculation?.available === true;

  return (
    <div className="german-option-card">
      <h2 className="german-option-heading">Optionsmöglichkeit in Deutschland</h2>
      <p className="german-option-subheading">
        Vereinfachter Schnellcheck — keine vollständige Prüfung nach § 1 Abs. 3
        EStG / 90-%-Test. Dieser Rechner prüft ausschließlich den Vergleich der
        österreichischen Pension mit dem deutschen Grundfreibetrag.
      </p>

      <div className="german-option-field-grid">
        <div className="field-group">
          <label className="german-option-label" htmlFor="gpo-current-year">
            Aktuelles Jahr
          </label>
          <div className="german-option-input-wrap">
            <input
              id="gpo-current-year"
              type="text"
              inputMode="numeric"
              value={currentYearInput}
              onChange={(e) => setCurrentYearInput(e.target.value)}
              placeholder="z. B. 2026"
              autoComplete="off"
            />
          </div>
        </div>
        <div className="field-group">
          <label className="german-option-label" htmlFor="gpo-first-full-year">
            Erstes volles Bezugsjahr
          </label>
          <div className="german-option-input-wrap">
            <input
              id="gpo-first-full-year"
              type="text"
              inputMode="numeric"
              value={firstFullYearInput}
              onChange={(e) => setFirstFullYearInput(e.target.value)}
              placeholder="z. B. 2016"
              autoComplete="off"
            />
          </div>
        </div>
        <div className="field-group">
          <label className="german-option-label" htmlFor="gpo-first-full-gross">
            Pension brutto im ersten vollen Bezugsjahr
          </label>
          <div className="german-option-input-wrap">
            <span aria-hidden="true">€</span>
            <input
              id="gpo-first-full-gross"
              type="text"
              inputMode="decimal"
              value={firstFullGrossInput}
              onChange={(e) => setFirstFullGrossInput(e.target.value)}
              placeholder="0,00"
              autoComplete="off"
            />
          </div>
        </div>
        <div className="field-group">
          <label className="german-option-label" htmlFor="gpo-current-gross">
            Aktuelle österreichische PVA/SVA-Bruttopension
          </label>
          <div className="german-option-input-wrap">
            <span aria-hidden="true">€</span>
            <input
              id="gpo-current-gross"
              type="text"
              inputMode="decimal"
              value={currentAnnualGrossInput}
              onChange={(e) => setCurrentAnnualGrossInput(e.target.value)}
              placeholder="0,00"
              autoComplete="off"
            />
          </div>
        </div>
      </div>

      {calculation === null ? (
        <div className="german-option-empty" aria-live="polite">
          Bitte alle Felder ausfüllen, um den Schnellcheck durchzuführen.
        </div>
      ) : !calculation.available ? (
        <div className="german-option-data-unavailable" role="alert" aria-live="polite">
          {calculation.unavailableReason}
        </div>
      ) : null}

      <div
        className="german-option-step-group"
        aria-label="Berechnungsschritte"
        aria-live="polite"
      >
        <div className="german-option-step">
          <span className="german-option-step-num">1</span>
          <span className="german-option-step-label">
            <strong>Rentenfreibetragssatz</strong>
            <small>Jahr des ersten vollen Bezugs: {firstFullPensionYear ?? "—"}</small>
          </span>
          <span className="german-option-step-value">
            {hasResult ? formatPercent(calculation.exemptionRate) : "—"}
          </span>
        </div>
        <div className="german-option-step">
          <span className="german-option-step-num">2</span>
          <span className="german-option-step-label">
            <strong>Fixer Rentenfreibetrag (EUR)</strong>
            <small>Pension 1. Jahr × Freibetragssatz</small>
          </span>
          <span className="german-option-step-value">
            {hasResult ? displayEuro(calculation.fixedPensionExemptionEur) : "—"}
          </span>
        </div>
        <div className="german-option-step">
          <span className="german-option-step-num">3</span>
          <span className="german-option-step-label">
            <strong>Progressionsvorbehalt (EUR)</strong>
            <small>Aktuelle Bruttopension − fixer Freibetrag</small>
          </span>
          <span className="german-option-step-value">
            {hasResult ? displayEuro(calculation.progressionIncomeEur) : "—"}
          </span>
        </div>
        <div className="german-option-step">
          <span className="german-option-step-num">4</span>
          <span className="german-option-step-label">
            <strong>Individueller Grundfreibetrag (EUR)</strong>
            <small>Jahr: {currentYear ?? "—"}</small>
          </span>
          <span className="german-option-step-value">
            {hasResult ? displayEuro(calculation.basicAllowanceEur) : "—"}
          </span>
        </div>
        <div className="german-option-step">
          <span className="german-option-step-num">5</span>
          <span className="german-option-step-label">
            <strong>Differenz zum Grundfreibetrag (EUR)</strong>
            <small>Progressionsvorbehalt − Grundfreibetrag</small>
          </span>
          <span className="german-option-step-value">
            {hasResult ? displayEuro(calculation.differenceToBasicAllowanceEur) : "—"}
          </span>
        </div>
      </div>

      <div className="german-option-result-grid" aria-live="polite">
        <div className={`german-option-result-item${hasResult ? (calculation.optionPossible ? " output-yes" : " output-no") : ""}`}>
          <p>Prüfung</p>
          <h3>Option möglich</h3>
          <output>Option möglich: {hasResult ? displayBool(calculation.optionPossible) : "—"}</output>
        </div>
        <div className={`german-option-result-item label-l1i${hasResult ? (calculation.optionPossible ? " output-yes" : " output-no") : ""}`}>
          <p>Kennzahl</p>
          <h3>L1i Feld 4.2</h3>
          <output>L1i Feld 4.2: {hasResult ? displayBool(calculation.optionPossible) : "—"}</output>
        </div>
      </div>

      <div className="german-option-disclaimer" role="note">
        <strong>Hinweis:</strong> Dieser Schnellcheck prüft ausschließlich den
        Vergleich der differenzbesteuerten österreichischen Pension mit dem
        deutschen Grundfreibetrag. Es wird keine vollständige Prüfung nach § 1
        Abs. 3 EStG / 90-%-Test durchgeführt.
      </div>
    </div>
  );
}


export default function Home() {
  const supabase = getSupabaseBrowserClient();
  const [settings, setSettings] = useState<ChatSettings>(DEFAULT_CHAT_SETTINGS);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState("");
  const [conversationTitle, setConversationTitle] = useState("");
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedConversationIds, setSelectedConversationIds] = useState<string[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [composer, setComposer] = useState("");
  const [selectedPdfs, setSelectedPdfs] = useState<File[]>([]);
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [feedbackTargetIndex, setFeedbackTargetIndex] = useState<number | null>(null);
  const [feedbackDialogType, setFeedbackDialogType] = useState<"positive" | "negative">("positive");
  const [feedbackText, setFeedbackText] = useState("");
  const [isFeedbackSaving, setIsFeedbackSaving] = useState(false);
  const [feedbackError, setFeedbackError] = useState("");
  const [openComposerMenu, setOpenComposerMenu] = useState<ComposerMenu>(null);
  const [pendingStepText, setPendingStepText] = useState(INITIAL_PENDING_TEXT);
  const [pendingSteps, setPendingSteps] = useState<AgentStep[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  const [enabledModels, setEnabledModels] = useState<EnabledModelDescriptor[]>([]);
  const [isModelPolicyLoaded, setIsModelPolicyLoaded] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [adminNotice, setAdminNotice] = useState("");
  const [adminModels, setAdminModels] = useState<AdminModelSetting[]>([]);
  const [isAdminModelsLoading, setIsAdminModelsLoading] = useState(false);
  const [isAdminModelsSaving, setIsAdminModelsSaving] = useState(false);
  const [adminCreateModel, setAdminCreateModel] = useState({ upstreamModel: "", displayName: "", baseUrl: "", apiKey: "", accessScope: "disabled" as "disabled" | "admins" | "all" });
  const [adminEditingModelId, setAdminEditingModelId] = useState<string | null>(null);
  const [adminEditModel, setAdminEditModel] = useState({ upstreamModel: "", displayName: "", baseUrl: "", apiKey: "", accessScope: "disabled" as "disabled" | "admins" | "all" });
  const [isAdminCreatingModel, setIsAdminCreatingModel] = useState(false);
  const [adminUsers, setAdminUsers] = useState<AdminUserSummary[]>([]);
  const [adminUserProfile, setAdminUserProfile] = useState<AdminUserProfile | null>(null);
  const [adminUserForm, setAdminUserForm] = useState({ email: "", password: "" });
  const [isAdminUsersLoading, setIsAdminUsersLoading] = useState(false);
  const [isAdminUserCreating, setIsAdminUserCreating] = useState(false);
  const [isAdminUserMutationRunning, setIsAdminUserMutationRunning] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [isAuthLoaded, setIsAuthLoaded] = useState(false);
  const [authForm, setAuthForm] = useState<AuthForm>({ email: "", password: "" });
  const [passwordChangeForm, setPasswordChangeForm] = useState<PasswordChangeForm>({
    currentPassword: "",
    newPassword: "",
    confirmation: "",
  });
  const [passwordChangeError, setPasswordChangeError] = useState("");
  const [passwordChangeNotice, setPasswordChangeNotice] = useState("");
  const [isPasswordChangeSubmitting, setIsPasswordChangeSubmitting] = useState(false);
  const [accountDeletionError, setAccountDeletionError] = useState("");
  const [isAccountDeletionSubmitting, setIsAccountDeletionSubmitting] = useState(false);
  const [authError, setAuthError] = useState("");
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [historyOwnerId, setHistoryOwnerId] = useState("");
  const [appView, setAppView] = useState<AppView>("chat");
  const [bfgQuery, setBfgQuery] = useState("");
  const [bfgSort, setBfgSort] = useState<BfgSort>("1");
  const [bfgAppliedSort, setBfgAppliedSort] = useState<BfgSort>("1");
  const [bfgFilters, setBfgFilters] = useState<BfgFilterSelection>(emptyBfgFilterSelection);
  const [bfgAppliedFilters, setBfgAppliedFilters] = useState<BfgFilterSelection>(emptyBfgFilterSelection);
  const [isBfgFilterPanelOpen, setIsBfgFilterPanelOpen] = useState(false);
  const [bfgPage, setBfgPage] = useState<BfgDecisionPage | null>(null);
  const [bfgError, setBfgError] = useState("");
  const [hasSearchedBfg, setHasSearchedBfg] = useState(false);
  const [isSearchingBfg, setIsSearchingBfg] = useState(false);
  const [bfgProScenario, setBfgProScenario] = useState("");
  const [bfgProResults, setBfgProResults] = useState<BfgProResult[] | null>(null);
  const [bfgProError, setBfgProError] = useState("");
  const [isSearchingBfgPro, setIsSearchingBfgPro] = useState(false);
  const [selectedFormId, setSelectedFormId] = useState<"" | typeof VERF5_FORM_ID>("");
  const [formImage, setFormImage] = useState<File | null>(null);
  const [formSaldo, setFormSaldo] = useState("");
  const [formError, setFormError] = useState("");
  const [formNotice, setFormNotice] = useState("");
  const [isGeneratingForm, setIsGeneratingForm] = useState(false);
  const [downloadingPdfMessageIndex, setDownloadingPdfMessageIndex] = useState<number | null>(null);
  const [isDownloadingGermanSvPensionPdf, setIsDownloadingGermanSvPensionPdf] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const attachmentMenuControlRef = useRef<HTMLDivElement>(null);
  const attachmentMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const modelMenuControlRef = useRef<HTMLDivElement>(null);
  const modelMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const formImageInputRef = useRef<HTMLInputElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsDialogRef = useRef<HTMLElement>(null);
  const settingsDialogCloseRef = useRef<HTMLButtonElement>(null);
  const authenticatedUserIdRef = useRef<string | null>(null);
  const feedbackCloseRef = useRef<HTMLButtonElement>(null);
  const feedbackTextareaRef = useRef<HTMLTextAreaElement>(null);
  const feedbackTriggerRef = useRef<HTMLButtonElement>(null);
  const feedbackDialogRef = useRef<HTMLElement>(null);
  const user = session?.user ?? null;
  const signedInEmail = user?.email ?? "";
  const [welcomeGreeting] = useState(() => getWelcomeGreeting());
  const closeSettingsDialog = useCallback(() => {
    setIsSettingsDialogOpen(false);
    requestAnimationFrame(() => settingsTriggerRef.current?.focus());
  }, []);
  const closeFeedbackDialog = useCallback(() => {
    if (isFeedbackSaving) {
      return;
    }
    setFeedbackTargetIndex(null);
    setFeedbackError("");
    requestAnimationFrame(() => feedbackTriggerRef.current?.focus());
  }, [isFeedbackSaving]);
  const clearAttachments = useCallback(() => {
    setSelectedPdfs([]);
    setSelectedImages([]);
    if (pdfInputRef.current) {
      pdfInputRef.current.value = "";
    }
    if (imageInputRef.current) {
      imageInputRef.current.value = "";
    }
  }, []);

  useEffect(() => {
    let isActive = true;

    queueMicrotask(() => {
      if (!isActive) {
        return;
      }

      setSettings(normalizeStoredChatSettings(readJson<unknown>(SETTINGS_STORAGE_KEY)));

      if (typeof window !== "undefined" && window.matchMedia("(max-width: 960px)").matches) {
        setSettingsOpen(false);
      }
      setIsLoaded(true);
    });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!supabase) {
      queueMicrotask(() => {
        setIsAuthLoaded(true);
      });
      return;
    }

    let isActive = true;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!isActive) {
        return;
      }

      setSession(nextSession);
      setError("");
      setAuthError("");
      setIsAuthLoaded(true);
    });

    return () => {
      isActive = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (!isLoaded || !isAuthLoaded) {
      return;
    }

    let isActive = true;

    queueMicrotask(() => {
      if (!isActive) {
        return;
      }

      if (!user?.id) {
        authenticatedUserIdRef.current = null;
        setHistoryOwnerId("");
        setConversationId("");
        setConversationTitle("");
        setConversations([]);
        setSelectedConversationIds([]);
        setMessages([]);
        setComposer("");
        setOpenComposerMenu(null);
        clearAttachments();
        setIsSending(false);
        setPendingStepText(INITIAL_PENDING_TEXT);
        setPendingSteps([]);
        setAppView("chat");
        setBfgQuery("");
        setBfgPage(null);
        setBfgError("");
        setHasSearchedBfg(false);
        setIsSearchingBfg(false);
        setSelectedFormId("");
        setFormImage(null);
        setFormSaldo("");
        setFormError("");
        setFormNotice("");
        setIsGeneratingForm(false);
        setEnabledModels([]);
        setIsModelPolicyLoaded(false);
        setAdminModels([]);
        setAdminUsers([]);
        setAdminUserProfile(null);
        setAdminUserForm({ email: "", password: "" });
        return;
      }

      const isFreshAuthenticatedLanding = authenticatedUserIdRef.current !== user.id;
      authenticatedUserIdRef.current = user.id;
      setHistoryOwnerId(user.id);
      if (isFreshAuthenticatedLanding) {
        setConversationId("");
        setConversationTitle("");
        setMessages([]);
        setComposer("");
        setOpenComposerMenu(null);
        setError("");
        setIsSending(false);
        setPendingStepText(INITIAL_PENDING_TEXT);
        setPendingSteps([]);
        clearAttachments();
        removeStoredValue(chatHistoryStorageKey(user.id));
      }

      const accessToken = session?.access_token;
      if (!accessToken) {
        return;
      }
      setIsHistoryLoading(true);
      void (async () => {
        try {
          const response = await fetch("/api/conversations", {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
          if (!response.ok) {
            throw new Error(
              typeof payload.error === "string"
                ? payload.error
                : "Gesprächsverlauf konnte nicht geladen werden.",
            );
          }
          if (!isActive) {
            return;
          }
          const summaries = normalizeConversationSummaries(payload.conversations);
          setConversations(summaries);
        } catch (historyError) {
          if (isActive) {
            setError(historyError instanceof Error
              ? historyError.message
              : "Gesprächsverlauf konnte nicht geladen werden.");
          }
        } finally {
          if (isActive) {
            setIsHistoryLoading(false);
          }
        }
      })();
    });

    return () => {
      isActive = false;
    };
  }, [clearAttachments, isAuthLoaded, isLoaded, session?.access_token, user?.id]);

  useEffect(() => {
    const accessToken = session?.access_token;
    if (!accessToken || !user?.id) {
      queueMicrotask(() => {
        setIsAdmin(false);
        setEnabledModels([]);
        setIsModelPolicyLoaded(false);
        setAppView((current) => current === "administration" ? "chat" : current);
      });
      return;
    }

    let isActive = true;
    queueMicrotask(() => {
      if (isActive) {
        setIsModelPolicyLoaded(false);
      }
    });
    void fetchAuthenticatedSettings(accessToken)
      .then((loadedSettings) => {
        if (!isActive) {
          return;
        }
        setIsAdmin(loadedSettings.isAdmin);
        setEnabledModels(loadedSettings.enabledModels);
        setSettings((current) => loadedSettings.enabledModels.some((model) => model.id === current.model)
          ? current
          : { ...current, model: FLASH_MODEL });
        setIsModelPolicyLoaded(true);
        if (!loadedSettings.isAdmin) {
          setAppView((current) => current === "administration" ? "chat" : current);
        }
      })
      .catch(() => {
        if (isActive) {
          setIsAdmin(false);
          setEnabledModels([]);
          setIsModelPolicyLoaded(false);
          setAppView((current) => current === "administration" ? "chat" : current);
        }
      });

    return () => {
      isActive = false;
    };
  }, [session?.access_token, user?.id]);

  useEffect(() => {
    if (isLoaded) {
      writeJson(SETTINGS_STORAGE_KEY, {
        model: settings.model,
      });
    }
  }, [isLoaded, settings]);

  useEffect(() => {
    if (isLoaded && user?.id && historyOwnerId === user.id && conversationId) {
      writeJson(chatHistoryStorageKey(user.id), {
        conversationId,
        title: conversationTitle,
        messages,
      });
    }
  }, [conversationId, conversationTitle, historyOwnerId, isLoaded, messages, user?.id]);

  useEffect(() => {
    if (!isSettingsDialogOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeSettingsDialog();
        return;
      }
      if (event.key === "Tab") {
        const focusable = Array.from(
          settingsDialogRef.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), [href]",
          ) ?? [],
        );
        const first = focusable[0];
        const last = focusable.at(-1);
        if (first && last && event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (first && last && !event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    settingsDialogCloseRef.current?.focus();
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeSettingsDialog, isSettingsDialogOpen]);

  useEffect(() => {
    if (feedbackTargetIndex === null) {
      return;
    }

    if (feedbackDialogType === "positive") {
      feedbackCloseRef.current?.focus();
    } else {
      feedbackTextareaRef.current?.focus();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isFeedbackSaving) {
        event.preventDefault();
        closeFeedbackDialog();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }

      const dialog = feedbackDialogRef.current;
      if (!dialog) {
        return;
      }
      const focusableElements = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements[focusableElements.length - 1];

      if (!firstFocusable || !lastFocusable) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === firstFocusable || !dialog.contains(activeElement))) {
        event.preventDefault();
        lastFocusable.focus();
      } else if (!event.shiftKey && (activeElement === lastFocusable || !dialog.contains(activeElement))) {
        event.preventDefault();
        firstFocusable.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeFeedbackDialog, feedbackDialogType, feedbackTargetIndex, isFeedbackSaving]);

  useEffect(() => {
    if (!openComposerMenu) {
      return;
    }

    const controlRef = openComposerMenu === "attachments"
      ? attachmentMenuControlRef
      : modelMenuControlRef;
    const triggerRef = openComposerMenu === "attachments"
      ? attachmentMenuTriggerRef
      : modelMenuTriggerRef;
    const focusFrame = requestAnimationFrame(() => {
      controlRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"], [role="menuitemradio"]')
        ?.focus();
    });

    const handlePointerDown = (event: PointerEvent) => {
      if (!controlRef.current?.contains(event.target as Node)) {
        setOpenComposerMenu(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      setOpenComposerMenu(null);
      requestAnimationFrame(() => triggerRef.current?.focus());
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openComposerMenu]);

  useEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = `${COMPOSER_MIN_HEIGHT}px`;
    textarea.style.height = `${clampComposerHeight(textarea.scrollHeight)}px`;
  }, [composer]);

  useEffect(() => {
    const prefersReducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  }, [isSending, messages, pendingStepText, pendingSteps]);

  function updateSetting<Key extends keyof ChatSettings>(key: Key, value: ChatSettings[Key]) {
    setSettings((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function applyEnabledModels(models: EnabledModelDescriptor[]) {
    setEnabledModels(models);
    setSettings((current) => models.some((model) => model.id === current.model)
      ? current
      : { ...current, model: FLASH_MODEL });
    setIsModelPolicyLoaded(true);
  }

  async function toggleComposerModelMenu() {
    if (openComposerMenu === "model") {
      setOpenComposerMenu(null);
      return;
    }

    const accessToken = session?.access_token;
    if (!accessToken) {
      setError("Deine Anmeldung ist abgelaufen. Bitte erneut anmelden.");
      return;
    }

    try {
      const loadedSettings = await fetchAuthenticatedSettings(accessToken);
      setIsAdmin(loadedSettings.isAdmin);
      applyEnabledModels(loadedSettings.enabledModels);
      setOpenComposerMenu("model");
    } catch {
      setError("Die freigegebenen Modelle konnten nicht geladen werden.");
      setOpenComposerMenu(null);
    }
  }

  function updateAuthForm<Key extends keyof AuthForm>(key: Key, value: AuthForm[Key]) {
    setAuthForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function updatePasswordChangeForm<Key extends keyof PasswordChangeForm>(
    key: Key,
    value: PasswordChangeForm[Key],
  ) {
    setPasswordChangeForm((current) => ({
      ...current,
      [key]: value,
    }));
    setPasswordChangeError("");
    setPasswordChangeNotice("");
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isAuthSubmitting) {
      return;
    }
    if (!supabase) {
      setAuthError("Supabase Auth ist noch nicht konfiguriert.");
      return;
    }

    const email = authForm.email.trim();
    const password = authForm.password;

    if (!email || !password) {
      setAuthError("Bitte E-Mail-Adresse und Passwort eingeben.");
      return;
    }
    if (password.length < 6) {
      setAuthError("Das Passwort muss mindestens 6 Zeichen lang sein.");
      return;
    }

    setAuthError("");
    setIsAuthSubmitting(true);

    try {
      const { error: authSubmitError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authSubmitError) {
        throw authSubmitError;
      }

      setAuthForm({ email: "", password: "" });
    } catch {
      setAuthError("Anmeldung fehlgeschlagen. Bitte E-Mail und Passwort prüfen.");
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  async function handlePasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isPasswordChangeSubmitting) {
      return;
    }

    let input;
    try {
      input = parsePasswordChangeBody(passwordChangeForm);
    } catch (validationError) {
      setPasswordChangeError(
        validationError instanceof Error
          ? validationError.message
          : "Die Passwortangaben sind ungültig.",
      );
      setPasswordChangeNotice("");
      return;
    }

    const accessToken = session?.access_token;
    if (!accessToken) {
      setPasswordChangeError("Deine Anmeldung ist abgelaufen. Bitte erneut anmelden.");
      setPasswordChangeNotice("");
      return;
    }

    setPasswordChangeError("");
    setPasswordChangeNotice("");
    setIsPasswordChangeSubmitting(true);
    try {
      const response = await fetch("/api/account/password", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok || payload.success !== true) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "Das Passwort konnte nicht geändert werden.",
        );
      }

      setPasswordChangeForm({ currentPassword: "", newPassword: "", confirmation: "" });
      setPasswordChangeNotice("Das Passwort wurde erfolgreich geändert.");
    } catch (passwordError) {
      setPasswordChangeError(
        passwordError instanceof Error
          ? passwordError.message
          : "Das Passwort konnte nicht geändert werden.",
      );
    } finally {
      setIsPasswordChangeSubmitting(false);
    }
  }

  async function deleteOwnAccount() {
    if (isAccountDeletionSubmitting) {
      return;
    }
    if (!window.confirm(
      "Dein Konto wirklich dauerhaft löschen? Konto, Unterhaltungen und Anfrageverlauf werden unwiderruflich entfernt.",
    )) {
      return;
    }

    const accessToken = session?.access_token;
    if (!accessToken || !user?.id) {
      setAccountDeletionError("Deine Anmeldung ist abgelaufen. Bitte erneut anmelden.");
      return;
    }

    setAccountDeletionError("");
    setIsAccountDeletionSubmitting(true);
    try {
      const response = await fetch("/api/account", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok || payload.success !== true) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "Das Benutzerkonto konnte nicht gelöscht werden.",
        );
      }

      try {
        await supabase?.auth.signOut({ scope: "local" });
      } catch {
        // The server has already deleted the user; local cleanup must still complete.
      }
      removeStoredValue(SETTINGS_STORAGE_KEY);
      removeStoredValue(chatHistoryStorageKey(user.id));
      setSettings({ ...DEFAULT_CHAT_SETTINGS, model: FLASH_MODEL });
      setEnabledModels([]);
      setIsModelPolicyLoaded(false);
      setSession(null);
      setHistoryOwnerId("");
      setConversationId("");
      setConversationTitle("");
      setConversations([]);
      setSelectedConversationIds([]);
      setMessages([]);
      setComposer("");
      setAdminModels([]);
      setIsAdmin(false);
      setAppView("chat");
      clearAttachments();
      closeSettingsDialog();
    } catch (deletionError) {
      setAccountDeletionError(
        deletionError instanceof Error
          ? deletionError.message
          : "Das Benutzerkonto konnte nicht gelöscht werden.",
      );
    } finally {
      setIsAccountDeletionSubmitting(false);
    }
  }

  async function handleSignOut() {
    if (!supabase || isAuthSubmitting) {
      return;
    }

    setAuthError("");
    setIsAuthSubmitting(true);

    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        throw signOutError;
      }

      setSession(null);
      setHistoryOwnerId("");
      setConversationId("");
      setConversationTitle("");
      setConversations([]);
      setSelectedConversationIds([]);
      setMessages([]);
      setComposer("");
      clearAttachments();
      setError("");
      setPendingStepText(INITIAL_PENDING_TEXT);
      setPendingSteps([]);
    } catch {
      setAuthError("Abmeldung fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  function removePdfAttachment(index: number) {
    setSelectedPdfs((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function removeImageAttachment(index: number) {
    setSelectedImages((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function handlePdfChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (files.length === 0) {
      return;
    }
    if (selectedPdfs.length + files.length > MAX_PDF_UPLOADS) {
      setError(`Bitte maximal ${MAX_PDF_UPLOADS} PDF-Dateien pro Anfrage hochladen.`);
      return;
    }

    for (const file of files) {
      if (file.type !== "application/pdf") {
        setError("Bitte nur PDF-Dateien hochladen.");
        return;
      }
      if (file.size > MAX_PDF_UPLOAD_BYTES) {
        setError("Das PDF ist zu groß. Maximal 50 MB sind erlaubt.");
        return;
      }
    }

    setSelectedPdfs((current) => [...current, ...files]);
    setError("");
  }

  function addImageAttachments(files: File[]) {
    if (files.length === 0) {
      return;
    }
    if (selectedImages.length + files.length > MAX_IMAGE_UPLOADS) {
      setError(`Bitte maximal ${MAX_IMAGE_UPLOADS} Bilder pro Anfrage hochladen.`);
      return;
    }

    if (!files.every((file) => file.type.toLowerCase().startsWith("image/"))) {
      setError("Bitte nur Bilddateien hochladen.");
      return;
    }
    if (files.some((file) => file.size > MAX_IMAGE_UPLOAD_BYTES)) {
      setError("Das Bild ist zu groß. Maximal 5 MB sind erlaubt.");
      return;
    }

    setSelectedImages((current) => [...current, ...files]);
    setError("");
  }

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    addImageAttachments(files);
  }

  function handleComposerPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (isSending || isDeleting) {
      return;
    }

    addImageAttachments(clipboardImageFiles(event.clipboardData.items));
  }

  function openFormsView() {
    setAppView("forms");
    setSelectedFormId("");
    setFormImage(null);
    setFormSaldo("");
    setFormError("");
    setFormNotice("");
    if (formImageInputRef.current) {
      formImageInputRef.current.value = "";
    }
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 960px)").matches) {
      setSettingsOpen(false);
    }
  }

  function openBfgDecisionsView() {
    setAppView("bfg-decisions");
    setBfgError("");
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 960px)").matches) {
      setSettingsOpen(false);
    }
  }

  function openBfgProView() {
    setAppView("bfg-pro");
    setBfgProError("");
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 960px)").matches) {
      setSettingsOpen(false);
    }
  }

  function openGermanSvPensionView() {
    setAppView("german-sv-pension");
    setError("");
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 960px)").matches) {
      setSettingsOpen(false);
    }
  }

  function openL17bCurrencyView() {
    setAppView("l17b-currency");
    setError("");
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 960px)").matches) {
      setSettingsOpen(false);
    }
  }

  async function searchBfgPro() {
    const scenario = bfgProScenario.trim();
    const accessToken = session?.access_token;
    if (!scenario) {
      setBfgProError("Bitte einen Sachverhalt eingeben.");
      return;
    }
    if (!accessToken) {
      setBfgProError("Deine Anmeldung ist abgelaufen. Bitte erneut anmelden.");
      return;
    }

    setBfgProError("");
    setBfgProResults(null);
    setIsSearchingBfgPro(true);
    try {
      const response = await fetch("/api/findok/bfg/pro", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ scenario }),
      });
      const payload = (await response.json().catch(() => ({}))) as unknown;
      if (!response.ok) {
        const errorPayload = payload && typeof payload === "object" && !Array.isArray(payload)
          ? payload as Record<string, unknown>
          : {};
        throw new Error(
          typeof errorPayload.error === "string"
            ? errorPayload.error
            : "Die BFG Suche PRO konnte nicht durchgeführt werden.",
        );
      }
      const results = normalizeBfgProResults(payload);
      if (!results) {
        throw new Error("Die BFG Suche PRO lieferte eine ungültige Antwort.");
      }
      setBfgProResults(results);
    } catch (searchError) {
      setBfgProError(
        searchError instanceof Error
          ? searchError.message
          : "Die BFG Suche PRO konnte nicht durchgeführt werden.",
      );
    } finally {
      setIsSearchingBfgPro(false);
    }
  }

  function updateBfgFilter<Key extends keyof BfgFilterSelection>(
    key: Key,
    value: BfgFilterSelection[Key],
  ) {
    setBfgFilters((current) => ({ ...current, [key]: value }));
  }

  async function searchBfgDecisions(
    page: number,
    controls = { sort: bfgAppliedSort, filters: bfgAppliedFilters },
  ) {
    const query = bfgQuery.trim();
    const accessToken = session?.access_token;
    if (!query) {
      setBfgError("Bitte einen Suchbegriff oder eine Geschäftszahl eingeben.");
      return;
    }
    if (!accessToken) {
      setBfgError("Deine Anmeldung ist abgelaufen. Bitte erneut anmelden.");
      return;
    }

    setBfgError("");
    setIsSearchingBfg(true);
    try {
      const parameters = new URLSearchParams({
        q: query,
        page: String(page),
        size: "10",
      });
      parameters.set("sort", controls.sort);
      if (controls.filters.materie) {
        parameters.set("materie", controls.filters.materie);
      }
      if (controls.filters.documentType) {
        parameters.set("documentType", controls.filters.documentType);
      }
      if (controls.filters.norm) {
        parameters.set("norm", controls.filters.norm);
      }
      if (controls.filters.timeframe) {
        parameters.set("timeframe", controls.filters.timeframe);
      }
      if (controls.filters.withHeadnote) {
        parameters.set("withHeadnote", "true");
      }
      setBfgAppliedSort(controls.sort);
      setBfgAppliedFilters(controls.filters);
      const response = await fetch(`/api/findok/bfg?${parameters.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = (await response.json().catch(() => ({}))) as unknown;
      if (!response.ok) {
        const errorPayload = payload && typeof payload === "object" && !Array.isArray(payload)
          ? payload as Record<string, unknown>
          : {};
        throw new Error(
          typeof errorPayload.error === "string"
            ? errorPayload.error
            : "Die BFG-Suche konnte nicht durchgeführt werden.",
        );
      }
      const normalized = normalizeBfgDecisionPage(payload);
      if (!normalized) {
        throw new Error("Findok lieferte eine ungültige Antwort.");
      }
      setBfgPage(normalized);
      setBfgFilters((current) => availableBfgFilterSelection(current, normalized.facets));
      setHasSearchedBfg(true);
    } catch (searchError) {
      setBfgError(
        searchError instanceof Error
          ? searchError.message
          : "Die BFG-Suche konnte nicht durchgeführt werden.",
      );
    } finally {
      setIsSearchingBfg(false);
    }
  }

  function resetBfgFilters() {
    const filters = emptyBfgFilterSelection();
    setBfgFilters(filters);
    if (hasSearchedBfg) {
      void searchBfgDecisions(1, { sort: bfgSort, filters });
    }
  }

  async function loadAdminModels(accessToken: string) {
    setIsAdminModelsLoading(true);
    try {
      const response = await fetch("/api/admin/models", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const models = normalizeAdminModels(payload.models);
      if (!response.ok || !models) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "Modelleinstellungen konnten nicht geladen werden.",
        );
      }
      setAdminModels(models);
    } catch (modelSettingsError) {
      setAdminModels([]);
      setAdminError(modelSettingsError instanceof Error
        ? modelSettingsError.message
        : "Modelleinstellungen konnten nicht geladen werden.");
    } finally {
      setIsAdminModelsLoading(false);
    }
  }

  function updateAdminModelEnabled(modelId: string, enabled: boolean) {
    setAdminModels((current) => current.map((model) => model.id === modelId
      ? { ...model, enabled: model.alwaysEnabled ? true : enabled }
      : model));
  }

  function updateAdminModelReasoning(modelId: string, reasoning: string) {
    setAdminModels((current) => current.map((model) => model.id === modelId
      && model.reasoningOptions.some((option) => option.value === reasoning)
      ? { ...model, reasoning }
      : model));
  }

  async function saveAdminModels() {
    const accessToken = session?.access_token;
    if (!accessToken || !isAdmin || isAdminModelsSaving || adminModels.length === 0) {
      return;
    }

    setAdminError("");
    setAdminNotice("");
    setIsAdminModelsSaving(true);
    try {
      const response = await fetch("/api/admin/models", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          models: adminModels
            .filter((model) => !isDynamicModelId(model.id))
            .map((model) => ({
              id: model.id,
              enabled: model.alwaysEnabled ? true : model.enabled,
              reasoning: model.reasoning,
              revision: model.revision,
            })),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const models = normalizeAdminModels(payload.models);
      if (!response.ok || !models) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "Modelleinstellungen konnten nicht gespeichert werden.",
        );
      }

      setAdminModels(models);
      const publicSettings = await fetchAuthenticatedSettings(accessToken);
      setIsAdmin(publicSettings.isAdmin);
      applyEnabledModels(publicSettings.enabledModels);
      setAdminNotice("Die Modelleinstellungen wurden gespeichert.");
    } catch (saveError) {
      setAdminError(saveError instanceof Error
        ? saveError.message
        : "Modelleinstellungen konnten nicht gespeichert werden.");
    } finally {
      setIsAdminModelsSaving(false);
    }
  }

  async function refreshModelSettings(accessToken: string) {
    await loadAdminModels(accessToken);
    const publicSettings = await fetchAuthenticatedSettings(accessToken);
    setIsAdmin(publicSettings.isAdmin);
    applyEnabledModels(publicSettings.enabledModels);
  }

  async function createOpenAICompatibleModel() {
    const accessToken = session?.access_token;
    if (!accessToken || !isAdmin || isAdminCreatingModel || !adminCreateModel.upstreamModel.trim() || !adminCreateModel.baseUrl.trim() || !adminCreateModel.apiKey.trim()) return;
    setAdminError(""); setAdminNotice(""); setIsAdminCreatingModel(true);
    try {
      const response = await fetch("/api/admin/models", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...adminCreateModel, upstreamModel: adminCreateModel.upstreamModel.trim(), displayName: adminCreateModel.displayName.trim() || null, baseUrl: adminCreateModel.baseUrl.trim() }),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Das Modell konnte nicht angelegt werden.");
      setAdminCreateModel({ upstreamModel: "", displayName: "", baseUrl: "", apiKey: "", accessScope: "disabled" });
      await refreshModelSettings(accessToken);
      setAdminNotice("Das OpenAI-kompatible Modell wurde angelegt.");
    } catch (createError) {
      setAdminError(createError instanceof Error ? createError.message : "Das Modell konnte nicht angelegt werden.");
    } finally { setIsAdminCreatingModel(false); }
  }

  function startEditingOpenAICompatibleModel(model: AdminModelSetting) {
    setAdminEditingModelId(model.id);
    setAdminEditModel({ upstreamModel: model.upstreamModel ?? "", displayName: model.displayName ?? "", baseUrl: model.baseUrl ?? "", apiKey: "", accessScope: model.accessScope ?? "disabled" });
  }

  function cancelEditingOpenAICompatibleModel() {
    setAdminEditingModelId(null);
    setAdminEditModel({ upstreamModel: "", displayName: "", baseUrl: "", apiKey: "", accessScope: "disabled" });
  }

  async function saveOpenAICompatibleModel(model: AdminModelSetting) {
    const accessToken = session?.access_token;
    if (
      !accessToken
      || !isAdmin
      || isAdminModelsSaving
      || adminEditingModelId !== model.id
      || !adminEditModel.upstreamModel.trim()
      || !adminEditModel.baseUrl.trim()
    ) return;
    setAdminError(""); setAdminNotice(""); setIsAdminModelsSaving(true);
    try {
      const response = await fetch(`/api/admin/models/${encodeURIComponent(model.id)}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...adminEditModel, upstreamModel: adminEditModel.upstreamModel.trim(), displayName: adminEditModel.displayName.trim() || null, baseUrl: adminEditModel.baseUrl.trim(), revision: model.revision }),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Das Modell konnte nicht gespeichert werden.");
      cancelEditingOpenAICompatibleModel();
      await refreshModelSettings(accessToken);
      setAdminNotice("Das OpenAI-kompatible Modell wurde gespeichert.");
    } catch (saveError) {
      setAdminError(saveError instanceof Error ? saveError.message : "Das Modell konnte nicht gespeichert werden.");
    } finally { setIsAdminModelsSaving(false); }
  }

  async function deleteOpenAICompatibleModel(model: AdminModelSetting) {
    const accessToken = session?.access_token;
    if (!accessToken || !isAdmin || isAdminModelsSaving || !window.confirm(`Modell „${model.label}“ wirklich löschen?`)) return;
    setAdminError(""); setAdminNotice(""); setIsAdminModelsSaving(true);
    try {
      const response = await fetch(`/api/admin/models/${encodeURIComponent(model.id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ revision: model.revision }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error(typeof payload.error === "string" ? payload.error : "Das Modell konnte nicht gelöscht werden.");
      }
      if (adminEditingModelId === model.id) cancelEditingOpenAICompatibleModel();
      await refreshModelSettings(accessToken);
      setAdminNotice("Das OpenAI-kompatible Modell wurde gelöscht.");
    } catch (deleteError) {
      setAdminError(deleteError instanceof Error ? deleteError.message : "Das Modell konnte nicht gelöscht werden.");
    } finally { setIsAdminModelsSaving(false); }
  }

  async function openAdministrationView() {
    const accessToken = session?.access_token;
    if (!isAdmin || !accessToken) {
      return;
    }
    setAppView("administration");
    setAdminError("");
    setAdminNotice("");
    setIsAdminUsersLoading(true);
    setAdminUserProfile(null);
    void loadAdminModels(accessToken);
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 960px)").matches) {
      setSettingsOpen(false);
    }

    try {
      const usersResponse = await fetch("/api/admin/users", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const usersPayload = (await usersResponse.json().catch(() => ({}))) as Record<string, unknown>;
      if (!usersResponse.ok || !Array.isArray(usersPayload.users)) {
        throw new Error(
          typeof usersPayload.error === "string"
            ? usersPayload.error
            : "Benutzer konnten nicht geladen werden.",
        );
      }
      const loadedUsers = usersPayload.users.flatMap((item): AdminUserSummary[] => {
        const loadedUser = normalizeAdminUser(item);
        return loadedUser ? [loadedUser] : [];
      });
      if (loadedUsers.length !== usersPayload.users.length) {
        throw new Error("Die geladenen Benutzerdaten sind ungültig.");
      }
      setAdminUsers(loadedUsers);
    } catch (adminUsersError) {
      setAdminError(adminUsersError instanceof Error
        ? adminUsersError.message
        : "Benutzer konnten nicht geladen werden.");
    } finally {
      setIsAdminUsersLoading(false);
    }
  }

  async function loadAdminUserProfile(userId: string) {
    const accessToken = session?.access_token;
    if (!accessToken || isAdminUserMutationRunning) {
      return;
    }
    setAdminError("");
    setAdminNotice("");
    setIsAdminUsersLoading(true);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const profile = normalizeAdminUserProfile(payload);
      if (!response.ok || !profile) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : "Benutzerprofil konnte nicht geladen werden.",
        );
      }
      setAdminUserProfile(profile);
    } catch (profileError) {
      setAdminError(profileError instanceof Error
        ? profileError.message
        : "Benutzerprofil konnte nicht geladen werden.");
    } finally {
      setIsAdminUsersLoading(false);
    }
  }

  async function createAdminManagedUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const accessToken = session?.access_token;
    if (!accessToken || isAdminUserCreating) {
      return;
    }
    setAdminError("");
    setAdminNotice("");
    setIsAdminUserCreating(true);
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(adminUserForm),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const createdUser = normalizeAdminUser(payload.user);
      if (!response.ok || !createdUser) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : "Das Benutzerkonto konnte nicht erstellt werden.",
        );
      }
      setAdminUsers((current) => [...current, createdUser]
        .sort((left, right) => left.email.localeCompare(right.email, "de")));
      setAdminUserForm({ email: "", password: "" });
      setAdminNotice(`Das Benutzerkonto ${createdUser.email} wurde erstellt.`);
      setAdminUserProfile({ user: createdUser, requestCount: 0, requests: [] });
    } catch (createError) {
      setAdminError(createError instanceof Error
        ? createError.message
        : "Das Benutzerkonto konnte nicht erstellt werden.");
    } finally {
      setIsAdminUserCreating(false);
    }
  }

  async function deleteAdminRequestHistory() {
    const accessToken = session?.access_token;
    const profile = adminUserProfile;
    if (!accessToken || !profile || isAdminUserMutationRunning) {
      return;
    }
    if (!window.confirm(
      `Den separaten Anfrageverlauf von ${profile.user.email} wirklich löschen? Die Unterhaltungen bleiben erhalten.`,
    )) {
      return;
    }
    setAdminError("");
    setAdminNotice("");
    setIsAdminUserMutationRunning(true);
    try {
      const response = await fetch(
        `/api/admin/users/${encodeURIComponent(profile.user.id)}/requests`,
        { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok || payload.success !== true) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : "Anfrageverlauf konnte nicht gelöscht werden.",
        );
      }
      setAdminUserProfile((current) => current?.user.id === profile.user.id
        ? { ...current, requestCount: 0, requests: [] }
        : current);
      setAdminNotice("Der separate Anfrageverlauf wurde gelöscht. Unterhaltungen bleiben erhalten.");
    } catch (deleteError) {
      setAdminError(deleteError instanceof Error
        ? deleteError.message
        : "Anfrageverlauf konnte nicht gelöscht werden.");
    } finally {
      setIsAdminUserMutationRunning(false);
    }
  }

  async function deleteAdminManagedUser() {
    const accessToken = session?.access_token;
    const profile = adminUserProfile;
    if (
      !accessToken
      || !profile
      || profile.user.id === user?.id
      || isAdminUserMutationRunning
    ) {
      return;
    }
    if (!window.confirm(
      `Das Konto ${profile.user.email} wirklich löschen? Konto, Unterhaltungen und Anfrageverlauf werden dauerhaft entfernt.`,
    )) {
      return;
    }
    setAdminError("");
    setAdminNotice("");
    setIsAdminUserMutationRunning(true);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(profile.user.id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok || payload.success !== true) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : "Das Benutzerkonto konnte nicht gelöscht werden.",
        );
      }
      setAdminUsers((current) => current.filter((entry) => entry.id !== profile.user.id));
      setAdminUserProfile(null);
      setAdminNotice(`Das Benutzerkonto ${profile.user.email} wurde gelöscht.`);
    } catch (deleteError) {
      setAdminError(deleteError instanceof Error
        ? deleteError.message
        : "Das Benutzerkonto konnte nicht gelöscht werden.");
    } finally {
      setIsAdminUserMutationRunning(false);
    }
  }

  function selectVerf5Form() {
    setSelectedFormId(VERF5_FORM_ID);
    setFormImage(null);
    setFormSaldo("");
    setFormError("");
    setFormNotice("");
  }

  function showFormSelection() {
    if (isGeneratingForm) {
      return;
    }
    setSelectedFormId("");
    setFormImage(null);
    setFormSaldo("");
    setFormError("");
    setFormNotice("");
    if (formImageInputRef.current) {
      formImageInputRef.current.value = "";
    }
  }

  function handleFormImageChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    setFormNotice("");

    if (files.length === 0) {
      return;
    }
    if (files.length !== 1) {
      event.target.value = "";
      setFormImage(null);
      setFormError("Bitte genau ein Bild auswählen.");
      return;
    }

    const image = files[0];
    if (!image || !isFormImageMimeType(image.type.toLowerCase())) {
      event.target.value = "";
      setFormImage(null);
      setFormError("Bitte nur JPEG-, PNG- oder WebP-Bilder auswählen.");
      return;
    }
    if (image.size > MAX_FORM_IMAGE_BYTES) {
      event.target.value = "";
      setFormImage(null);
      setFormError("Das Bild ist zu groß. Maximal 5 MB sind erlaubt.");
      return;
    }

    setFormImage(image);
    setFormError("");
  }

  async function handleFormGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isGeneratingForm || selectedFormId !== VERF5_FORM_ID) {
      return;
    }
    if (!formImage) {
      setFormError("Bitte ein Bild auswählen.");
      return;
    }

    try {
      normalizeManualSaldo(formSaldo);
    } catch (saldoError) {
      setFormError(saldoError instanceof Error ? saldoError.message : "Der Saldo ist ungültig.");
      return;
    }

    if (!supabase || !user) {
      setFormError("Bitte zuerst anmelden.");
      return;
    }

    setFormError("");
    setFormNotice("");
    setIsGeneratingForm(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        throw new Error("Deine Anmeldung ist abgelaufen. Bitte erneut anmelden.");
      }
      setSession(sessionData.session);

      const formData = new FormData();
      formData.append("formId", VERF5_FORM_ID);
      formData.append("image", formImage, formImage.name);
      formData.append("saldo", formSaldo);

      const response = await fetch("/api/forms/generate", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body: formData,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "Das Formular konnte nicht erstellt werden.",
        );
      }

      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = /filename="(Verf5_\d{2}\.\d{2}\.\d{4}\.docx)"/.exec(disposition)?.[1];
      if (!filename) {
        throw new Error("Die Formularantwort war ungültig. Bitte erneut versuchen.");
      }

      const documentBlob = await response.blob();
      const downloadUrl = URL.createObjectURL(documentBlob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
      setFormNotice("Das Formular wurde erstellt und heruntergeladen.");
    } catch (generateError) {
      setFormError(
        generateError instanceof Error
          ? generateError.message
          : "Das Formular konnte nicht erstellt werden.",
      );
    } finally {
      setIsGeneratingForm(false);
    }
  }

  function startNewConversation() {
    setAppView("chat");
    setError("");
    setMessages([]);
    setConversationId("");
    setConversationTitle("");
    setPendingStepText(INITIAL_PENDING_TEXT);
    setPendingSteps([]);
    clearAttachments();
    if (user?.id) {
      writeJson(chatHistoryStorageKey(user.id), { conversationId: "", title: "", messages: [] });
    }
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 960px)").matches) {
      setSettingsOpen(false);
    }
  }

  async function selectConversation(conversation: ConversationSummary) {
    if (isSending || isHistoryLoading || isDeleting || !session?.access_token) {
      return;
    }
    setError("");
    setIsHistoryLoading(true);
    try {
      const history = await fetchConversationHistory(session.access_token, conversation.id);
      setAppView("chat");
      setConversationId(conversation.id);
      setConversationTitle(history.title);
      setMessages(history.messages);
      setComposer("");
      setPendingStepText(INITIAL_PENDING_TEXT);
      setPendingSteps([]);
      clearAttachments();
      if (typeof window !== "undefined" && window.matchMedia("(max-width: 960px)").matches) {
        setSettingsOpen(false);
      }
    } catch (historyError) {
      setError(historyError instanceof Error
        ? historyError.message
        : "Gespräch konnte nicht geladen werden.");
    } finally {
      setIsHistoryLoading(false);
    }
  }

  function toggleConversationSelection(id: string) {
    setSelectedConversationIds((current) =>
      current.includes(id) ? current.filter((selectedId) => selectedId !== id) : [...current, id],
    );
  }

  async function deleteConversations(ids: string[], useBulkEndpoint = false) {
    if (
      ids.length === 0
      || isSending
      || isHistoryLoading
      || isDeleting
      || !session?.access_token
    ) {
      return;
    }

    const confirmed = window.confirm(
      ids.length === 1
        ? "Diese Unterhaltung wirklich löschen? Alle Nachrichten und Agentenschritte werden entfernt."
        : `${ids.length} Unterhaltungen wirklich löschen? Alle Nachrichten und Agentenschritte werden entfernt.`,
    );
    if (!confirmed) {
      return;
    }

    setError("");
    setIsDeleting(true);
    try {
      const response = await fetch(
        useBulkEndpoint
          ? "/api/conversations"
          : `/api/conversations/${encodeURIComponent(ids[0])}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            ...(useBulkEndpoint ? { "Content-Type": "application/json" } : {}),
          },
          ...(useBulkEndpoint ? { body: JSON.stringify({ ids }) } : {}),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "Unterhaltung konnte nicht gelöscht werden.",
        );
      }

      const deletedIds = Array.isArray(payload.deletedIds)
        ? payload.deletedIds.filter((id): id is string => typeof id === "string")
        : [];
      const result = applyConversationDeletion({
        conversations,
        selectedIds: selectedConversationIds,
        activeConversationId: conversationId,
        deletedIds,
      });
      setConversations(result.conversations);
      setSelectedConversationIds(result.selectedIds);

      if (result.activeConversationDeleted) {
        setConversationId("");
        setConversationTitle("");
        setMessages([]);
        setComposer("");
        setIsSending(false);
        setPendingStepText(INITIAL_PENDING_TEXT);
        setPendingSteps([]);
        clearAttachments();
        if (user?.id) {
          removeStoredValue(chatHistoryStorageKey(user.id));
        }
      }
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unterhaltung konnte nicht gelöscht werden.",
      );
    } finally {
      setIsDeleting(false);
    }
  }

  function openSettingsDialog() {
    setAccountDeletionError("");
    setIsSettingsDialogOpen(true);
  }

  function handleComposerMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"], [role="menuitemradio"]',
      ),
    );
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | undefined;

    if (event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % items.length;
    } else if (event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + items.length) % items.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = items.length - 1;
    }

    if (nextIndex !== undefined && items[nextIndex]) {
      event.preventDefault();
      items[nextIndex].focus();
    }
  }

  function chooseAttachment(input: HTMLInputElement | null) {
    setOpenComposerMenu(null);
    input?.click();
  }

  async function submitFeedback(messageIndex: number) {
    if (isFeedbackSaving) return;
    setFeedbackError("");
    setIsFeedbackSaving(true);

    const message = messages[messageIndex];
    if (!message || message.role !== "assistant") {
      setIsFeedbackSaving(false);
      return;
    }

    const userRequest = findNearestPrecedingUserMessage(messages, messageIndex);
    if (!userRequest) {
      setIsFeedbackSaving(false);
      return;
    }

    try {
      const currentSession = await getSupabaseBrowserClient()?.auth.getSession();
      const accessToken = currentSession?.data?.session?.access_token;
      if (!accessToken) {
        setFeedbackError("Sitzung abgelaufen. Bitte lade die Seite neu.");
        setIsFeedbackSaving(false);
        return;
      }

      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          conversationId: conversationId,
          userRequest,
          assistantResponse: message.content,
          feedback: feedbackText.trim(),
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        setFeedbackError(
          typeof payload.error === "string" ? payload.error : "Feedback konnte nicht gespeichert werden.",
        );
        setIsFeedbackSaving(false);
        return;
      }

      setFeedbackDialogType("positive");
      setFeedbackText("");
      setFeedbackError("");
    } catch (err) {
      setFeedbackError(
        err instanceof Error ? err.message : "Feedback konnte nicht gespeichert werden.",
      );
    } finally {
      setIsFeedbackSaving(false);
    }
  }
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isDeleting) {
      return;
    }

    const question = composer.trim();
    const attachedPdfs = selectedPdfs;
    const attachedImages = selectedImages;
    const hasAttachments = attachedPdfs.length > 0 || attachedImages.length > 0;
    if ((!question && !hasAttachments) || isSending) {
      return;
    }

    if (!supabase || !user) {
      setError("Bitte zuerst anmelden.");
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) {
      setError("Deine Anmeldung ist abgelaufen. Bitte erneut anmelden.");
      return;
    }
    setSession(sessionData.session);

    const attachmentLines = [
      ...attachedPdfs.map((file) => `PDF-Anhang: ${file.name}`),
      ...attachedImages.map((file) => `Bild-Anhang: ${file.name}`),
    ];
    const userContent = attachmentLines.length > 0
      ? [question || "Bitte analysiere die hochgeladenen Anhänge.", attachmentLines.join("\n")].join("\n\n")
      : question;

    const userMessage: ChatMessage = {
      role: "user",
      content: userContent,
      createdAt: new Date().toISOString(),
    };
    const nextMessages = [...messages, userMessage];

    setComposer("");
    setError("");
    setOpenComposerMenu(null);
    setIsSending(true);
    setPendingStepText(INITIAL_PENDING_TEXT);
    setPendingSteps([]);
    setMessages(nextMessages);

    try {
      const requestBody: {
        model: string;
        messages: Array<Pick<ChatMessage, "role" | "content">>;
        conversationId?: string;
      } = {
        model: settings.model,
        messages: nextMessages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      };

      if (conversationId) {
        requestBody.conversationId = conversationId;
      }

      const requestHeaders: Record<string, string> = {
        Accept: CHAT_STREAM_CONTENT_TYPE,
        Authorization: `Bearer ${accessToken}`,
      };
      const requestInit: RequestInit = {
        method: "POST",
        headers: requestHeaders,
      };

      if (hasAttachments) {
        const formData = new FormData();
        formData.append("payload", JSON.stringify(requestBody));
        for (const file of attachedPdfs) {
          formData.append("pdf", file, file.name);
        }
        for (const file of attachedImages) {
          formData.append("image", file, file.name);
        }
        requestInit.body = formData;
      } else {
        requestHeaders["Content-Type"] = "application/json";
        requestInit.body = JSON.stringify(requestBody);
      }

      const response = await fetch("/api/chat", requestInit);

      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      const payload = contentType.includes(CHAT_STREAM_CONTENT_TYPE)
        ? await readChatStream(response, (step) => {
            setPendingSteps((current) => [...current, step]);
            setPendingStepText(agentStepDisplayLabel(step));
          })
        : ((await response.json().catch(() => ({}))) as ChatResponsePayload);

      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : `Die Anfrage ist mit HTTP ${response.status} fehlgeschlagen.`,
        );
      }

      if (typeof payload.answer !== "string" || !payload.answer.trim()) {
        throw new Error("Die Antwort war leer.");
      }

      if (typeof payload.conversationId === "string" && payload.conversationId.trim()) {
        setConversationId(payload.conversationId.trim());
      }
      const responseConversationId = typeof payload.conversationId === "string"
        ? payload.conversationId.trim()
        : conversationId;
      const responseTitle = typeof payload.title === "string" && payload.title.trim()
        ? payload.title.trim()
        : conversationTitle;
      if (responseTitle) {
        setConversationTitle(responseTitle);
      }
      if (responseConversationId) {
        const now = new Date().toISOString();
        setConversations((current) => {
          const existing = current.find((item) => item.id === responseConversationId);
          const title = responseTitle || existing?.title || "Neue Unterhaltung";
          return [
            {
              id: responseConversationId,
              title,
              createdAt: existing?.createdAt ?? now,
              updatedAt: now,
            },
            ...current.filter((item) => item.id !== responseConversationId),
          ];
        });
      }
      if (hasAttachments) {
        clearAttachments();
      }

      const steps = normalizeAgentSteps(payload.steps);
      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content: payload.answer.trim(),
          createdAt: new Date().toISOString(),
          ...(steps.length > 0 ? { steps } : {}),
        },
      ]);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Die Anfrage konnte nicht verarbeitet werden.",
      );
      setMessages(nextMessages);
    } finally {
      setIsSending(false);
      setPendingStepText(INITIAL_PENDING_TEXT);
      setPendingSteps([]);
    }
  }

  async function downloadAssistantPdf(message: ChatMessage, messageIndex: number) {
    if (downloadingPdfMessageIndex !== null) {
      return;
    }
    if (!supabase || !user) {
      setError("Bitte zuerst anmelden.");
      return;
    }

    setError("");
    setDownloadingPdfMessageIndex(messageIndex);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        throw new Error("Deine Anmeldung ist abgelaufen. Bitte erneut anmelden.");
      }
      setSession(sessionData.session);

      const response = await fetch("/api/documents/pdf", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: conversationTitle.trim().slice(0, 160) || "Antwort",
          content: message.content,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "Das PDF konnte nicht erstellt werden.",
        );
      }
      if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/pdf")) {
        throw new Error("Die PDF-Antwort war ungültig. Bitte erneut versuchen.");
      }

      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = /filename="([A-Za-z0-9_.-]+\.pdf)"/.exec(disposition)?.[1]
        ?? "Antwort.pdf";
      const downloadUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "Das PDF konnte nicht erstellt werden.",
      );
    } finally {
      setDownloadingPdfMessageIndex(null);
    }
  }

  async function downloadGermanSvPensionPdf(
    year: GermanSvPensionYear,
    mode: GermanSvPensionMode,
    amount: number,
  ) {
    if (isDownloadingGermanSvPensionPdf) {
      return;
    }
    if (!supabase || !user) {
      setError("Bitte zuerst anmelden.");
      return;
    }

    setError("");
    setIsDownloadingGermanSvPensionPdf(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        throw new Error("Deine Anmeldung ist abgelaufen. Bitte erneut anmelden.");
      }
      setSession(sessionData.session);

      const pdfDocument = buildGermanSvPensionPdfDocument(year, mode, amount);
      const response = await fetch("/api/documents/pdf", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(pdfDocument),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "Das PDF konnte nicht erstellt werden.",
        );
      }
      if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/pdf")) {
        throw new Error("Die PDF-Antwort war ungültig. Bitte erneut versuchen.");
      }

      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = /filename="([A-Za-z0-9_.-]+\.pdf)"/.exec(disposition)?.[1]
        ?? `Deutsche_SV_Rente_${year}.pdf`;
      const downloadUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "Das PDF konnte nicht erstellt werden.",
      );
    } finally {
      setIsDownloadingGermanSvPensionPdf(false);
    }
  }

  const isAppReady = isLoaded && isAuthLoaded;
  const isAuthConfigured = isSupabaseBrowserConfigured();
  const hasSelectedAttachments = selectedPdfs.length > 0 || selectedImages.length > 0;
  const canSend = isAppReady
    && isModelPolicyLoaded
    && enabledModels.some((model) => model.id === settings.model)
    && Boolean(user)
    && (composer.trim().length > 0 || hasSelectedAttachments)
    && !isSending
    && !isDeleting;
  const historyControlsDisabled = isSending || isHistoryLoading || isDeleting;
  const currentModelName = enabledModels.find((model) => model.id === settings.model)?.label
    ?? "Modell wird geladen…";

  if (!isAuthLoaded) {
    return (
      <main className="auth-shell">
        <section className="auth-card auth-card-standalone" aria-label="Anmeldung wird geprüft">
          <p className="eyebrow">findog.at</p>
          <h1>Anmeldung prüfen</h1>
          <p className="auth-copy">Bitte warten...</p>
        </section>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="auth-shell">
        <section className="auth-card auth-card-standalone" aria-label="Anmeldung">
          {/* The supplied Fred asset must remain a regular responsive public image. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="fred-login-image"
            src="/fred-login.png"
            alt="Fred liest im Steuerkodex"
          />
          <p className="auth-copy">
            Melde dich mit E-Mail und Passwort an. Der geschützte Bereich öffnet sich erst nach
            erfolgreicher Anmeldung.
          </p>

          {!isAuthConfigured ? (
            <div className="error-box auth-message" role="alert">
              Supabase Auth ist für diese Umgebung noch nicht konfiguriert.
            </div>
          ) : null}
          {authError ? (
            <div className="error-box auth-message" role="alert" aria-live="polite">
              {authError}
            </div>
          ) : null}
          <form className="auth-form" onSubmit={handleAuthSubmit}>
            <div className="field-group">
              <label htmlFor="auth-email">E-Mail-Adresse</label>
              <input
                id="auth-email"
                type="email"
                value={authForm.email}
                onChange={(event) => updateAuthForm("email", event.target.value)}
                autoComplete="email"
                placeholder="name@example.com"
                disabled={!isAppReady || !isAuthConfigured || isAuthSubmitting}
              />
            </div>
            <div className="field-group">
              <label htmlFor="auth-password">Passwort</label>
              <input
                id="auth-password"
                type="password"
                value={authForm.password}
                onChange={(event) => updateAuthForm("password", event.target.value)}
                autoComplete="current-password"
                placeholder="Mindestens 6 Zeichen"
                disabled={!isAppReady || !isAuthConfigured || isAuthSubmitting}
              />
            </div>
            <button
              className="primary-button"
              type="submit"
              disabled={!isAppReady || !isAuthConfigured || isAuthSubmitting}
            >
              {isAuthSubmitting ? "Bitte warten..." : "Anmelden"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      {settingsOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setSettingsOpen(false)}
          aria-hidden="true"
        />
      )}

      {!settingsOpen && (
        <button
          className="mobile-menu-toggle"
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="Menü öffnen"
          title="Menü öffnen"
        >
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
        </button>
      )}

      <aside className={`sidebar ${settingsOpen ? "expanded" : "collapsed"}`} aria-label="Seitenmenü">
        <div className="sidebar-header">
          {settingsOpen ? (
            <>
              <Link className="sidebar-brand" href="/">
                <span className="austria-flag" aria-hidden="true">
                  <span className="red"></span>
                  <span className="white"></span>
                  <span className="red"></span>
                </span>
                <span className="brand-text">findog.at</span>
                <span className="beta-tag">Beta</span>
              </Link>
              <button
                className="icon-button toggle-sidebar-btn"
                type="button"
                onClick={() => setSettingsOpen(false)}
                aria-label="Menü einklappen"
                title="Menü einklappen"
              >
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
              </button>
            </>
          ) : (
            <button
              className="icon-button toggle-sidebar-btn rail-btn"
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Menü ausklappen"
              title="Menü ausklappen"
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
            </button>
          )}
        </div>

        {settingsOpen ? (
          <div className="sidebar-content">
            <button
              className="primary-button new-conversation-button"
              type="button"
              onClick={startNewConversation}
              disabled={historyControlsDisabled}
            >
              <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              Neue Unterhaltung
            </button>
            <div className="conversation-history" aria-label="Gespeicherte Unterhaltungen">
              <div className="conversation-history-heading">
                <span>Unterhaltungen</span>
                {isHistoryLoading || isDeleting ? (
                  <span className="history-loading">{isDeleting ? "Löscht…" : "Lädt…"}</span>
                ) : null}
              </div>
              <div className="conversation-bulk-actions">
                <span>{selectedConversationIds.length} ausgewählt</span>
                <button
                  className="bulk-delete-button"
                  type="button"
                  onClick={() => void deleteConversations(selectedConversationIds, true)}
                  disabled={historyControlsDisabled || selectedConversationIds.length === 0}
                >
                  Auswahl löschen
                </button>
              </div>
              <div className="conversation-list">
                {!isHistoryLoading && conversations.length === 0 ? (
                  <p className="conversation-empty">Noch keine gespeicherten Unterhaltungen.</p>
                ) : null}
                {conversations.map((conversation) => (
                  <div
                    className={`conversation-row ${appView === "chat" && conversation.id === conversationId ? "active" : ""}`}
                    key={conversation.id}
                  >
                    <input
                      className="conversation-checkbox"
                      type="checkbox"
                      checked={selectedConversationIds.includes(conversation.id)}
                      onChange={() => toggleConversationSelection(conversation.id)}
                      disabled={historyControlsDisabled}
                      aria-label={`Unterhaltung „${conversation.title}“ auswählen`}
                    />
                    <button
                      className="conversation-open"
                      type="button"
                      onClick={() => void selectConversation(conversation)}
                      disabled={historyControlsDisabled}
                      aria-current={appView === "chat" && conversation.id === conversationId ? "page" : undefined}
                    >
                      <span title={conversation.title}>{conversation.title}</span>
                      <time dateTime={conversation.updatedAt}>{formatHistoryDate(conversation.updatedAt)}</time>
                    </button>
                    <button
                      className="conversation-delete"
                      type="button"
                      onClick={() => void deleteConversations([conversation.id])}
                      disabled={historyControlsDisabled}
                      aria-label={`Unterhaltung „${conversation.title}“ löschen`}
                    >
                      Löschen
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <nav className="forms-navigation" aria-label="Anwendungsbereiche">
              <button
                className={`sidebar-view-button ${appView === "bfg-decisions" ? "active" : ""}`}
                type="button"
                onClick={openBfgDecisionsView}
                aria-current={appView === "bfg-decisions" ? "page" : undefined}
              >
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="20" y1="20" x2="16.65" y2="16.65"></line><path d="M8 11h6M11 8v6"></path></svg>
                BFG Suche
              </button>
              <button
                className={`sidebar-view-button ${appView === "bfg-pro" ? "active" : ""}`}
                type="button"
                onClick={openBfgProView}
                aria-current={appView === "bfg-pro" ? "page" : undefined}
              >
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z"></path><path d="m19 15 .75 2.25L22 18l-2.25.75L19 21l-.75-2.25L16 18l2.25-.75L19 15Z"></path></svg>
                BFG Suche PRO
              </button>
              <button
                className={`sidebar-view-button ${appView === "german-sv-pension" ? "active" : ""}`}
                type="button"
                onClick={openGermanSvPensionView}
                aria-current={appView === "german-sv-pension" ? "page" : undefined}
              >
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"></rect><path d="M8 6h8M8 10h2M14 10h2M8 14h2M14 14h2M8 18h2M14 18h2"></path></svg>
                Deutsche SV Rente
              </button>
              <button
                className={`sidebar-view-button ${appView === "l17b-currency" ? "active" : ""}`}
                type="button"
                onClick={openL17bCurrencyView}
                aria-current={appView === "l17b-currency" ? "page" : undefined}
              >
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v12M8 10h8"></path></svg>
                L17b Währungsrechner
              </button>
              <button
                className={`sidebar-view-button ${appView === "forms" ? "active" : ""}`}
                type="button"
                onClick={openFormsView}
                aria-current={appView === "forms" ? "page" : undefined}
              >
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="8" y1="13" x2="16" y2="13"></line><line x1="8" y1="17" x2="16" y2="17"></line></svg>
                Formulare
              </button>
              {isAdmin ? (
                <button
                  className={`sidebar-view-button ${appView === "administration" ? "active" : ""}`}
                  type="button"
                  onClick={() => void openAdministrationView()}
                  aria-current={appView === "administration" ? "page" : undefined}
                >
                  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><path d="M9 12l2 2 4-4"></path></svg>
                  Administration
                </button>
              ) : null}
            </nav>
          </div>
        ) : (
          <div className="rail-content">
            <button
              className="icon-button rail-icon-btn"
              type="button"
              onClick={startNewConversation}
              disabled={historyControlsDisabled}
              title="Neue Unterhaltung"
              aria-label="Neue Unterhaltung"
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
            <button
              className={`icon-button rail-icon-btn rail-forms-button ${appView === "forms" ? "active" : ""}`}
              type="button"
              onClick={openFormsView}
              title="Formulare"
              aria-label="Formulare"
              aria-current={appView === "forms" ? "page" : undefined}
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="8" y1="13" x2="16" y2="13"></line><line x1="8" y1="17" x2="16" y2="17"></line></svg>
            </button>
            <button
              className={`icon-button rail-icon-btn ${appView === "bfg-decisions" ? "active" : ""}`}
              type="button"
              onClick={openBfgDecisionsView}
              title="BFG Suche"
              aria-label="BFG Suche"
              aria-current={appView === "bfg-decisions" ? "page" : undefined}
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="20" y1="20" x2="16.65" y2="16.65"></line><path d="M8 11h6M11 8v6"></path></svg>
            </button>
            <button
              className={`icon-button rail-icon-btn ${appView === "bfg-pro" ? "active" : ""}`}
              type="button"
              onClick={openBfgProView}
              title="BFG Suche PRO"
              aria-label="BFG Suche PRO"
              aria-current={appView === "bfg-pro" ? "page" : undefined}
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z"></path><path d="m19 15 .75 2.25L22 18l-2.25.75L19 21l-.75-2.25L16 18l2.25-.75L19 15Z"></path></svg>
            </button>
            <button
              className={`icon-button rail-icon-btn ${appView === "german-sv-pension" ? "active" : ""}`}
              type="button"
              onClick={openGermanSvPensionView}
              title="Deutsche SV Rente"
              aria-label="Deutsche SV Rente"
              aria-current={appView === "german-sv-pension" ? "page" : undefined}
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"></rect><path d="M8 6h8M8 10h2M14 10h2M8 14h2M14 14h2M8 18h2M14 18h2"></path></svg>
            </button>
            <button
              className={`icon-button rail-icon-btn ${appView === "l17b-currency" ? "active" : ""}`}
              type="button"
              onClick={openL17bCurrencyView}
              title="L17b Währungsrechner"
              aria-label="L17b Währungsrechner"
              aria-current={appView === "l17b-currency" ? "page" : undefined}
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v12M8 10h8"></path></svg>
            </button>
            {isAdmin ? (
              <button
                className={`icon-button rail-icon-btn rail-forms-button ${appView === "administration" ? "active" : ""}`}
                type="button"
                onClick={() => void openAdministrationView()}
                title="Administration"
                aria-label="Administration"
                aria-current={appView === "administration" ? "page" : undefined}
              >
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><path d="M9 12l2 2 4-4"></path></svg>
              </button>
            ) : null}
          </div>
        )}

        <div className="sidebar-footer">
          {settingsOpen ? (
            <>
              <div className="user-profile">
                <span className="user-email-label">Angemeldet als</span>
                <span className="user-email" title={signedInEmail}>{signedInEmail}</span>
              </div>
              <button
                ref={settingsTriggerRef}
                className="secondary-button sidebar-settings-btn"
                type="button"
                onClick={openSettingsDialog}
              >
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                Einstellungen
              </button>
              <button
                className="secondary-button sidebar-signout-btn"
                type="button"
                onClick={handleSignOut}
                disabled={isAuthSubmitting}
                title="Abmelden"
                aria-label="Abmelden"
              >
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "6px" }}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                Abmelden
              </button>
            </>
          ) : (
            <>
              <button
                ref={settingsTriggerRef}
                className="icon-button rail-icon-btn"
                type="button"
                onClick={openSettingsDialog}
                title="Einstellungen"
                aria-label="Einstellungen"
              >
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              </button>
              <button
                className="icon-button rail-icon-btn sidebar-signout-btn"
                type="button"
                onClick={handleSignOut}
                disabled={isAuthSubmitting}
                title="Abmelden"
                aria-label="Abmelden"
              >
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
              </button>
            </>
          )}
        </div>
      </aside>

      {isSettingsDialogOpen ? (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeSettingsDialog();
            }
          }}
        >
          <section
            ref={settingsDialogRef}
            className="settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-dialog-title"
          >
            <div className="settings-dialog-header">
              <div>
                <p className="eyebrow">Konto</p>
                <h2 id="settings-dialog-title">Einstellungen</h2>
              </div>
              <button
                ref={settingsDialogCloseRef}
                className="icon-button"
                type="button"
                onClick={closeSettingsDialog}
                aria-label="Einstellungen schließen"
                title="Schließen"
              >
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="5" y1="5" x2="19" y2="19"></line><line x1="19" y1="5" x2="5" y2="19"></line></svg>
              </button>
            </div>
            <div className="account-settings-content">
              <section className="account-settings-section" aria-labelledby="password-settings-title">
                <h3 id="password-settings-title">Passwort ändern</h3>
              <form
                className="password-settings-form"
                onSubmit={handlePasswordChange}
              >
                <p className="field-help">
                  Gib dein aktuelles Passwort und ein neues Passwort mit mindestens 6 Zeichen ein.
                </p>
                {passwordChangeError ? (
                  <div className="error-box" role="alert" aria-live="polite">
                    {passwordChangeError}
                  </div>
                ) : null}
                {passwordChangeNotice ? (
                  <div className="notice-box" role="status" aria-live="polite">
                    {passwordChangeNotice}
                  </div>
                ) : null}
                <div className="field-group">
                  <label htmlFor="current-password">Aktuelles Passwort</label>
                  <input
                    id="current-password"
                    type="password"
                    value={passwordChangeForm.currentPassword}
                    onChange={(event) => updatePasswordChangeForm("currentPassword", event.target.value)}
                    autoComplete="current-password"
                    disabled={isPasswordChangeSubmitting}
                    required
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="new-password">Neues Passwort</label>
                  <input
                    id="new-password"
                    type="password"
                    value={passwordChangeForm.newPassword}
                    onChange={(event) => updatePasswordChangeForm("newPassword", event.target.value)}
                    autoComplete="new-password"
                    minLength={6}
                    disabled={isPasswordChangeSubmitting}
                    required
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="password-confirmation">Neues Passwort bestätigen</label>
                  <input
                    id="password-confirmation"
                    type="password"
                    value={passwordChangeForm.confirmation}
                    onChange={(event) => updatePasswordChangeForm("confirmation", event.target.value)}
                    autoComplete="new-password"
                    minLength={6}
                    disabled={isPasswordChangeSubmitting}
                    required
                  />
                </div>
                <button
                  className="primary-button password-change-button"
                  type="submit"
                  disabled={isPasswordChangeSubmitting}
                >
                  {isPasswordChangeSubmitting ? "Bitte warten..." : "Passwort ändern"}
                </button>
              </form>
              </section>
              <section className="account-settings-section account-deletion-section" aria-labelledby="account-deletion-title">
                <h3 id="account-deletion-title">Konto löschen</h3>
                <p>
                  Löscht dein Konto, alle Unterhaltungen und den Anfrageverlauf dauerhaft.
                  Vor dem Löschen musst du den Vorgang ausdrücklich bestätigen.
                </p>
                {accountDeletionError ? (
                  <div className="error-box" role="alert" aria-live="polite">
                    {accountDeletionError}
                  </div>
                ) : null}
                <button
                  className="secondary-button danger-button account-delete-button"
                  type="button"
                  onClick={() => void deleteOwnAccount()}
                  disabled={isAccountDeletionSubmitting}
                >
                  {isAccountDeletionSubmitting ? "Konto wird gelöscht…" : "Konto dauerhaft löschen"}
                </button>
              </section>
            </div>
          </section>
        </div>
      ) : null}

      {appView === "bfg-pro" ? (
        <section className="forms-panel" aria-labelledby="bfg-pro-view-title">
          <div className="forms-view bfg-decisions-view bfg-pro-view">
            <header className="forms-view-header bfg-view-header">
              <div className="bfg-view-header-copy">
                <p className="eyebrow">Findok</p>
                <h1 id="bfg-pro-view-title">BFG Suche PRO</h1>
                <p>KI-gestützte Reihung auf Basis veröffentlichter Findok BFG-Entscheidungen</p>
              </div>
              <Image
                className="bfg-view-header-illustration"
                src="/fred-bfg-pro-search.png"
                alt=""
                width={313}
                height={313}
                unoptimized
              />
            </header>

            <form
              className="bfg-search-form bfg-pro-form"
              onSubmit={(event) => {
                event.preventDefault();
                void searchBfgPro();
              }}
            >
              <label htmlFor="bfg-pro-scenario">Sachverhalt</label>
              <textarea
                id="bfg-pro-scenario"
                value={bfgProScenario}
                onChange={(event) => {
                  setBfgProScenario(event.target.value);
                  setBfgProError("");
                }}
                maxLength={2000}
                rows={7}
                placeholder="Beschreibe den steuerrechtlichen Sachverhalt in eigenen Worten."
                disabled={isSearchingBfgPro}
              />
              <button
                className="primary-button bfg-pro-submit"
                type="submit"
                disabled={isSearchingBfgPro || !bfgProScenario.trim()}
              >
                {isSearchingBfgPro ? "Wird gereiht…" : "Entscheidungen suchen"}
              </button>
            </form>

            {isSearchingBfgPro ? (
              <p className="bfg-pro-loading-state" role="status" aria-live="polite">
                Passende BFG-Entscheidungen werden gesucht und gereiht…
              </p>
            ) : null}

            {bfgProError ? (
              <div className="error-box bfg-message" role="alert" aria-live="polite">{bfgProError}</div>
            ) : null}

            {!bfgProError && !isSearchingBfgPro && bfgProResults?.length === 0 ? (
              <p className="bfg-empty-state">Keine relevanten BFG-Entscheidungen gefunden.</p>
            ) : null}

            {bfgProResults && bfgProResults.length > 0 ? (
              <div className="bfg-results">
                <ol className="bfg-result-list">
                  {bfgProResults.map((result, index) => (
                    <li key={`${result.htmlUrl ?? result.gz}-${index}`}>
                      <article>
                        <h2>{result.title}</h2>
                        <p className="bfg-result-meta">
                          {[
                            result.gz,
                            result.documentType,
                            result.decisionDate
                              ? `Entscheidung vom ${formatBfgPublicationDate(result.decisionDate)}`
                              : result.publicationDate
                                ? `Veröffentlicht am ${formatBfgPublicationDate(result.publicationDate)}`
                                : "",
                          ].filter(Boolean).join(" · ")}
                        </p>
                        <div className="bfg-pro-relevance">
                          <h3>Warum relevant</h3>
                          <p>{result.whyRelevant}</p>
                        </div>
                        {result.caseSummary ? (
                          <div className="bfg-pro-excerpt">
                            <h3>Sachverhalt</h3>
                            <p>{result.caseSummary}</p>
                          </div>
                        ) : null}
                        <div className="bfg-result-links">
                          {result.htmlUrl ? (
                            <a href={result.htmlUrl} target="_blank" rel="noreferrer noopener">
                              <svg className="bfg-result-link-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14 5h5v5" />
                                <path d="M10 14 19 5" />
                                <path d="M19 14v5H5V5h5" />
                              </svg>
                              Entscheidung öffnen
                            </a>
                          ) : null}
                          {result.pdfUrl ? (
                            <a href={result.pdfUrl} target="_blank" rel="noreferrer noopener">
                              <svg className="bfg-result-link-icon bfg-result-pdf-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                                <path d="M14 2v6h6" />
                              </svg>
                              PDF öffnen
                            </a>
                          ) : null}
                        </div>
                      </article>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </div>
        </section>
      ) : appView === "bfg-decisions" ? (
        <section className="forms-panel" aria-labelledby="bfg-decisions-view-title">
          <div className="forms-view bfg-decisions-view">
            <header className="forms-view-header bfg-view-header">
              <div className="bfg-view-header-copy">
                <p className="eyebrow">Findok</p>
                <h1 id="bfg-decisions-view-title">BFG-Entscheidungen</h1>
                <p>Durchsuche veröffentlichte Entscheidungen des Bundesfinanzgerichts in der Findok-Suche über das Suchfeld.</p>
              </div>
              <Image
                className="bfg-view-header-illustration"
                src="/fred-bfg-search.png"
                alt=""
                width={1254}
                height={1254}
                unoptimized
              />
            </header>

            <form
              className="bfg-search-form"
              onSubmit={(event) => {
                event.preventDefault();
                void searchBfgDecisions(1, { sort: bfgSort, filters: bfgFilters });
              }}
            >
              <label htmlFor="bfg-search">Suchbegriff oder Geschäftszahl</label>
              <div className="bfg-search-row">
                <input
                  id="bfg-search"
                  type="search"
                  value={bfgQuery}
                  onChange={(event) => {
                    setBfgQuery(event.target.value);
                    setBfgError("");
                  }}
                  maxLength={200}
                  placeholder="z. B. Umsatzsteuer oder RV/7100930/2024"
                  disabled={isSearchingBfg}
                />
                <button className="primary-button" type="submit" disabled={isSearchingBfg || !bfgQuery.trim()}>
                  {isSearchingBfg ? "Sucht…" : "Suchen"}
                </button>
              </div>
              <div className="bfg-search-controls">
                <select
                  className="bfg-sort-select"
                  aria-label="Sortierung"
                  value={bfgSort}
                  onChange={(event) => setBfgSort(event.target.value as BfgSort)}
                  disabled={isSearchingBfg}
                >
                  {BFG_SORT_OPTIONS.map((option) => (
                    <option value={option.value} key={option.value}>{option.label}</option>
                  ))}
                </select>
                <button
                  className="secondary-button compact-button"
                  type="button"
                  aria-expanded={isBfgFilterPanelOpen}
                  aria-controls="bfg-filter-panel"
                  onClick={() => setIsBfgFilterPanelOpen((open) => !open)}
                  disabled={isSearchingBfg}
                >
                  Filter
                </button>
              </div>
              {isBfgFilterPanelOpen ? (
                <div className="bfg-filter-panel" id="bfg-filter-panel">
                  <div className="bfg-filter-grid">
                    {bfgPage?.facets.materie.length ? (
                      <label>
                        <span>Materie</span>
                        <select
                          value={bfgFilters.materie}
                          onChange={(event) => updateBfgFilter("materie", event.target.value)}
                          disabled={isSearchingBfg}
                        >
                          <option value="">Alle</option>
                          {bfgPage.facets.materie.map((option) => (
                            <option value={option.value} key={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    {bfgPage?.facets.documentType.length ? (
                      <label>
                        <span>Dokumenttyp</span>
                        <select
                          value={bfgFilters.documentType}
                          onChange={(event) => updateBfgFilter("documentType", event.target.value)}
                          disabled={isSearchingBfg}
                        >
                          <option value="">Alle</option>
                          {bfgPage.facets.documentType.map((option) => (
                            <option value={option.value} key={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    {bfgPage?.facets.norm.length ? (
                      <label>
                        <span>Norm</span>
                        <select
                          value={bfgFilters.norm}
                          onChange={(event) => updateBfgFilter("norm", event.target.value)}
                          disabled={isSearchingBfg}
                        >
                          <option value="">Alle</option>
                          {bfgPage.facets.norm.map((option) => (
                            <option value={option.value} key={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    {bfgPage?.facets.timeframe.length ? (
                      <label>
                        <span>Zeitraum</span>
                        <select
                          value={bfgFilters.timeframe}
                          onChange={(event) => updateBfgFilter("timeframe", event.target.value)}
                          disabled={isSearchingBfg}
                        >
                          <option value="">Alle</option>
                          {bfgPage.facets.timeframe.map((option) => (
                            <option value={option.value} key={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    {bfgPage?.facets.withHeadnote.length ? (
                      <label className="bfg-headnote-filter">
                        <input
                          type="checkbox"
                          checked={bfgFilters.withHeadnote}
                          onChange={(event) => updateBfgFilter("withHeadnote", event.target.checked)}
                          disabled={isSearchingBfg}
                        />
                        <span>Mit Rechtssatz</span>
                      </label>
                    ) : null}
                  </div>
                  <div className="bfg-filter-actions">
                    <button
                      className="primary-button compact-button"
                      type="button"
                      onClick={() => {
                        setIsBfgFilterPanelOpen(false);
                        void searchBfgDecisions(1, { sort: bfgSort, filters: bfgFilters });
                      }}
                      disabled={isSearchingBfg || !bfgQuery.trim()}
                    >
                      Anwenden
                    </button>
                    <button
                      className="secondary-button compact-button"
                      type="button"
                      onClick={resetBfgFilters}
                      disabled={isSearchingBfg}
                    >
                      Zurücksetzen
                    </button>
                  </div>
                </div>
              ) : null}
            </form>

            {bfgError ? (
              <div className="error-box bfg-message" role="alert" aria-live="polite">{bfgError}</div>
            ) : null}

            {!bfgError && hasSearchedBfg && bfgPage?.results.length === 0 ? (
              <p className="bfg-empty-state">Keine BFG-Entscheidung gefunden.</p>
            ) : null}

            {bfgPage && bfgPage.results.length > 0 ? (
              <div className="bfg-results">
                <p className="bfg-result-count">
                  {bfgPage.totalCount.toLocaleString("de-AT")} {bfgPage.totalCount === 1 ? "Ergebnis" : "Ergebnisse"}
                </p>
                <ol className="bfg-result-list">
                  {bfgPage.results.map((result, index) => (
                    <li key={`${result.htmlUrl ?? result.gz}-${index}`}>
                      <article>
                        <h2>{result.title}</h2>
                        <p className="bfg-result-meta">
                          {[result.gz, result.documentType, result.publicationDate
                            ? `Veröffentlicht am ${formatBfgPublicationDate(result.publicationDate)}`
                            : ""].filter(Boolean).join(" · ")}
                        </p>
                        {result.snippet ? <p className="bfg-result-snippet">{result.snippet}</p> : null}
                        <div className="bfg-result-links">
                          {result.htmlUrl ? (
                            <a href={result.htmlUrl} target="_blank" rel="noreferrer noopener">
                              <svg className="bfg-result-link-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14 5h5v5" />
                                <path d="M10 14 19 5" />
                                <path d="M19 14v5H5V5h5" />
                              </svg>
                              Entscheidung öffnen
                            </a>
                          ) : null}
                          {result.pdfUrl ? (
                            <a href={result.pdfUrl} target="_blank" rel="noreferrer noopener">
                              <svg className="bfg-result-link-icon bfg-result-pdf-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                                <path d="M14 2v6h6" />
                              </svg>
                              PDF öffnen
                            </a>
                          ) : null}
                        </div>
                      </article>
                    </li>
                  ))}
                </ol>
                {bfgPage.totalPages > 1 ? (
                  <nav className="bfg-pagination" aria-label="Ergebnisseiten">
                    <button
                      className="secondary-button compact-button"
                      type="button"
                      onClick={() => void searchBfgDecisions(bfgPage.page - 1)}
                      disabled={isSearchingBfg || bfgPage.page <= 1}
                    >
                      Zurück
                    </button>
                    <span>Seite {bfgPage.page} von {bfgPage.totalPages}</span>
                    <button
                      className="secondary-button compact-button"
                      type="button"
                      onClick={() => void searchBfgDecisions(bfgPage.page + 1)}
                      disabled={isSearchingBfg || bfgPage.page >= bfgPage.totalPages}
                    >
                      Weiter
                    </button>
                  </nav>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
      ) : appView === "l17b-currency" ? (
        <L17bCurrencyView />
      ) : appView === "german-sv-pension" ? (
        <GermanSvPensionView
          downloadError={error}
          isDownloadingPdf={isDownloadingGermanSvPensionPdf}
          onDownloadPdf={downloadGermanSvPensionPdf}
        />
      ) : appView === "forms" ? (
        <section className="forms-panel" aria-labelledby="forms-view-title">
          <div className="forms-view">
            <header className="forms-view-header">
              <p className="eyebrow">Dokumenterstellung</p>
              <h1 id="forms-view-title">Formulare</h1>
              <p>Wähle ein Formular und erstelle das ausgefüllte Word-Dokument aus einem Bild.</p>
            </header>

            {!selectedFormId ? (
              <div className="form-choice-grid" aria-label="Verfügbare Formulare">
                <button className="form-choice-card" type="button" onClick={selectVerf5Form}>
                  <span className="form-choice-icon" aria-hidden="true">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                  </span>
                  <span>
                    <strong>{VERF5_FORM_NAME}</strong>
                    <small>Formular auswählen</small>
                  </span>
                  <span aria-hidden="true">›</span>
                </button>
              </div>
            ) : (
              <div className="form-generator-card">
                <button
                  className="form-back-button"
                  type="button"
                  onClick={showFormSelection}
                  disabled={isGeneratingForm}
                >
                  <span aria-hidden="true">←</span> Formularauswahl
                </button>
                <div className="form-generator-heading">
                  <h2>{VERF5_FORM_NAME}</h2>
                  <p>Lade ein gut lesbares Bild des Dokuments hoch. Fehlende Werte bleiben im Formular leer.</p>
                </div>

                {formError ? (
                  <div className="error-box" role="alert" aria-live="polite">{formError}</div>
                ) : null}
                {formNotice ? (
                  <div className="form-success-box" role="status" aria-live="polite">{formNotice}</div>
                ) : null}

                <form className="form-generator" onSubmit={handleFormGenerate}>
                  <div className="field-group form-upload-field">
                    <label htmlFor="verf5-image">Bild des Dokuments</label>
                    <input
                      ref={formImageInputRef}
                      id="verf5-image"
                      type="file"
                      accept={FORM_IMAGE_MIME_TYPES.join(",")}
                      onChange={handleFormImageChange}
                      disabled={isGeneratingForm}
                      required
                    />
                    <span className="field-help">JPEG, PNG oder WebP, maximal 5 MB.</span>
                    {formImage ? (
                      <span className="form-selected-file">
                        <span title={formImage.name}>{ellipsizeFilename(formImage.name)}</span>
                        <small>{(formImage.size / 1_048_576).toLocaleString("de-AT", { maximumFractionDigits: 1 })} MB</small>
                        <button
                          type="button"
                          onClick={() => {
                            setFormImage(null);
                            if (formImageInputRef.current) {
                              formImageInputRef.current.value = "";
                            }
                          }}
                          disabled={isGeneratingForm}
                          aria-label={`Bild ${formImage.name} entfernen`}
                        >
                          Entfernen
                        </button>
                      </span>
                    ) : null}
                  </div>

                  <div className="field-group">
                    <label htmlFor="verf5-saldo">Saldo am Abgabenkonto per Todestag <span>(optional)</span></label>
                    <input
                      id="verf5-saldo"
                      type="text"
                      inputMode="decimal"
                      value={formSaldo}
                      onChange={(event) => {
                        setFormSaldo(event.target.value);
                        setFormError("");
                        setFormNotice("");
                      }}
                      maxLength={MAX_SALDO_INPUT_CHARS}
                      placeholder="z. B. 1234,56"
                      disabled={isGeneratingForm}
                    />
                    <span className="field-help">Ziffern mit höchstens zwei Dezimalstellen; Komma oder Punkt sind möglich.</span>
                  </div>

                  <button
                    className="primary-button form-generate-button"
                    type="submit"
                    disabled={!formImage || isGeneratingForm || !isAppReady || !user}
                  >
                    {isGeneratingForm ? (
                      <><span className="spinner" aria-hidden="true"></span> Formular wird erstellt…</>
                    ) : (
                      "Formular generieren"
                    )}
                  </button>
                </form>
              </div>
            )}
          </div>
        </section>
      ) : appView === "administration" && isAdmin ? (
        <section className="forms-panel" aria-labelledby="administration-view-title">
          <div className="forms-view">
            <header className="forms-view-header">
              <p className="eyebrow">Benutzerverwaltung</p>
              <h1 id="administration-view-title">Administration</h1>
            </header>
            {adminError ? (
              <div className="admin-message error-box" role="alert" aria-live="polite">
                {adminError}
              </div>
            ) : null}
            {adminNotice ? (
              <div className="notice-box" role="status" aria-live="polite">
                {adminNotice}
              </div>
            ) : null}
            <section className="form-generator-card admin-model-settings-card" aria-labelledby="admin-model-settings-title">
              <div className="form-generator-heading">
                <h2 id="admin-model-settings-title">Modelle</h2>
                <p>Legt zentral fest, welche Modelle im Chat auswählbar sind und welche Reasoning-Stufe sie verwenden.</p>
              </div>
              {isAdminModelsLoading ? (
                <p className="admin-empty-state">Modelleinstellungen werden geladen…</p>
              ) : adminModels.length === 0 ? (
                <p className="admin-empty-state">Keine Modelleinstellungen verfügbar.</p>
              ) : (
                <div className="admin-model-settings-list">
                  {adminModels.filter((m) => !isDynamicModelId(m.id)).map((model, modelIndex) => (
                    <div className="admin-model-setting" key={model.id}>
                      <label className="admin-model-toggle">
                        <input
                          type="checkbox"
                          checked={model.alwaysEnabled || model.enabled}
                          onChange={(event) => updateAdminModelEnabled(model.id, event.target.checked)}
                          disabled={
                            model.alwaysEnabled
                            || (!model.providerConfigured && !model.enabled)
                            || isAdminModelsSaving
                          }
                        />
                        <span>
                          <strong>{model.label}</strong>
                          <small>
                            {model.alwaysEnabled
                              ? model.providerConfigured
                                ? "Immer aktiviert"
                                : "Immer aktiviert · Provider nicht konfiguriert"
                              : model.providerConfigured
                                ? "Zentral aktivierbar"
                                : "Provider nicht konfiguriert"}
                          </small>
                        </span>
                      </label>
                      <div className="field-group admin-model-reasoning">
                        <label htmlFor={`admin-model-reasoning-${modelIndex}`}>Reasoning</label>
                        {model.reasoningOptions.length > 0 ? (
                          <select
                            id={`admin-model-reasoning-${modelIndex}`}
                            aria-label={`Reasoning für ${model.label}`}
                            value={model.reasoning ?? ""}
                            onChange={(event) => updateAdminModelReasoning(model.id, event.target.value)}
                            disabled={!model.providerConfigured || isAdminModelsSaving}
                          >
                            {model.reasoning === null ? <option value="" disabled>Auswählen</option> : null}
                            {model.reasoningOptions.map((option) => (
                              <option value={option.value} key={option.value}>{option.label}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="admin-model-no-reasoning">Nicht unterstützt</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="admin-model-actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => void saveAdminModels()}
                  disabled={isAdminModelsLoading || isAdminModelsSaving || adminModels.length === 0}
                >
                  {isAdminModelsSaving ? "Wird gespeichert…" : "Modelleinstellungen speichern"}
                </button>
              </div>
              <details className="admin-openai-compatible-section">
                <summary className="admin-openai-compatible-summary">OpenAI-kompatible Modelle verwalten</summary>
                <div className="admin-openai-compatible-create-form">
                  <div className="field-group"><label htmlFor="openai-compatible-upstream-id">Upstream-Modell-ID</label><input id="openai-compatible-upstream-id" type="text" maxLength={120} value={adminCreateModel.upstreamModel} onChange={(event) => setAdminCreateModel((current) => ({ ...current, upstreamModel: event.target.value }))} disabled={isAdminCreatingModel} /></div>
                  <div className="field-group"><label htmlFor="openai-compatible-display-name">Anzeigename (optional)</label><input id="openai-compatible-display-name" type="text" maxLength={120} value={adminCreateModel.displayName} onChange={(event) => setAdminCreateModel((current) => ({ ...current, displayName: event.target.value }))} disabled={isAdminCreatingModel} /></div>
                  <div className="field-group"><label htmlFor="openai-compatible-base-url">Basis-URL</label><input id="openai-compatible-base-url" type="url" maxLength={2048} placeholder="https://gateway.example.com/v1" value={adminCreateModel.baseUrl} onChange={(event) => setAdminCreateModel((current) => ({ ...current, baseUrl: event.target.value }))} disabled={isAdminCreatingModel} /></div>
                  <div className="field-group"><label htmlFor="openai-compatible-api-key">API-Key</label><input id="openai-compatible-api-key" type="password" maxLength={512} autoComplete="new-password" value={adminCreateModel.apiKey} onChange={(event) => setAdminCreateModel((current) => ({ ...current, apiKey: event.target.value }))} disabled={isAdminCreatingModel} /></div>
                  <div className="field-group"><label htmlFor="openai-compatible-access">Verfügbarkeit</label><select id="openai-compatible-access" value={adminCreateModel.accessScope} onChange={(event) => setAdminCreateModel((current) => ({ ...current, accessScope: event.target.value as "disabled" | "admins" | "all" }))} disabled={isAdminCreatingModel}><option value="disabled">Deaktiviert</option><option value="admins">Nur Administratoren</option><option value="all">Alle Benutzer</option></select></div>
                  <button className="primary-button compact-button" type="button" onClick={() => void createOpenAICompatibleModel()} disabled={isAdminCreatingModel || !adminCreateModel.upstreamModel.trim() || !adminCreateModel.baseUrl.trim() || !adminCreateModel.apiKey.trim()}>{isAdminCreatingModel ? "Wird angelegt…" : "Modell hinzufügen"}</button>
                </div>
                <div className="admin-openai-compatible-model-list">
                  {adminModels.filter((model) => isDynamicModelId(model.id)).map((model) => (
                    <div className="admin-openai-compatible-model" key={model.id}>
                      {adminEditingModelId === model.id ? (
                        <div className="admin-openai-compatible-create-form">
                          <div className="field-group">
                            <label htmlFor={`openai-compatible-edit-upstream-${model.id}`}>Upstream-Modell-ID</label>
                            <input
                              id={`openai-compatible-edit-upstream-${model.id}`}
                              type="text"
                              maxLength={120}
                              value={adminEditModel.upstreamModel}
                              onChange={(event) => setAdminEditModel((current) => ({ ...current, upstreamModel: event.target.value }))}
                              disabled={isAdminModelsSaving}
                              required
                            />
                          </div>
                          <div className="field-group">
                            <label htmlFor={`openai-compatible-edit-display-${model.id}`}>Anzeigename (optional)</label>
                            <input
                              id={`openai-compatible-edit-display-${model.id}`}
                              type="text"
                              maxLength={120}
                              value={adminEditModel.displayName}
                              onChange={(event) => setAdminEditModel((current) => ({ ...current, displayName: event.target.value }))}
                              disabled={isAdminModelsSaving}
                            />
                          </div>
                          <div className="field-group">
                            <label htmlFor={`openai-compatible-edit-base-url-${model.id}`}>Basis-URL</label>
                            <input
                              id={`openai-compatible-edit-base-url-${model.id}`}
                              type="url"
                              maxLength={2048}
                              value={adminEditModel.baseUrl}
                              onChange={(event) => setAdminEditModel((current) => ({ ...current, baseUrl: event.target.value }))}
                              disabled={isAdminModelsSaving}
                              required
                            />
                          </div>
                          <div className="field-group">
                            <label htmlFor={`openai-compatible-edit-api-key-${model.id}`}>Neuer API-Key (optional)</label>
                            <input
                              id={`openai-compatible-edit-api-key-${model.id}`}
                              type="password"
                              maxLength={512}
                              autoComplete="new-password"
                              value={adminEditModel.apiKey}
                              onChange={(event) => setAdminEditModel((current) => ({ ...current, apiKey: event.target.value }))}
                              disabled={isAdminModelsSaving}
                            />
                          </div>
                          <div className="field-group">
                            <label htmlFor={`openai-compatible-edit-access-${model.id}`}>Verfügbarkeit</label>
                            <select
                              id={`openai-compatible-edit-access-${model.id}`}
                              value={adminEditModel.accessScope}
                              onChange={(event) => setAdminEditModel((current) => ({ ...current, accessScope: event.target.value as "disabled" | "admins" | "all" }))}
                              disabled={isAdminModelsSaving}
                            >
                              <option value="disabled">Deaktiviert</option>
                              <option value="admins">Nur Administratoren</option>
                              <option value="all">Alle Benutzer</option>
                            </select>
                          </div>
                          <div className="admin-openai-compatible-actions">
                            <button
                              className="primary-button compact-button"
                              type="button"
                              onClick={() => void saveOpenAICompatibleModel(model)}
                              disabled={isAdminModelsSaving || !adminEditModel.upstreamModel.trim() || !adminEditModel.baseUrl.trim()}
                            >
                              Speichern
                            </button>
                            <button className="secondary-button compact-button" type="button" onClick={cancelEditingOpenAICompatibleModel} disabled={isAdminModelsSaving}>Abbrechen</button>
                          </div>
                        </div>
                      ) : (
                        <><div><strong>{model.label}</strong><small>{model.upstreamModel} · {model.baseUrl} · {model.accessScope === "all" ? "Alle Benutzer" : model.accessScope === "admins" ? "Nur Administratoren" : "Deaktiviert"}</small></div><div className="admin-openai-compatible-actions"><button className="secondary-button compact-button" type="button" onClick={() => startEditingOpenAICompatibleModel(model)} disabled={isAdminModelsSaving}>Bearbeiten</button><button className="danger-button compact-button" type="button" onClick={() => void deleteOpenAICompatibleModel(model)} disabled={isAdminModelsSaving}>Löschen</button></div></>
                      )}
                    </div>
                  ))}
                </div>
              </details>

            </section>
            <div className="admin-user-management">
              <div className="form-generator-card admin-create-user-card">
                <div className="form-generator-heading">
                  <h2>Benutzer anlegen</h2>
                  <p>Erstellt ein bestätigtes Konto für die Anmeldung mit E-Mail und Passwort.</p>
                </div>
                <form className="admin-create-user-form" onSubmit={(event) => void createAdminManagedUser(event)}>
                  <div className="field-group">
                    <label htmlFor="admin-user-email">E-Mail</label>
                    <input
                      id="admin-user-email"
                      type="email"
                      autoComplete="off"
                      value={adminUserForm.email}
                      onChange={(event) => setAdminUserForm((current) => ({
                        ...current,
                        email: event.target.value,
                      }))}
                      required
                      disabled={isAdminUserCreating}
                    />
                  </div>
                  <div className="field-group">
                    <label htmlFor="admin-user-password">Passwort</label>
                    <input
                      id="admin-user-password"
                      type="password"
                      autoComplete="new-password"
                      minLength={6}
                      maxLength={72}
                      value={adminUserForm.password}
                      onChange={(event) => setAdminUserForm((current) => ({
                        ...current,
                        password: event.target.value,
                      }))}
                      required
                      disabled={isAdminUserCreating}
                    />
                  </div>
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={isAdminUserCreating || !adminUserForm.email.trim() || adminUserForm.password.length < 6}
                  >
                    {isAdminUserCreating ? "Wird angelegt…" : "Benutzer anlegen"}
                  </button>
                </form>
              </div>

              <div className="form-generator-card admin-user-list-card">
                <div className="form-generator-heading">
                  <h2>Benutzer</h2>
                  <p>{adminUsers.length} Konten</p>
                </div>
                {isAdminUsersLoading && adminUsers.length === 0 ? (
                  <p className="admin-empty-state">Benutzer werden geladen…</p>
                ) : adminUsers.length === 0 ? (
                  <p className="admin-empty-state">Keine Benutzer gefunden.</p>
                ) : (
                  <ul className="admin-user-list">
                    {adminUsers.map((adminUser) => (
                      <li key={adminUser.id}>
                        <button
                          type="button"
                          className={adminUserProfile?.user.id === adminUser.id ? "active" : undefined}
                          onClick={() => void loadAdminUserProfile(adminUser.id)}
                          disabled={isAdminUsersLoading || isAdminUserMutationRunning}
                        >
                          <strong>{adminUser.email || "Ohne E-Mail"}</strong>
                          <small>Erstellt {formatAdminDate(adminUser.createdAt)}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="form-generator-card admin-user-profile-card">
                <div className="form-generator-heading">
                  <h2>Benutzerprofil</h2>
                  <p>Der Anfrageverlauf enthält ausschließlich Eingaben des Benutzers.</p>
                </div>
                {!adminUserProfile ? (
                  <p className="admin-empty-state">Wähle einen Benutzer aus der Liste.</p>
                ) : (
                  <>
                    <dl className="admin-profile-metadata">
                      <div><dt>E-Mail</dt><dd>{adminUserProfile.user.email || "–"}</dd></div>
                      <div><dt>Erstellt</dt><dd>{formatAdminDate(adminUserProfile.user.createdAt)}</dd></div>
                      <div><dt>Letzte Anmeldung</dt><dd>{formatAdminDate(adminUserProfile.user.lastSignInAt)}</dd></div>
                      <div><dt>Anfragen</dt><dd>{adminUserProfile.requestCount}</dd></div>
                    </dl>
                    <div className="admin-request-history">
                      <h3>Anfrageverlauf</h3>
                      {adminUserProfile.requests.length === 0 ? (
                        <p className="admin-empty-state">Keine protokollierten Anfragen.</p>
                      ) : (
                        <ol>
                          {adminUserProfile.requests.map((entry) => (
                            <li key={entry.id}>
                              <time dateTime={entry.createdAt}>{formatAdminDate(entry.createdAt)}</time>
                              <p>{entry.content}</p>
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                    <div className="admin-profile-actions">
                      <button
                        className="secondary-button danger-button"
                        type="button"
                        onClick={() => void deleteAdminRequestHistory()}
                        disabled={isAdminUserMutationRunning || adminUserProfile.requestCount === 0}
                      >
                        Anfrageverlauf löschen
                      </button>
                      <button
                        className="secondary-button danger-button"
                        type="button"
                        onClick={() => void deleteAdminManagedUser()}
                        disabled={isAdminUserMutationRunning || adminUserProfile.user.id === user?.id}
                        title={adminUserProfile.user.id === user?.id
                          ? "Das eigene Administratorkonto kann nicht gelöscht werden."
                          : undefined}
                      >
                        Konto löschen
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>
      ) : (
      <section className={`chat-panel ${messages.length === 0 ? "empty-chat" : ""}`}>
        <div className="chat-content-group">
        <div className="transcript" ref={transcriptRef}>
          <div className="transcript-content">
            {messages.length === 0 ? (
              <div className="empty-state">
                {/* The supplied Fred asset must remain a regular responsive public image. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="fred-welcome-image"
                  src="/fred.png"
                  alt="Fred, der Findog-Steuerassistent"
                />
                <h1 className="welcome-greeting">{welcomeGreeting}</h1>
              </div>
            ) : (
              messages.map((message, index) => (
                <article className={`message ${message.role}`} key={`${message.createdAt}-${index}`}>
                  <div className="message-header">
                    {message.role === "user" ? (
                      <div className="message-avatar">DU</div>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="message-avatar fred-avatar" src="/fred-avatar.png" alt="" />
                    )}
                    <div className="message-meta">
                      {message.role === "user" ? (
                        <span className="sender-name">Du</span>
                      ) : (
                        <span className="sender-name">Fred</span>
                      )}
                      <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
                    </div>
                  </div>
                  {message.role === "assistant" ? (
                    <RichAnswer content={message.content} />
                  ) : (
                    renderUserMessageContent(message.content)
                  )}
                  {message.role === "assistant"
                    && messages[index - 1]?.role === "user"
                    && shouldOfferChatPdfDownload(messages[index - 1].content, message.content) ? (
                      <div className="pdf-download-row">
                        <button
                          className="secondary-button compact-button pdf-download-button"
                          type="button"
                          onClick={() => void downloadAssistantPdf(message, index)}
                          disabled={downloadingPdfMessageIndex !== null}
                          aria-label="Antwort von Fred als PDF herunterladen"
                        >
                          PDF herunterladen
                        </button>
                      </div>
                    ) : null}
                  {message.role === "assistant" && findNearestPrecedingUserMessage(messages, index) ? (
                    <div className="feedback-controls">
                      <button
                        type="button"
                        className="feedback-button feedback-positive"
                        onClick={(event) => {
                          feedbackTriggerRef.current = event.currentTarget;
                          setFeedbackTargetIndex(index);
                          setFeedbackDialogType("positive");
                          setFeedbackError("");
                        }}
                        aria-label="Positive Rückmeldung zu dieser Antwort"
                      >
                        👍
                      </button>
                      <button
                        type="button"
                        className="feedback-button feedback-negative"
                        onClick={(event) => {
                          feedbackTriggerRef.current = event.currentTarget;
                          setFeedbackTargetIndex(index);
                          setFeedbackDialogType("negative");
                          setFeedbackText("");
                          setFeedbackError("");
                        }}
                        aria-label="Negative Rückmeldung zu dieser Antwort"
                      >
                        👎
                      </button>
                    </div>
                  ) : null}
                  {message.role === "assistant" && (message.steps?.length || message.agentRun) ? (
                    <AgentStepsPanel steps={message.steps ?? []} />
                  ) : null}
                </article>
              ))
            )}

            {isSending ? (
              <article className="message assistant pending" aria-live="polite">
                <div className="message-header">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="message-avatar fred-avatar" src="/fred-avatar.png" alt="" />
                  <div className="message-meta">
                    <span className="sender-name">Fred</span>
                  </div>
                </div>
                <p className="message-body">{pendingStepText}</p>
                {pendingSteps.length > 0 ? <AgentStepsPanel steps={pendingSteps} /> : null}
              </article>
            ) : null}
          </div>
        </div>

          {feedbackTargetIndex !== null ? (
            <div
              className="dialog-backdrop"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  closeFeedbackDialog();
                }
              }}
            >
              {feedbackDialogType === "positive" ? (
                <section
                  className="feedback-dialog feedback-positive-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Positive Rückmeldung"
                  ref={feedbackDialogRef}
                  tabIndex={-1}
                >
                  <p className="feedback-thanks-message">Danke für dein Feedback</p>
                  <button
                    className="icon-button"
                    type="button"
                    onClick={closeFeedbackDialog}
                    ref={feedbackCloseRef}
                    aria-label="Schließen"
                    disabled={isFeedbackSaving}
                  >
                    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="5" y1="5" x2="19" y2="19"></line><line x1="19" y1="5" x2="5" y2="19"></line></svg>
                  </button>
                </section>
              ) : (
                <section
                  className="feedback-dialog feedback-negative-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="feedback-negative-title"
                  ref={feedbackDialogRef}
                  tabIndex={-1}
                >
                  <div className="feedback-dialog-header">
                    <h2 id="feedback-negative-title">Feedback</h2>
                    <button
                      className="icon-button"
                      type="button"
                      onClick={closeFeedbackDialog}
                      aria-label="Schließen"
                      disabled={isFeedbackSaving}
                    >
                      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="5" y1="5" x2="19" y2="19"></line><line x1="19" y1="5" x2="5" y2="19"></line></svg>
                    </button>
                  </div>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitFeedback(feedbackTargetIndex);
                    }}
                  >
                    <div className="field-group">
                      <label htmlFor="feedback-textarea">Deine Rückmeldung</label>
                      <textarea
                        id="feedback-textarea"
                        ref={feedbackTextareaRef}
                        value={feedbackText}
                        onChange={(e) => setFeedbackText(e.target.value)}
                        placeholder="Was können wir verbessern?"
                        required
                        disabled={isFeedbackSaving}
                      />
                    </div>
                    {feedbackError ? (
                      <div className="error-box" role="alert" aria-live="polite">
                        {feedbackError}
                      </div>
                    ) : null}
                    <div className="feedback-dialog-actions">
                      <button
                        type="button"
                        className="secondary-button compact-button"
                        onClick={closeFeedbackDialog}
                        disabled={isFeedbackSaving}
                      >
                        Abbrechen
                      </button>
                      <button
                        type="submit"
                        className="primary-button compact-button"
                        disabled={isFeedbackSaving || !feedbackText.trim()}
                      >
                        {isFeedbackSaving ? "Wird gespeichert…" : "Absenden"}
                      </button>
                    </div>
                  </form>
                </section>
              )}
            </div>
          ) : null}

        <div className="composer-container">
          {error ? (
            <div className="error-box composer-error" role="alert" aria-live="polite">
              {error}
            </div>
          ) : null}
          <form className="composer" onSubmit={handleSubmit}>
            <label className="sr-only" htmlFor="question">
              Frage
            </label>
            <textarea
              ref={composerRef}
              id="question"
              value={composer}
              onChange={(event) => setComposer(event.target.value)}
              onPaste={handleComposerPaste}
              placeholder="Frage zu BFG, EStG, UStG oder Verfahrensrecht..."
              rows={2}
            />
            <div className="composer-toolbar">
              <div className="composer-menu-control" ref={attachmentMenuControlRef}>
                <input
                  ref={pdfInputRef}
                  className="sr-only"
                  id="pdf-upload"
                  type="file"
                  accept="application/pdf"
                  multiple
                  tabIndex={-1}
                  aria-hidden={true}
                  onChange={handlePdfChange}
                  disabled={isSending}
                />
                <input
                  ref={imageInputRef}
                  className="sr-only"
                  id="image-upload"
                  type="file"
                  accept="image/*"
                  multiple
                  tabIndex={-1}
                  aria-hidden={true}
                  onChange={handleImageChange}
                  disabled={isSending}
                />
                <button
                  ref={attachmentMenuTriggerRef}
                  className="composer-icon-button"
                  type="button"
                  aria-label="Anhänge hinzufügen"
                  aria-haspopup="menu"
                  aria-expanded={openComposerMenu === "attachments"}
                  aria-controls="composer-attachment-menu"
                  disabled={isSending}
                  onClick={() => setOpenComposerMenu((current) =>
                    current === "attachments" ? null : "attachments")}
                >
                  <span aria-hidden="true">+</span>
                </button>
                {openComposerMenu === "attachments" && !isSending ? (
                  <div
                    className="composer-popover attachment-menu"
                    id="composer-attachment-menu"
                    role="menu"
                    aria-label="Anhang auswählen"
                    onKeyDown={handleComposerMenuKeyDown}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => chooseAttachment(pdfInputRef.current)}
                    >
                      PDF anhängen
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => chooseAttachment(imageInputRef.current)}
                    >
                      Bild anhängen
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="composer-actions">
                <div className="composer-menu-control model-menu-control" ref={modelMenuControlRef}>
                  <button
                    ref={modelMenuTriggerRef}
                    className="composer-model-trigger"
                    type="button"
                    aria-label={`Modell auswählen, aktuell ${currentModelName}`}
                    aria-haspopup="menu"
                    aria-expanded={openComposerMenu === "model"}
                    aria-controls="composer-model-menu"
                    disabled={isSending || isDeleting || !isModelPolicyLoaded}
                    onClick={() => void toggleComposerModelMenu()}
                  >
                    {currentModelName}
                  </button>
                  {openComposerMenu === "model" && !isSending && !isDeleting ? (
                    <div
                      className="composer-popover model-menu"
                      id="composer-model-menu"
                      role="menu"
                      aria-label="Modell auswählen"
                      onKeyDown={handleComposerMenuKeyDown}
                    >
                      {enabledModels.map((model) => (
                        <button
                          className={settings.model === model.id ? "is-active" : undefined}
                          type="button"
                          role="menuitemradio"
                          aria-checked={settings.model === model.id}
                          key={model.id}
                          onClick={() => {
                            updateSetting("model", model.id);
                            setOpenComposerMenu(null);
                          }}
                        >
                          <span aria-hidden="true" className="model-menu-check">
                            {settings.model === model.id ? "✓" : ""}
                          </span>
                          <span>{model.label}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <button className="composer-send-button" type="submit" disabled={!canSend}>
                  {isSending ? (
                    <>
                      <span className="spinner" aria-hidden="true"></span>
                      Senden...
                    </>
                  ) : (
                    <>
                      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "6px" }}><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                      Senden
                    </>
                  )}
                </button>
              </div>
            </div>
            {selectedPdfs.length > 0 || selectedImages.length > 0 ? (
              <div className="attachment-chips">
                {selectedPdfs.map((file, index) => (
                  <span className="attachment-chip" key={`pdf-${file.name}-${file.lastModified}-${index}`}>
                    <span title={file.name}>{ellipsizeFilename(file.name)}</span>
                    <small>{(file.size / 1_048_576).toLocaleString("de-AT", { maximumFractionDigits: 1 })} MB</small>
                    <button type="button" onClick={() => removePdfAttachment(index)} disabled={isSending} aria-label={`PDF ${file.name} entfernen`}>
                      Entfernen
                    </button>
                  </span>
                ))}
                {selectedImages.map((file, index) => (
                  <span className="attachment-chip image" key={`image-${file.name}-${file.lastModified}-${index}`}>
                    <span title={file.name}>{ellipsizeFilename(file.name)}</span>
                    <small>{(file.size / 1_048_576).toLocaleString("de-AT", { maximumFractionDigits: 1 })} MB</small>
                    <button type="button" onClick={() => removeImageAttachment(index)} disabled={isSending} aria-label={`Bild ${file.name} entfernen`}>
                      Entfernen
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </form>
        </div>
        </div>
      </section>
      )}
    </main>
  );
}
