"use client";

import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { chatHistoryStorageKey } from "@/lib/chat/storage";
import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL,
  DEFAULT_SYSTEM_PROMPT,
  MAX_SYSTEM_PROMPT_CHARS,
  type ChatModel,
} from "@/lib/config";
import type { AgentStep } from "@/lib/agent-steps";
import {
  getSupabaseBrowserClient,
  isSupabaseBrowserConfigured,
} from "@/lib/supabase/browser";

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

const SETTINGS_STORAGE_KEY = "findog.settings.v1";

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

function stepTypeLabel(step: AgentStep): string {
  switch (step.type) {
    case "plan":
      return "Plan";
    case "tools":
      return "Werkzeuge";
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
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);
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
  }, [isSending, messages]);

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
      setError("");
    } catch {
      setAuthError("Abmeldung fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  function clearConversation() {
    setError("");
    setMessages([]);
    setConversationId("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const question = composer.trim();
    if (!question || isSending) {
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

    const userMessage: ChatMessage = {
      role: "user",
      content: question,
      createdAt: new Date().toISOString(),
    };
    const nextMessages = [...messages, userMessage];

    setComposer("");
    setError("");
    setIsSending(true);
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

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        answer?: unknown;
        error?: unknown;
        steps?: unknown;
        conversationId?: unknown;
      };

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
    }
  }

  const isAppReady = isLoaded && isAuthLoaded;
  const isAuthConfigured = isSupabaseBrowserConfigured();
  const canSend = isAppReady && Boolean(user) && composer.trim().length > 0 && !isSending;
  const needsOwnDeepSeekKey = isProModel(settings.model);
  const hasOwnDeepSeekKey = Boolean(settings.deepSeekApiKey.trim());

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
      <header className="hero" aria-label="Findog/Fred">
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="austria-flag" aria-hidden="true">
              <span className="red"></span>
              <span className="white"></span>
              <span className="red"></span>
            </span>
            findog.at
          </p>
          <h1>Findog/Fred</h1>
          <p>
            Deutscher Chat für österreichisches Steuerrecht mit DeepSeek Flash global,
            DeepSeek Pro BYOK und BFG/WeKnora-MCP-Recherche.
          </p>
        </div>
        <div className="status-strip" aria-label="Status">
          <span className={user ? "status ready" : "status missing"}>Auth</span>
          <span className={!needsOwnDeepSeekKey || hasOwnDeepSeekKey ? "status ready" : "status missing"}>
            {needsOwnDeepSeekKey ? "DeepSeek Pro BYOK" : "DeepSeek Flash global"}
          </span>
          <span className="status ready">{settings.model}</span>
        </div>
      </header>

      <section className={`workspace ${settingsOpen ? "has-sidebar" : ""}`} aria-label="Arbeitsbereich">
        <aside className={settingsOpen ? "settings-panel open" : "settings-panel"}>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Einstellungen</p>
              <h2>Lokale Konfiguration</h2>
            </div>
            <button
              className="icon-button close-sidebar"
              type="button"
              onClick={() => setSettingsOpen(false)}
              aria-label="Einstellungen ausblenden"
              title="Einstellungen ausblenden"
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>

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
        </aside>

        <section className="chat-panel">
          <div className="chat-toolbar">
            <div>
              <p className="eyebrow">Steuerrechts-Chat</p>
              <h2>Recherche & Analyse</h2>
            </div>
            <div className="toolbar-actions">
              {user ? (
                <>
                  <div className="signed-in-user">
                    <span>Angemeldet als</span>
                    <strong>{signedInEmail}</strong>
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={handleSignOut}
                    disabled={isAuthSubmitting}
                  >
                    Abmelden
                  </button>
                </>
              ) : null}
              {!settingsOpen && (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  title="Einstellungen anzeigen"
                >
                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "6px" }}><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                  Einstellungen
                </button>
              )}
            </div>
          </div>

          {error ? (
            <div className="error-box" role="alert" aria-live="polite">
              {error}
            </div>
          ) : null}

          <div className="transcript" ref={transcriptRef}>
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
                  <p className="message-body">{message.content}</p>
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
                <p className="message-body">
                  Plant den Rechercheablauf, lädt BFG/WeKnora-Werkzeuge und wertet Quellen aus...
                </p>
              </article>
            ) : null}
          </div>

          <form className="composer" onSubmit={handleSubmit}>
            <label className="sr-only" htmlFor="question">
              Frage
            </label>
            <textarea
              id="question"
              value={composer}
              onChange={(event) => setComposer(event.target.value)}
              placeholder="Frage zu BFG, EStG, UStG oder Verfahrensrecht..."
              rows={4}
            />
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
        </section>
      </section>
    </main>
  );
}
