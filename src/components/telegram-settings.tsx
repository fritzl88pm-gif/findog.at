"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type TelegramIntegrationStatus = "awaiting_pairing" | "active" | "disconnecting" | "error";

export type TelegramIntegrationPublicState = {
  status: TelegramIntegrationStatus;
  botUsername: string | null;
};

type TelegramIntegration = TelegramIntegrationPublicState & {
  pairingExpiresAt: string | null;
  hasActivePairing: boolean;
  hasPairedChat: boolean;
  lastErrorCode: number | null;
  lastErrorDescription: string | null;
  lastErrorAt: string | null;
};

type RegisterResult = {
  status: string;
  deepLink?: string;
  pairingExpiresAt?: string;
};

const TELEGRAM_INTEGRATION_STATUSES = new Set<TelegramIntegrationStatus>([
  "awaiting_pairing",
  "active",
  "disconnecting",
  "error",
]);

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeIntegration(value: unknown): TelegramIntegration | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (!TELEGRAM_INTEGRATION_STATUSES.has(item.status as TelegramIntegrationStatus)) return null;
  return {
    status: item.status as TelegramIntegrationStatus,
    botUsername: nullableString(item.botUsername),
    pairingExpiresAt: nullableString(item.pairingExpiresAt),
    hasActivePairing: item.hasActivePairing === true,
    hasPairedChat: item.hasPairedChat === true,
    lastErrorCode: typeof item.lastErrorCode === "number" ? item.lastErrorCode : null,
    lastErrorDescription: nullableString(item.lastErrorDescription),
    lastErrorAt: nullableString(item.lastErrorAt),
  };
}

function publicState(integration: TelegramIntegration): TelegramIntegrationPublicState {
  return { status: integration.status, botUsername: integration.botUsername };
}

function formatExpiry(value: string | null): string {
  if (!value) return "Ablaufzeit nicht verfügbar";
  const expiresAt = new Date(value);
  if (Number.isNaN(expiresAt.getTime())) return "Ablaufzeit nicht verfügbar";
  const remaining = Math.max(0, expiresAt.getTime() - Date.now());
  const minutes = Math.ceil(remaining / 60_000);
  if (minutes <= 0) return "abgelaufen";
  if (minutes === 1) return "1 Minute";
  return `${minutes} Minuten`;
}

