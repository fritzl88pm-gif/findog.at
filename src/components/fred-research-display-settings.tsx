"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ResearchDisplayMode = "simple" | "advanced";

export default function FredResearchDisplaySettings({
  accessToken,
  onResearchDisplayModeChange,
}: {
  accessToken: string;
  onResearchDisplayModeChange?: (mode: ResearchDisplayMode) => void;
}) {
  const [researchDisplayMode, setResearchDisplayMode] = useState<ResearchDisplayMode>("simple");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const mountedRef = useRef(true);
  const requestSequenceRef = useRef(0);
  const controllersRef = useRef(new Set<AbortController>());

  const fetchSettings = useCallback(async () => {
    if (!accessToken) {
      setIsLoading(false);
      return;
    }

    const sequence = ++requestSequenceRef.current;
    const controller = new AbortController();
    controllersRef.current.add(controller);
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/account/settings/fred-research-display", {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!mountedRef.current || controller.signal.aborted || sequence !== requestSequenceRef.current) {
        return;
      }
      if (!response.ok) {
        setError(typeof payload.error === "string" ? payload.error : "Rechercheanzeige konnte nicht geladen werden.");
        return;
      }

      const mode: ResearchDisplayMode = payload.researchDisplayMode === "advanced" ? "advanced" : "simple";
      setResearchDisplayMode(mode);
      onResearchDisplayModeChange?.(mode);
    } catch {
      if (mountedRef.current && !controller.signal.aborted && sequence === requestSequenceRef.current) {
        setError("Rechercheanzeige konnte nicht geladen werden.");
      }
    } finally {
      controllersRef.current.delete(controller);
      if (mountedRef.current && sequence === requestSequenceRef.current) {
        setIsLoading(false);
      }
    }
  }, [accessToken, onResearchDisplayModeChange]);

  useEffect(() => {
    mountedRef.current = true;
    const controllers = controllersRef.current;
    return () => {
      mountedRef.current = false;
      requestSequenceRef.current += 1;
      for (const controller of controllers) controller.abort();
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
      const response = await fetch("/api/account/settings/fred-research-display", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ researchDisplayMode }),
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!mountedRef.current || controller.signal.aborted) return;
      if (!response.ok) {
        setError(typeof payload.error === "string" ? payload.error : "Speichern fehlgeschlagen.");
        return;
      }

      const mode: ResearchDisplayMode = payload.researchDisplayMode === "advanced" ? "advanced" : "simple";
      setResearchDisplayMode(mode);
      onResearchDisplayModeChange?.(mode);
      setNotice("Rechercheanzeige gespeichert.");
    } catch {
      if (mountedRef.current && !controller.signal.aborted) {
        setError("Rechercheanzeige konnte nicht gespeichert werden.");
      }
    } finally {
      controllersRef.current.delete(controller);
      if (mountedRef.current) setIsSaving(false);
    }
  }, [accessToken, researchDisplayMode, onResearchDisplayModeChange]);

  if (isLoading) {
    return (
      <section className="account-settings-section" aria-labelledby="fred-research-display-settings-title">
        <h3 id="fred-research-display-settings-title">Rechercheanzeige</h3>
        <p className="field-help">Einstellungen werden geladen…</p>
      </section>
    );
  }

  return (
    <section className="account-settings-section" aria-labelledby="fred-research-display-settings-title">
      <h3 id="fred-research-display-settings-title">Rechercheanzeige</h3>

      {error ? <div className="error-box" role="alert" aria-live="polite">{error}</div> : null}
      {notice ? <div className="notice-box" role="status" aria-live="polite">{notice}</div> : null}

      <fieldset className="fred-research-display-fieldset" disabled={isSaving || !accessToken}>
        <legend>Darstellung des Rechercheverlaufs</legend>
        <label className="fred-research-display-radio-label">
          <input
            type="radio"
            name="fred-research-display-mode"
            value="simple"
            checked={researchDisplayMode === "simple"}
            onChange={() => {
              setResearchDisplayMode("simple");
              setError("");
              setNotice("");
            }}
          />
          <span className="fred-research-display-radio-text">
            <strong>Einfach</strong>
            <small className="field-help">Kompakter Rechercheverlauf</small>
          </span>
        </label>
        <label className="fred-research-display-radio-label">
          <input
            type="radio"
            name="fred-research-display-mode"
            value="advanced"
            checked={researchDisplayMode === "advanced"}
            onChange={() => {
              setResearchDisplayMode("advanced");
              setError("");
              setNotice("");
            }}
          />
          <span className="fred-research-display-radio-text">
            <strong>Erweitert</strong>
            <small className="field-help">Ausführungsverlauf mit Planung, Suche und Bewertung</small>
          </span>
        </label>
      </fieldset>

      <button
        className="primary-button"
        type="button"
        onClick={() => void save()}
        disabled={isSaving || isLoading || !accessToken}
      >
        {isSaving ? "Wird gespeichert…" : "Rechercheanzeige speichern"}
      </button>
    </section>
  );
}
