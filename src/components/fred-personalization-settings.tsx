"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type PersonalityOption = {
  id: string;
  title: string;
};

function normalizePersonalityOption(item: unknown): PersonalityOption | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const entry = item as Record<string, unknown>;
  if (typeof entry.id !== "string" || typeof entry.title !== "string") return null;
  return { id: entry.id, title: entry.title };
}

function normalizePersonalityOptions(value: unknown): PersonalityOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    const p = normalizePersonalityOption(item);
    return p ? [p] : [];
  });
}

function resolvePersonality(
  serverId: unknown,
  options: PersonalityOption[],
): string {
  if (typeof serverId === "string" && options.some((o) => o.id === serverId)) {
    return serverId;
  }
  if (options.some((o) => o.id === "standard")) {
    return "standard";
  }
  return options.length > 0 ? (options[0]?.id ?? "") : "";
}

export default function FredPersonalizationSettings({
  accessToken,
  onResearchDisplayModeChange,
}: {
  accessToken: string;
  onResearchDisplayModeChange?: (mode: "simple" | "advanced") => void;
}) {
  const [preferredName, setPreferredName] = useState("");
  const [personality, setPersonality] = useState<string>("");
  const [personalities, setPersonalities] = useState<PersonalityOption[]>([]);
  const [researchDisplayMode, setResearchDisplayMode] = useState<"simple" | "advanced">("simple");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const mountedRef = useRef(true);
  const requestSequenceRef = useRef(0);
  const controllersRef = useRef(new Set<AbortController>());

  const fetchSettings = useCallback(async (showLoading = true) => {
    if (!accessToken) {
      setIsLoading(false);
      return;
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
        return;
      }

      if (!response.ok) {
        setError(typeof payload.error === "string" ? payload.error : "Einstellungen konnten nicht geladen werden.");
        return;
      }

      const name = typeof payload.preferredName === "string" ? payload.preferredName : "";
      const options = normalizePersonalityOptions(payload.personalities);
      const mode = payload.researchDisplayMode === "advanced" ? "advanced" : "simple";

      setPreferredName(name);
      setPersonalities(options);
      setPersonality(resolvePersonality(payload.personality, options));
      setResearchDisplayMode(mode);
      onResearchDisplayModeChange?.(mode);
    } catch {
      if (mountedRef.current && !controller.signal.aborted && sequence === requestSequenceRef.current) {
        setError("Fred-Personalisierung konnte nicht geladen werden.");
      }
    } finally {
      controllersRef.current.delete(controller);
      if (mountedRef.current && sequence === requestSequenceRef.current && showLoading) {
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
      for (const ctrl of controllers) ctrl.abort();
      controllers.clear();
    };
  }, [accessToken]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void fetchSettings(), 0);
    return () => window.clearTimeout(timeout);
  }, [fetchSettings]);

  const canSave = personality.length > 0 && personalities.some((o) => o.id === personality);

  const save = useCallback(async () => {
    if (!accessToken || !canSave) return;

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
        body: JSON.stringify({ preferredName, personality, researchDisplayMode }),
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!mountedRef.current || controller.signal.aborted) return;

      if (!response.ok) {
        setError(typeof payload.error === "string" ? payload.error : "Speichern fehlgeschlagen.");
        return;
      }

      const name = typeof payload.preferredName === "string" ? payload.preferredName : preferredName;
      const options = normalizePersonalityOptions(payload.personalities);
      const pers = resolvePersonality(payload.personality, options);
      const mode = payload.researchDisplayMode === "advanced" ? "advanced" : "simple";

      setPreferredName(name);
      setPersonalities(options);
      setPersonality(pers);
      setResearchDisplayMode(mode);
      onResearchDisplayModeChange?.(mode);
      setNotice("Personalisierung gespeichert.");
    } catch {
      if (mountedRef.current && !controller.signal.aborted) {
        setError("Personalisierung konnte nicht gespeichert werden.");
      }
    } finally {
      controllersRef.current.delete(controller);
      if (mountedRef.current) setIsSaving(false);
    }
  }, [accessToken, preferredName, personality, researchDisplayMode, canSave, onResearchDisplayModeChange]);

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
        {personalities.map((option) => (
          <label key={option.id} className="fred-personality-radio-label">
            <input
              type="radio"
              name="fred-personality"
              value={option.id}
              checked={personality === option.id}
              onChange={() => {
                setPersonality(option.id);
                setError("");
                setNotice("");
              }}
            />
            <span className="fred-personality-radio-text">
              <strong>{option.title}</strong>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="fred-personality-fieldset" disabled={isSaving || !accessToken}>
        <legend>Rechercheanzeige</legend>
        <label className="fred-personality-radio-label">
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
          <span className="fred-personality-radio-text">
            <strong>Einfach</strong>
            <small className="field-help">Kompakter Rechercheverlauf</small>
          </span>
        </label>
        <label className="fred-personality-radio-label">
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
          <span className="fred-personality-radio-text">
            <strong>Erweitert</strong>
            <small className="field-help">Ausführungsverlauf mit Planung, Suche und Bewertung</small>
          </span>
        </label>
      </fieldset>

      <button
        className="primary-button"
        type="button"
        onClick={() => void save()}
        disabled={isSaving || isLoading || !accessToken || !canSave}
      >
        {isSaving ? "Wird gespeichert…" : "Personalisierung speichern"}
      </button>
    </section>
  );
}
