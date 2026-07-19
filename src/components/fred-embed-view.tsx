"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import { getWelcomeGreeting } from "@/lib/chat/welcome";

const EMBED_TOKEN_ENDPOINT = "/api/fred/embed-token";
const EMBED_ORIGIN = "https://taxdog.cloud";
const HOST_SOURCE = "weknora-host";
const EMBED_SOURCE = "weknora-embed";
const TOKEN_REQUEST_TIMEOUT_MS = 10_000;
const INITIAL_RETRY_DELAYS_MS = [1_000, 3_000] as const;
const REFRESH_RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000] as const;
const REFRESH_EXPIRY_MARGIN_MS = 5_000;
const EMBED_READY_TIMEOUT_MS = 20_000;
const CHANNEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const SESSION_TOKEN_PATTERN = /^ems_[A-Za-z0-9_-]{16,512}$/u;
const CREDENTIALLESS_IFRAME_ATTRIBUTE = { credentialless: "" } as const;

type FredEmbedViewProps = {
  accessToken: string;
  onConversationUpdated?: (conversation: {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
  }) => void;
};

type EmbedConfig = {
  channelId: string;
  embedOrigin: typeof EMBED_ORIGIN;
};

type EmbedToken = EmbedConfig & {
  token: string;
  expiresIn: number;
};

type ViewPhase = "loading" | "ready" | "error";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseEmbedToken(value: unknown): EmbedToken | null {
  if (!isRecord(value)) {
    return null;
  }

  const token = typeof value.token === "string" ? value.token.trim() : "";
  const channelId = typeof value.channelId === "string" ? value.channelId.trim() : "";
  const expiresIn = value.expiresIn;
  if (
    !SESSION_TOKEN_PATTERN.test(token)
    || !CHANNEL_ID_PATTERN.test(channelId)
    || value.embedOrigin !== EMBED_ORIGIN
    || typeof expiresIn !== "number"
    || !Number.isSafeInteger(expiresIn)
    || expiresIn < 60
    || expiresIn > 3_600
  ) {
    return null;
  }

  return { token, expiresIn, channelId, embedOrigin: EMBED_ORIGIN };
}

function retryMessage(status: number): string {
  if (status === 401) {
    return "Deine Anmeldung ist abgelaufen. Bitte melde dich erneut an.";
  }
  if (status === 429) {
    return "Fred ist derzeit ausgelastet. Bitte versuche es gleich noch einmal.";
  }
  return "Fred konnte nicht geladen werden. Bitte versuche es erneut.";
}

function FredEmbedUnavailable({ message }: { message: string }) {
  return (
    <section className="fred-embed-panel" aria-label="Fred">
      <div className="fred-embed-frame-shell">
        <div className="fred-embed-state fred-embed-state--error" role="alert">
          <h1>Fred ist gerade nicht erreichbar</h1>
          <p>{message}</p>
        </div>
      </div>
    </section>
  );
}

