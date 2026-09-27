// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FredLiveView from "./fred-live-view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeChannel extends EventTarget {
  readyState: RTCDataChannelState = "open";
  sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    this.dispatchEvent(new Event("close"));
  }
}

class FakeConnection extends EventTarget {
  static all: FakeConnection[] = [];
  channel = new FakeChannel();
  closed = false;
  connectionState: RTCPeerConnectionState = "new";
  iceGatheringState: RTCIceGatheringState = "complete";
  localDescription: RTCSessionDescriptionInit | null = null;
  constructor() {
    super();
    FakeConnection.all.push(this);
  }
  createDataChannel() {
    return this.channel;
  }
  addTrack() {}
  async createOffer() {
    return { type: "offer" as const, sdp: "v=0" };
  }
  async setLocalDescription(description: RTCSessionDescriptionInit) {
    this.localDescription = description;
  }
  async setRemoteDescription() {
    if (this.closed) throw new DOMException("closed", "InvalidStateError");
  }
  close() {
    this.closed = true;
  }
}

type Pending<T> = { promise: Promise<T>; resolve: (value: T) => void };
function deferred<T>(): Pending<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

type FetchCall = { url: string; init: RequestInit; reply: Pending<Response> };

let calls: FetchCall[];
let microphones: Pending<MediaStream>[];
let tracks: { stop: ReturnType<typeof vi.fn> }[];
let container: HTMLDivElement;
let root: Root;

function nextMicrophone() {
  const track = Object.assign(new EventTarget(), { stop: vi.fn() });
  tracks.push(track);
  return { getTracks: () => [track] } as unknown as MediaStream;
}

async function flush() {
  for (let index = 0; index < 20; index += 1) await act(async () => { await Promise.resolve(); });
}

function buttons() {
  const [start, stop] = Array.from(container.querySelectorAll("button"));
  return { start: start as HTMLButtonElement, stop: stop as HTMLButtonElement };
}

function emit(connection: FakeConnection, event: Record<string, unknown>) {
  connection.channel.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(event) }));
}

function asks() {
  return calls.filter((call) => call.url === "/api/fred-live/ask");
}

async function render(accessToken = "token-1") {
  await act(async () => root.render(<FredLiveView accessToken={accessToken} />));
}

async function startCall() {
  await act(async () => buttons().start.click());
  microphones.at(-1)!.resolve(nextMicrophone());
  await flush();
  calls.at(-1)!.reply.resolve(new Response(JSON.stringify({ sdp: "answer" }), { status: 201 }));
  await flush();
  const connection = FakeConnection.all.at(-1)!;
  await act(async () => emit(connection, { type: "session.started" }));
  return connection;
}

