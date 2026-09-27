"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  collectFredLiveQuestion,
  describeFredLiveStartError,
  fredLiveAnswerCommentary,
  fredLiveAskBody,
  fredLiveDelegationId,
  fredLiveDelegationReply,
  fredLiveErrorMessage,
  fredLiveGreetingCommentary,
  fredLiveInterimCommentary,
  fredLiveNoticeCommentary,
  fredLiveQuestionFromTranscript,
  fredLiveUserTranscript,
  FRED_LIVE_BACKEND_ERROR_REPLY,
  FRED_LIVE_EMPTY_QUESTION_REPLY,
  isFredLiveConnectionActive,
  reduceFredLiveEvent,
  runFredLiveFillers,
  type FredLiveAppendEvent,
  type FredLiveTranscriptState,
  waitForIceGathering,
} from "@/lib/fred-live-client";

type FredLiveSource = { title: string; channel?: string; knowledgeBaseId?: string };

const FRED_LIVE_CONNECT_TIMEOUT_MS = 30_000;

function isFredLiveSource(value: unknown): value is FredLiveSource {
  return Boolean(value && typeof value === "object" && typeof (value as { title?: unknown }).title === "string");
}

export default function FredLiveView({ accessToken }: { accessToken: string }) {
  const [liveState, setLiveState] = useState<FredLiveTranscriptState>({ status: "Bereit", transcript: [] });
  const [error, setError] = useState("");
  const [activity, setActivity] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [sources, setSources] = useState<FredLiveSource[]>([]);
  const liveStateRef = useRef(liveState);
  const delegationAbortRef = useRef<AbortController | null>(null);
  const transcriptCursorRef = useRef(0);
  const upstreamSessionRef = useRef("");
  const greetedRef = useRef(false);
  const connectionRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Every start is one attempt; stop and unmount end it, so an attempt still waiting for the
  // microphone, ICE or the session request sees that it is stale and releases what it opened.
  const attemptRef = useRef(0);
  const runningRef = useRef(false);
  // Where the question of the delegation being answered begins in the user transcript; a failed
  // or superseded ask gives it back, so the retry or the follow-up still carries that question.
  const pendingQuestionStartRef = useRef<number | null>(null);
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The token is read when a request is sent: Supabase refreshes it during a long call.
  const accessTokenRef = useRef(accessToken);

  useEffect(() => {
    accessTokenRef.current = accessToken;
  }, [accessToken]);

  const stop = useCallback(() => {
    attemptRef.current += 1;
    runningRef.current = false;
    if (connectTimerRef.current) clearTimeout(connectTimerRef.current);
    connectTimerRef.current = null;
    delegationAbortRef.current?.abort();
    delegationAbortRef.current = null;
    pendingQuestionStartRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    channelRef.current?.close();
    channelRef.current = null;
    connectionRef.current?.close();
    connectionRef.current = null;
    if (audioRef.current) audioRef.current.srcObject = null;
    setActivity("");
    setIsRunning(false);
  }, []);

  useEffect(() => stop, [stop]);

  const start = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    const attempt = ++attemptRef.current;
    const isCurrent = () => attemptRef.current === attempt;
    setIsRunning(true);
    setError("");
    setActivity("");
    setLiveState({ status: "Mikrofon wird vorbereitet…", transcript: [] });
    liveStateRef.current = { status: "Mikrofon wird vorbereitet…", transcript: [] };
    setSources([]);
    transcriptCursorRef.current = 0;
    pendingQuestionStartRef.current = null;
    upstreamSessionRef.current = "";
    greetedRef.current = false;
    let stream: MediaStream | null = null;
    let connection: RTCPeerConnection | null = null;
    let channel: RTCDataChannel | null = null;
    // Releases only what this attempt opened; a newer attempt's session stays untouched.
    const releaseAttempt = () => {
      stream?.getTracks().forEach((track) => track.stop());
      channel?.close();
      connection?.close();
    };
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!isCurrent()) {
        releaseAttempt();
        return;
      }
      const liveStream = stream;
      const liveConnection = new RTCPeerConnection();
      connection = liveConnection;
      const liveChannel = liveConnection.createDataChannel("oai-events");
      channel = liveChannel;
      // A call that ends by itself (connection lost, session closed, microphone gone) is released
      // like a stop, so the microphone is not held and Starten works again.
      const endLive = (message?: string) => {
        if (!isCurrent()) return;
        stop();
        setLiveState((current) => (current.status === "Beendet" ? current : { ...current, status: "Beendet" }));
        if (message) setError(message);
      };
      const sendCommentary = (payload: FredLiveAppendEvent) => {
        if (liveChannel.readyState !== "open") {
          throw new Error("Die Live-Verbindung zu Fred ist unterbrochen.");
        }
        liveChannel.send(JSON.stringify(payload));
      };
      const handleDelegation = async (parsed: Record<string, unknown>) => {
        const delegationId = fredLiveDelegationId(parsed);
        if (!delegationId) return;
        // A delegation that arrives while the previous question is still being answered replaces
        // it; the previous question is read again together with the new speech.
        if (delegationAbortRef.current && pendingQuestionStartRef.current !== null) {
          transcriptCursorRef.current = pendingQuestionStartRef.current;
        }
        pendingQuestionStartRef.current = null;
        delegationAbortRef.current?.abort();
        const controller = new AbortController();
        delegationAbortRef.current = controller;
        const fillers = new AbortController();
        const stopFillers = () => fillers.abort();
        controller.signal.addEventListener("abort", stopFillers, { once: true });
        try {
          // Fred keeps the floor while the knowledge base runs; without this the line falls silent.
          sendCommentary(fredLiveInterimCommentary(delegationId));
          // The knowledge base takes seconds, so the wait is filled with spaced short lines.
          void runFredLiveFillers({
            delegationId,
            signal: fillers.signal,
            send: (filler) => {
              try {
                sendCommentary(filler);
              } catch {
                stopFillers();
              }
            },
          });
          setActivity("Frage wird aus dem Gesprächsverlauf gelesen…");
          const question = await collectFredLiveQuestion({
            readQuestion: () =>
              fredLiveQuestionFromTranscript(liveStateRef.current.transcript, transcriptCursorRef.current),
            signal: controller.signal,
          });
          if (!question) {
            setActivity("");
            sendCommentary(fredLiveNoticeCommentary(delegationId, FRED_LIVE_EMPTY_QUESTION_REPLY));
            return;
          }
          pendingQuestionStartRef.current = transcriptCursorRef.current;
          transcriptCursorRef.current = fredLiveUserTranscript(liveStateRef.current.transcript).length;
          setActivity(`Wissensbasis wird gefragt: „${question}“`);
          const response = await fetch("/api/fred-live/ask", {
            method: "POST",
            headers: { Authorization: `Bearer ${accessTokenRef.current}`, "Content-Type": "application/json" },
            body: JSON.stringify(fredLiveAskBody(question, upstreamSessionRef.current || undefined)),
            signal: controller.signal,
          });
          stopFillers();
          const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
          if (!response.ok || typeof payload.answer !== "string") {
            if (response.status === 404 || response.status === 405) {
              if (delegationAbortRef.current === controller) pendingQuestionStartRef.current = null;
              sendCommentary(fredLiveDelegationReply(parsed)!);
              return;
            }
            throw new Error(typeof payload.error === "string" ? payload.error : "Die Wissensbasis ist derzeit nicht verfügbar.");
          }
          if (delegationAbortRef.current === controller) pendingQuestionStartRef.current = null;
          if (typeof payload.upstreamSessionId === "string" && payload.upstreamSessionId) {
            upstreamSessionRef.current = payload.upstreamSessionId;
          }
          // A single append above the provider limit is dropped unspoken, so the answer is
          // handed over in several appends that share the delegation id.
          const appends = fredLiveAnswerCommentary(delegationId, payload.answer);
          if (appends.length === 0) throw new Error("Die Wissensbasis hat eine leere Antwort geliefert.");
          for (const append of appends) sendCommentary(append);
          setActivity(appends.length > 1
            ? `Antwort an Fred übergeben (${appends.length} Teile).`
            : "Antwort an Fred übergeben.");
          setSources(Array.isArray(payload.sources) ? payload.sources.filter(isFredLiveSource) : []);
        } catch (delegationError) {
          if (controller.signal.aborted) return;
          // Fred offers to try again; the retry has to reach the knowledge base with this question.
          if (delegationAbortRef.current === controller && pendingQuestionStartRef.current !== null) {
            transcriptCursorRef.current = pendingQuestionStartRef.current;
            pendingQuestionStartRef.current = null;
          }
          setActivity("");
          setError(delegationError instanceof Error && delegationError.message
            ? delegationError.message
            : "Die Wissensbasis konnte die Frage nicht beantworten.");
          try {
            sendCommentary(fredLiveNoticeCommentary(delegationId, FRED_LIVE_BACKEND_ERROR_REPLY));
          } catch {
            // The data channel is gone; the message above already explains the failure.
          }
        } finally {
          stopFillers();
          controller.signal.removeEventListener("abort", stopFillers);
          if (delegationAbortRef.current === controller) delegationAbortRef.current = null;
        }
      };
      const update = (event: MessageEvent) => {
        if (!isCurrent()) return;
        try {
          const parsed = JSON.parse(event.data) as Record<string, unknown>;
          const nextState = reduceFredLiveEvent(liveStateRef.current, parsed);
          liveStateRef.current = nextState;
          setLiveState(nextState);
          const liveError = fredLiveErrorMessage(parsed);
          if (liveError) setError(liveError);
          if (parsed.type === "session.started" && connectTimerRef.current) {
            clearTimeout(connectTimerRef.current);
            connectTimerRef.current = null;
          }
          if (parsed.type === "session.closed") {
            endLive();
            return;
          }
          if (parsed.type === "session.started" && !greetedRef.current) {
            greetedRef.current = true;
            try {
              sendCommentary(fredLiveGreetingCommentary());
            } catch {
              // The channel closed before the greeting; the status line already shows the state.
            }
          }
          if (parsed.type === "session.delegation.created") void handleDelegation(parsed);
        } catch {
          setError("Ein Live-Ereignis konnte nicht verarbeitet werden.");
        }
      };
      liveChannel.addEventListener("message", update);
      liveChannel.addEventListener("close", () => endLive("Die Live-Verbindung zu Fred wurde unterbrochen."));
      liveConnection.addEventListener("connectionstatechange", () => {
        if (liveConnection.connectionState === "failed" || liveConnection.connectionState === "closed") {
          endLive("Die Live-Verbindung zu Fred wurde unterbrochen.");
        }
      });
      liveConnection.addEventListener("track", (event) => {
        if (audioRef.current && event.streams[0]) {
          audioRef.current.srcObject = event.streams[0];
          void audioRef.current.play().catch(() => undefined);
        }
      });
      liveStream.getTracks().forEach((track) => {
        track.addEventListener("ended", () => endLive("Das Mikrofon ist nicht mehr verfügbar."));
        liveConnection.addTrack(track, liveStream);
      });
      streamRef.current = liveStream;
      connectionRef.current = liveConnection;
      channelRef.current = liveChannel;
      const offer = await liveConnection.createOffer();
      if (!isCurrent()) return releaseAttempt();
      await liveConnection.setLocalDescription(offer);
      if (!isCurrent()) return releaseAttempt();
      await waitForIceGathering(liveConnection, 10_000);
      if (!isCurrent() || !isFredLiveConnectionActive(connectionRef.current, liveConnection)) return releaseAttempt();
      const localSdp = liveConnection.localDescription?.sdp;
      if (!localSdp) throw new Error("SDP fehlt");
      setLiveState((current) => ({ ...current, status: "Live-Sitzung wird gestartet…" }));
      const response = await fetch("/api/fred-live/session", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessTokenRef.current}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sdp: localSdp }),
      });
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!isCurrent()) return releaseAttempt();
      if (!response.ok || typeof payload.sdp !== "string") {
        throw new Error(typeof payload.error === "string" ? payload.error : "Fred Live konnte nicht gestartet werden.");
      }
      await liveConnection.setRemoteDescription({ type: "answer", sdp: payload.sdp });
      if (!isCurrent()) return releaseAttempt();
      setLiveState((current) => ({ ...current, status: "Verbinde…" }));
      // Without session.started the call never begins (for example when UDP is blocked).
      connectTimerRef.current = setTimeout(() => {
        connectTimerRef.current = null;
        endLive("Die Live-Verbindung zu Fred konnte nicht aufgebaut werden.");
      }, FRED_LIVE_CONNECT_TIMEOUT_MS);
    } catch (startError) {
      if (!isCurrent()) {
        releaseAttempt();
        return;
      }
      stop();
      setLiveState((current) => ({ ...current, status: "Bereit" }));
      setError(describeFredLiveStartError(startError));
    }
  };

  return (
    <section className="forms-panel" aria-labelledby="fred-live-title">
      <div className="forms-view">
        <header className="forms-view-header">
          <p className="eyebrow">Admin</p>
          <h1 id="fred-live-title">Fred Live</h1>
          <p>Gesprochene Live-Unterhaltung mit Fred.</p>
        </header>
        <div className="form-actions">
          <button className="primary-button" type="button" onClick={() => void start()} disabled={isRunning || !accessToken}>Starten</button>
          <button className="secondary-button" type="button" onClick={stop} disabled={!isRunning}>Stoppen</button>
        </div>
        <p aria-live="polite">
          Status: {liveState.status}
          {liveState.usageSeconds !== undefined ? ` · ${liveState.usageSeconds} s` : ""}
        </p>
        {activity ? <p aria-live="polite">Wissensbasis: {activity}</p> : null}
        {error ? <div className="error-box" role="alert">{error}</div> : null}
        <ol aria-label="Gesprächsprotokoll">
          {liveState.transcript.map((row, index) => (
            <li key={`${index}-${row.speaker}-${row.startMs}`}>{row.speaker}: {row.text}</li>
          ))}
        </ol>
        {sources.length > 0 ? <div aria-label="Verwendete Quellen"><p>Quellen</p><ul>{sources.map((source, index) => <li key={`${source.title}-${index}`}>{source.title}</li>)}</ul></div> : null}
        <audio ref={audioRef} autoPlay />
      </div>
    </section>
  );
}
