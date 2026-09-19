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

  const stop = useCallback(() => {
    delegationAbortRef.current?.abort();
    delegationAbortRef.current = null;
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
    if (isRunning) return;
    setError("");
    setActivity("");
    setLiveState({ status: "Mikrofon wird vorbereitet…", transcript: [] });
    liveStateRef.current = { status: "Mikrofon wird vorbereitet…", transcript: [] };
    setSources([]);
    transcriptCursorRef.current = 0;
    upstreamSessionRef.current = "";
    greetedRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const connection = new RTCPeerConnection();
      const channel = connection.createDataChannel("oai-events");
      const sendCommentary = (payload: FredLiveAppendEvent) => {
        if (channel.readyState !== "open") {
          throw new Error("Die Live-Verbindung zu Fred ist unterbrochen.");
        }
        channel.send(JSON.stringify(payload));
      };
      const handleDelegation = async (parsed: Record<string, unknown>) => {
        const delegationId = fredLiveDelegationId(parsed);
        if (!delegationId) return;
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
          transcriptCursorRef.current = fredLiveUserTranscript(liveStateRef.current.transcript).length;
          setActivity(`Wissensbasis wird gefragt: „${question}“`);
          const response = await fetch("/api/fred-live/ask", {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify(fredLiveAskBody(question, upstreamSessionRef.current || undefined)),
            signal: controller.signal,
          });
          stopFillers();
          const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
          if (!response.ok || typeof payload.answer !== "string") {
            if (response.status === 404 || response.status === 405) {
              sendCommentary(fredLiveDelegationReply(parsed)!);
              return;
            }
            throw new Error(typeof payload.error === "string" ? payload.error : "Die Wissensbasis ist derzeit nicht verfügbar.");
          }
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
        try {
          const parsed = JSON.parse(event.data) as Record<string, unknown>;
          const nextState = reduceFredLiveEvent(liveStateRef.current, parsed);
          liveStateRef.current = nextState;
          setLiveState(nextState);
          const liveError = fredLiveErrorMessage(parsed);
          if (liveError) setError(liveError);
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
      channel.addEventListener("message", update);
      connection.addEventListener("track", (event) => {
        if (audioRef.current && event.streams[0]) {
          audioRef.current.srcObject = event.streams[0];
          void audioRef.current.play().catch(() => undefined);
        }
      });
      stream.getTracks().forEach((track) => connection.addTrack(track, stream));
      streamRef.current = stream;
      connectionRef.current = connection;
      channelRef.current = channel;
      setIsRunning(true);
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      await waitForIceGathering(connection, 10_000);
      const localSdp = connection.localDescription?.sdp;
      if (!localSdp) throw new Error("SDP fehlt");
      setLiveState((current) => ({ ...current, status: "Live-Sitzung wird gestartet…" }));
      if (!isFredLiveConnectionActive(connectionRef.current, connection)) {
        stream.getTracks().forEach((track) => track.stop());
        channel.close();
        connection.close();
        return;
      }
      const response = await fetch("/api/fred-live/session", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sdp: localSdp }),
      });
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok || typeof payload.sdp !== "string") {
        throw new Error(typeof payload.error === "string" ? payload.error : "Fred Live konnte nicht gestartet werden.");
      }
      await connection.setRemoteDescription({ type: "answer", sdp: payload.sdp });
      setLiveState((current) => ({ ...current, status: "Verbinde…" }));
    } catch (startError) {
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
