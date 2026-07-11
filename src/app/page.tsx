"use client";

import { Fragment, type ChangeEvent, type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";

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
  AVAILABLE_MODELS,
  DEFAULT_SYSTEM_PROMPT,
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_IMAGE_UPLOADS,
  MAX_PDF_UPLOAD_BYTES,
  MAX_PDF_UPLOADS,
  MAX_SYSTEM_PROMPT_CHARS,
  type ChatModel,
} from "@/lib/config";
import {
  DEFAULT_CHAT_SETTINGS,
  displayedSystemPrompt,
  editPersonalSystemPrompt,
  normalizeStoredChatSettings,
  resetToGlobalSystemPrompt,
  systemPromptForChatRequest,
  type ChatSettings,
} from "@/lib/chat/settings";
import { ellipsizeFilename } from "@/lib/attachment-names";
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
import {
  FORM_IMAGE_MIME_TYPES,
  isFormImageMimeType,
  MAX_FORM_IMAGE_BYTES,
  MAX_SALDO_INPUT_CHARS,
  VERF5_FORM_ID,
  VERF5_FORM_NAME,
} from "@/lib/forms/config";
import { normalizeManualSaldo } from "@/lib/forms/values";

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

type SettingsTab = "system-prompt" | "model" | "password";
type AppView = "chat" | "forms" | "administration";
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
  globalSystemPrompt: string;
  isAdmin: boolean;
};