function FredEmbedSession({
  accessToken,
  onConversationUpdated,
  onRetry,
}: FredEmbedViewProps & { onRetry: () => void }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const tokenRef = useRef("");
  const configRef = useRef<EmbedConfig | null>(null);
  const [config, setConfig] = useState<EmbedConfig | null>(null);
  const [phase, setPhase] = useState<ViewPhase>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [iframeGeneration, setIframeGeneration] = useState(0);
  const [welcomeGreeting] = useState(() => getWelcomeGreeting());

  const provideToken = useCallback(() => {
    const currentConfig = configRef.current;
    const frameWindow = iframeRef.current?.contentWindow;
    if (!currentConfig || !frameWindow || !tokenRef.current) {
      return;
    }

    frameWindow.postMessage(
      {
        source: HOST_SOURCE,
        type: "provide_token",
        token: tokenRef.current,
        channel_id: currentConfig.channelId,
      },
      currentConfig.embedOrigin,
    );
  }, []);

  const persistEmbedEvent = useCallback(async (data: Record<string, unknown>) => {
    const type = data.type;
    const sessionId = typeof data.session_id === "string" ? data.session_id.trim() : "";
    const content = type === "message_sent"
      ? (typeof data.query === "string" ? data.query.trim() : "")
      : (typeof data.content === "string" ? data.content.trim() : "");
    const channelId = configRef.current?.channelId ?? "";
    if (
      (type !== "message_sent" && type !== "message_received")
      || !sessionId
      || !content
      || !channelId
    ) {
      return;
    }

    try {
      const response = await fetch("/api/fred/events", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          eventId: crypto.randomUUID(),
          type,
          channelId,
          sessionId,
          content,
        }),
      });
      const payload = await response.json().catch(() => null) as unknown;
      if (
        !response.ok
        || !isRecord(payload)
        || !isRecord(payload.conversation)
      ) {
        return;
      }
      const conversation = payload.conversation;
      if (
        typeof conversation.id === "string"
        && typeof conversation.title === "string"
        && typeof conversation.createdAt === "string"
        && typeof conversation.updatedAt === "string"
      ) {
        onConversationUpdated?.({
          id: conversation.id,
          title: conversation.title,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
        });
      }
    } catch {
      // The signed WeKnora webhook is the independent persistence fallback.
    }
  }, [accessToken, onConversationUpdated]);

  useEffect(() => {
    let cancelled = false;
    const reloadExistingFrameAfterBootstrap = Boolean(iframeRef.current);
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let expiresAt = 0;
    const controllers = new Set<AbortController>();

    function clearTimers() {
      if (refreshTimer) clearTimeout(refreshTimer);
      if (retryTimer) clearTimeout(retryTimer);
      refreshTimer = undefined;
      retryTimer = undefined;
    }

    function fail(message: string) {
      if (cancelled) return;
      clearTimers();
      tokenRef.current = "";
      setPhase("error");
      setErrorMessage(message);
    }

    async function fetchToken(): Promise<EmbedToken> {
      const controller = new AbortController();
      controllers.add(controller);
      const timeout = setTimeout(() => controller.abort(), TOKEN_REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(EMBED_TOKEN_ENDPOINT, {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          signal: controller.signal,
        });
        const body = await response.json().catch(() => null) as unknown;
        if (!response.ok) {
          throw new Error(retryMessage(response.status));
        }
        const parsed = parseEmbedToken(body);
        if (!parsed) {
          throw new Error("Fred hat eine ungültige Sitzungsantwort geliefert.");
        }
        return parsed;
      } finally {
        clearTimeout(timeout);
        controllers.delete(controller);
      }
    }

    function scheduleRefresh(expiresIn: number) {
      if (refreshTimer) clearTimeout(refreshTimer);
      const delayMs = Math.max(15, Math.floor(expiresIn * 0.8)) * 1_000;
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        void requestToken("refresh", 0);
      }, delayMs);
    }

    function scheduleRetry(mode: "initial" | "refresh", attempt: number, message: string) {
      if (retryTimer) clearTimeout(retryTimer);

      if (mode === "initial") {
        const delay = INITIAL_RETRY_DELAYS_MS[attempt];
        if (typeof delay !== "number") {
          fail(message);
          return;
        }
        retryTimer = setTimeout(() => {
          retryTimer = undefined;
          void requestToken(mode, attempt + 1);
        }, delay);
        return;
      }

      const remainingMs = expiresAt - Date.now();
      if (remainingMs <= REFRESH_EXPIRY_MARGIN_MS) {
        retryTimer = setTimeout(() => fail(message), Math.max(0, remainingMs));
        return;
      }

      const baseDelay = REFRESH_RETRY_DELAYS_MS[
        Math.min(attempt, REFRESH_RETRY_DELAYS_MS.length - 1)
      ];
      const delay = Math.min(baseDelay, remainingMs - REFRESH_EXPIRY_MARGIN_MS);
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        void requestToken(mode, attempt + 1);
      }, delay);
    }

    async function requestToken(mode: "initial" | "refresh", attempt: number) {
      try {
        const result = await fetchToken();
        if (cancelled) return;

        const existingConfig = configRef.current;
        if (
          existingConfig
          && (existingConfig.channelId !== result.channelId || existingConfig.embedOrigin !== result.embedOrigin)
        ) {
          fail("Fred hat eine unerwartete Kanalkonfiguration geliefert.");
          return;
        }

        const nextConfig = { channelId: result.channelId, embedOrigin: result.embedOrigin };
        configRef.current = nextConfig;
        tokenRef.current = result.token;
        expiresAt = Date.now() + result.expiresIn * 1_000;
        setConfig(nextConfig);
        setErrorMessage("");
        scheduleRefresh(result.expiresIn);
        if (mode === "refresh" || reloadExistingFrameAfterBootstrap) {
          // The current WeKnora embed accepts a token only during bootstrap.
          // Remounting preserves the credentialless page-lifetime storage while
          // forcing a fresh bootstrap with the newly minted short-lived token.
          setIframeGeneration((current) => current + 1);
        }
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error && error.message
          ? error.message
          : "Fred konnte nicht geladen werden. Bitte versuche es erneut.";
        scheduleRetry(mode, attempt, message);
      }
    }

    void requestToken("initial", 0);

    return () => {
      cancelled = true;
      clearTimers();
      for (const controller of controllers) controller.abort();
      controllers.clear();
      tokenRef.current = "";
      configRef.current = null;
    };
  }, [accessToken, provideToken]);

  useEffect(() => {
    if (!config) return;
    const activeConfig = config;

    function receiveEmbedMessage(event: MessageEvent<unknown>) {
      const frameWindow = iframeRef.current?.contentWindow;
      if (event.source !== frameWindow || event.origin !== activeConfig.embedOrigin || !isRecord(event.data)) {
        return;
      }
      if (event.data.source !== EMBED_SOURCE || event.data.channel_id !== activeConfig.channelId) {
        return;
      }

      if (event.data.type === "bootstrap_request") {
        provideToken();
      } else if (event.data.type === "ready") {
        setPhase("ready");
        setErrorMessage("");
      } else if (
        event.data.type === "message_sent"
        || event.data.type === "message_received"
      ) {
        void persistEmbedEvent(event.data);
      }
    }

    window.addEventListener("message", receiveEmbedMessage);
    return () => window.removeEventListener("message", receiveEmbedMessage);
  }, [config, persistEmbedEvent, provideToken]);

  useEffect(() => {
    if (!config || phase !== "loading") return;
    const timeout = setTimeout(() => {
      tokenRef.current = "";
      setPhase("error");
      setErrorMessage("Fred hat den sicheren Verbindungsaufbau nicht abgeschlossen.");
    }, EMBED_READY_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [config, iframeGeneration, phase]);

  const embedUrl = config
    ? `${config.embedOrigin}/embed/${encodeURIComponent(config.channelId)}${
      iframeGeneration > 0 ? `?r=${iframeGeneration}` : ""
    }`
    : "";

  return (
    <section className="fred-embed-panel" aria-label="Fred">
      <header className="fred-embed-hero">
        <Image
          className="fred-embed-hero-image"
          src="/fred.png"
          alt="Fred, der Findog-Assistent"
          width={380}
          height={380}
          priority
        />
        <h1 className="fred-embed-greeting">{welcomeGreeting}</h1>
      </header>
      <div className="fred-embed-frame-shell" aria-busy={phase === "loading"}>
        {config ? (
          <iframe
            key={iframeGeneration}
            ref={iframeRef}
            className="fred-embed-frame"
            src={embedUrl}
            title="Fred"
            allow="clipboard-write"
            sandbox="allow-scripts allow-forms allow-popups allow-modals allow-same-origin"
            referrerPolicy="no-referrer"
            {...CREDENTIALLESS_IFRAME_ATTRIBUTE}
            onLoad={() => {
              setPhase("loading");
              provideToken();
            }}
          />
        ) : null}

        {phase === "loading" ? (
          <div className="fred-embed-state" role="status" aria-live="polite">
            <span className="fred-embed-spinner" aria-hidden="true" />
            <h1>Fred wird geladen</h1>
            <p>Die sichere Verbindung wird hergestellt.</p>
          </div>
        ) : null}

        {phase === "error" ? (
          <div className="fred-embed-state fred-embed-state--error" role="alert">
            <h1>Fred ist gerade nicht erreichbar</h1>
            <p>{errorMessage}</p>
            <button className="primary-button" type="button" onClick={onRetry}>
              Erneut versuchen
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default function FredEmbedView({ accessToken, onConversationUpdated }: FredEmbedViewProps) {
  const [loadGeneration, setLoadGeneration] = useState(0);

  if (!accessToken) {
    return <FredEmbedUnavailable message="Deine Anmeldung ist abgelaufen. Bitte melde dich erneut an." />;
  }

  if (
    typeof HTMLIFrameElement !== "undefined"
    && !("credentialless" in HTMLIFrameElement.prototype)
  ) {
    return (
      <FredEmbedUnavailable message="Der sichere Fred-Bereich benötigt derzeit einen aktuellen Chromium-Browser, zum Beispiel Chrome oder Edge." />
    );
  }

  return (
    <FredEmbedSession
      key={loadGeneration}
      accessToken={accessToken}
      onConversationUpdated={onConversationUpdated}
      onRetry={() => setLoadGeneration((current) => current + 1)}
    />
  );
}
