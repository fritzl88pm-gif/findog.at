"use client";

import Image from "next/image";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import {
  parseFredNativeStreamLine,
  type FredNativeConversation,
} from "@/lib/fred-native-stream";
import { getWelcomeGreeting } from "@/lib/chat/welcome";

export type FredNativeMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

type FredNativeChatViewProps = {
  accessToken: string;
  conversationId: string;
  initialMessages: FredNativeMessage[];
  externalError?: string;
  renderAssistantContent: (content: string) => ReactNode;
  renderUserContent: (content: string) => ReactNode;
  onConversationUpdated: (
    conversation: FredNativeConversation,
    messages: FredNativeMessage[],
  ) => void;
};

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("de-AT", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function responseError(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const error = (payload as Record<string, unknown>).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return fallback;
}

export default function FredNativeChatView({
  accessToken,
  conversationId,
  initialMessages,
  externalError = "",
  renderAssistantContent,
  renderUserContent,
  onConversationUpdated,
}: FredNativeChatViewProps) {
  const [messages, setMessages] = useState<FredNativeMessage[]>(initialMessages);
  const [composer, setComposer] = useState("");
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [welcomeGreeting] = useState(() => getWelcomeGreeting());
  const activeConversationIdRef = useRef(conversationId);
  const abortControllerRef = useRef<AbortController | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (conversationId === activeConversationIdRef.current) return;
    activeConversationIdRef.current = conversationId;
    setMessages(initialMessages);
    setComposer("");
    setError("");
  }, [conversationId, initialMessages]);

  useEffect(() => () => abortControllerRef.current?.abort(), []);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    transcript.scrollTop = transcript.scrollHeight;
  }, [messages]);

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const query = composer.trim();
    if (!query || isSending || !accessToken) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const userMessage: FredNativeMessage = {
      role: "user",
      content: query,
      createdAt: new Date().toISOString(),
    };
    const assistantMessage: FredNativeMessage = {
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
    };
    const baseMessages = [...messages, userMessage];
    setMessages([...baseMessages, assistantMessage]);
    setComposer("");
    setError("");
    setIsSending(true);

    let answer = "";
    let receivedFinal = false;
    try {
      const response = await fetch("/api/fred/chat", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          Accept: "application/x-ndjson",
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          conversationId: activeConversationIdRef.current || undefined,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as unknown;
        throw new Error(responseError(payload, "Fred konnte die Anfrage nicht verarbeiten."));
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Der Fred-Antwortstream konnte nicht gelesen werden.");
      const decoder = new TextDecoder();
      let buffer = "";

      const processLine = (line: string) => {
        const streamEvent = parseFredNativeStreamLine(line);
        if (!streamEvent) return;
        if (streamEvent.type === "error") throw new Error(streamEvent.error);
        if (streamEvent.type === "conversation") {
          activeConversationIdRef.current = streamEvent.conversation.id;
          onConversationUpdated(streamEvent.conversation, baseMessages);
          return;
        }
        if (streamEvent.type === "delta") {
          answer += streamEvent.content;
          const updatedAssistant = { ...assistantMessage, content: answer };
          setMessages([...baseMessages, updatedAssistant]);
          return;
        }
        answer = streamEvent.answer;
        receivedFinal = true;
        activeConversationIdRef.current = streamEvent.conversation.id;
        const completedMessages = [
          ...baseMessages,
          { ...assistantMessage, content: streamEvent.answer },
        ];
        setMessages(completedMessages);
        onConversationUpdated(streamEvent.conversation, completedMessages);
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) processLine(line);
      }
      buffer += decoder.decode();
      processLine(buffer);
      if (!answer.trim()) throw new Error("Fred hat keine Antwort geliefert.");
      if (!receivedFinal) throw new Error("Der Fred-Antwortstream wurde ohne Abschluss beendet.");
    } catch (sendError) {
      if (!controller.signal.aborted) {
        setError(sendError instanceof Error
          ? sendError.message
          : "Fred konnte die Anfrage nicht abschließen.");
      }
      if (!answer) setMessages(baseMessages);
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
      setIsSending(false);
    }
  }

  function stopAnswer() {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsSending(false);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void sendMessage();
    }
  }

  return (
    <section className="fred-native-panel" aria-label="Fred">
      <header className="fred-embed-hero">
        <Image
          className="fred-embed-hero-image"
          src="/fred.png"
          alt="Fred, der Findog-Assistent"
          width={380}
          height={380}
          priority
        />
        <h1 className="fred-embed-greeting">{welcomeGreeting}</h1>
      </header>

      <div className="fred-native-chat-shell">
        <div className="transcript fred-native-transcript" ref={transcriptRef} aria-live="polite">
          <div className="transcript-content">
            {messages.length === 0 ? (
              <div className="fred-native-empty">
                <p>Frag Fred zu österreichischem Steuerrecht und den verfügbaren Rechtsquellen.</p>
              </div>
            ) : messages.map((message, index) => (
              <article
                className={`message ${message.role}${isSending && index === messages.length - 1 ? " pending" : ""}`}
                key={`${message.createdAt}-${index}`}
              >
                <div className="message-header">
                  {message.role === "user" ? (
                    <div className="message-avatar">DU</div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="message-avatar fred-avatar" src="/fred-avatar.png" alt="" />
                  )}
                  <div className="message-meta">
                    <span className="sender-name">{message.role === "user" ? "Du" : "Fred"}</span>
                    <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
                  </div>
                </div>
                {message.role === "assistant"
                  ? (message.content
                    ? renderAssistantContent(message.content)
                    : <p className="message-body">Fred denkt nach …</p>)
                  : renderUserContent(message.content)}
              </article>
            ))}
          </div>
        </div>

        <div className="composer-container fred-native-composer-container">
          {error || externalError ? (
            <div className="error-box composer-error" role="alert">{error || externalError}</div>
          ) : null}
          <form className="composer" onSubmit={(event) => void sendMessage(event)}>
            <textarea
              value={composer}
              onChange={(event) => setComposer(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="Frag Fred …"
              aria-label="Nachricht an Fred"
              disabled={isSending || !accessToken}
              rows={2}
            />
            <div className="composer-toolbar">
              <span className="fred-native-composer-note">Enter zum Senden · Shift + Enter für neue Zeile</span>
              <div className="composer-actions">
                {isSending ? (
                  <button className="secondary-button" type="button" onClick={stopAnswer}>
                    Stoppen
                  </button>
                ) : null}
                <button
                  className="composer-send-button"
                  type="submit"
                  disabled={!composer.trim() || isSending || !accessToken}
                >
                  Senden
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
