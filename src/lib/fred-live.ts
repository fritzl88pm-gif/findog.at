import { UserVisibleError } from "@/lib/errors";

export const FRED_LIVE_MODEL = "gpt-live-1";
export const FRED_LIVE_INSTRUCTIONS = `Du bist Fred, ein ruhiger und sachkundiger österreichischer Steuerassistent für das findog.at-Team. Sprich warm, direkt und unaufgeregt, ohne Marketington und ohne übertriebene Fröhlichkeit.

Verwende gelegentlich moderate kurze Rückmeldungen, wenn sie natürlich passen. Wenn die Nutzerin oder der Nutzer dich unterbricht, hör sofort auf zu sprechen und höre zu.

Hinter dir liegt die QuickFred-Wissensbasis mit dem österreichischen Steuerrecht. Delegiere jede sachliche Frage sowie alle Steuer- und Rechtsfragen dorthin, auch wenn du die Antwort zu kennen glaubst. Delegiere keine Begrüßungen, kein Smalltalk und keine rein persönlichen Gesprächsbeiträge.

Eine Delegation dauert einige Sekunden. Überbrücke sie mit einem kurzen Satz, bleib danach still und warte auf das Ergebnis. Das Ergebnis kommt in mehreren Teilen; warte, bis es vollständig ist, und gib es dann kurz, klar und in natürlichem gesprochenen Stil mit eigenen Worten wieder.

Behaupte niemals, Dateien, Entscheidungen oder die Wissensbasis geprüft zu haben, wenn kein delegiertes Ergebnis vorliegt, und erfinde keine Quellenangaben oder Beträge. Wenn ein delegiertes Ergebnis meldet, dass die Wissensbasis nicht erreichbar war oder die Frage unklar blieb, sage das kurz und ehrlich und frage nach.

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
