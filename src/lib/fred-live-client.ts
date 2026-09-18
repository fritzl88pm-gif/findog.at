export type FredLiveTranscriptState = {
  status: string;
  transcript: FredLiveTranscriptEntry[];
  usage?: unknown;
  turnClosed?: boolean;
};

export type FredLiveTranscriptEntry = { speaker: string; text: string };

export function fredLiveSpeakerFor(type: string): "Fred" | "Du" | undefined {
  if (type.startsWith("response.")) return "Fred";
  if (type.includes("input_audio_transcription") || type.startsWith("conversation.item.input")) return "Du";
  return undefined;
}

export function isFredLiveConnectionActive(
  activeConnection: RTCPeerConnection | null,
  capturedConnection: RTCPeerConnection,
): boolean {
  return activeConnection === capturedConnection;
}

export function waitForIceGathering(
  connection: RTCPeerConnection,
  timeoutMs: number,
): Promise<void> {
  if (connection.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      connection.removeEventListener("icegatheringstatechange", handleStateChange);
      reject(new Error("ICE gathering timeout"));
    }, timeoutMs);
    const handleStateChange = () => {
      if (connection.iceGatheringState !== "complete") return;
      clearTimeout(timeout);
      connection.removeEventListener("icegatheringstatechange", handleStateChange);
      resolve();
    };
    connection.addEventListener("icegatheringstatechange", handleStateChange);
  });
}

export function reduceFredLiveEvent(
  state: FredLiveTranscriptState,
  event: Record<string, unknown>,
): FredLiveTranscriptState {
  const type = typeof event.type === "string" ? event.type : "";
  if (type === "session.started") return { ...state, status: "Verbunden" };
  if (type === "session.closed") return { ...state, status: "Beendet", usage: event.usage };
  if (
    type.endsWith("transcript.done") || type.endsWith("transcript.completed") ||
    type.endsWith("transcription.done") || type.endsWith("transcription.completed")
  ) {
    return { ...state, turnClosed: true };
  }
  if (!type.endsWith("transcript.delta") && !type.endsWith("transcription.delta")) return state;
  const text = typeof event.delta === "string" ? event.delta : typeof event.text === "string" ? event.text : "";
  if (!text) return state;
  const transcript = [...state.transcript];
  const speaker = fredLiveSpeakerFor(type);
  const last = transcript[transcript.length - 1];
  if (!state.turnClosed && last && (!speaker || last.speaker === speaker)) {
    transcript[transcript.length - 1] = { ...last, text: `${last.text}${text}` };
  } else {
    transcript.push({ speaker: speaker ?? "", text });
  }
  return { ...state, transcript, turnClosed: false };
}
