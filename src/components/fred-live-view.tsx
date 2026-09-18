"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  describeFredLiveStartError,
  fredLiveDelegationReply,
  isFredLiveConnectionActive,
  reduceFredLiveEvent,
  type FredLiveTranscriptState,
  waitForIceGathering,
} from "@/lib/fred-live-client";

export default function FredLiveView({ accessToken }: { accessToken: string }) {
  const [liveState, setLiveState] = useState<FredLiveTranscriptState>({ status: "Bereit", transcript: [] });
  const [error, setError] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const connectionRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stop = useCallback(() => {
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
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const connection = new RTCPeerConnection();
      const channel = connection.createDataChannel("oai-events");
      const update = (event: MessageEvent) => {
        try {
          const parsed = JSON.parse(event.data) as Record<string, unknown>;
          setLiveState((current) => reduceFredLiveEvent(current, parsed));
          const reply = fredLiveDelegationReply(parsed);
          if (reply && channel.readyState === "open") {
            channel.send(JSON.stringify(reply));
          }
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
        <audio ref={audioRef} autoPlay />
      </div>
    </section>
  );
}
