"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Personality = "standard" | "friendly" | "efficient" | "cynical";

type FredPersonalization = {
  preferredName: string;
  personality: Personality;
};

const VALID_PERSONALITIES: Personality[] = ["standard", "friendly", "efficient", "cynical"];

export default function FredPersonalizationSettings({
  accessToken,
}: {
  accessToken: string;
}) {
  const [preferredName, setPreferredName] = useState("");
  const [personality, setPersonality] = useState<Personality>("standard");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const mountedRef = useRef(true);
  const requestSequenceRef = useRef(0);
  const controllersRef = useRef(new Set<AbortController>());

  const fetchSettings = useCallback(async (showLoading = true): Promise<FredPersonalization | null> => {
    if (!accessToken) {
      setIsLoading(false);
      return null;
    }

    const sequence = ++requestSequenceRef.current;
    const controller = new AbortController();
    controllersRef.current.add(controller);

    if (mountedRef.current && showLoading) {
      setIsLoading(true);
      setError("");
    }

    try {
      const response = await fetch("/api/account/settings/fred-personalization", {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!mountedRef.current || controller.signal.aborted || sequence !== requestSequenceRef.current) {
        return null;
      }

      if (!response.ok) {
        setError(typeof payload.error === "string" ? payload.error : "Einstellungen konnten nicht geladen werden.");
        return null;
      }

      const name = typeof payload.preferredName === "string" ? payload.preferredName : "";
      const pers = VALID_PERSONALITIES.includes(payload.personality as Personality)
        ? (payload.personality as Personality)
        : "standard";

      setPreferredName(name);
      setPersonality(pers);

      return { preferredName: name, personality: pers };
    } catch {
      if (mountedRef.current && !controller.signal.aborted && sequence === requestSequenceRef.current) {
        setError("Fred-Personalisierung konnte nicht geladen werden.");
      }
      return null;
    } finally {
      controllersRef.current.delete(controller);
      if (mountedRef.current && sequence === requestSequenceRef.current && showLoading) {
        setIsLoading(false);
      }
    }
  }, [accessToken]);

  useEffect(() => {
    mountedRef.current = true;
    const controllers = controllersRef.current;
    return () => {
      mountedRef.current = false;
      requestSequenceRef.current += 1;
      for (const ctrl of controllers) ctrl.abort();
      controllers.clear();
    };
  }, [accessToken]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void fetchSettings(), 0);
    return () => window.clearTimeout(timeout);
  }, [fetchSettings]);

  const save = useCallback(async () => {
    if (!accessToken) return;

    const controller = new AbortController();
    controllersRef.current.add(controller);
    setIsSaving(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/account/settings/fred-personalization", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ preferredName, personality }),
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!mountedRef.current || controller.signal.aborted) return;

      if (!response.ok) {
        setError(typeof payload.error === "string" ? payload.error : "Speichern fehlgeschlagen.");
        return;
      }

      const name = typeof payload.preferredName === "string" ? payload.preferredName : preferredName;
      const pers = VALID_PERSONALITIES.includes(payload.personality as Personality)
        ? (payload.personality as Personality)
        : personality;

      setPreferredName(name);
      setPersonality(pers);
      setNotice("Personalisierung gespeichert.");
    } catch {
      if (mountedRef.current && !controller.signal.aborted) {
        setError("Personalisierung konnte nicht gespeichert werden.");
      }
    } finally {
      controllersRef.current.delete(controller);
      if (mountedRef.current) setIsSaving(false);
    }
  }, [accessToken, preferredName, personality]);

  if (isLoading) {
    return (
      <section className="account-settings-section" aria-labelledby="fred-personalization-settings-title">
        <h3 id="fred-personalization-settings-title">Fred personalisieren</h3>
        <p className="field-help">Einstellungen werden geladen…</p>
      </section>
    );
  }

  return (
    <section className="account-settings-section" aria-labelledby="fred-personalization-settings-title">
      <h3 id="fred-personalization-settings-title">Fred personalisieren</h3>

      {error ? (
        <div className="error-box" role="alert" aria-live="polite">{error}</div>
      ) : null}
      {notice ? (
        <div className="notice-box" role="status" aria-live="polite">{notice}</div>
      ) : null}

      <div className="field-group">
        <label htmlFor="fred-personalization-name">Name</label>
        <input
          id="fred-personalization-name"
          type="text"
          maxLength={80}
          autoComplete="name"
          value={preferredName}
          onChange={(event) => {
            setPreferredName(event.target.value);
            setError("");
            setNotice("");
          }}
          disabled={isSaving || !accessToken}
        />
        <p className="field-help">
          Fred kann diesen Namen in Unterhaltungen auf natürliche Weise verwenden.
        </p>
      </div>

      <fieldset className="fred-personality-fieldset" disabled={isSaving || !accessToken}>
        <legend>Persönlichkeit</legend>
        {VALID_PERSONALITIES.map((value) => (
          <label key={value} className="fred-personality-radio-label">
            <input
              type="radio"
              name="fred-personality"
              value={value}
              checked={personality === value}
              onChange={() => {
                setPersonality(value);
                setError("");
                setNotice("");
              }}
            />
            <span className="fred-personality-radio-text">
              <strong>
                {value === "standard" ? "Standard" : value === "friendly" ? "Freundlich" : value === "efficient" ? "Effizient" : "Zynisch"}
              </strong>
              <span className="fred-personality-radio-desc">
                {value === "standard"
                  ? "Keine Stilvorgabe. Nur der Name wird berücksichtigt, wenn du ihn eingetragen hast."
                  : value === "friendly"
                  ? "Herzlich und gesprächig, mit mehr passenden Emojis."
                  : value === "efficient"
                  ? "Prägnant und klar."
                  : "Kritisch und sarkastisch."}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <button
        className="primary-button"
        type="button"
        onClick={() => void save()}
        disabled={isSaving || isLoading || !accessToken}
      >
        {isSaving ? "Wird gespeichert…" : "Personalisierung speichern"}
      </button>
    </section>
  );
}
