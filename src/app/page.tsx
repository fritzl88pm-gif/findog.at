"use client";

import { type ChangeEvent, type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { chatHistoryStorageKey } from "@/lib/chat/storage";
import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL,
  DEFAULT_SYSTEM_PROMPT,
  MAX_PDF_UPLOAD_BYTES,
  MAX_SYSTEM_PROMPT_CHARS,
  type ChatModel,
} from "@/lib/config";
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
  deepSeekApiKey: string;
  model: ChatModel;
  systemPrompt: string;
};

type StoredHistory = {
  conversationId: string;
  messages: ChatMessage[];
};

type StoredSettings = Pick<Settings, "model" | "systemPrompt">;

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
};

const SETTINGS_STORAGE_KEY = "findog.settings.v1";
const INITIAL_PENDING_TEXT = "Verbindung zum Rechercheagenten wird aufgebaut...";

const DEFAULT_SETTINGS: Settings = {
  deepSeekApiKey: "",
  model: DEFAULT_MODEL,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
};

function isChatModel(value: unknown): value is ChatModel {
  return typeof value === "string" && AVAILABLE_MODELS.includes(value as ChatModel);
}

function isProModel(model: ChatModel): boolean {
  return model === "deepseek-v4-pro";
}

function modelLabel(model: ChatModel): string {
  return model === "deepseek-v4-pro"
    ? "deepseek-v4-pro (BYOK, eigener API Key)"
    : "deepseek-v4-flash (Global, Standard)";
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

    if (item.type === "pdf_context") {
      return [{ type: "pdf_context", title: item.title, content: item.content }];
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
    return <mark key={key}>{renderRichInline(node.children, key)}</mark>;
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
  const [composer, setComposer] = useState("");
  const [selectedPdf, setSelectedPdf] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [pendingStepText, setPendingStepText] = useState(INITIAL_PENDING_TEXT);
  const [pendingSteps, setPendingSteps] = useState<AgentStep[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);
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
  const user = session?.user ?? null;
  const signedInEmail = user?.email ?? "";

  useEffect(() => {
    let isActive = true;

    queueMicrotask(() => {
      if (!isActive) {
        return;
      }

      const storedSettings = readJson<Partial<StoredSettings>>(SETTINGS_STORAGE_KEY);
      if (storedSettings) {
        setSettings({
          deepSeekApiKey: "",
          model: isChatModel(storedSettings.model) ? storedSettings.model : DEFAULT_MODEL,
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
        setMessages([]);
        setComposer("");
        setIsSending(false);
        setPendingStepText(INITIAL_PENDING_TEXT);
        setPendingSteps([]);
        return;
      }

      const storedHistory = readJson<Partial<StoredHistory>>(chatHistoryStorageKey(user.id));
      setHistoryOwnerId(user.id);
      setConversationId(
        typeof storedHistory?.conversationId === "string" && storedHistory.conversationId
          ? storedHistory.conversationId
          : "",
      );
      setMessages(normalizeMessages(storedHistory?.messages));
    });

    return () => {
      isActive = false;
    };
  }, [isAuthLoaded, isLoaded, user?.id]);

  useEffect(() => {
    if (isLoaded) {
      writeJson(SETTINGS_STORAGE_KEY, {
        model: settings.model,
        systemPrompt: settings.systemPrompt,
      });
    }
  }, [isLoaded, settings]);

  useEffect(() => {
    if (isLoaded && user?.id && historyOwnerId === user.id && conversationId) {
      writeJson(chatHistoryStorageKey(user.id), {
        conversationId,
        messages,
      });
    }
  }, [conversationId, historyOwnerId, isLoaded, messages, user?.id]);

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

      setSettings((current) => ({
        ...current,
        deepSeekApiKey: "",
      }));
      setSession(null);
      setHistoryOwnerId("");
      setConversationId("");
      setMessages([]);
      setComposer("");
      clearPdfAttachment();
      setError("");
      setPendingStepText(INITIAL_PENDING_TEXT);
      setPendingSteps([]);
    } catch {
      setAuthError("Abmeldung fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  function clearPdfAttachment() {
    setSelectedPdf(null);
    if (pdfInputRef.current) {
      pdfInputRef.current.value = "";
    }
  }

  function handlePdfChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file) {
      return;
    }
    if (file.type !== "application/pdf") {
      clearPdfAttachment();
      setError("Bitte nur PDF-Dateien hochladen.");
      return;
    }
    if (file.size > MAX_PDF_UPLOAD_BYTES) {
      clearPdfAttachment();
      setError("Das PDF ist zu groß. Maximal 50 MB sind erlaubt.");
      return;
    }

    setSelectedPdf(file);
    setError("");
  }

  function clearConversation() {
    setError("");
    setMessages([]);
    setConversationId("");
    setPendingStepText(INITIAL_PENDING_TEXT);
    setPendingSteps([]);
    clearPdfAttachment();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const question = composer.trim();
    const attachedPdf = selectedPdf;
    if ((!question && !attachedPdf) || isSending) {
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

    if (isProModel(settings.model) && !settings.deepSeekApiKey.trim()) {
      setError("DeepSeek Pro benötigt deinen eigenen API Key. Bitte in den Einstellungen eintragen.");
      setSettingsOpen(true);
      return;
    }

    const userContent = attachedPdf
      ? [question || "Bitte analysiere das hochgeladene PDF.", `PDF-Anhang: ${attachedPdf.name}`].join("\n\n")
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
        deepSeekApiKey?: string;
        model: ChatModel;
        systemPrompt: string;
        messages: Array<Pick<ChatMessage, "role" | "content">>;
        conversationId?: string;
      } = {
        model: settings.model,
        systemPrompt: settings.systemPrompt.trim() || DEFAULT_SYSTEM_PROMPT,
        messages: nextMessages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      };

      if (conversationId) {
        requestBody.conversationId = conversationId;
      }
      if (isProModel(settings.model)) {
        requestBody.deepSeekApiKey = settings.deepSeekApiKey.trim();
      }

      const requestHeaders: Record<string, string> = {
        Accept: CHAT_STREAM_CONTENT_TYPE,
        Authorization: `Bearer ${accessToken}`,
      };
      const requestInit: RequestInit = {
        method: "POST",
        headers: requestHeaders,
      };

      if (attachedPdf) {
        const formData = new FormData();
        formData.append("payload", JSON.stringify(requestBody));
        formData.append("pdf", attachedPdf, attachedPdf.name);
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
      if (attachedPdf) {
        clearPdfAttachment();
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
  const canSend = isAppReady && Boolean(user) && (composer.trim().length > 0 || Boolean(selectedPdf)) && !isSending;
  const needsOwnDeepSeekKey = isProModel(settings.model);

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
            <div className="field-group">
              <label htmlFor="model">DeepSeek Modell</label>
              <select
                id="model"
                value={settings.model}
                onChange={(event) => updateSetting("model", event.target.value as ChatModel)}
              >
                {AVAILABLE_MODELS.map((model) => (
                  <option key={model} value={model}>
                    {modelLabel(model)}
                  </option>
                ))}
              </select>
              <span className="field-help">
                Flash ist der Standard und nutzt den globalen Server-Key. Pro ist BYOK und benötigt deinen eigenen Key.
              </span>
            </div>

            {needsOwnDeepSeekKey ? (
              <div className="field-group">
                <label htmlFor="deepseek-key">DeepSeek API Key für Pro</label>
                <input
                  id="deepseek-key"
                  type="password"
                  value={settings.deepSeekApiKey}
                  onChange={(event) => updateSetting("deepSeekApiKey", event.target.value)}
                  autoComplete="off"
                  placeholder="Nur für deepseek-v4-pro"
                />
                <span className="field-help">
                  Wird nur flüchtig im React-State gehalten und nie persistent gespeichert.
                </span>
              </div>
            ) : (
              <div className="notice-box" role="status">
                DeepSeek v4 Flash ist global verfügbar. Für das Standardmodell ist kein eigener API Key nötig.
              </div>
            )}

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
                rows={12}
              />
              <span className="field-help">
                {settings.systemPrompt.length.toLocaleString("de-AT")} /{" "}
                {MAX_SYSTEM_PROMPT_CHARS.toLocaleString("de-AT")} Zeichen
              </span>
            </div>

            <button
              className="secondary-button danger-button"
              type="button"
              onClick={clearConversation}
              disabled={!user}
            >
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "6px" }}><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              Verlauf leeren
            </button>
          </div>
        ) : (
          <div className="rail-content">
            <button
              className="icon-button rail-icon-btn"
              type="button"
              onClick={clearConversation}
              disabled={!user}
              title="Verlauf leeren"
              aria-label="Verlauf leeren"
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
            <button
              className="icon-button rail-icon-btn"
              type="button"
              onClick={() => setSettingsOpen(true)}
              title="Einstellungen einblenden"
              aria-label="Einstellungen einblenden"
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
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
          )}
        </div>
      </aside>

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
                    <p className="message-body">{message.content}</p>
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
                onChange={handlePdfChange}
                disabled={isSending}
              />
              <label className="attachment-button" htmlFor="pdf-upload" aria-disabled={isSending}>
                PDF anhängen
              </label>
              {selectedPdf ? (
                <span className="attachment-chip">
                  <span title={selectedPdf.name}>{selectedPdf.name}</span>
                  <small>{(selectedPdf.size / 1_048_576).toLocaleString("de-AT", { maximumFractionDigits: 1 })} MB</small>
                  <button type="button" onClick={clearPdfAttachment} disabled={isSending} aria-label="PDF entfernen">
                    Entfernen
                  </button>
                </span>
              ) : null}
            </div>
            <div className="composer-actions">
              <span>{messages.length} Nachrichten lokal für dieses Konto gespeichert</span>
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