const SETTINGS_STORAGE_KEY = "findog.settings.v1";
const INITIAL_PENDING_TEXT = "Recherche wird vorbereitet";

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
  if (typeof payload.globalSystemPrompt !== "string" || typeof payload.isAdmin !== "boolean") {
    throw new Error("Die geladenen Einstellungen sind ungültig.");
  }
  return {
    globalSystemPrompt: payload.globalSystemPrompt,
    isAdmin: payload.isAdmin,
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
  const [openComposerMenu, setOpenComposerMenu] = useState<ComposerMenu>(null);
  const [pendingStepText, setPendingStepText] = useState(INITIAL_PENDING_TEXT);
  const [pendingSteps, setPendingSteps] = useState<AgentStep[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("system-prompt");
  const [globalSystemPrompt, setGlobalSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [isAdmin, setIsAdmin] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [adminSystemPrompt, setAdminSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [adminError, setAdminError] = useState("");
  const [adminNotice, setAdminNotice] = useState("");
  const [isAdminSettingsLoading, setIsAdminSettingsLoading] = useState(false);
  const [isAdminSettingsSaving, setIsAdminSettingsSaving] = useState(false);
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
  const [authError, setAuthError] = useState("");
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [historyOwnerId, setHistoryOwnerId] = useState("");
  const [appView, setAppView] = useState<AppView>("chat");
  const [selectedFormId, setSelectedFormId] = useState<"" | typeof VERF5_FORM_ID>("");
  const [formImage, setFormImage] = useState<File | null>(null);
  const [formSaldo, setFormSaldo] = useState("");
  const [formError, setFormError] = useState("");
  const [formNotice, setFormNotice] = useState("");
  const [isGeneratingForm, setIsGeneratingForm] = useState(false);
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
  const user = session?.user ?? null;
  const signedInEmail = user?.email ?? "";
  const [welcomeGreeting] = useState(() => getWelcomeGreeting());
  const closeSettingsDialog = useCallback(() => {
    setIsSettingsDialogOpen(false);
    requestAnimationFrame(() => settingsTriggerRef.current?.focus());
  }, []);
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
        setSelectedFormId("");
        setFormImage(null);
        setFormSaldo("");
        setFormError("");
        setFormNotice("");
        setIsGeneratingForm(false);
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
        setGlobalSystemPrompt(DEFAULT_SYSTEM_PROMPT);
        setIsAdmin(false);
        setAppView((current) => current === "administration" ? "chat" : current);
      });
      return;
    }

    let isActive = true;
    void fetchAuthenticatedSettings(accessToken)
      .then((loadedSettings) => {
        if (!isActive) {
          return;
        }
        setGlobalSystemPrompt(loadedSettings.globalSystemPrompt);
        setIsAdmin(loadedSettings.isAdmin);
        if (!loadedSettings.isAdmin) {
          setAppView((current) => current === "administration" ? "chat" : current);
        }
      })
      .catch(() => {
        if (isActive) {
          setIsAdmin(false);
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
        systemPrompt: settings.systemPrompt,
        model: settings.model,
        usesGlobalDefault: settings.usesGlobalDefault,
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

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";

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

  async function refreshAuthenticatedSettings(): Promise<string> {
    const accessToken = session?.access_token;
    if (!accessToken) {
      throw new Error("Deine Anmeldung ist abgelaufen. Bitte erneut anmelden.");
    }
    const loadedSettings = await fetchAuthenticatedSettings(accessToken);
    setGlobalSystemPrompt(loadedSettings.globalSystemPrompt);
    setIsAdmin(loadedSettings.isAdmin);
    if (!loadedSettings.isAdmin) {
      setAppView((current) => current === "administration" ? "chat" : current);
    }
    return loadedSettings.globalSystemPrompt;
  }

  async function openAdministrationView() {
    const accessToken = session?.access_token;
    if (!isAdmin || !accessToken) {
      return;
    }
    setAppView("administration");
    setAdminError("");
    setAdminNotice("");
    setIsAdminSettingsLoading(true);
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 960px)").matches) {
      setSettingsOpen(false);
    }

    try {
      const response = await fetch("/api/admin/settings", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok || typeof payload.systemPrompt !== "string") {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "Globale Einstellungen konnten nicht geladen werden.",
        );
      }
      setAdminSystemPrompt(payload.systemPrompt);
      setGlobalSystemPrompt(payload.systemPrompt);
    } catch (adminSettingsError) {
      setAdminError(adminSettingsError instanceof Error
        ? adminSettingsError.message
        : "Globale Einstellungen konnten nicht geladen werden.");
    } finally {
      setIsAdminSettingsLoading(false);
    }
  }

  async function saveAdminSystemPrompt() {
    const accessToken = session?.access_token;
    if (!accessToken || isAdminSettingsSaving) {
      return;
    }
    setAdminError("");
    setAdminNotice("");
    setIsAdminSettingsSaving(true);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ systemPrompt: adminSystemPrompt }),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok || typeof payload.systemPrompt !== "string") {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "Der globale System Prompt konnte nicht gespeichert werden.",
        );
      }
      setAdminSystemPrompt(payload.systemPrompt);
      setGlobalSystemPrompt(payload.systemPrompt);
      setAdminNotice("Der globale System Prompt wurde gespeichert.");
    } catch (adminSettingsError) {
      setAdminError(adminSettingsError instanceof Error
        ? adminSettingsError.message
        : "Der globale System Prompt konnte nicht gespeichert werden.");
    } finally {
      setIsAdminSettingsSaving(false);
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
    setIsSettingsDialogOpen(true);
    setSettingsError("");
    void refreshAuthenticatedSettings().catch((loadError) => {
      setSettingsError(loadError instanceof Error
        ? loadError.message
        : "Der aktuelle globale System Prompt konnte nicht geladen werden.");
    });
  }

  async function resetPersonalSystemPrompt() {
    setSettingsError("");
    try {
      await refreshAuthenticatedSettings();
      setSettings((current) => resetToGlobalSystemPrompt(current));
    } catch (loadError) {
      setSettingsError(loadError instanceof Error
        ? loadError.message
        : "Der aktuelle globale System Prompt konnte nicht geladen werden.");
    }
  }

  function handleSettingsTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    const tabs: SettingsTab[] = ["system-prompt", "model", "password"];
    const currentIndex = tabs.indexOf(settingsTab);
    let nextTab: SettingsTab | undefined;

    if (event.key === "ArrowRight") {
      nextTab = tabs[(currentIndex + 1) % tabs.length];
    } else if (event.key === "ArrowLeft") {
      nextTab = tabs[(currentIndex - 1 + tabs.length) % tabs.length];
    } else if (event.key === "Home") {
      nextTab = tabs[0];
    } else if (event.key === "End") {
      nextTab = tabs.at(-1);
    }

    if (nextTab) {
      event.preventDefault();
      setSettingsTab(nextTab);
      document.getElementById(`settings-tab-${nextTab}`)?.focus();
    }
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
      const personalSystemPrompt = systemPromptForChatRequest(settings);
      const requestBody: {
        systemPrompt?: string;
        usesGlobalDefault: boolean;
        model: ChatModel;
        messages: Array<Pick<ChatMessage, "role" | "content">>;
        conversationId?: string;
      } = {
        usesGlobalDefault: settings.usesGlobalDefault || !personalSystemPrompt,
        model: settings.model,
        messages: nextMessages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      };

      if (personalSystemPrompt) {
        requestBody.systemPrompt = personalSystemPrompt;
      }

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

  const isAppReady = isLoaded && isAuthLoaded;
  const isAuthConfigured = isSupabaseBrowserConfigured();
  const hasSelectedAttachments = selectedPdfs.length > 0 || selectedImages.length > 0;
  const canSend = isAppReady && Boolean(user) && (composer.trim().length > 0 || hasSelectedAttachments) && !isSending && !isDeleting;
  const historyControlsDisabled = isSending || isHistoryLoading || isDeleting;
  const currentModelName = settings.model === "deepseek-v4-pro"
    ? "DeepSeek v4 Pro"
    : "DeepSeek v4 Flash";

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
              <div className="sidebar-brand">
                <span className="austria-flag" aria-hidden="true">
                  <span className="red"></span>
                  <span className="white"></span>
                  <span className="red"></span>
                </span>
                <span className="brand-text">findog.at</span>
              </div>
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
                <p className="eyebrow">Konfiguration</p>
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
            <div className="settings-tabs" role="tablist" aria-label="Einstellungsbereiche">
              <button
                id="settings-tab-system-prompt"
                className={settingsTab === "system-prompt" ? "settings-tab active" : "settings-tab"}
                type="button"
                role="tab"
                aria-selected={settingsTab === "system-prompt"}
                aria-controls="settings-panel-system-prompt"
                tabIndex={settingsTab === "system-prompt" ? 0 : -1}
                onClick={() => setSettingsTab("system-prompt")}
                onKeyDown={handleSettingsTabKeyDown}
              >
                System Prompt
              </button>
              <button
                id="settings-tab-model"
                className={settingsTab === "model" ? "settings-tab active" : "settings-tab"}
                type="button"
                role="tab"
                aria-selected={settingsTab === "model"}
                aria-controls="settings-panel-model"
                tabIndex={settingsTab === "model" ? 0 : -1}
                onClick={() => setSettingsTab("model")}
                onKeyDown={handleSettingsTabKeyDown}
              >
                Modell
              </button>
              <button
                id="settings-tab-password"
                className={settingsTab === "password" ? "settings-tab active" : "settings-tab"}
                type="button"
                role="tab"
                aria-selected={settingsTab === "password"}
                aria-controls="settings-panel-password"
                tabIndex={settingsTab === "password" ? 0 : -1}
                onClick={() => setSettingsTab("password")}
                onKeyDown={handleSettingsTabKeyDown}
              >
                Passwort
              </button>
            </div>
            {settingsError ? (
              <div className="settings-inline-error" role="alert" aria-live="polite">
                {settingsError}
              </div>
            ) : null}
            {settingsTab === "system-prompt" ? (
              <div
                className="field-group settings-tab-panel"
                id="settings-panel-system-prompt"
                role="tabpanel"
                aria-labelledby="settings-tab-system-prompt"
              >
                <div className="field-label-row">
                  <label htmlFor="system-prompt">System Prompt</label>
                  <button
                    className="secondary-button compact-button"
                    type="button"
                    onClick={() => void resetPersonalSystemPrompt()}
                  >
                    Auf Standard zurücksetzen
                  </button>
                </div>
                <textarea
                  id="system-prompt"
                  value={displayedSystemPrompt(settings, globalSystemPrompt)}
                  onChange={(event) => setSettings((current) =>
                    editPersonalSystemPrompt(current, event.target.value))}
                  maxLength={MAX_SYSTEM_PROMPT_CHARS}
                  rows={16}
                />
                <span className="field-help">
                  {displayedSystemPrompt(settings, globalSystemPrompt).length.toLocaleString("de-AT")} /{" "}
                  {MAX_SYSTEM_PROMPT_CHARS.toLocaleString("de-AT")} Zeichen
                  {settings.usesGlobalDefault ? " · Aktueller globaler Standard" : " · Persönliche Einstellung"}
                </span>
              </div>
            ) : settingsTab === "model" ? (
              <div
                className="field-group settings-tab-panel"
                id="settings-panel-model"
                role="tabpanel"
                aria-labelledby="settings-tab-model"
              >
                <fieldset className="model-options">
                  <legend>DeepSeek-Modell</legend>
                  {AVAILABLE_MODELS.map((model) => (
                    <label className="model-option" key={model}>
                      <input
                        type="radio"
                        name="settings-model"
                        value={model}
                        checked={settings.model === model}
                        onChange={() => updateSetting("model", model)}
                      />
                      <span>
                        <strong>{model === "deepseek-v4-pro" ? "DeepSeek v4 Pro" : "DeepSeek v4 Flash"}</strong>
                        <small>{model === "deepseek-v4-pro" ? "Standardmodell für anspruchsvolle Recherche" : "Schnellere Variante für kompakte Anfragen"}</small>
                      </span>
                    </label>
                  ))}
                </fieldset>
              </div>
            ) : (
              <form
                className="password-settings-form settings-tab-panel"
                id="settings-panel-password"
                role="tabpanel"
                aria-labelledby="settings-tab-password"
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
            )}
          </section>
        </div>
      ) : null}

      {appView === "forms" ? (
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
              <p className="eyebrow">Systemkonfiguration</p>
              <h1 id="administration-view-title">Administration</h1>
            </header>
            <div className="form-generator-card admin-settings-card">
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
              <div className="field-group">
                <label htmlFor="admin-system-prompt">Globaler System Prompt</label>
                <textarea
                  id="admin-system-prompt"
                  value={adminSystemPrompt}
                  onChange={(event) => {
                    setAdminSystemPrompt(event.target.value);
                    setAdminError("");
                    setAdminNotice("");
                  }}
                  maxLength={MAX_SYSTEM_PROMPT_CHARS}
                  rows={18}
                  disabled={isAdminSettingsLoading || isAdminSettingsSaving}
                />
              </div>
              <div className="admin-settings-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    setAdminSystemPrompt(DEFAULT_SYSTEM_PROMPT);
                    setAdminError("");
                    setAdminNotice("");
                  }}
                  disabled={isAdminSettingsLoading || isAdminSettingsSaving}
                >
                  Auf integrierten Standard zurücksetzen
                </button>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => void saveAdminSystemPrompt()}
                  disabled={isAdminSettingsLoading || isAdminSettingsSaving || !adminSystemPrompt.trim()}
                >
                  {isAdminSettingsSaving ? "Speichert…" : "Speichern"}
                </button>
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
                    disabled={isSending || isDeleting}
                    onClick={() => setOpenComposerMenu((current) =>
                      current === "model" ? null : "model")}
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
                      {AVAILABLE_MODELS.map((model) => (
                        <button
                          className={settings.model === model ? "is-active" : undefined}
                          type="button"
                          role="menuitemradio"
                          aria-checked={settings.model === model}
                          key={model}
                          onClick={() => {
                            updateSetting("model", model);
                            setOpenComposerMenu(null);
                          }}
                        >
                          <span aria-hidden="true" className="model-menu-check">
                            {settings.model === model ? "✓" : ""}
                          </span>
                          <span>
                            {model === "deepseek-v4-pro" ? "DeepSeek v4 Pro" : "DeepSeek v4 Flash"}
                          </span>
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
