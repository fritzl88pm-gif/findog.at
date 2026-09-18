import { UserVisibleError } from "@/lib/errors";

export const FRED_LIVE_MODEL = "gpt-live-1";
export const FRED_LIVE_INSTRUCTIONS = `Du bist Fred, ein ruhiger und sachkundiger österreichischer Steuerassistent für das findog.at-Team. Sprich warm, direkt und unaufgeregt, ohne Marketington und ohne übertriebene Fröhlichkeit.

Verwende gelegentlich moderate kurze Rückmeldungen, wenn sie natürlich passen. Wenn die Nutzerin oder der Nutzer dich unterbricht, hör sofort auf zu sprechen und höre zu.

Delegiere sachliche Fragen sowie Steuer- und Rechtsfragen an den Backend-Agenten. Delegiere keine Begrüßungen, kein Smalltalk und keine rein persönlichen Gesprächsbeiträge. Wenn ein delegiertes Ergebnis zurückkommt, antworte kurz, klar und in einem natürlichen gesprochenen Stil.

Behaupte niemals, Dateien, Entscheidungen oder die Wissensbasis geprüft zu haben, wenn kein delegiertes Ergebnis vorliegt, und erfinde keine Quellenangaben oder Beträge. Wenn eine Frage Dokumente oder Recherche erfordert und die Delegation nicht verfügbar ist, sage kurz und ehrlich, dass dies in dieser Version nicht verfügbar ist.

Formuliere deine Antworten frei; es gibt keine vorgeschriebenen Formulierungen und keine Vorgabe für eine bestimmte Antwortlänge.`;

const LIVE_SESSIONS_URL = "https://api.openai.com/v1/live/sessions";

export function buildFredLiveSessionConfig() {
  return {
    model: FRED_LIVE_MODEL,
    instructions: FRED_LIVE_INSTRUCTIONS,
    delegation: { type: "client" as const },
  };
}

export function resolveFredLiveApiKey(): string | null {
  return process.env.OPENAI_LIVE_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || null;
}

export async function createFredLiveSession({
  sdp,
  apiKey,
  fetchImpl = fetch,
}: {
  sdp: string;
  apiKey?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<{ sessionId: string; sdp: string }> {
  const key = apiKey?.trim() || null;
  if (!key) {
    throw new UserVisibleError("Fred Live ist derzeit nicht verfügbar.", 503);
  }
  if (typeof sdp !== "string" || !sdp.trim()) {
    throw new UserVisibleError("Die WebRTC-Anfrage ist ungültig.", 400);
  }

  let response: Response;
  try {
    response = await fetchImpl(LIVE_SESSIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: buildFredLiveSessionConfig(),
        transport: { type: "webrtc", sdp },
      }),
    });
  } catch {
    throw new UserVisibleError("Fred Live konnte nicht gestartet werden.", 502);
  }

  if (!response.ok) {
    throw new UserVisibleError("Fred Live konnte nicht gestartet werden.", 502);
  }

  try {
    const payload = await response.json() as {
      session?: { id?: unknown };
      transport?: { sdp?: unknown };
    };
    if (typeof payload.session?.id !== "string" || !payload.session.id.trim()
      || typeof payload.transport?.sdp !== "string" || !payload.transport.sdp.trim()) {
      throw new Error("invalid response");
    }
    return { sessionId: payload.session.id, sdp: payload.transport.sdp };
  } catch {
    throw new UserVisibleError("Fred Live konnte nicht gestartet werden.", 502);
  }
}
