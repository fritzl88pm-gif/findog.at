"use client";

import { Fragment, type ChangeEvent, type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { chatHistoryStorageKey } from "@/lib/chat/storage";
import {
  DEFAULT_SYSTEM_PROMPT,
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_IMAGE_UPLOADS,
  MAX_PDF_UPLOAD_BYTES,
  MAX_PDF_UPLOADS,
  MAX_SYSTEM_PROMPT_CHARS,
} from "@/lib/config";
import { ellipsizeFilename } from "@/lib/attachment-names";
import type { AgentStep } from "@/lib/agent-steps";
import { parseRichAnswer, type RichBlock, type RichInline } from "@/lib/answer-rendering";
import {
  getSupabaseBrowserClient,
  isSupabaseBrowserConfigured,
} from "@/lib/supabase/browser";
import { CHAT_STREAM_CONTENT_TYPE, parseChatStreamLine } from "@/lib/chat-stream";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  steps?: AgentStep[];
};

type Settings = {
  systemPrompt: string;
};

type StoredHistory = {
  conversationId: string;
  title?: string;
  messages: ChatMessage[];
};

type ConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

type StoredSettings = Pick<Settings, "systemPrompt">;

type AuthMode = "sign-in" | "sign-up";

type AuthForm = {
  email: string;
  password: string;
};

type ChatResponsePayload = {
  answer?: unknown;
  error?: unknown;
  steps?: unknown;
  conversationId?: unknown;
  title?: unknown;
};

const SETTINGS_STORAGE_KEY = "findog.settings.v1";
const INITIAL_PENDING_TEXT = "Verbindung zum Rechercheagenten wird aufgebaut...";