export default function TelegramSettings({
  accessToken,
  onIntegrationChange,
}: {
  accessToken: string;
  onIntegrationChange?: (integration: TelegramIntegrationPublicState | null) => void;
}) {
  const [integration, setIntegration] = useState<TelegramIntegration | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [tokenInput, setTokenInput] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [showReplaceForm, setShowReplaceForm] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deepLink, setDeepLink] = useState("");
  const [hasForeignWebhookConflict, setHasForeignWebhookConflict] = useState(false);
  const tokenInputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const requestSequenceRef = useRef(0);
  const requestControllersRef = useRef(new Set<AbortController>());

  const fetchIntegration = useCallback(async (showLoading = true): Promise<TelegramIntegration | null> => {
    const sequence = ++requestSequenceRef.current;
    const controller = new AbortController();
    requestControllersRef.current.add(controller);
    if (mountedRef.current && showLoading) {
      setIsLoading(true);
      setError("");
    }
    try {
      const response = await fetch("/api/settings/telegram", {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!mountedRef.current || controller.signal.aborted || sequence !== requestSequenceRef.current) {
        return null;
      }
      if (response.status === 404) {
        setIntegration(null);
        onIntegrationChange?.(null);
        return null;
      }
      if (!response.ok) {
        setError(typeof payload.error === "string" ? payload.error : "Integration konnte nicht geladen werden.");
        return null;
      }
      const nextIntegration = normalizeIntegration(payload.integration);
      if (!nextIntegration) {
        setError("Integration konnte nicht geladen werden.");
        return null;
      }
      setIntegration(nextIntegration);
      onIntegrationChange?.(publicState(nextIntegration));
      return nextIntegration;
    } catch {
      if (mountedRef.current && !controller.signal.aborted) {
        setError("Telegram-Einstellungen konnten nicht geladen werden.");
      }
      return null;
    } finally {
      requestControllersRef.current.delete(controller);
      if (mountedRef.current && sequence === requestSequenceRef.current) setIsLoading(false);
    }
  }, [accessToken, onIntegrationChange]);

  useEffect(() => {
    mountedRef.current = true;
    const controllers = requestControllersRef.current;
    return () => {
      mountedRef.current = false;
      requestSequenceRef.current += 1;
      for (const controller of controllers) controller.abort();
      controllers.clear();
    };
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void fetchIntegration(), 0);
    return () => window.clearTimeout(timeout);
  }, [fetchIntegration]);

  useEffect(() => {
    if (integration?.status !== "awaiting_pairing") return;
    const interval = window.setInterval(() => void fetchIntegration(false), 15_000);
    return () => window.clearInterval(interval);
  }, [fetchIntegration, integration?.status]);

  const connect = useCallback(async (replaceExistingWebhook = false) => {
    if (!tokenInput.trim()) {
      setError("Bot-Token ist erforderlich.");
      tokenInputRef.current?.focus();
      return;
    }
    const controller = new AbortController();
    requestControllersRef.current.add(controller);
    setIsConnecting(true);
    setError("");
    setNotice("");
    setHasForeignWebhookConflict(false);
    try {
      const response = await fetch("/api/settings/telegram", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token: tokenInput.trim(),
          ...(replaceExistingWebhook ? { replaceExistingWebhook: true } : {}),
        }),
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!mountedRef.current || controller.signal.aborted) return;
      if (response.status === 409 && payload.conflict === "foreign_webhook") {
        setHasForeignWebhookConflict(true);
        setError("Dieser Bot hat bereits einen Webhook. Soll der bestehende Webhook überschrieben werden?");
        return;
      }
      if (!response.ok) {
        setError(typeof payload.error === "string" ? payload.error : "Registrierung fehlgeschlagen.");
        return;
      }
      const result = payload.integration as RegisterResult | undefined;
      if (result?.status === "awaiting_pairing" && result.deepLink) {
        setDeepLink(result.deepLink);
        setTokenInput("");
        setShowReplaceForm(false);
        setNotice("Token gespeichert. Verknüpfe jetzt deinen Telegram-Account.");
        if (result.pairingExpiresAt) {
          setIntegration((current) => current ? {
            ...current,
            pairingExpiresAt: result.pairingExpiresAt ?? null,
          } : current);
        }
      }
      await fetchIntegration(false);
    } catch {
      if (mountedRef.current && !controller.signal.aborted) setError("Registrierung fehlgeschlagen.");
    } finally {
      requestControllersRef.current.delete(controller);
      if (mountedRef.current) {
        setIsConnecting(false);
        setIsReplacing(false);
      }
    }
  }, [accessToken, fetchIntegration, tokenInput]);

  const disconnect = useCallback(async () => {
    const controller = new AbortController();
    requestControllersRef.current.add(controller);
    setIsDisconnecting(true);
    setError("");
    try {
      const response = await fetch("/api/settings/telegram", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!mountedRef.current || controller.signal.aborted) return;
      if (!response.ok) {
        setError(typeof payload.error === "string" ? payload.error : "Trennung fehlgeschlagen.");
        return;
      }
      setIntegration(null);
      setDeepLink("");
      setNotice("Integration entfernt.");
      onIntegrationChange?.(null);
    } catch {
      if (mountedRef.current && !controller.signal.aborted) setError("Trennung fehlgeschlagen.");
    } finally {
      requestControllersRef.current.delete(controller);
      if (mountedRef.current) setIsDisconnecting(false);
    }
  }, [accessToken, onIntegrationChange]);

  const rotateLink = useCallback(async () => {
    const controller = new AbortController();
    requestControllersRef.current.add(controller);
    setIsRotating(true);
    setError("");
    try {
      const response = await fetch("/api/settings/telegram/pairing", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!mountedRef.current || controller.signal.aborted) return;
      if (!response.ok) {
        setError(typeof payload.error === "string" ? payload.error : "Link konnte nicht aktualisiert werden.");
        return;
      }
      if (typeof payload.deepLink === "string") setDeepLink(payload.deepLink);
      if (typeof payload.pairingExpiresAt === "string") {
        setIntegration((current) => current ? {
          ...current,
          pairingExpiresAt: payload.pairingExpiresAt as string,
          hasActivePairing: true,
        } : current);
      }
      await fetchIntegration(false);
    } catch {
      if (mountedRef.current && !controller.signal.aborted) setError("Link konnte nicht aktualisiert werden.");
    } finally {
      requestControllersRef.current.delete(controller);
      if (mountedRef.current) setIsRotating(false);
    }
  }, [accessToken, fetchIntegration]);

  if (isLoading) {
    return (
      <section className="account-settings-section" aria-labelledby="telegram-settings-title">
        <h3 id="telegram-settings-title">Telegram</h3>
        <p className="field-help">Einstellungen werden geladen…</p>
      </section>
    );
  }

  if (!integration) {
    return (
      <section className="account-settings-section" aria-labelledby="telegram-settings-title">
        <h3 id="telegram-settings-title">Telegram</h3>
        <p className="field-help">
          Verknüpfe einen Telegram-Bot um Fred direkt in Telegram zu nutzen.
          Erstelle einen Bot bei <code>@BotFather</code> und gib hier das Token ein.
        </p>
        {error ? <div className="error-box" role="alert" aria-live="polite">{error}</div> : null}
        {notice ? <div className="notice-box" role="status" aria-live="polite">{notice}</div> : null}
        {hasForeignWebhookConflict ? (
          <div className="telegram-conflict-actions">
            <button
              className="secondary-button danger-button"
              type="button"
              onClick={() => void connect(true)}
              disabled={isConnecting}
            >
              {isConnecting ? "Wird verbunden…" : "Webhook überschreiben"}
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setHasForeignWebhookConflict(false);
                setError("");
              }}
              disabled={isConnecting}
            >
              Abbrechen
            </button>
          </div>
        ) : null}
        <div className="field-group">
          <label htmlFor="telegram-bot-token">Bot-Token</label>
          <input
            ref={tokenInputRef}
            id="telegram-bot-token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={tokenInput}
            onChange={(event) => {
              setTokenInput(event.target.value);
              setError("");
              setHasForeignWebhookConflict(false);
            }}
            placeholder="1234567890:ABCdefGHIjklMNOpqrsTUVwxyz"
            disabled={isConnecting}
          />
          <span className="field-help">Das Token wird verschlüsselt gespeichert und nie angezeigt.</span>
        </div>
        <button
          className="primary-button"
          type="button"
          onClick={() => void connect()}
          disabled={isConnecting || !tokenInput.trim()}
        >
          {isConnecting ? "Wird verbunden…" : "Verbinden"}
        </button>
      </section>
    );
  }

  if (integration.status === "awaiting_pairing") {
    return (
      <section className="account-settings-section" aria-labelledby="telegram-settings-title">
        <h3 id="telegram-settings-title">Telegram</h3>
        {error ? <div className="error-box" role="alert" aria-live="polite">{error}</div> : null}
        <div className="telegram-pairing-card">
          <p className="field-help">
            Bot <strong>@{integration.botUsername ?? "unbekannt"}</strong> wartet auf Verknüpfung.
          </p>
          {deepLink ? (
            <div className="telegram-deeplink">
              <a
                href={deepLink}
                target="_blank"
                rel="noopener noreferrer"
                className="primary-button telegram-deeplink-button"
              >
                In Telegram öffnen
              </a>
              <span className="field-help">Gültig für {formatExpiry(integration.pairingExpiresAt)}.</span>
            </div>
          ) : (
            <p className="field-help">
              Gültig für {formatExpiry(integration.pairingExpiresAt)}. Aktualisiere den Link, um Telegram zu öffnen.
            </p>
          )}
          <button className="secondary-button" type="button" onClick={() => void rotateLink()} disabled={isRotating}>
            {isRotating ? "Wird aktualisiert…" : "Link aktualisieren"}
          </button>
        </div>
        <button className="secondary-button danger-button" type="button" onClick={() => void disconnect()} disabled={isDisconnecting}>
          {isDisconnecting ? "Wird getrennt…" : "Integration entfernen"}
        </button>
      </section>
    );
  }

  const replacementForm = showReplaceForm ? (
    <>
      <p className="field-help">
        Neues Bot-Token eingeben. Der Verlauf bleibt erhalten; der neue Bot wird anschließend neu verknüpft.
      </p>
      {hasForeignWebhookConflict ? (
        <div className="telegram-conflict-actions">
          <button
            className="secondary-button danger-button"
            type="button"
            onClick={() => void connect(true)}
            disabled={isConnecting || isReplacing}
          >
            {isConnecting || isReplacing ? "Wird verbunden…" : "Webhook überschreiben"}
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              setHasForeignWebhookConflict(false);
              setError("");
            }}
            disabled={isConnecting || isReplacing}
          >
            Abbrechen
          </button>
        </div>
      ) : null}
      <div className="field-group">
        <label htmlFor="telegram-bot-token">Neues Bot-Token</label>
        <input
          ref={tokenInputRef}
          id="telegram-bot-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={tokenInput}
          onChange={(event) => {
            setTokenInput(event.target.value);
            setError("");
            setHasForeignWebhookConflict(false);
          }}
          placeholder="1234567890:ABCdefGHIjklMNOpqrsTUVwxyz"
          disabled={isConnecting || isReplacing}
        />
        <span className="field-help">Das Token wird verschlüsselt gespeichert und nie angezeigt.</span>
      </div>
      <div className="telegram-active-actions">
        <button
          className="primary-button"
          type="button"
          onClick={() => {
            setIsReplacing(true);
            void connect();
          }}
          disabled={isConnecting || isReplacing || !tokenInput.trim()}
        >
          {isConnecting || isReplacing ? "Wird gewechselt…" : "Wechseln"}
        </button>
        <button
          className="secondary-button"
          type="button"
          onClick={() => {
            setShowReplaceForm(false);
            setTokenInput("");
            setError("");
            setHasForeignWebhookConflict(false);
            setIsReplacing(false);
          }}
          disabled={isConnecting || isReplacing}
        >
          Abbrechen
        </button>
      </div>
    </>
  ) : null;

  if (integration.status === "active") {
    return (
      <section className="account-settings-section" aria-labelledby="telegram-settings-title">
        <h3 id="telegram-settings-title">Telegram</h3>
        {error ? <div className="error-box" role="alert" aria-live="polite">{error}</div> : null}
        {notice ? <div className="notice-box" role="status" aria-live="polite">{notice}</div> : null}
        <div className="telegram-active-card">
          <p className="field-help">Verbunden als <strong>@{integration.botUsername ?? "unbekannt"}</strong></p>
          <span className="telegram-status-badge telegram-status-active" aria-label="Status: Aktiv">Aktiv</span>
        </div>
        {!showReplaceForm ? (
          <div className="telegram-active-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setShowReplaceForm(true);
                setError("");
                setNotice("");
                setHasForeignWebhookConflict(false);
              }}
              disabled={isDisconnecting}
            >
              Bot wechseln
            </button>
            <button className="secondary-button danger-button" type="button" onClick={() => void disconnect()} disabled={isDisconnecting}>
              {isDisconnecting ? "Wird getrennt…" : "Integration entfernen"}
            </button>
          </div>
        ) : null}
        {replacementForm}
      </section>
    );
  }

  return (
    <section className="account-settings-section" aria-labelledby="telegram-settings-title">
      <h3 id="telegram-settings-title">Telegram</h3>
      <div className="error-box" role="alert" aria-live="polite">
        {integration.lastErrorDescription
          ? `Fehler: ${integration.lastErrorDescription}`
          : "Es ist ein Fehler aufgetreten."}
        {integration.lastErrorCode !== null ? ` (Code ${integration.lastErrorCode})` : ""}
      </div>
      {integration.botUsername ? <p className="field-help">Bot: <strong>@{integration.botUsername}</strong></p> : null}
      <p className="field-help">Du kannst den Bot wechseln oder die Integration entfernen.</p>
      {!showReplaceForm ? (
        <div className="telegram-active-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              setShowReplaceForm(true);
              setError("");
              setHasForeignWebhookConflict(false);
            }}
            disabled={isDisconnecting}
          >
            Bot wechseln
          </button>
          <button className="secondary-button danger-button" type="button" onClick={() => void disconnect()} disabled={isDisconnecting}>
            {isDisconnecting ? "Wird getrennt…" : "Integration entfernen"}
          </button>
        </div>
      ) : null}
      {replacementForm}
    </section>
  );
}
