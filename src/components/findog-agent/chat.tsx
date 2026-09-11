"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import styles from "./findog-agent.module.css";
import {
  findogAgentRequest,
  FindogAgentApiError,
  isFindogAgentAccessDenied,
  type FindogAgentConversationDto,
  type FindogAgentConversationListDto,
  type FindogAgentConversationViewDto,
  type FindogAgentEventPageDto,
  type FindogAgentRunDto,
  type FindogAgentRunEventDto,
  type FindogAgentSourceDto,
} from "./client";

const HISTORY_LIMIT = 20;
const MESSAGE_LIMIT = 50;
const EVENT_LIMIT = 200;
const MAX_RENDERED_EVENTS = 400;
const POLL_INTERVAL_MS = 1500;
const MAX_POLL_BACKOFF_MS = 15000;
const STORAGE_KEY = "findog-agent:active-conversation";
const TERMINAL_STATES: readonly FindogAgentRunDto["state"][] = ["succeeded", "failed", "cancelled"];

/**
 * The identity of a submission the server may already have accepted. It is kept
 * across transport failures so an idempotent retry reuses the same key *and* the
 * same conversation, and so a successfully accepted run is never re-generated.
 */
type PendingSubmission = {
  question: string;
  key: string;
  conversationId: string;
  run: FindogAgentRunDto | null;
};

const RUN_STATE_LABELS: Record<FindogAgentRunDto["state"], string> = {
  queued: "In der Warteschlange",
  running: "Recherche läuft",
  succeeded: "Abgeschlossen",
  failed: "Fehlgeschlagen",
  cancelled: "Abgebrochen",
};

const SOURCE_KIND_LABELS: Record<FindogAgentSourceDto["kind"], string> = {
  knowledge: "Wissensdatenbank",
  wiki: "Wiki",
  web: "Web",
  mcp: "MCP",
};

const COVERAGE_LABELS: Record<string, string> = {
  reported: "vom Anbieter gemeldet",
  estimated: "geschätzt",
  unknown: "unbekannt",
  uncovered: "nicht erfasst",
  unused: "nicht genutzt",
};

function isRunActive(run: FindogAgentRunDto | null): boolean {
  return run !== null && !TERMINAL_STATES.includes(run.state);
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "unbekannt";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "unbekannt" : parsed.toLocaleString("de-AT");
}

/** Unknown usage is never rendered as zero. */
function formatCount(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("de-AT") : "unbekannt";
}