const DEFAULT_SETTINGS: Settings = {
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
};

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

    return [
      {
        role: item.role,
        content: item.content,
        createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
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

function compactStatusText(value: string, maxLength = 220): string {
  const compacted = value.replace(/\s+/g, " ").trim();
  if (compacted.length <= maxLength) {
    return compacted;
  }

  return `${compacted.slice(0, maxLength).trimEnd()}...`;
}

function pendingTextForStep(step: AgentStep): string {
  const preview = compactStatusText(step.content);

  switch (step.type) {
    case "pdf_context":
    case "attachment_context":
      return `${step.title}: ${preview}`;
    case "plan":
      return `Arbeitsplan erstellt: ${preview}`;
    case "tools":
      return preview || step.title;
    case "tool_call":
      return `${step.title}: ${compactStatusText(step.content.replace(/^Argumente:\s*/i, ""))}`;
    case "tool_result":
      return `${step.title}: ${preview}`;
    case "progress":
      return `Fortschritt aktualisiert: ${preview}`;
    case "finalize":
      return "Recherche abgeschlossen. Die finale Antwort wird vorbereitet.";
    case "citation_verification":
      return `Findok-Verifikation: ${preview}`;
    case "self_check":
      return `Selbstcheck: ${preview}`;
    case "answer":
      return "Finale Antwort wird übernommen.";
  }
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

function stepTypeLabel(step: AgentStep): string {
  switch (step.type) {
    case "pdf_context":
      return "PDF";
    case "attachment_context":
      return "Anhang";
    case "plan":
      return "Plan";
    case "tools":
      return "Datenbank";
    case "tool_call":
      return "Aufruf";
    case "tool_result":
      return step.success ? "Ergebnis" : "Fehler";
    case "progress":
      return "Fortschritt";
    case "finalize":
      return "Finalisierung";
    case "citation_verification":
      return "Findok";
    case "self_check":
      return "Selbstcheck";
    case "answer":
      return "Antwort";
  }
}

function renderStepContent(content: string): ReactNode {
  const nodes: ReactNode[] = [];
  const strikePattern = /~~(.+?)~~/gs;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = strikePattern.exec(content)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(<span key={`text-${lastIndex}`}>{content.slice(lastIndex, match.index)}</span>);
    }
    nodes.push(<s key={`strike-${match.index}-${match[1]}`}>{match[1]}</s>);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    nodes.push(<span key={`text-${lastIndex}`}>{content.slice(lastIndex)}</span>);
  }

  return nodes.length > 0 ? nodes : content;
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
  if (steps.length === 0) {
    return null;
  }

  return (
    <details className="agent-steps" open>
      <summary>Agentenschritte ({steps.length})</summary>
      <ol>
        {steps.map((step, index) => (
          <li className={`agent-step ${step.type}`} key={`${step.type}-${step.title}-${index}`}>
            <div className="agent-step-header">
              <span>{stepTypeLabel(step)}</span>
              <strong>{step.title}</strong>
            </div>
            <pre>{renderStepContent(step.content)}</pre>
          </li>
        ))}
      </ol>
    </details>
  );
}

export default function Home() {
  const supabase = getSupabaseBrowserClient();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState("");
  const [conversationTitle, setConversationTitle] = useState("");
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [composer, setComposer] = useState("");
  const [selectedPdfs, setSelectedPdfs] = useState<File[]>([]);
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [pendingStepText, setPendingStepText] = useState(INITIAL_PENDING_TEXT);
  const [pendingSteps, setPendingSteps] = useState<AgentStep[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [isAuthLoaded, setIsAuthLoaded] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("sign-in");
  const [authForm, setAuthForm] = useState<AuthForm>({ email: "", password: "" });
  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [historyOwnerId, setHistoryOwnerId] = useState("");
  const transcriptRef = useRef<HTMLDivElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsDialogRef = useRef<HTMLElement>(null);
  const settingsDialogCloseRef = useRef<HTMLButtonElement>(null);
  const user = session?.user ?? null;
  const signedInEmail = user?.email ?? "";
  const closeSettingsDialog = useCallback(() => {
    setIsSettingsDialogOpen(false);
    requestAnimationFrame(() => settingsTriggerRef.current?.focus());
  }, []);

  useEffect(() => {
    let isActive = true;

    queueMicrotask(() => {
      if (!isActive) {
        return;
      }

      const storedSettings = readJson<Partial<StoredSettings>>(SETTINGS_STORAGE_KEY);
      if (storedSettings) {
        setSettings({
          systemPrompt:
            typeof storedSettings.systemPrompt === "string" && storedSettings.systemPrompt.trim()
              ? storedSettings.systemPrompt
            : DEFAULT_SYSTEM_PROMPT,
        });
      }

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

    supabase.auth.getSession().then(({ data }) => {
      if (!isActive) {
        return;
      }
      setSession(data.session);
      setIsAuthLoaded(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setError("");
      setAuthError("");
      setAuthNotice("");
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
        setHistoryOwnerId("");
        setConversationId("");
        setConversationTitle("");
        setConversations([]);
        setMessages([]);
        setComposer("");
        setIsSending(false);
        setPendingStepText(INITIAL_PENDING_TEXT);
        setPendingSteps([]);
        return;
      }

      const storedHistory = readJson<Partial<StoredHistory>>(chatHistoryStorageKey(user.id));
      setHistoryOwnerId(user.id);
      const storedConversationId = typeof storedHistory?.conversationId === "string"
        ? storedHistory.conversationId
        : "";
      setConversationId(storedConversationId);
      setConversationTitle(typeof storedHistory?.title === "string" ? storedHistory.title : "");
      setMessages(normalizeMessages(storedHistory?.messages));

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

          if (storedConversationId && summaries.some((item) => item.id === storedConversationId)) {
            const history = await fetchConversationHistory(accessToken, storedConversationId);
            if (isActive) {
              setConversationTitle(history.title);
              setMessages(history.messages);
            }
          } else if (storedConversationId) {
            setConversationId("");
            setConversationTitle("");
            setMessages([]);
          }
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
  }, [isAuthLoaded, isLoaded, session?.access_token, user?.id]);

  useEffect(() => {
    if (isLoaded) {
      writeJson(SETTINGS_STORAGE_KEY, {
        systemPrompt: settings.systemPrompt,
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
    const prefersReducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  }, [isSending, messages, pendingStepText, pendingSteps]);

  function updateSetting<Key extends keyof Settings>(key: Key, value: Settings[Key]) {
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

  function selectAuthMode(nextMode: AuthMode) {
    setAuthMode(nextMode);
    setAuthError("");
    setAuthNotice("");
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

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
    setAuthNotice("");
    setIsAuthSubmitting(true);

    try {
      const { data, error: authSubmitError } =
        authMode === "sign-in"
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({
              email,
              password,
              options: { emailRedirectTo: window.location.origin },
            });

      if (authSubmitError) {
        throw authSubmitError;
      }

      setAuthForm({ email: "", password: "" });

      if (authMode === "sign-up") {
        setAuthNotice(
          data.session
            ? "Registrierung abgeschlossen. Du bist angemeldet."
            : "Registrierung erstellt. Bitte bestätige deine E-Mail-Adresse und melde dich danach an.",
        );
      }
    } catch (caughtError) {
      const fallbackMessage =
        authMode === "sign-in"
          ? "Anmeldung fehlgeschlagen. Bitte E-Mail und Passwort prüfen."
          : "Registrierung fehlgeschlagen. Bitte Eingaben prüfen oder später erneut versuchen.";
      const detail = caughtError instanceof Error ? caughtError.message.trim() : "";
      setAuthError(detail ? `${fallbackMessage} Details: ${detail}` : fallbackMessage);
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  async function handleSignOut() {
    if (!supabase || isAuthSubmitting) {
      return;
    }

    setAuthError("");
    setAuthNotice("");
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

  function clearAttachments() {
    setSelectedPdfs([]);
    setSelectedImages([]);
    if (pdfInputRef.current) {
      pdfInputRef.current.value = "";
    }
    if (imageInputRef.current) {
      imageInputRef.current.value = "";
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

  function startNewConversation() {
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
    if (isSending || !session?.access_token) {
      return;
    }
    setError("");
    setIsHistoryLoading(true);
    try {
      const history = await fetchConversationHistory(session.access_token, conversation.id);
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

  function openSettingsDialog() {
    setIsSettingsDialogOpen(true);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

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
    setIsSending(true);
    setPendingStepText(INITIAL_PENDING_TEXT);
    setPendingSteps([]);
    setMessages(nextMessages);

    try {
      const requestBody: {
        systemPrompt: string;
        messages: Array<Pick<ChatMessage, "role" | "content">>;
        conversationId?: string;
      } = {
        systemPrompt: settings.systemPrompt.trim() || DEFAULT_SYSTEM_PROMPT,
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
            setPendingStepText(pendingTextForStep(step));
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
  const canSend = isAppReady && Boolean(user) && (composer.trim().length > 0 || hasSelectedAttachments) && !isSending;

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
          <p className="eyebrow">findog.at</p>
          <h1>{authMode === "sign-in" ? "Anmelden" : "Registrieren"}</h1>
          <p className="auth-copy">
            Melde dich mit E-Mail und Passwort an. Der geschützte Bereich öffnet sich erst nach
            erfolgreicher Anmeldung.
          </p>

          <div className="auth-tabs" role="tablist" aria-label="Authentifizierungsmodus">
            <button
              type="button"
              role="tab"
              className={authMode === "sign-in" ? "auth-tab active" : "auth-tab"}
              onClick={() => selectAuthMode("sign-in")}
              aria-selected={authMode === "sign-in"}
            >
              Anmelden
            </button>
            <button
              type="button"
              role="tab"
              className={authMode === "sign-up" ? "auth-tab active" : "auth-tab"}
              onClick={() => selectAuthMode("sign-up")}
              aria-selected={authMode === "sign-up"}
            >
              Registrieren
            </button>
          </div>

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
          {authNotice ? (
            <div className="notice-box auth-message" role="status" aria-live="polite">
              {authNotice}
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
                autoComplete={authMode === "sign-in" ? "current-password" : "new-password"}
                placeholder="Mindestens 6 Zeichen"
                disabled={!isAppReady || !isAuthConfigured || isAuthSubmitting}
              />
            </div>
            <button
              className="primary-button"
              type="submit"
              disabled={!isAppReady || !isAuthConfigured || isAuthSubmitting}
            >
              {isAuthSubmitting ? "Bitte warten..." : authMode === "sign-in" ? "Anmelden" : "Registrieren"}
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
              disabled={isSending}
            >
              <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              Neue Unterhaltung
            </button>
            <div className="conversation-history" aria-label="Gespeicherte Unterhaltungen">
              <div className="conversation-history-heading">
                <span>Unterhaltungen</span>
                {isHistoryLoading ? <span className="history-loading">Lädt…</span> : null}
              </div>
              <div className="conversation-list">
                {!isHistoryLoading && conversations.length === 0 ? (
                  <p className="conversation-empty">Noch keine gespeicherten Unterhaltungen.</p>
                ) : null}
                {conversations.map((conversation) => (
                  <button
                    className={`conversation-row ${conversation.id === conversationId ? "active" : ""}`}
                    type="button"
                    key={conversation.id}
                    onClick={() => void selectConversation(conversation)}
                    disabled={isSending || isHistoryLoading}
                    aria-current={conversation.id === conversationId ? "page" : undefined}
                  >
                    <span title={conversation.title}>{conversation.title}</span>
                    <time dateTime={conversation.updatedAt}>{formatHistoryDate(conversation.updatedAt)}</time>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="rail-content">
            <button
              className="icon-button rail-icon-btn"
              type="button"
              onClick={startNewConversation}
              disabled={isSending}
              title="Neue Unterhaltung"
              aria-label="Neue Unterhaltung"
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
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
            <div className="field-group">
              <div className="field-label-row">
                <label htmlFor="system-prompt">System Prompt</label>
                <button
                  className="secondary-button compact-button"
                  type="button"
                  onClick={() => updateSetting("systemPrompt", DEFAULT_SYSTEM_PROMPT)}
                >
                  Auf Standard zurücksetzen
                </button>
              </div>
              <textarea
                id="system-prompt"
                value={settings.systemPrompt}
                onChange={(event) => updateSetting("systemPrompt", event.target.value)}
                maxLength={MAX_SYSTEM_PROMPT_CHARS}
                rows={16}
              />
              <span className="field-help">
                {settings.systemPrompt.length.toLocaleString("de-AT")} /{" "}
                {MAX_SYSTEM_PROMPT_CHARS.toLocaleString("de-AT")} Zeichen
              </span>
            </div>
          </section>
        </div>
      ) : null}

      <section className="chat-panel">
        <div className="transcript" ref={transcriptRef}>
          <div className="transcript-content">
            {messages.length === 0 ? (
              <div className="empty-state">
                <svg aria-hidden="true" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="empty-state-icon" style={{ color: "var(--bmf-blue)", marginBottom: "16px", opacity: 0.8 }}><path d="M12 3v17" /><path d="M3 6h18" /><path d="M3 6l3 6h6L9 6" /><path d="M15 6l3 6h6l-3-6" /><path d="M9 21h6" /></svg>
                <h3>Neue Anfrage</h3>
                <p>Stelle eine konkrete steuerrechtliche Frage mit Sachverhalt und Zeitraum.</p>
              </div>
            ) : (
              messages.map((message, index) => (
                <article className={`message ${message.role}`} key={`${message.createdAt}-${index}`}>
                  <div className="message-header">
                    <div className="message-avatar">
                      {message.role === "user" ? "DU" : "FF"}
                    </div>
                    <div className="message-meta">
                      <span className="sender-name">{message.role === "user" ? "Du" : "Findog/Fred"}</span>
                      <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
                    </div>
                  </div>
                  {message.role === "assistant" ? (
                    <RichAnswer content={message.content} />
                  ) : (
                    renderUserMessageContent(message.content)
                  )}
                  {message.role === "assistant" && message.steps?.length ? (
                    <AgentStepsPanel steps={message.steps} />
                  ) : null}
                </article>
              ))
            )}

            {isSending ? (
              <article className="message assistant pending" aria-live="polite">
                <div className="message-header">
                  <div className="message-avatar">FF</div>
                  <div className="message-meta">
                    <span className="sender-name">Findog/Fred</span>
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
            <div className="error-box" role="alert" aria-live="polite" style={{ maxWidth: "800px", margin: "0 auto 12px" }}>
              {error}
            </div>
          ) : null}
          <form className="composer" onSubmit={handleSubmit}>
            <label className="sr-only" htmlFor="question">
              Frage
            </label>
            <textarea
              id="question"
              value={composer}
              onChange={(event) => setComposer(event.target.value)}
              placeholder="Frage zu BFG, EStG, UStG oder Verfahrensrecht..."
              rows={3}
            />
            <div className="attachment-row">
              <input
                ref={pdfInputRef}
                className="sr-only"
                id="pdf-upload"
                type="file"
                accept="application/pdf"
                multiple
                onChange={handlePdfChange}
                disabled={isSending}
              />
              <label className="attachment-button" htmlFor="pdf-upload" aria-disabled={isSending}>
                PDFs anhängen
              </label>
              <input
                ref={imageInputRef}
                className="sr-only"
                id="image-upload"
                type="file"
                accept="image/*"
                multiple
                onChange={handleImageChange}
                disabled={isSending}
              />
              <label className="attachment-button" htmlFor="image-upload" aria-disabled={isSending}>
                Bilder anhängen
              </label>
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
            <div className="composer-actions">
              <span>{messages.length} Nachrichten in dieser Unterhaltung</span>
              <button type="submit" disabled={!canSend}>
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
          </form>
        </div>
      </section>
    </main>
  );
}
