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
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
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
      <section className="hero" aria-label="Findog/Fred">
        <div className="hero-copy">
          <p className="eyebrow">findog.at</p>
          <h1>Findog/Fred</h1>
          <p>
            Deutscher Chat fuer oesterreichisches Steuerrecht mit DeepSeek BYOK und
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
      </section>

      <section className="workspace" aria-label="Chat">
        <aside className={settingsOpen ? "settings-panel open" : "settings-panel"}>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Einstellungen</p>
              <h2>Lokale Konfiguration</h2>
            </div>
            <button
              className="icon-button"
              type="button"
              onClick={() => setSettingsOpen((current) => !current)}
              aria-label={settingsOpen ? "Einstellungen ausblenden" : "Einstellungen anzeigen"}
              title={settingsOpen ? "Einstellungen ausblenden" : "Einstellungen anzeigen"}
            >
              {settingsOpen ? "×" : "⚙"}
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

          <button className="secondary-button" type="button" onClick={clearConversation}>
            Verlauf leeren
          </button>
        </aside>

        <section className="chat-panel">
          <div className="chat-toolbar">
            <div>
              <p className="eyebrow">Chat</p>
              <h2>BFG- und Steuerrechtsrecherche</h2>
            </div>
            <button
              className="secondary-button compact"
              type="button"
              onClick={() => setSettingsOpen((current) => !current)}
            >
              Einstellungen
            </button>
          </div>

          {error ? (
            <div className="error-box" role="alert" aria-live="polite">
              {error}
            </div>
          ) : null}

          <div className="transcript" ref={transcriptRef}>
            {messages.length === 0 ? (
              <div className="empty-state">
                <h3>Neue Anfrage</h3>
                <p>Stelle eine konkrete steuerrechtliche Frage mit Sachverhalt und Zeitraum.</p>
              </div>
            ) : (
              messages.map((message, index) => (
                <article className={`message ${message.role}`} key={`${message.createdAt}-${index}`}>
                  <div className="message-meta">
                    <span>{message.role === "user" ? "Du" : "Findog/Fred"}</span>
                    <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
                  </div>
                  <p>{message.content}</p>
                </article>
              ))
            )}

            {isSending ? (
              <article className="message assistant pending" aria-live="polite">
                <div className="message-meta">
                  <span>Findog/Fred</span>
                </div>
                <p>Recherchiert und formuliert die Antwort...</p>
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
                {isSending ? "Senden..." : "Senden"}
              </button>
            </div>
          </form>
        </section>
      </section>
    </main>
  );
}