async function askQuestion(connection: FakeConnection, text: string, delegationId: string, atMs: number) {
  await act(async () => {
    emit(connection, { type: "session.input_transcript.delta", delta: text, start_ms: atMs, end_ms: atMs + 100 });
    emit(connection, { type: "session.delegation.created", delegation: { id: delegationId } });
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
}

beforeEach(() => {
  calls = [];
  microphones = [];
  tracks = [];
  FakeConnection.all = [];
  vi.stubGlobal("RTCPeerConnection", FakeConnection);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(() => {
        const microphone = deferred<MediaStream>();
        microphones.push(microphone);
        return microphone.promise;
      }),
    },
  });
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit) => {
    const reply = deferred<Response>();
    calls.push({ url, init, reply });
    return reply.promise;
  }));
  HTMLMediaElement.prototype.play = vi.fn(async () => undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  vi.useRealTimers();
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("FredLiveView call lifecycle", () => {
  it("releases the microphone and starts no session when the view closes during the microphone prompt", async () => {
    await render();
    await act(async () => buttons().start.click());
    await act(async () => root.unmount());
    microphones[0].resolve(nextMicrophone());
    await flush();
    expect(calls).toHaveLength(0);
    expect(tracks[0].stop).toHaveBeenCalled();
    root = createRoot(container);
  });

  it("starts once on a double click and can be stopped while the microphone is still being opened", async () => {
    await render();
    await act(async () => {
      buttons().start.click();
      buttons().start.click();
    });
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(buttons().stop.disabled).toBe(false);
    await act(async () => buttons().stop.click());
    microphones[0].resolve(nextMicrophone());
    await flush();
    expect(calls).toHaveLength(0);
    expect(tracks[0].stop).toHaveBeenCalled();
    expect(buttons().start.disabled).toBe(false);
  });

  it("keeps a restarted call when the session request of the stopped attempt fails late", async () => {
    await render();
    await act(async () => buttons().start.click());
    microphones[0].resolve(nextMicrophone());
    await flush();
    const firstSession = calls[0];
    await act(async () => buttons().stop.click());
    await act(async () => buttons().start.click());
    microphones[1].resolve(nextMicrophone());
    await flush();
    firstSession.reply.resolve(new Response(JSON.stringify({ error: "zu spät" }), { status: 502 }));
    await flush();
    const second = FakeConnection.all[1];
    expect(second.closed).toBe(false);
    expect(tracks[1].stop).not.toHaveBeenCalled();
    expect(container.querySelector("[role=alert]")).toBeNull();
    calls[1].reply.resolve(new Response(JSON.stringify({ sdp: "answer" }), { status: 201 }));
    await flush();
    expect(container.textContent).toContain("Verbinde");
  });

  it("releases the call when the session closes or the connection fails", async () => {
    await render();
    const first = await startCall();
    await act(async () => emit(first, { type: "session.closed", usage: { seconds: 5 } }));
    expect(tracks[0].stop).toHaveBeenCalled();
    expect(buttons().start.disabled).toBe(false);
    expect(container.textContent).toContain("Beendet");

    const second = await startCall();
    await act(async () => {
      second.connectionState = "failed";
      second.dispatchEvent(new Event("connectionstatechange"));
    });
    expect(tracks[1].stop).toHaveBeenCalled();
    expect(buttons().start.disabled).toBe(false);
    expect(container.querySelector("[role=alert]")?.textContent).toContain("unterbrochen");
  });
});

describe("FredLiveView delegations", () => {
  it("asks with the access token current at the time of the question", async () => {
    await render("token-1");
    const connection = await startCall();
    await render("token-2");
    vi.useFakeTimers();
    await askQuestion(connection, "Wie hoch ist die Pendlerpauschale?", "d1", 0);
    expect(asks()).toHaveLength(1);
    expect(asks()[0].init.headers).toMatchObject({ Authorization: "Bearer token-2" });
  });

  it("sends the failed question again when Fred offers the retry", async () => {
    await render();
    const connection = await startCall();
    vi.useFakeTimers();
    await askQuestion(connection, "Wie hoch ist die Pendlerpauschale bei 25 km?", "d1", 0);
    asks()[0].reply.resolve(new Response(JSON.stringify({ error: "Zeitüberschreitung" }), { status: 504 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    await askQuestion(connection, " Ja, bitte versuch es noch einmal.", "d2", 9_000);
    expect(asks()).toHaveLength(2);
    const retried = JSON.parse(String(asks()[1].init.body)) as { question: string };
    expect(retried.question).toContain("Pendlerpauschale bei 25 km");
    expect(retried.question).toContain("noch einmal");
  });

  it("carries the unanswered question into a delegation that replaces it", async () => {
    await render();
    const connection = await startCall();
    vi.useFakeTimers();
    await askQuestion(connection, "Frage eins zur Pendlerpauschale?", "d1", 0);
    await askQuestion(connection, " Und was ist mit dem Pendlereuro?", "d2", 9_000);
    expect(asks()).toHaveLength(2);
    expect((asks()[0].init.signal as AbortSignal).aborted).toBe(true);
    const combined = JSON.parse(String(asks()[1].init.body)) as { question: string };
    expect(combined.question).toContain("Frage eins zur Pendlerpauschale?");
    expect(combined.question).toContain("Pendlereuro");
  });

  it("asks only the new speech after an answered question", async () => {
    await render();
    const connection = await startCall();
    vi.useFakeTimers();
    await askQuestion(connection, "Erste Frage?", "d1", 0);
    asks()[0].reply.resolve(new Response(JSON.stringify({ answer: "Erste Antwort.", upstreamSessionId: "s1" }), { status: 200 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    await askQuestion(connection, " Zweite Frage?", "d2", 9_000);
    const second = JSON.parse(String(asks()[1].init.body)) as { question: string };
    expect(second.question).not.toContain("Erste Frage");
    expect(second.question).toContain("Zweite Frage");
  });
});
