"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  describeFredLiveStartError,
  fredLiveAskBody,
  fredLiveDelegationFollowUp,
  fredLiveDelegationReply,
  FRED_LIVE_QUESTION_GRACE_MS,
  fredLiveQuestionFromTranscript,
  isFredLiveConnectionActive,
  reduceFredLiveEvent,
  type FredLiveTranscriptState,
  waitForIceGathering,
} from "@/lib/fred-live-client";

export default function FredLiveView({ accessToken }: { accessToken: string }) {
  const [liveState, setLiveState] = useState<FredLiveTranscriptState>({ status: "Bereit", transcript: [] });
  const [error, setError] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [sources, setSources] = useState<{ title: string; channel?: string; knowledgeBaseId?: string }[]>([]);
  const liveStateRef = useRef(liveState);
  const delegationAbortRef = useRef<AbortController | null>(null);
  const transcriptCursorRef = useRef(0);
  const upstreamSessionRef = useRef("");
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
    setIsRunning(false);
  }, []);

  useEffect(() => stop, [stop]);

  const start = async () => {
    if (isRunning) return;
    setError("");
    setLiveState({ status: "Mikrofon wird vorbereitet…", transcript: [] });
    liveStateRef.current = { status: "Mikrofon wird vorbereitet…", transcript: [] };
    setSources([]);
    transcriptCursorRef.current = 0;
    upstreamSessionRef.current = "";
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const connection = new RTCPeerConnection();
      const channel = connection.createDataChannel("oai-events");
      const sendCommentary = (payload: ReturnType<typeof fredLiveDelegationFollowUp>[number]) => {
        if (channel.readyState === "open") channel.send(JSON.stringify(payload));
      };
      const handleDelegation = async (parsed: Record<string, unknown>) => {
        const delegation = parsed.delegation as { id?: unknown } | undefined;
        const delegationId = typeof delegation?.id === "string" ? delegation.id : "";
        if (!delegationId) return;
        delegationAbortRef.current?.abort();
        const controller = new AbortController();
        delegationAbortRef.current = controller;
        const fromIndex = transcriptCursorRef.current;
        transcriptCursorRef.current = liveStateRef.current.transcript.length;
        const interim = fredLiveDelegationFollowUp(delegationId, "")[0];
        sendCommentary(interim);
        try {
          await new Promise<void>((resolve, reject) => {
            const timeout = window.setTimeout(resolve, FRED_LIVE_QUESTION_GRACE_MS);
            const abort = () => {
              window.clearTimeout(timeout);
              reject(controller.signal.reason ?? new DOMException("Aborted", "AbortError"));
            };
            controller.signal.addEventListener("abort", abort, { once: true });
          });
          const question = fredLiveQuestionFromTranscript(liveStateRef.current.transcript, fromIndex);
          if (!question) throw new Error("empty-question");
          const response = await fetch("/api/fred-live/ask", {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify(fredLiveAskBody(question, upstreamSessionRef.current || undefined)),
            signal: controller.signal,
          });
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
          const [, answer] = fredLiveDelegationFollowUp(delegationId, payload.answer);
          sendCommentary(answer);
          setSources(Array.isArray(payload.sources) ? payload.sources.filter((source): source is { title: string; channel?: string; knowledgeBaseId?: string } => Boolean(source && typeof source === "object" && typeof (source as { title?: unknown }).title === "string")) : []);
        } catch (error) {
          if (!controller.signal.aborted) {
            sendCommentary({ type: "session.commentary.append", event_id: `fred-live-error-${delegationId}`, delegation_id: delegationId, content: "Ich konnte die Wissensbasis gerade nicht erreichen. Bitte versuche es später noch einmal." });
            setError(error instanceof Error && error.message !== "empty-question" ? error.message : "Die delegierte Frage war leer.");
          }
        } finally {
          if (delegationAbortRef.current === controller) delegationAbortRef.current = null;
        }
      };
      const update = (event: MessageEvent) => {
        try {
          const parsed = JSON.parse(event.data) as Record<string, unknown>;
          const nextState = reduceFredLiveEvent(liveStateRef.current, parsed);
          liveStateRef.current = nextState;
          setLiveState(nextState);
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
