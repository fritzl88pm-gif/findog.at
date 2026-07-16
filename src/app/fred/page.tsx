"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  abortFredRequest,
  beginFredRun,
  invalidateFredRun,
  isCurrentFredRun,
} from "@/lib/fred/abort";
import {
  isTerminalFredEvent,
  parseSseChunk,
  type FredSseEvent,
} from "@/lib/fred/sse";
import Link from "next/link";
import { RichAnswer } from "./rich-answer";
import "./page.css";

type FredMessage = {
  role: "user" | "assistant";
  content: string;
};

type FredSession = {
  token: string;
};

const STATUS_TEXT = "Fred recherchiert …";


export default function FredPage() {
  const [session, setSession] = useState<FredSession | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [messages, setMessages] = useState<FredMessage[]>([]);
  const [composer, setComposer] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [pendingAnswer, setPendingAnswer] = useState("");
  const [assistantMessageId, setAssistantMessageId] = useState<string | null>(
    null,
  );
  const [authLoading, setAuthLoading] = useState(true);

  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const supabase = getSupabaseBrowserClient();

  // Check auth on mount
  useEffect(() => {
    async function checkAuth() {
      setAuthLoading(true);
      try {
        if (!supabase) {
          setIsAuthenticated(false);
          setAuthLoading(false);
          return;
        }
        const {
          data: { session: currentSession },
        } = await supabase.auth.getSession();
        setIsAuthenticated(Boolean(currentSession));
      } catch {
        setIsAuthenticated(false);
      }
      setAuthLoading(false);
    }
    void checkAuth();
  }, [supabase]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [messages, pendingAnswer]);

  useEffect(() => () => {
    invalidateFredRun(runIdRef);
    abortFredRequest(abortRef);
  }, []);

  const startNewChat = useCallback(async () => {
    const runId = beginFredRun(runIdRef);
    abortFredRequest(abortRef);
    setMessages([]);
    setSession(null);
    setSessionError(null);
    setPendingAnswer("");
    setAssistantMessageId(null);
    setIsSending(false);

    if (!supabase) return;

    try {
      const {
        data: { session: currentSession },
      } = await supabase.auth.getSession();
      if (!currentSession?.access_token) {
        setIsAuthenticated(false);
        return;
      }

      const response = await fetch("/api/fred/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${currentSession.access_token}`,
        },
      });

      const payload = (await response.json()) as Record<string, unknown>;

      if (!isCurrentFredRun(runIdRef, runId)) {
        return;
      }

      if (!response.ok) {
        setSessionError(
          typeof payload.error === "string"
            ? payload.error
            : "Fred-Sitzung konnte nicht gestartet werden.",
        );
        return;
      }

      setSession({
        token: payload.token as string,
      });
    } catch {
      if (!isCurrentFredRun(runIdRef, runId)) {
        return;
      }
      setSessionError(
        "Fred-Sitzung konnte nicht gestartet werden. Bitte später erneut versuchen.",
      );
    }
  }, [supabase]);

  // Auto-start session on mount when authenticated
  useEffect(() => {
    if (isAuthenticated === true && !session && !sessionError && supabase) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      startNewChat().catch(() => {
        // Session start errors are handled in startNewChat
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, session, sessionError]);

  const sendQuery = useCallback(
    async (query: string) => {
      if (!session || !supabase) return;
      const runId = beginFredRun(runIdRef);

      const {
        data: { session: currentSession },
      } = await supabase.auth.getSession();
      if (!isCurrentFredRun(runIdRef, runId)) {
        return;
      }
      if (!currentSession?.access_token) {
        setIsAuthenticated(false);
        return;
      }

      setIsSending(true);
      setAssistantMessageId(null);
      setPendingAnswer("");

      const userMessage: FredMessage = { role: "user", content: query };
      setMessages((prev) => [...prev, userMessage]);

      const controller = new AbortController();
      abortRef.current = controller;

      let answerChunks: string[] = [];
      try {
        const response = await fetch("/api/fred/chat", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${currentSession.access_token}`,
            "Content-Type": "application/json",
            "X-Fred-Session-Token": session.token,
          },
          body: JSON.stringify({ query }),
          signal: controller.signal,
        });

        if (!isCurrentFredRun(runIdRef, runId)) {
          await response.body?.cancel().catch(() => undefined);
          return;
        }

        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as Record<
            string,
            unknown
          >;
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                typeof payload.error === "string"
                  ? payload.error
                  : "Fred konnte nicht antworten. Bitte später erneut versuchen.",
            },
          ]);
          setIsSending(false);
          return;
        }

        if (!response.body) {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                "Fred konnte nicht antworten. Bitte später erneut versuchen.",
            },
          ]);
          setIsSending(false);
          return;
        }

        // Read the SSE stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let remainder = "";

        const processEvents = (events: FredSseEvent[]): boolean => {
          if (!isCurrentFredRun(runIdRef, runId)) {
            return true;
          }

          for (const event of events) {
            if (
              event.response_type === "answer" &&
              typeof event.content === "string"
            ) {
              answerChunks.push(event.content);
              setPendingAnswer(answerChunks.join(""));
            } else if (
              event.response_type === "agent_query" &&
              event.assistant_message_id
            ) {
              setAssistantMessageId(event.assistant_message_id);
            } else if (event.response_type === "complete") {
              const finalAnswer = answerChunks.join("");
              setMessages((prev) => [
                ...prev,
                { role: "assistant", content: finalAnswer || "Keine Antwort." },
              ]);
              setPendingAnswer("");
              answerChunks = [];
            } else if (event.response_type === "error") {
              const errorMsg =
                typeof event.content === "string"
                  ? event.content
                  : "Fred konnte nicht antworten.";
              setMessages((prev) => [
                ...prev,
                { role: "assistant", content: errorMsg },
              ]);
              setPendingAnswer("");
              answerChunks = [];
            }

            if (isTerminalFredEvent(event)) {
              return true;
            }
          }
          return false;
        };

        let terminalEventReceived = false;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const parsed = parseSseChunk(
            remainder + decoder.decode(value, { stream: true }),
          );
          remainder = parsed.remainder;
          if (processEvents(parsed.events)) {
            terminalEventReceived = true;
            await reader.cancel().catch(() => undefined);
            break;
          }
        }

        if (!terminalEventReceived) {
          const finalParsed = parseSseChunk(remainder + decoder.decode());
          terminalEventReceived = processEvents(finalParsed.events);
        }

        // If stream ended without complete event, add what we have
        if (!terminalEventReceived && answerChunks.length > 0) {
          const finalAnswer = answerChunks.join("");
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: finalAnswer },
          ]);
          setPendingAnswer("");
        }
      } catch (error) {
        if (!isCurrentFredRun(runIdRef, runId)) {
          return;
        }
        if (error instanceof DOMException && error.name === "AbortError") {
          // User stopped - keep answer so far
          if (answerChunks.length > 0) {
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: answerChunks.join("") },
            ]);
            setPendingAnswer("");
          }
        } else {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                "Fred konnte nicht antworten. Bitte später erneut versuchen.",
            },
          ]);
        }
      }

      if (!isCurrentFredRun(runIdRef, runId)) {
        return;
      }
      setIsSending(false);
      abortRef.current = null;
    },
    [session, supabase],
  );

  const stopQuery = useCallback(async () => {
    abortFredRequest(abortRef);

    // Best-effort stop upstream
    if (session && assistantMessageId && supabase) {
      try {
        const {
          data: { session: currentSession },
        } = await supabase.auth.getSession();
        if (currentSession?.access_token) {
          await fetch("/api/fred/stop", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${currentSession.access_token}`,
              "Content-Type": "application/json",
              "X-Fred-Session-Token": session.token,
            },
            body: JSON.stringify({ messageId: assistantMessageId }),
          });
        }
      } catch {
        // Best-effort
      }
    }
  }, [session, assistantMessageId, supabase]);

  const handleSubmit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const query = composer.trim();
      if (!query || isSending) return;
      setComposer("");
      void sendQuery(query);
    },
    [composer, isSending, sendQuery],
  );

  // Loading state
  if (authLoading || isAuthenticated === null) {
    return (
      <div className="fred-shell">
        <div className="fred-loading">
          <div className="fred-spinner" aria-hidden="true" />
          <p>Wird geladen …</p>
        </div>
      </div>
    );
  }

  // Unauthenticated state
  if (isAuthenticated === false) {
    return (
      <div className="fred-shell">
        <div className="fred-unauthorized">
          <h1>Fred – Steuerassistent</h1>
          <p>
            Bitte melde dich an, um Fred zu nutzen.
          </p>
          <Link href="/" className="fred-primary-button">
            Anmelden
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="fred-shell">
      <header className="fred-header">
        <div className="fred-header-left">
          <h1 className="fred-title">Fred</h1>
          <p className="fred-subtitle">Steuerassistent</p>
        </div>
        <nav className="fred-header-nav">
          <Link href="/" className="fred-header-link">
            Zurück zur App
          </Link>
          <button
            type="button"
            className="fred-header-button"
            onClick={() => void startNewChat()}
            disabled={isSending}
          >
            Neuer Chat
          </button>
        </nav>
      </header>

      <div className="fred-conversation" ref={transcriptRef}>
        {messages.length === 0 && !isSending && !sessionError ? (
          <div className="fred-empty-state">
            <div className="fred-empty-icon" aria-hidden="true">🤖</div>
            <h2>Fred – Steuerassistent</h2>
            <p>
              Stelle eine Frage zum österreichischen Steuerrecht. Fred
              durchsucht die Findok-Datenbank und relevante Quellen.
            </p>
          </div>
        ) : null}

        {sessionError ? (
          <div className="fred-error-banner" role="alert">
            {sessionError}
          </div>
        ) : null}

        {messages.map((msg, idx) => (
          <article
            className={`fred-message fred-message-${msg.role}`}
            key={`msg-${idx}`}
          >
            <div className="fred-message-header">
              <span className="fred-message-avatar">
                {msg.role === "user" ? "DU" : "F"}
              </span>
              <span className="fred-message-sender">
                {msg.role === "user" ? "Du" : "Fred"}
              </span>
            </div>
            {msg.role === "assistant" ? (
              <RichAnswer content={msg.content} />
            ) : (
              <p className="fred-message-body">{msg.content}</p>
            )}
          </article>
        ))}

        {isSending ? (
          <article className="fred-message fred-message-assistant fred-message-pending">
            <div className="fred-message-header">
              <span className="fred-message-avatar">F</span>
              <span className="fred-message-sender">Fred</span>
            </div>
            {pendingAnswer ? (
              <RichAnswer content={pendingAnswer} />
            ) : (
              <p className="fred-message-body fred-status-text">
                {STATUS_TEXT}
              </p>
            )}
          </article>
        ) : null}
      </div>

      <div className="fred-composer-container">
        <form className="fred-composer" onSubmit={handleSubmit}>
          <label className="fred-sr-only" htmlFor="fred-question">
            Frage an Fred
          </label>
          <textarea
            ref={composerRef}
            id="fred-question"
            value={composer}
            onChange={(e) => setComposer(e.target.value)}
            placeholder="Frage zum Steuerrecht…"
            rows={2}
            disabled={isSending || !session}
          />
          <div className="fred-composer-actions">
            {isSending ? (
              <button
                type="button"
                className="fred-stop-button"
                onClick={() => void stopQuery()}
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                className="fred-send-button"
                disabled={!composer.trim() || !session}
              >
                Senden
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