function formatUsd(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(4)} USD` : "unbekannt";
}

function textValue(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value ? value : null;
}

/** Splits bracket citations such as `[src_2]` into focusable buttons. */
function renderAnswerText(content: string, onCitation: (sourceId: string) => void) {
  return content.split(/(\[[^[\]]*\])/g).map((part, index) => {
    const group = /^\[([^[\]]*)\]$/.exec(part);
    if (!group) {
      return <span key={index}>{part}</span>;
    }
    return (
      <span key={index}>
        {"["}
        {(group[1] ?? "").split(/(src_[0-9]+)/g).map((token, tokenIndex) => (
          /^src_[0-9]+$/.test(token)
            ? (
              <button
                key={tokenIndex}
                type="button"
                className={styles.citation}
                onClick={() => onCitation(token)}
                aria-label={`Quelle ${token} anzeigen`}
              >
                {token}
              </button>
            )
            : <span key={tokenIndex}>{token}</span>
        ))}
        {"]"}
      </span>
    );
  });
}

function RunDetails({ usage, cost }: { usage: FindogAgentRunDto["usage"]; cost: FindogAgentRunDto["cost"] }) {
  if (!usage && !cost) {
    return null;
  }
  return (
    <>
      {usage ? (
        <dl className={styles.definitionList}>
          <div><dt>Modellaufrufe</dt><dd>{formatCount(usage.modelCalls)}</dd></div>
          <div><dt>Eingabe-Tokens</dt><dd>{formatCount(usage.promptTokens)}</dd></div>
          <div><dt>Ausgabe-Tokens</dt><dd>{formatCount(usage.completionTokens)}</dd></div>
          <div><dt>Werkzeugaufrufe</dt><dd>{formatCount(usage.toolCalls)}</dd></div>
          <div><dt>Wissensabrufe</dt><dd>{formatCount(usage.knowledgeRetrievals)}</dd></div>
          <div><dt>Webabrufe</dt><dd>{formatCount(usage.webRetrievals)}</dd></div>
          <div><dt>MCP-Aufrufe</dt><dd>{formatCount(usage.mcpCalls)}</dd></div>
        </dl>
      ) : null}
      {cost ? (
        <dl className={styles.definitionList}>
          <div><dt>Kosten (geschätzt)</dt><dd>{formatUsd(cost.totalEstimatedUsd)}</dd></div>
          <div><dt>Kostenlimit</dt><dd>{cost.limitUsd === null || cost.limitUsd === undefined ? "kein Limit" : `${formatUsd(cost.limitUsd)} (${cost.limitStatus ?? "unbekannt"})`}</dd></div>
          <div><dt>Modell</dt><dd>{COVERAGE_LABELS[cost.coverage?.model ?? "unknown"] ?? "unbekannt"}</dd></div>
          <div><dt>Websuche</dt><dd>{COVERAGE_LABELS[cost.coverage?.web ?? "unknown"] ?? "unbekannt"}</dd></div>
          <div><dt>Wissensdatenbank</dt><dd>{COVERAGE_LABELS[cost.coverage?.knowledge ?? "unknown"] ?? "unbekannt"}</dd></div>
          <div><dt>MCP</dt><dd>{COVERAGE_LABELS[cost.coverage?.mcp ?? "unknown"] ?? "unbekannt"}</dd></div>
        </dl>
      ) : null}
      <p className={styles.hint}>
        Kostenangaben sind Schätzungen, keine Abrechnung. „nicht erfasst“ bedeutet, dass der
        Anbieter keine Kostendaten liefert.
      </p>
    </>
  );
}

export default function FindogAgentChat({ accessToken }: { accessToken: string }) {
  const [conversations, setConversations] = useState<FindogAgentConversationDto[] | null>(null);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<FindogAgentConversationViewDto["messages"] | null>(null);
  const [messagesTruncated, setMessagesTruncated] = useState(false);
  const [run, setRun] = useState<FindogAgentRunDto | null>(null);
  const [events, setEvents] = useState<FindogAgentRunEventDto[]>([]);
  const [finishedRuns, setFinishedRuns] = useState<Record<string, FindogAgentRunDto>>({});
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState("");
  const [reconnecting, setReconnecting] = useState(false);
  const [selected, setSelected] = useState<{ runId: string; sourceId: string } | null>(null);
  const cursorRef = useRef(0);
  const pendingRef = useRef<PendingSubmission | null>(null);
  // Bumped on every explicit view selection. Async responses only mutate state
  // while their captured token is still the current one, so a slow earlier
  // navigation can never overwrite a later choice.
  const viewRef = useRef(0);
  const runId = run?.id ?? null;
  const runState = run?.state ?? null;
  const active = isRunActive(run);

  const fail = useCallback((caught: unknown) => {
    if (isFindogAgentAccessDenied(caught)) {
      // A revoked session must not leave any previously loaded agent data behind.
      setDenied(true);
      setConversations(null);
      setMessages(null);
      setRun(null);
      setEvents([]);
      setFinishedRuns({});
      setSelected(null);
      setReconnecting(false);
      setConversationId(null);
      sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
    setError(caught instanceof Error ? caught.message : "Die Anfrage ist fehlgeschlagen.");
  }, []);

  const refreshHistory = useCallback(async (signal?: AbortSignal) => {
    const token = viewRef.current;
    const list = await findogAgentRequest<FindogAgentConversationListDto>(
      accessToken,
      `/conversations?limit=${HISTORY_LIMIT}`,
      { signal },
    );
    if (token === viewRef.current) {
      setConversations(list.conversations);
      setHistoryHasMore(list.hasMore);
    }
    return list.conversations;
  }, [accessToken]);

  /** Reads one run (live or historical) and caches it for citation/usage display. */
  const loadFinishedRun = useCallback(async (targetRunId: string, signal?: AbortSignal) => {
    const loaded = await findogAgentRequest<{ run: FindogAgentRunDto }>(
      accessToken,
      `/runs/${targetRunId}`,
      { signal },
    );
    setFinishedRuns((previous) => ({ ...previous, [targetRunId]: loaded.run }));
  }, [accessToken]);

  /**
   * Applies a freshly read conversation view only while it still belongs to the
   * active selection. Returns whether the view was applied.
   */
  const applyConversationView = useCallback((
    view: FindogAgentConversationViewDto,
    token: number,
    fallbackRun: FindogAgentRunDto | null = null,
  ): boolean => {
    if (token !== viewRef.current) {
      return false;
    }
    setConversationId(view.conversation.id);
    setMessages(view.messages);
    setMessagesTruncated(view.messagesTruncated);
    setRun(view.activeRun ?? fallbackRun);
    setEvents([]);
    setSelected(null);
    setReconnecting(false);
    cursorRef.current = 0;
    sessionStorage.setItem(STORAGE_KEY, view.conversation.id);
    return true;
  }, []);

  const openConversation = useCallback(async (targetId: string, signal?: AbortSignal) => {
    // Selecting a conversation is an explicit intent: it fences every older
    // observation and abandons any no-longer-relevant pending submission.
    const token = ++viewRef.current;
    pendingRef.current = null;
    try {
      const view = await findogAgentRequest<FindogAgentConversationViewDto>(
        accessToken,
        `/conversations/${targetId}?limit=${MESSAGE_LIMIT}`,
        { signal },
      );
      if (!applyConversationView(view, token)) {
        return;
      }
      if (!view.activeRun) {
        // Reopening a finished conversation recovers the last answer's stored
        // sources and usage from its own run, not from the current run.
        const lastAnswer = [...view.messages].reverse().find((message) => message.role === "assistant" && message.runId);
        if (lastAnswer?.runId) {
          try {
            await loadFinishedRun(lastAnswer.runId, signal);
          } catch (caught) {
            if (token === viewRef.current && !signal?.aborted) {
              fail(caught);
            }
          }
        }
      }
    } catch (caught) {
      if (token === viewRef.current && !signal?.aborted) {
        fail(caught);
      }
    }
  }, [accessToken, applyConversationView, fail, loadFinishedRun]);

  /**
   * Adopts a run the server accepted. The canonical conversation id and the run
   * are applied *before* the conversation read, so a failing read can neither
   * lose the accepted run nor invite a second generation for the same key.
   */
  const adoptAcceptedRun = useCallback(async (accepted: FindogAgentRunDto, token: number) => {
    if (token !== viewRef.current) {
      return;
    }
    setConversationId(accepted.conversationId);
    setRun(accepted);
    setSelected(null);
    cursorRef.current = 0;
    sessionStorage.setItem(STORAGE_KEY, accepted.conversationId);
    const view = await findogAgentRequest<FindogAgentConversationViewDto>(
      accessToken,
      `/conversations/${accepted.conversationId}?limit=${MESSAGE_LIMIT}`,
      {},
    );
    applyConversationView(view, token, accepted);
  }, [accessToken, applyConversationView]);

  /** Adopts a terminal run together with its freshly read conversation view. */
  const adoptFinishedRun = useCallback(async (finished: FindogAgentRunDto, signal?: AbortSignal, token?: number) => {
    const current = token ?? viewRef.current;
    const view = await findogAgentRequest<FindogAgentConversationViewDto>(
      accessToken,
      `/conversations/${finished.conversationId}?limit=${MESSAGE_LIMIT}`,
      { signal },
    );
    if (current !== viewRef.current) {
      return;
    }
    setMessages(view.messages);
    setMessagesTruncated(view.messagesTruncated);
    setSelected(null);
    setFinishedRuns((previous) => ({ ...previous, [finished.id]: finished }));
    setRun(finished);
    void refreshHistory().catch((caught) => {
      if (current === viewRef.current) {
        fail(caught);
      }
    });
  }, [accessToken, fail, refreshHistory]);

  // Mount/remount and token change: history + active run are re-read, never re-posted.
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const list = await refreshHistory(controller.signal);
        const stored = sessionStorage.getItem(STORAGE_KEY);
        const restored = list.find((entry) => entry.id === stored) ?? list[0] ?? null;
        if (restored) {
          await openConversation(restored.id, controller.signal);
        } else {
          setConversationId(null);
          sessionStorage.removeItem(STORAGE_KEY);
        }
      } catch (caught) {
        if (!controller.signal.aborted) {
          fail(caught);
        }
      }
    })();
    return () => controller.abort();
  }, [fail, openConversation, refreshHistory]);

  // Polling resumes from the stored cursor, so a remount continues an active run
  // instead of starting a second one. Unmounting only aborts polling. A failed
  // *observation* is retried with bounded backoff; only a lost authorization or
  // a permanently missing run stops the loop.
  useEffect(() => {
    if (!conversationId || !runId || !runState || TERMINAL_STATES.includes(runState)) {
      return;
    }
    const controller = new AbortController();
    const token = viewRef.current;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    const wait = (ms: number) => new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
    });
    (async () => {
      while (!controller.signal.aborted && token === viewRef.current) {
        try {
          let batch: FindogAgentEventPageDto;
          do {
            batch = await findogAgentRequest<FindogAgentEventPageDto>(
              accessToken,
              `/runs/${runId}/events?afterSequence=${cursorRef.current}&limit=${EVENT_LIMIT}`,
              { signal: controller.signal },
            );
            if (token !== viewRef.current) {
              return;
            }
            if (batch.events.length > 0) {
              cursorRef.current = batch.events[batch.events.length - 1]!.sequence;
              setEvents((previous) => [...previous, ...batch.events].slice(-MAX_RENDERED_EVENTS));
            }
          } while (batch.hasMore && !controller.signal.aborted && token === viewRef.current);

          const status = await findogAgentRequest<{ run: FindogAgentRunDto }>(
            accessToken,
            `/runs/${runId}`,
            { signal: controller.signal },
          );
          if (token !== viewRef.current) {
            return;
          }
          failures = 0;
          setReconnecting(false);
          if (TERMINAL_STATES.includes(status.run.state)) {
            await adoptFinishedRun(status.run, controller.signal, token);
            return;
          }
          setRun(status.run);
        } catch (caught) {
          if (controller.signal.aborted || token !== viewRef.current) {
            return;
          }
          const errorStatus = caught instanceof FindogAgentApiError ? caught.status : null;
          // Revoked access and permanently missing runs never recover.
          if (isFindogAgentAccessDenied(caught) || errorStatus === 404 || errorStatus === 410) {
            fail(caught);
            return;
          }
          failures += 1;
          setReconnecting(true);
          await wait(Math.min(POLL_INTERVAL_MS * 2 ** (failures - 1), MAX_POLL_BACKOFF_MS));
          continue;
        }
        await wait(POLL_INTERVAL_MS);
      }
    })();
    return () => {
      controller.abort();
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [accessToken, conversationId, runId, runState, fail, adoptFinishedRun]);

  async function send() {
    const question = draft.trim();
    if (!question || sending || active) {
      return;
    }
    let pending = pendingRef.current;
    if (!pending || pending.question !== question) {
      pending = { question, key: crypto.randomUUID(), conversationId: conversationId ?? crypto.randomUUID(), run: null };
      pendingRef.current = pending;
    }
    let submission = pending;
    const token = viewRef.current;
    const isNewConversation = !conversationId;
    setSending(true);
    setError("");
    try {
      let acceptedRun = submission.run;
      if (!acceptedRun) {
        const accepted = await findogAgentRequest<{ run: FindogAgentRunDto }>(accessToken, "/runs", {
          method: "POST",
          body: {
            conversationId: submission.conversationId,
            question: submission.question,
            idempotencyKey: submission.key,
            conversationTitle: isNewConversation ? question.slice(0, 120) : null,
          },
        });
        // The server is authoritative: an idempotent replay returns the original
        // run, whose conversation may differ from the locally generated id.
        acceptedRun = accepted.run;
        submission = { ...submission, run: acceptedRun, conversationId: acceptedRun.conversationId };
        pendingRef.current = submission;
      }
      await adoptAcceptedRun(acceptedRun, token);
      if (token === viewRef.current) {
        if (pendingRef.current === submission) {
          pendingRef.current = null;
        }
        setDraft("");
      }
      await refreshHistory();
    } catch (caught) {
      if (token === viewRef.current) {
        fail(caught);
      }
    } finally {
      setSending(false);
    }
  }

  async function stop() {
    if (!run || !active || stopping) {
      return;
    }
    const token = viewRef.current;
    setStopping(true);
    setError("");
    try {
      const cancelled = await findogAgentRequest<{ run: FindogAgentRunDto }>(
        accessToken,
        `/runs/${run.id}/stop`,
        { method: "POST" },
      );
      await adoptFinishedRun(cancelled.run, undefined, token);
    } catch (caught) {
      if (token === viewRef.current) {
        fail(caught);
      }
    } finally {
      setStopping(false);
    }
  }

  function startNewConversation() {
    if (active || sending) {
      return;
    }
    viewRef.current += 1;
    setConversationId(null);
    setMessages([]);
    setMessagesTruncated(false);
    setRun(null);
    setEvents([]);
    setSelected(null);
    setReconnecting(false);
    setError("");
    setDraft("");
    pendingRef.current = null;
    cursorRef.current = 0;
    sessionStorage.removeItem(STORAGE_KEY);
  }

  function openCitation(sourceId: string, messageRunId: string | null) {
    if (!messageRunId) {
      setError("Zu dieser Antwort ist kein Lauf gespeichert.");
      return;
    }
    setSelected({ runId: messageRunId, sourceId });
    void loadFinishedRun(messageRunId).catch(fail);
  }

  // Both the live run and the loaded run results resolve citations for the
  // message they belong to; a historical message never borrows the current run.
  const runById = new Map<string, FindogAgentRunDto>(Object.entries(finishedRuns));
  if (run) {
    runById.set(run.id, run);
  }
  const selectedRun = selected ? runById.get(selected.runId) ?? null : null;
  const selectedSource = selected
    ? selectedRun?.result?.sources?.find((source) => source.id === selected.sourceId) ?? null
    : null;

  const latestPlan = [...events].reverse().find((event) => event.kind === "plan");
  const planSteps = Array.isArray(latestPlan?.payload.steps)
    ? latestPlan.payload.steps.map(String)
    : run?.result?.plan?.steps ?? [];
  const toolActivity = events
    .filter((event) => event.kind === "tool_call" || event.kind === "tool_result")
    .slice(-8)
    .map((event) => {
      const tool = textValue(event.payload, "tool") ?? "Werkzeug";
      if (event.kind === "tool_call") {
        return `${tool} wird aufgerufen`;
      }
      if (event.payload.ok === false) {
        return `${tool}: Fehler (${textValue(event.payload, "errorCode") ?? "unbekannt"})`;
      }
      const summary = textValue(event.payload, "summary");
      return summary ? `${tool}: ${summary}` : `${tool}: abgeschlossen`;
    });
  const liveSources = events.filter((event) => event.kind === "source").slice(-12);
  const latestStatus = [...events].reverse().find((event) => event.kind === "status");
  const phase = textValue(latestStatus?.payload ?? {}, "phase");
  const notices = run?.result?.notices ?? [];

  if (denied) {
    return (
      <section className={styles.panel} aria-labelledby="findog-agent-chat-title">
        <div className={styles.header}>
          <div className={styles.headerText}>
            <h2 id="findog-agent-chat-title">Findog Agent (Preview)</h2>
            <p>Recherche-Agent für Administratoren.</p>
          </div>
        </div>
        <p className={styles.error} role="alert">
          Die Administrationsberechtigung für den Findog Agent wurde entzogen. Es werden keine
          Unterhaltungen mehr angezeigt.
        </p>
      </section>
    );
  }

  return (
    <section className={styles.panel} aria-labelledby="findog-agent-chat-title">
      <div className={styles.header}>
        <div className={styles.headerText}>
          <h2 id="findog-agent-chat-title">Findog Agent (Preview)</h2>
          <p>
            Eigene Unterhaltungen mit belegten Antworten. Läufe sind dauerhaft und werden nach einem
            Neuladen weiter verfolgt, ohne die Frage erneut zu senden.
          </p>
        </div>
        <span className={`${styles.badge} ${active ? styles.badgeActive : ""}`}>
          {run ? RUN_STATE_LABELS[run.state] : "Bereit"}
        </span>
      </div>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {run?.state === "failed" && run.error ? (
        <p className={styles.error} role="alert">Der Lauf ist fehlgeschlagen: {run.error.message}</p>
      ) : null}
      {notices.map((notice) => (
        <p className={styles.notice} key={notice.code}>{notice.message}</p>
      ))}
      {reconnecting ? (
        <p className={styles.notice} role="status">
          Die Verbindung wurde unterbrochen. Der Lauf wird ohne erneutes Senden weiter verfolgt.
        </p>
      ) : null}

      <div className={styles.layout}>
        <details className={styles.history}>
          <summary>
            Verlauf{conversations ? ` (${conversations.length})` : ""}
          </summary>
          <div className={styles.historyBody}>
            <button
              type="button"
              className={styles.primary}
              onClick={startNewConversation}
              disabled={active || sending}
            >
              Neue Unterhaltung
            </button>
            <ul className={styles.historyList}>
              {(conversations ?? []).map((conversation) => (
                <li key={conversation.id}>
                  <button
                    type="button"
                    aria-current={conversation.id === conversationId}
                    onClick={() => {
                      if (conversation.id !== conversationId) {
                        void openConversation(conversation.id);
                      }
                    }}
                  >
                    <strong>{conversation.title ?? "Ohne Titel"}</strong>
                    <span>{formatTimestamp(conversation.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {conversations && conversations.length === 0 ? (
              <p className={styles.hint}>Noch keine Unterhaltung gespeichert.</p>
            ) : null}
            {historyHasMore ? (
              <p className={styles.hint}>
                Es werden nur die letzten {HISTORY_LIMIT} Unterhaltungen geladen. Ältere
                Unterhaltungen sind in dieser Liste nicht enthalten.
              </p>
            ) : null}
          </div>
        </details>

        <div className={styles.thread}>
          {messages === null ? (
            <p className={styles.empty} role="status">Unterhaltungen werden geladen …</p>
          ) : messages.length === 0 ? (
            <p className={styles.empty}>
              Noch keine Frage in dieser Unterhaltung. Formuliere unten deine erste Recherchefrage.
            </p>
          ) : (
            <ul className={styles.messages}>
              {messages.map((message) => {
                const details = message.runId ? runById.get(message.runId) ?? null : null;
                const result = details?.result ?? null;
                return (
                  <li
                    key={message.id}
                    className={`${styles.message} ${message.role === "user" ? styles.messageUser : ""}`}
                  >
                    <span className={styles.messageRole}>
                      {message.role === "user" ? "Frage" : "Antwort"}
                    </span>
                    <p className={styles.messageText}>
                      {message.role === "user"
                        ? message.content
                        : renderAnswerText(message.content, (sourceId) => openCitation(sourceId, message.runId))}
                    </p>
                    {message.role === "assistant" && result?.sources?.length ? (
                      <ul className={styles.sourceList}>
                        {result.sources.map((source) => (
                          <li key={source.id}>
                            <button
                              type="button"
                              className={styles.sourceButton}
                              onClick={() => openCitation(source.id, message.runId)}
                            >
                              {source.title}
                              <small>
                                {source.id} · {SOURCE_KIND_LABELS[source.kind]} · {source.provider}
                                {source.truncated ? " · gekürzt gespeichert" : ""}
                              </small>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {message.role === "assistant" ? (
                      <RunDetails usage={details?.usage ?? null} cost={details?.cost ?? null} />
                    ) : null}
                    <span className={styles.messageMeta}>{formatTimestamp(message.createdAt)}</span>
                  </li>
                );
              })}
            </ul>
          )}

          {messagesTruncated ? (
            <p className={styles.hint} role="status">
              Es werden nur die letzten {MESSAGE_LIMIT} Nachrichten dieser Unterhaltung angezeigt.
              Ältere Nachrichten sind hier nicht geladen.
            </p>
          ) : null}

          {active || planSteps.length > 0 || toolActivity.length > 0 ? (
            <section className={styles.activity} aria-live="polite">
              <h3>Aktivität{run ? ` · ${RUN_STATE_LABELS[run.state]}` : ""}</h3>
              {phase ? <p className={styles.hint}>Aktuelle Phase: {phase}</p> : null}
              {planSteps.length > 0 ? (
                <ol>
                  {planSteps.map((step, index) => (
                    // Plan steps are plain strings from the run event; the index is the plan position.
                    <li key={`${index}-${step}`}>{step}</li>
                  ))}
                </ol>
              ) : (
                <p className={styles.hint}>Noch kein Arbeitsplan veröffentlicht.</p>
              )}
              {toolActivity.length > 0 ? (
                <ul>
                  {toolActivity.map((line, index) => <li key={index}>{line}</li>)}
                </ul>
              ) : null}
              {liveSources.length > 0 ? (
                <ul className={styles.chips}>
                  {liveSources.map((event) => (
                    <li key={event.sequence}>
                      {textValue(event.payload, "id")} · {textValue(event.payload, "title") ?? "Quelle"}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className={styles.hint}>
                Ein unfertiger Entwurf wird nicht angezeigt. Die Antwort erscheint erst, wenn der
                Lauf abgeschlossen ist.
              </p>
            </section>
          ) : null}

          {selected ? (
            <section className={styles.sourcePanel} aria-live="polite">
              <h3>Beleg {selected.sourceId}</h3>
              {selectedSource ? (
                <>
                  <p className={styles.subHeading}><strong>{selectedSource.title}</strong></p>
                  <dl className={styles.definitionList}>
                    <div><dt>Art</dt><dd>{SOURCE_KIND_LABELS[selectedSource.kind]}</dd></div>
                    <div><dt>Quelle</dt><dd>{selectedSource.provider}</dd></div>
                    <div><dt>Abgerufen</dt><dd>{formatTimestamp(selectedSource.retrievedAt)}</dd></div>
                    <div>
                      <dt>Vollständigkeit</dt>
                      <dd>{selectedSource.truncated ? "gekürzt gespeichert" : "vollständig gespeichert"}</dd>
                    </div>
                    {Object.entries(selectedSource.provenance).map(([key, value]) => (
                      <div key={key}><dt>{key}</dt><dd>{value}</dd></div>
                    ))}
                  </dl>
                  {selectedSource.url ? (
                    <a href={selectedSource.url} target="_blank" rel="noreferrer noopener">
                      In der Originalquelle öffnen
                    </a>
                  ) : (
                    <p className={styles.hint}>Für diesen Beleg ist keine Original-URL gespeichert.</p>
                  )}
                  <pre className={styles.excerpt}>{selectedSource.text}</pre>
                </>
              ) : (
                <p className={styles.hint}>
                  {selectedRun
                    ? "Dieser Beleg ist im gespeicherten Laufergebnis nicht enthalten."
                    : "Der zugehörige Lauf wird geladen …"}
                </p>
              )}
              <div className={styles.actions}>
                <button type="button" className={styles.secondary} onClick={() => setSelected(null)}>
                  Beleg schließen
                </button>
              </div>
            </section>
          ) : null}

          <form
            className={styles.composer}
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <label htmlFor="findog-agent-question">Frage an den Findog Agent</label>
            <textarea
              id="findog-agent-question"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                  event.preventDefault();
                  void send();
                }
              }}
              disabled={sending || active}
              aria-describedby="findog-agent-composer-hint"
            />
            <div className={styles.actions}>
              <button className={styles.primary} type="submit" disabled={sending || active || !draft.trim()}>
                {sending ? "Wird gesendet …" : "Frage senden"}
              </button>
              <button className={styles.danger} type="button" onClick={() => void stop()} disabled={!active || stopping}>
                {stopping ? "Wird abgebrochen …" : "Stopp"}
              </button>
            </div>
            <p className={styles.hint} id="findog-agent-composer-hint">
              Strg/⌘ + Enter sendet. „Stopp“ beendet nur den Lauf; die Frage bleibt im Verlauf
              erhalten, ein unfertiger Entwurf wird verworfen.
            </p>
          </form>
        </div>
      </div>
    </section>
  );
}
