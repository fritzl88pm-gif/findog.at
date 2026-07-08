"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";

import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL,
  DEFAULT_SYSTEM_PROMPT,
  type ChatModel,
} from "@/lib/config";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

type Settings = {
  deepSeekApiKey: string;
  mcpBearerToken: string;
  model: ChatModel;
  systemPrompt: string;
};

type StoredHistory = {
  conversationId: string;
  messages: ChatMessage[];
};

type StoredSettings = Pick<Settings, "model" | "systemPrompt">;

const SETTINGS_STORAGE_KEY = "findog.settings.v1";
const HISTORY_STORAGE_KEY = "findog.history.v1";
const CLIENT_STORAGE_KEY = "findog.clientId.v1";

const DEFAULT_SETTINGS: Settings = {
  deepSeekApiKey: "",
  mcpBearerToken: "",
  model: DEFAULT_MODEL,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
};

function isChatModel(value: unknown): value is ChatModel {
  return typeof value === "string" && AVAILABLE_MODELS.includes(value as ChatModel);
}

function createUuid(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) {
    return randomUuid;
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
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

    return [
      {
        role: item.role,
        content: item.content,
        createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
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

export default function Home() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState("");
  const [clientId, setClientId] = useState("");
  const [composer, setComposer] = useState("");
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const transcriptRef = useRef<HTMLDivElement>(null);

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
          mcpBearerToken: "",
          model: isChatModel(storedSettings.model) ? storedSettings.model : DEFAULT_MODEL,
          systemPrompt:
            typeof storedSettings.systemPrompt === "string" && storedSettings.systemPrompt.trim()
              ? storedSettings.systemPrompt
              : DEFAULT_SYSTEM_PROMPT,
        });
      }

      const storedHistory = readJson<Partial<StoredHistory>>(HISTORY_STORAGE_KEY);
      setConversationId(
        typeof storedHistory?.conversationId === "string" && storedHistory.conversationId
          ? storedHistory.conversationId
          : createUuid(),
      );
      setMessages(normalizeMessages(storedHistory?.messages));

      const storedClientId = localStorage.getItem(CLIENT_STORAGE_KEY);
      const nextClientId = storedClientId || createUuid();
      localStorage.setItem(CLIENT_STORAGE_KEY, nextClientId);
      setClientId(nextClientId);
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
    if (isLoaded) {
      writeJson(SETTINGS_STORAGE_KEY, {
        model: settings.model,
        systemPrompt: settings.systemPrompt,
      });
    }
  }, [isLoaded, settings]);

  useEffect(() => {
    if (isLoaded && conversationId) {
      writeJson(HISTORY_STORAGE_KEY, {
        conversationId,
        messages,
      });
    }
  }, [conversationId, isLoaded, messages]);

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

  function clearConversation() {
    setError("");
    setMessages([]);
    setConversationId(createUuid());
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const question = composer.trim();
    if (!question || isSending) {
      return;
    }

    if (!settings.deepSeekApiKey.trim()) {
      setError("DeepSeek API Key fehlt. Bitte in den Einstellungen eintragen.");
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
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          deepSeekApiKey: settings.deepSeekApiKey.trim(),
          mcpBearerToken: settings.mcpBearerToken.trim() || undefined,
          model: settings.model,
          systemPrompt: settings.systemPrompt.trim() || DEFAULT_SYSTEM_PROMPT,
          messages: nextMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          conversationId,
          clientId,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        answer?: unknown;
        error?: unknown;
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

      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content: payload.answer.trim(),
          createdAt: new Date().toISOString(),
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

  const canSend = isLoaded && composer.trim().length > 0 && !isSending;

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
            Deutscher Chat für österreichisches Steuerrecht mit DeepSeek BYOK und
            BFG/WeKnora-MCP-Recherche.
          </p>
        </div>
        <div className="status-strip" aria-label="Status">
          <span className={settings.deepSeekApiKey.trim() ? "status ready" : "status missing"}>
            DeepSeek
          </span>
          <span className={settings.mcpBearerToken.trim() ? "status ready" : "status muted"}>
            MCP Token
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
            <label htmlFor="deepseek-key">DeepSeek API Key</label>
            <input
              id="deepseek-key"
              type="password"
              value={settings.deepSeekApiKey}
              onChange={(event) => updateSetting("deepSeekApiKey", event.target.value)}
              autoComplete="off"
              placeholder="sk-..."
            />
            <span className="field-help">Wird nur flüchtig im React-State gehalten und nie persistent gespeichert.</span>
          </div>

          <div className="field-group">
            <label htmlFor="mcp-token">MCP Bearer Token (optional)</label>
            <input
              id="mcp-token"
              type="password"
              value={settings.mcpBearerToken}
              onChange={(event) => updateSetting("mcpBearerToken", event.target.value)}
              autoComplete="off"
              placeholder="Bearer Token"
            />
            <span className="field-help">Ermöglicht den Zugriff auf BFG/WeKnora-MCP-Recherche-Tools.</span>
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
                  {model}
                </option>
              ))}
            </select>
          </div>

          <div className="field-group">
            <label htmlFor="system-prompt">System Prompt</label>
            <textarea
              id="system-prompt"
              value={settings.systemPrompt}
              onChange={(event) => updateSetting("systemPrompt", event.target.value)}
              rows={8}
            />
          </div>

          <button className="secondary-button danger-button" type="button" onClick={clearConversation}>
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
                <p className="message-body">Recherchiert und formuliert die Antwort...</p>
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
              <span>{messages.length} Nachrichten lokal gespeichert</span>
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
