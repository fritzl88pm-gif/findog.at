"use client";

import { useCallback, useEffect, useState } from "react";

import { useAdminEditorGuard } from "@/components/admin-editor-guard";
import {
  FINDOG_AGENT_EXA_SECRET_NAME,
  FINDOG_AGENT_KNOWLEDGE_SECRET_NAME,
  FINDOG_AGENT_LIMITS,
  FINDOG_AGENT_PROVIDERS,
  FINDOG_AGENT_REASONING_EFFORTS,
  FINDOG_AGENT_WEB_MODES,
  findogAgentConnectionSecretName,
  findogAgentMcpSecretName,
  type FindogAgentModelCapability,
  type FindogAgentProvider,
  type FindogAgentReasoningEffort,
  type FindogAgentRedactedSettings,
  type FindogAgentRunLimits,
  type FindogAgentSettings,
  type FindogAgentWebMode,
} from "@/lib/findog-agent/types";
import styles from "./findog-agent.module.css";
import {
  buildFindogAgentSecretPatch,
  findogAgentCatalogId,
  findogAgentRequest,
  FindogAgentApiError,
  isFindogAgentAccessDenied,
  toFindogAgentSettingsPayload,
  type FindogAgentConnectionTestResultDto,
  type FindogAgentSettingsResponseDto,
} from "./client";

const PROVIDER_LABELS: Record<FindogAgentProvider, string> = {
  deepseek: "DeepSeek (nativ)",
  openrouter: "OpenRouter",
  "openai-compatible": "OpenAI-kompatibel",
};

/**
 * Capabilities the administrator may declare in this UI.
 *
 * Token streaming is deliberately absent: the provider always requests a
 * complete (non-streaming) model response and the run's progress is observed by
 * polling the event log, so a "streaming" toggle would have no runtime effect.
 * The stored settings schema and existing saved values still accept the flag
 * for backward compatibility.
 */
const CONFIGURABLE_CAPABILITIES = ["tools", "reasoning"] as const satisfies readonly FindogAgentModelCapability[];
type ConfigurableCapability = (typeof CONFIGURABLE_CAPABILITIES)[number];

const CAPABILITY_LABELS: Record<ConfigurableCapability, string> = {
  tools: "Werkzeuge",
  reasoning: "Reasoning",
};

const EFFORT_LABELS: Record<FindogAgentReasoningEffort, string> = {
  low: "niedrig",
  medium: "mittel",
  high: "hoch",
  max: "maximal",
};

const WEB_MODE_LABELS: Record<FindogAgentWebMode, string> = {
  off: "Aus",
  auto: "Automatisch",
  on: "Immer",
};

const TEST_HINTS: Record<string, string> = {
  model: "Der Modelltest ruft das Modell mit einer kurzen Testfrage auf und kann Token verbrauchen.",
  weknora: "Der Test liest die erreichbaren Wissensbasen und ändert nichts.",
  exa: "Der Test führt eine einzelne begrenzte Websuche aus und kann Kosten verursachen.",
  mcp: "Die Erkennung authentifiziert sich und listet die Werkzeuge; sie ruft kein Werkzeug auf.",
};

const CONNECTION_URL_PLACEHOLDERS: Record<FindogAgentProvider, string> = {
  deepseek: "https://api.deepseek.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  "openai-compatible": "https://beispiel.example/v1",
};

const CONNECTION_URL_HINTS: Record<FindogAgentProvider, string> = {
  deepseek: "Native DeepSeek-API.",
  openrouter: "OpenRouter Chat Completions.",
  "openai-compatible": "Beliebiger OpenAI-kompatibler Chat-Completions-Endpunkt mit /v1-Pfad.",
};

type KnowledgeBaseRecord = { id: string; name: string; configured: boolean };
type McpToolRecord = { name: string; description: string; approved: boolean; readOnlyHint: boolean };

function asKnowledgeBases(detail: Record<string, unknown> | null): KnowledgeBaseRecord[] {
  const raw = detail?.knowledgeBases;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const record = entry as Record<string, unknown>;
    return typeof record.id === "string" && typeof record.name === "string"
      ? [{ id: record.id, name: record.name, configured: record.configured === true }]
      : [];
  });
}

function asMcpTools(detail: Record<string, unknown> | null): McpToolRecord[] {
  const raw = detail?.tools;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const record = entry as Record<string, unknown>;
    return typeof record.name === "string"
      ? [{
        name: record.name,
        description: typeof record.description === "string" ? record.description : "",
        approved: record.approved === true,
        readOnlyHint: record.readOnlyHint === true,
      }]
      : [];
  });
}

function numberOrNull(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}

function patchById<T extends { id: string }>(entries: T[], id: string, patch: Partial<T>): T[] {
  return entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry));
}

function toggleValue<T>(values: T[], value: T, checked: boolean): T[] {
  return checked ? [...values, value] : values.filter((entry) => entry !== value);
}

/** Missing prerequisites the server would reject on enqueue, shown as guidance. */
function readinessNotes(settings: FindogAgentRedactedSettings): string[] {
  const notes: string[] = [];
  if (!settings.enabled) {
    notes.push("Der Agent ist deaktiviert; neue Fragen werden abgelehnt.");
  }
  const model = settings.models.find((entry) => entry.id === settings.activeModelId);
  if (!model) {
    notes.push("Es ist kein aktives Modell ausgewählt.");
  } else {
    const connection = settings.connections.find((entry) => entry.id === model.connectionId);
    if (!connection) {
      notes.push("Die Verbindung des aktiven Modells fehlt.");
    } else if (!connection.apiKeyConfigured) {
      notes.push("Für das aktive Modell ist kein Zugangsschlüssel gespeichert.");
    }
  }
  if (settings.knowledge.enabled) {
    if (!settings.knowledge.baseUrl) {
      notes.push("Die Wissensdatenbank ist aktiviert, aber die Basis-URL fehlt.");
    }
    if (settings.knowledge.knowledgeBaseIds.length === 0) {
      notes.push("Die Wissensdatenbank ist aktiviert, aber keine Wissensbasis ist ausgewählt.");
    }
    if (!settings.knowledge.apiKeyConfigured) {
      notes.push("Für die Wissensdatenbank ist kein Zugangsschlüssel gespeichert.");
    }
  }
  if (settings.web.mode !== "off" && !settings.web.exaApiKeyConfigured) {
    notes.push("Die Websuche ist aktiviert, aber kein Exa-Schlüssel gespeichert.");
  }
  return notes;
}

function detailLines(entries: Array<[string, string | null]>): Array<[string, string]> {
  return entries.filter((entry): entry is [string, string] => entry[1] !== null);
}

function testDetailLines(result: FindogAgentConnectionTestResultDto): Array<[string, string]> {
  const detail = result.detail ?? {};
  const count = (key: string) => (typeof detail[key] === "number" ? String(detail[key]) : null);
  const listed = count("listed");
  const total = count("total");
  const truncation = listed !== null && total !== null && listed !== total
    ? `${listed} von ${total} Einträgen angezeigt; die Liste ist gekürzt.`
    : null;
  if (result.kind === "model") {
    return detailLines([
      ["Abschlussgrund", typeof detail.finishReason === "string" ? detail.finishReason : null],
      ["Antwort erhalten", detail.answered === true ? "ja" : detail.answered === false ? "nein" : null],
      ["Eingabe-Tokens", count("promptTokens")],
      ["Ausgabe-Tokens", count("completionTokens")],
    ]);
  }
  if (result.kind === "weknora") {
    return detailLines([["Gefundene Wissensbasen", listed], ["Hinweis", truncation]]);
  }
  if (result.kind === "exa") {
    return detailLines([
      ["Treffer", count("hits")],
      ["Ausgefiltert", count("filtered")],
      [
        "Geschätzte Kosten",
        typeof detail.estimatedCostUsd === "number"
          ? `${detail.estimatedCostUsd.toFixed(4)} USD (Schätzung)`
          : "unbekannt",
      ],
    ]);
  }
  return detailLines([["Gefundene Werkzeuge", listed], ["Hinweis", truncation]]);
}

function TestOutcome({ result }: { result: FindogAgentConnectionTestResultDto }) {
  return (
    <div className={styles.testResult} role="status">
      <strong>{result.ok ? "Erfolgreich" : "Fehlgeschlagen"}: {result.summary}</strong>
      <span>Dauer {result.latencyMs} ms{result.code ? ` · Code ${result.code}` : ""}</span>
      {testDetailLines(result).map(([label, value]) => (
        <span key={label}>{label}: {value}</span>
      ))}
    </div>
  );
}

function SecretField({ label, configured, hint, value, removed, onValueChange, onRemove, onKeep }: {
  label: string;
  configured: boolean;
  hint: string;
  value: string;
  removed: boolean;
  onValueChange: (value: string) => void;
  onRemove: () => void;
  onKeep: () => void;
}) {
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={`${styles.badge} ${configured && !removed ? styles.badgeOk : ""}`}>
        {removed ? "wird beim Speichern entfernt" : configured ? "hinterlegt" : "nicht hinterlegt"}
      </span>
      <input
        type="password"
        autoComplete="off"
        aria-label={label}
        placeholder={configured ? "Leer lassen, um den Wert zu behalten" : "Neuen Wert eingeben"}
        value={value}
        disabled={removed}
        onChange={(event) => onValueChange(event.target.value)}
      />
      <div className={styles.actions}>
        {removed ? (
          <button type="button" className={styles.secondary} onClick={onKeep}>
            Entfernen zurücknehmen
          </button>
        ) : (
          <button type="button" className={styles.danger} onClick={onRemove} disabled={!configured}>
            Wert entfernen
          </button>
        )}
      </div>
      <p className={styles.hint}>{hint}</p>
    </div>
  );
}

export default function FindogAgentSettings({ accessToken }: { accessToken: string }) {
  const [settings, setSettings] = useState<FindogAgentRedactedSettings | null>(null);
  const [revision, setRevision] = useState<number | null>(null);
  const [baseline, setBaseline] = useState("");
  const [domainText, setDomainText] = useState("");
  const [secretEdits, setSecretEdits] = useState<Record<string, string>>({});
  const [secretRemovals, setSecretRemovals] = useState<string[]>([]);
  const [tests, setTests] = useState<Record<string, FindogAgentConnectionTestResultDto | "pending">>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const fail = useCallback((caught: unknown) => {
    if (isFindogAgentAccessDenied(caught)) {
      setDenied(true);
      setSettings(null);
      setRevision(null);
      setBaseline("");
      setSecretEdits({});
      setSecretRemovals([]);
      setTests({});
      setNotice("");
      return;
    }
    setError(caught instanceof Error ? caught.message : "Die Anfrage ist fehlgeschlagen.");
  }, []);

  const applyLoaded = useCallback((response: FindogAgentSettingsResponseDto) => {
    setSettings(response.settings);
    setRevision(response.revision);
    setBaseline(JSON.stringify(response.settings));
    setDomainText(response.settings.web.allowedDomains.join(", "));
    setSecretEdits({});
    setSecretRemovals([]);
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await findogAgentRequest<FindogAgentSettingsResponseDto>(accessToken, "/settings", { signal });
    applyLoaded(response);
  }, [accessToken, applyLoaded]);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        await load(controller.signal);
      } catch (caught) {
        if (!controller.signal.aborted) {
          fail(caught);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    })();
    return () => controller.abort();
  }, [accessToken, fail, load]);

  const pendingTests = Object.values(tests).filter((entry) => entry === "pending").length;
  const savingOrTesting = saving || pendingTests > 0;
  const dirty = settings !== null && (
    JSON.stringify(settings) !== baseline
    || Object.values(secretEdits).some((value) => value.trim() !== "")
    || secretRemovals.length > 0
  );
  const confirmLeave = useAdminEditorGuard({ dirty, busy: savingOrTesting });

  function updateSettings(mutate: (current: FindogAgentRedactedSettings) => FindogAgentRedactedSettings) {
    setSettings((current) => (current ? mutate(current) : current));
  }

  function secretValue(name: string): string {
    return secretEdits[name] ?? "";
  }

  function setSecretValue(name: string, value: string) {
    setSecretRemovals((current) => current.filter((entry) => entry !== name));
    setSecretEdits((current) => {
      const next = { ...current };
      if (value === "") {
        delete next[name];
      } else {
        next[name] = value;
      }
      return next;
    });
  }

  function removeSecret(name: string) {
    setSecretEdits((current) => {
      const next = { ...current };
      delete next[name];
      return next;
    });
    setSecretRemovals((current) => (current.includes(name) ? current : [...current, name]));
  }

  function keepSecret(name: string) {
    setSecretRemovals((current) => current.filter((entry) => entry !== name));
  }

  function secretFieldProps(name: string, label: string, configured: boolean, hint: string) {
    return {
      label,
      configured,
      hint,
      value: secretValue(name),
      removed: secretRemovals.includes(name),
      onValueChange: (value: string) => setSecretValue(name, value),
      onRemove: () => removeSecret(name),
      onKeep: () => keepSecret(name),
    };
  }

  async function save() {
    if (!settings || savingOrTesting) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payload = toFindogAgentSettingsPayload(settings);
      const response = await findogAgentRequest<FindogAgentSettingsResponseDto>(accessToken, "/settings", {
        method: "PUT",
        body: {
          expectedRevision: revision,
          settings: payload,
          secrets: buildFindogAgentSecretPatch(payload, secretEdits, secretRemovals),
        },
      });
      applyLoaded(response);
      setNotice(response.revision === null
        ? "Konfiguration gespeichert."
        : `Konfiguration als Revision ${response.revision} gespeichert.`);
    } catch (caught) {
      if (caught instanceof FindogAgentApiError && caught.code === "conflict") {
        setError(`${caught.message} Deine Eingaben bleiben erhalten; „Neu laden“ lädt den Stand des Servers.`);
      } else {
        fail(caught);
      }
    } finally {
      setSaving(false);
    }
  }

  async function reload() {
    if (!confirmLeave()) {
      return;
    }
    setError("");
    setNotice("");
    setLoading(true);
    try {
      await load();
    } catch (caught) {
      fail(caught);
    } finally {
      setLoading(false);
    }
  }

  function testKey(kind: string, id: string | null): string {
    return `${kind}:${id ?? ""}`;
  }

  async function runTest(kind: "model" | "weknora" | "exa" | "mcp", id: string | null) {
    if (revision === null) {
      setError("Bitte die Konfiguration zuerst speichern; Tests verwenden ausschließlich die gespeicherte Revision.");
      return;
    }
    const key = testKey(kind, id);
    setTests((current) => ({ ...current, [key]: "pending" }));
    setError("");
    try {
      const result = await findogAgentRequest<FindogAgentConnectionTestResultDto>(
        accessToken,
        "/connection-tests",
        { method: "POST", body: { revision, kind, id } },
      );
      setTests((current) => ({ ...current, [key]: result }));
    } catch (caught) {
      setTests((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      fail(caught);
    }
  }

  function testOutcomeFor(kind: string, id: string | null) {
    const entry = tests[testKey(kind, id)];
    if (entry === undefined) {
      return null;
    }
    return entry === "pending" ? <p className={styles.hint} role="status">Test läuft …</p> : <TestOutcome result={entry} />;
  }

  function addConnection() {
    updateSettings((current) => ({
      ...current,
      connections: [
        ...current.connections,
        {
          id: findogAgentCatalogId("conn"),
          name: "Neue Verbindung",
          provider: "deepseek" as FindogAgentProvider,
          baseUrl: "",
          apiKeyConfigured: false,
        },
      ],
    }));
  }

  function patchConnection(id: string, patch: Partial<FindogAgentRedactedSettings["connections"][number]>) {
    updateSettings((current) => ({ ...current, connections: patchById(current.connections, id, patch) }));
  }

  function removeConnection(id: string) {
    updateSettings((current) => {
      const models = current.models.filter((entry) => entry.connectionId !== id);
      return {
        ...current,
        connections: current.connections.filter((entry) => entry.id !== id),
        models,
        activeModelId: models.some((entry) => entry.id === current.activeModelId) ? current.activeModelId : null,
      };
    });
  }

  function addModel(connectionId: string) {
    updateSettings((current) => ({
      ...current,
      models: [
        ...current.models,
        {
          id: findogAgentCatalogId("model"),
          label: "Neues Modell",
          connectionId,
          model: "",
          reasoningEffort: null,
          capabilities: ["tools"] as FindogAgentModelCapability[],
          maxOutputTokens: null,
          contextTokens: null,
          inputCostPerMillionUsd: null,
          outputCostPerMillionUsd: null,
        },
      ],
    }));
  }

  function patchModel(id: string, patch: Partial<FindogAgentRedactedSettings["models"][number]>) {
    updateSettings((current) => ({ ...current, models: patchById(current.models, id, patch) }));
  }

  function removeModel(id: string) {
    updateSettings((current) => ({
      ...current,
      models: current.models.filter((entry) => entry.id !== id),
      activeModelId: current.activeModelId === id ? null : current.activeModelId,
    }));
  }

  function addMcpServer() {
    updateSettings((current) => ({
      ...current,
      mcp: {
        servers: [
          ...current.mcp.servers,
          { id: findogAgentCatalogId("mcp"), name: "Neuer MCP-Server", url: "", allowedTools: [], bearerConfigured: false },
        ],
      },
    }));
  }

  function patchMcpServer(id: string, patch: Partial<FindogAgentRedactedSettings["mcp"]["servers"][number]>) {
    updateSettings((current) => ({
      ...current,
      mcp: { servers: patchById(current.mcp.servers, id, patch) },
    }));
  }

  function removeMcpServer(id: string) {
    updateSettings((current) => ({
      ...current,
      mcp: { servers: current.mcp.servers.filter((entry) => entry.id !== id) },
    }));
  }

  function patchLimits(patch: Partial<FindogAgentRunLimits>) {
    updateSettings((current) => ({ ...current, limits: { ...current.limits, ...patch } }));
  }

  function toggleKnowledgeBase(baseId: string, checked: boolean) {
    updateSettings((current) => ({
      ...current,
      knowledge: {
        ...current.knowledge,
        knowledgeBaseIds: toggleValue(current.knowledge.knowledgeBaseIds, baseId, checked),
      },
    }));
  }

  function toggleMcpTool(serverId: string, toolName: string, checked: boolean) {
    updateSettings((current) => ({
      ...current,
      mcp: {
        servers: current.mcp.servers.map((entry) => (entry.id === serverId
          ? {
            ...entry,
            allowedTools: toggleValue(entry.allowedTools, toolName, checked),
          }
          : entry)),
      },
    }));
  }

  const notes = settings ? readinessNotes(settings) : [];
  const knowledgeDiscovery = tests[testKey("weknora", null)];
  const discoveredBases = knowledgeDiscovery && knowledgeDiscovery !== "pending"
    ? asKnowledgeBases(knowledgeDiscovery.detail)
    : [];

  return (
    <section className={styles.panel} aria-labelledby="findog-agent-settings-title">
      <div className={styles.header}>
        <div className={styles.headerText}>
          <h2 id="findog-agent-settings-title">Agent-Einstellungen</h2>
          <p>
            Jede Speicherung erzeugt eine unveränderliche Revision. Laufende und neue Recherchen
            verwenden die Revision, mit der sie gestartet wurden.
          </p>
        </div>
        <div className={styles.actions}>
          <span className={styles.badge}>
            {revision === null ? "Noch nicht gespeichert" : `Revision ${revision}`}
          </span>
          {dirty ? <span className={`${styles.badge} ${styles.badgeActive}`}>Ungespeicherte Änderungen</span> : null}
          <button type="button" className={styles.primary} onClick={() => void save()} disabled={!settings || savingOrTesting}>
            {saving ? "Wird gespeichert …" : "Speichern"}
          </button>
          <button type="button" className={styles.secondary} onClick={() => void reload()} disabled={savingOrTesting}>
            Neu laden
          </button>
        </div>
      </div>

      {revision === null && settings ? (
        <p className={styles.hint}>
          Verbindungs- und Modelltests sind erst nach dem ersten Speichern möglich; Tests verwenden
          ausschließlich gespeicherte Revisionen.
        </p>
      ) : null}
      {denied ? (
        <p className={styles.error} role="alert">
          Die Administrationsberechtigung für den Findog Agent wurde entzogen. Die Konfiguration ist
          gesperrt und wurde aus der Ansicht entfernt.
        </p>
      ) : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}

      {loading && !settings ? <p className={styles.empty} role="status">Konfiguration wird geladen …</p> : null}

      {settings ? (
        <div className={styles.sections}>
          <div className={styles.section}>
            <div className={styles.sectionBody}>
              <div className={styles.fieldGrid}>
                <div className={styles.field}>
                  <label htmlFor="findog-agent-name">Name des Agenten</label>
                  <input
                    id="findog-agent-name"
                    value={settings.agentName}
                    onChange={(event) => updateSettings((current) => ({ ...current, agentName: event.target.value }))}
                  />
                </div>
                <div className={`${styles.field} ${styles.fieldSpan}`}>
                  <label htmlFor="findog-agent-prompt">Systemprompt</label>
                  <textarea
                    id="findog-agent-prompt"
                    value={settings.systemPrompt}
                    onChange={(event) => updateSettings((current) => ({ ...current, systemPrompt: event.target.value }))}
                  />
                </div>
                <div className={styles.fieldSpan}>
                  <label className={styles.checkRow} htmlFor="findog-agent-enabled">
                    <input
                      id="findog-agent-enabled"
                      type="checkbox"
                      checked={settings.enabled}
                      onChange={(event) => updateSettings((current) => ({ ...current, enabled: event.target.checked }))}
                    />
                    Agent aktiviert
                  </label>
                </div>
              </div>
              {notes.length > 0 ? (
                <ul className={styles.inlineList}>
                  {notes.map((note) => <li key={note}>{note}</li>)}
                </ul>
              ) : (
                <p className={styles.hint}>Alle Voraussetzungen für neue Recherchen sind erfüllt.</p>
              )}
            </div>
          </div>

          <details className={styles.section}>
            <summary>Verbindungen ({settings.connections.length})</summary>
            <div className={styles.sectionBody}>
              <p className={styles.hint}>
                Zugangsschlüssel werden verschlüsselt gespeichert. Ein leeres Feld behält den
                gespeicherten Wert; „Wert entfernen“ löscht ihn beim Speichern.
              </p>
              {settings.connections.map((connection) => {
                const secretName = findogAgentConnectionSecretName(connection.id);
                return (
                  <div className={styles.catalogItem} key={connection.id}>
                    <div className={styles.catalogHead}>
                      <strong>{connection.name || connection.id}</strong>
                      <button
                        type="button"
                        className={styles.danger}
                        onClick={() => removeConnection(connection.id)}
                      >
                        Verbindung entfernen
                      </button>
                    </div>
                    <div className={styles.fieldGrid}>
                      <div className={styles.field}>
                        <label htmlFor={`conn-name-${connection.id}`}>Name</label>
                        <input
                          id={`conn-name-${connection.id}`}
                          value={connection.name}
                          onChange={(event) => patchConnection(connection.id, { name: event.target.value })}
                        />
                      </div>
                      <div className={styles.field}>
                        <label htmlFor={`conn-provider-${connection.id}`}>Anbieter</label>
                        <select
                          id={`conn-provider-${connection.id}`}
                          value={connection.provider}
                          onChange={(event) => patchConnection(connection.id, {
                            provider: event.target.value as FindogAgentProvider,
                          })}
                        >
                          {FINDOG_AGENT_PROVIDERS.map((provider) => (
                            <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>
                          ))}
                        </select>
                      </div>
                      <div className={`${styles.field} ${styles.fieldSpan}`}>
                        <label htmlFor={`conn-url-${connection.id}`}>Basis-URL</label>
                        <input
                          id={`conn-url-${connection.id}`}
                          value={connection.baseUrl}
                          placeholder={CONNECTION_URL_PLACEHOLDERS[connection.provider]}
                          onChange={(event) => patchConnection(connection.id, { baseUrl: event.target.value })}
                        />
                        <p className={styles.hint}>
                          {CONNECTION_URL_HINTS[connection.provider]} Nur https; private
                          Testursprünge müssen serverseitig freigegeben sein.
                        </p>
                      </div>
                      <div className={styles.fieldSpan}>
                        <SecretField
                          {...secretFieldProps(
                            secretName,
                            `Zugangsschlüssel für ${connection.name || connection.id}`,
                            connection.apiKeyConfigured,
                            "Der Schlüssel wird nur serverseitig verwendet und niemals zurückgeliefert.",
                          )}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
              <div className={styles.actions}>
                <button type="button" className={styles.secondary} onClick={addConnection}>
                  Verbindung hinzufügen
                </button>
              </div>
            </div>
          </details>

          <details className={styles.section}>
            <summary>Modelle ({settings.models.length})</summary>
            <div className={styles.sectionBody}>
              <p className={styles.hint}>
                Das aktive Modell gilt für neue Läufe. Fähigkeiten steuern die Anbieter-Parameter;
                Ausgabe- und Kontextgrenzen begrenzen Antwortlänge und Kontextfenster.
              </p>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => addModel(settings.connections[0]!.id)}
                  disabled={settings.connections.length === 0}
                >
                  Modell hinzufügen
                </button>
                {settings.connections.length === 0 ? (
                  <span className={styles.hint}>Zuerst eine Verbindung anlegen.</span>
                ) : null}
              </div>
              <label className={styles.checkRow}>
                <input
                  type="radio"
                  name="findog-agent-active-model"
                  checked={settings.activeModelId === null}
                  onChange={() => updateSettings((current) => ({ ...current, activeModelId: null }))}
                />
                Kein Modell aktiv
              </label>
              {settings.models.map((model) => {
                const connection = settings.connections.find((entry) => entry.id === model.connectionId);
                return (
                  <div className={styles.catalogItem} key={model.id}>
                    <div className={styles.catalogHead}>
                      <label className={styles.checkRow}>
                        <input
                          type="radio"
                          name="findog-agent-active-model"
                          checked={settings.activeModelId === model.id}
                          onChange={() => updateSettings((current) => ({ ...current, activeModelId: model.id }))}
                        />
                        Aktiv
                      </label>
                      <button type="button" className={styles.danger} onClick={() => removeModel(model.id)}>
                        Modell entfernen
                      </button>
                    </div>
                    <div className={styles.fieldGrid}>
                      <div className={styles.field}>
                        <label htmlFor={`model-label-${model.id}`}>Bezeichnung</label>
                        <input
                          id={`model-label-${model.id}`}
                          value={model.label}
                          onChange={(event) => patchModel(model.id, { label: event.target.value })}
                        />
                      </div>
                      <div className={styles.field}>
                        <label htmlFor={`model-connection-${model.id}`}>Verbindung</label>
                        <select
                          id={`model-connection-${model.id}`}
                          value={model.connectionId}
                          onChange={(event) => patchModel(model.id, { connectionId: event.target.value })}
                        >
                          {settings.connections.map((entry) => (
                            <option key={entry.id} value={entry.id}>{entry.name || entry.id}</option>
                          ))}
                        </select>
                      </div>
                      <div className={styles.field}>
                        <label htmlFor={`model-id-${model.id}`}>Modell-ID beim Anbieter</label>
                        <input
                          id={`model-id-${model.id}`}
                          value={model.model}
                          placeholder="z. B. deepseek-flash"
                          onChange={(event) => patchModel(model.id, { model: event.target.value })}
                        />
                      </div>
                      <div className={styles.field}>
                        <label htmlFor={`model-effort-${model.id}`}>Reasoning-Aufwand</label>
                        <select
                          id={`model-effort-${model.id}`}
                          value={model.reasoningEffort ?? ""}
                          onChange={(event) => patchModel(model.id, {
                            reasoningEffort: event.target.value === ""
                              ? null
                              : event.target.value as FindogAgentReasoningEffort,
                          })}
                        >
                          <option value="">nicht gesetzt</option>
                          {FINDOG_AGENT_REASONING_EFFORTS.map((effort) => (
                            <option key={effort} value={effort}>{EFFORT_LABELS[effort]}</option>
                          ))}
                        </select>
                      </div>
                      <div className={`${styles.field} ${styles.fieldSpan}`}>
                        <span className={styles.fieldLabel}>Fähigkeiten</span>
                        <div className={styles.actions}>
                          {CONFIGURABLE_CAPABILITIES.map((capability) => (
                            <label className={styles.checkRow} key={capability}>
                              <input
                                type="checkbox"
                                checked={model.capabilities.includes(capability)}
                                onChange={(event) => patchModel(model.id, {
                                  capabilities: toggleValue(model.capabilities, capability, event.target.checked),
                                })}
                              />
                              {CAPABILITY_LABELS[capability]}
                            </label>
                          ))}
                        </div>
                        <span className={styles.hint}>
                          Antworten werden vollständig geliefert; der Fortschritt eines Laufs wird
                          über Abfragen (Polling) angezeigt, nicht als Token-Stream.
                        </span>
                      </div>
                      <div className={styles.field}>
                        <label htmlFor={`model-output-${model.id}`}>Maximale Ausgabetokens (optional)</label>
                        <input
                          id={`model-output-${model.id}`}
                          type="number"
                          min={1}
                          value={model.maxOutputTokens ?? ""}
                          onChange={(event) => patchModel(model.id, { maxOutputTokens: numberOrNull(event.target.value) })}
                        />
                      </div>
                      <div className={styles.field}>
                        <label htmlFor={`model-context-${model.id}`}>Kontextfenster in Tokens (optional)</label>
                        <input
                          id={`model-context-${model.id}`}
                          type="number"
                          min={1000}
                          value={model.contextTokens ?? ""}
                          onChange={(event) => patchModel(model.id, { contextTokens: numberOrNull(event.target.value) })}
                        />
                      </div>
                      <div className={styles.field}>
                        <label htmlFor={`model-input-cost-${model.id}`}>Eingabepreis USD / Mio. Tokens (optional)</label>
                        <input
                          id={`model-input-cost-${model.id}`}
                          type="number"
                          min={0}
                          step="0.0001"
                          value={model.inputCostPerMillionUsd ?? ""}
                          onChange={(event) => patchModel(model.id, { inputCostPerMillionUsd: numberOrNull(event.target.value) })}
                        />
                      </div>
                      <div className={styles.field}>
                        <label htmlFor={`model-output-cost-${model.id}`}>Ausgabepreis USD / Mio. Tokens (optional)</label>
                        <input
                          id={`model-output-cost-${model.id}`}
                          type="number"
                          min={0}
                          step="0.0001"
                          value={model.outputCostPerMillionUsd ?? ""}
                          onChange={(event) => patchModel(model.id, { outputCostPerMillionUsd: numberOrNull(event.target.value) })}
                        />
                      </div>
                    </div>
                    <p className={styles.hint}>
                      Leere Preisangaben bedeuten „unbekannt“ und werden nie als 0 gerechnet.
                    </p>
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className={styles.secondary}
                        onClick={() => void runTest("model", model.id)}
                        disabled={revision === null}
                      >
                        Modell testen
                      </button>
                      <span className={styles.hint}>{TEST_HINTS.model} Verwendet die gespeicherte Revision.</span>
                    </div>
                    {testOutcomeFor("model", model.id)}
                    {connection && !connection.apiKeyConfigured ? (
                      <p className={styles.hint}>Für diese Verbindung ist kein Zugangsschlüssel gespeichert.</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </details>

          <details className={styles.section}>
            <summary>Wissensdatenbank (WeKnora)</summary>
            <div className={styles.sectionBody}>
              <label className={styles.checkRow} htmlFor="findog-agent-knowledge-enabled">
                <input
                  id="findog-agent-knowledge-enabled"
                  type="checkbox"
                  checked={settings.knowledge.enabled}
                  onChange={(event) => updateSettings((current) => ({
                    ...current,
                    knowledge: { ...current.knowledge, enabled: event.target.checked },
                  }))}
                />
                Wissensdatenbank für Recherchen verwenden
              </label>
              <div className={styles.fieldGrid}>
                <div className={`${styles.field} ${styles.fieldSpan}`}>
                  <label htmlFor="findog-agent-knowledge-url">WeKnora-Basis-URL</label>
                  <input
                    id="findog-agent-knowledge-url"
                    value={settings.knowledge.baseUrl ?? ""}
                    placeholder="https://weknora.example/api/v1"
                    onChange={(event) => updateSettings((current) => ({
                      ...current,
                      knowledge: { ...current.knowledge, baseUrl: event.target.value || null },
                    }))}
                  />
                  <p className={styles.hint}>Die Basis-URL muss mit /api/v1 enden.</p>
                </div>
                <div className={styles.fieldSpan}>
                  <SecretField
                    {...secretFieldProps(
                      FINDOG_AGENT_KNOWLEDGE_SECRET_NAME,
                      "WeKnora-API-Schlüssel",
                      settings.knowledge.apiKeyConfigured,
                      "Wird serverseitig als X-API-Key gesendet.",
                    )}
                  />
                </div>
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => void runTest("weknora", null)}
                  disabled={revision === null}
                >
                  Wissensbasen laden
                </button>
                <span className={styles.hint}>{TEST_HINTS.weknora} Verwendet die gespeicherte Revision.</span>
              </div>
              {testOutcomeFor("weknora", null)}
              {discoveredBases.length > 0 ? (
                <fieldset className={styles.legend}>
                  <legend>
                    Erlaubte Wissensbasen ({settings.knowledge.knowledgeBaseIds.length} ausgewählt)
                  </legend>
                  <ul className={styles.checkboxGrid}>
                    {discoveredBases.map((base) => (
                      <li className={styles.checkboxItem} key={base.id}>
                        <label className={styles.checkRow}>
                          <input
                            type="checkbox"
                            checked={settings.knowledge.knowledgeBaseIds.includes(base.id)}
                            onChange={(event) => toggleKnowledgeBase(base.id, event.target.checked)}
                          />
                          {base.name}
                        </label>
                        <span className={styles.hint}>
                          {base.id}{base.configured ? " · aktuell erlaubt" : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              ) : (
                <p className={styles.hint}>
                  Noch keine Wissensbasen geladen. Läufe dürfen ausschließlich die hier ausgewählten
                  Wissensbasen lesen.
                </p>
              )}
            </div>
          </details>

          <details className={styles.section}>
            <summary>Websuche (Exa)</summary>
            <div className={styles.sectionBody}>
              <div className={styles.fieldGrid}>
                <div className={styles.field}>
                  <label htmlFor="findog-agent-web-mode">Websuche</label>
                  <select
                    id="findog-agent-web-mode"
                    value={settings.web.mode}
                    onChange={(event) => updateSettings((current) => ({
                      ...current,
                      web: { ...current.web, mode: event.target.value as FindogAgentWebMode },
                    }))}
                  >
                    {FINDOG_AGENT_WEB_MODES.map((mode) => (
                      <option key={mode} value={mode}>{WEB_MODE_LABELS[mode]}</option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label htmlFor="findog-agent-web-domains">Erlaubte Domains (Komma-getrennt)</label>
                  <input
                    id="findog-agent-web-domains"
                    value={domainText}
                    placeholder="example.at, example.de"
                    onChange={(event) => {
                      const text = event.target.value;
                      setDomainText(text);
                      updateSettings((current) => ({
                        ...current,
                        web: {
                          ...current.web,
                          allowedDomains: text.split(",").map((entry) => entry.trim()).filter(Boolean),
                        },
                      }));
                    }}
                  />
                  <p className={styles.hint}>
                    Leer bedeutet keine Domaineinschränkung; Einschränkungen gelten für Suche und
                    Seitenabruf.
                  </p>
                </div>
                <div className={styles.field}>
                  <label htmlFor="findog-agent-web-results">Maximale Treffer pro Suche</label>
                  <input
                    id="findog-agent-web-results"
                    type="number"
                    min={1}
                    max={20}
                    value={settings.web.maxResults}
                    onChange={(event) => updateSettings((current) => ({
                      ...current,
                      web: { ...current.web, maxResults: Number(event.target.value) },
                    }))}
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="findog-agent-web-text">Maximale Zeichen pro Seite</label>
                  <input
                    id="findog-agent-web-text"
                    type="number"
                    min={500}
                    max={100000}
                    value={settings.web.maxTextCharacters}
                    onChange={(event) => updateSettings((current) => ({
                      ...current,
                      web: { ...current.web, maxTextCharacters: Number(event.target.value) },
                    }))}
                  />
                </div>
                <div className={styles.fieldSpan}>
                  <SecretField
                    {...secretFieldProps(
                      FINDOG_AGENT_EXA_SECRET_NAME,
                      "Exa-API-Schlüssel",
                      settings.web.exaApiKeyConfigured,
                      "Wird serverseitig als x-api-key gesendet; die Ziel-URL ist fest auf api.exa.ai begrenzt.",
                    )}
                  />
                </div>
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => void runTest("exa", null)}
                  disabled={revision === null}
                >
                  Websuche testen
                </button>
                <span className={styles.hint}>{TEST_HINTS.exa} Verwendet die gespeicherte Revision.</span>
              </div>
              {testOutcomeFor("exa", null)}
            </div>
          </details>

          <details className={styles.section}>
            <summary>MCP-Werkzeuge ({settings.mcp.servers.length})</summary>
            <div className={styles.sectionBody}>
              <p className={styles.hint}>
                Unterstützt wird ausschließlich Streamable HTTP mit optionalem Bearer-Token. Nur hier
                ausdrücklich freigegebene Werkzeuge dürfen ausgeführt werden; Hinweise des Servers
                sind keine Freigabe.
              </p>
              {settings.mcp.servers.map((server) => {
                const discovery = tests[testKey("mcp", server.id)];
                const tools = discovery && discovery !== "pending" ? asMcpTools(discovery.detail) : [];
                return (
                  <div className={styles.catalogItem} key={server.id}>
                    <div className={styles.catalogHead}>
                      <strong>{server.name || server.id}</strong>
                      <button type="button" className={styles.danger} onClick={() => removeMcpServer(server.id)}>
                        MCP-Server entfernen
                      </button>
                    </div>
                    <div className={styles.fieldGrid}>
                      <div className={styles.field}>
                        <label htmlFor={`mcp-name-${server.id}`}>Name</label>
                        <input
                          id={`mcp-name-${server.id}`}
                          value={server.name}
                          onChange={(event) => patchMcpServer(server.id, { name: event.target.value })}
                        />
                      </div>
                      <div className={styles.field}>
                        <label htmlFor={`mcp-url-${server.id}`}>Streamable-HTTP-URL</label>
                        <input
                          id={`mcp-url-${server.id}`}
                          value={server.url}
                          placeholder="https://mcp.example/mcp"
                          onChange={(event) => patchMcpServer(server.id, { url: event.target.value })}
                        />
                      </div>
                      <div className={styles.fieldSpan}>
                        <SecretField
                          {...secretFieldProps(
                            findogAgentMcpSecretName(server.id),
                            `Bearer-Token für ${server.name || server.id}`,
                            server.bearerConfigured,
                            "Optional: Server ohne Authentifizierung bleiben zulässig.",
                          )}
                        />
                      </div>
                    </div>
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className={styles.secondary}
                        onClick={() => void runTest("mcp", server.id)}
                        disabled={revision === null}
                      >
                        Werkzeuge laden
                      </button>
                      <span className={styles.hint}>{TEST_HINTS.mcp} Verwendet die gespeicherte Revision.</span>
                    </div>
                    {testOutcomeFor("mcp", server.id)}
                    {tools.length > 0 ? (
                      <fieldset className={styles.legend}>
                        <legend>Freigegebene Werkzeuge ({server.allowedTools.length})</legend>
                        <ul className={styles.checkboxGrid}>
                          {tools.map((tool) => (
                            <li className={styles.checkboxItem} key={tool.name}>
                              <label className={styles.checkRow}>
                                <input
                                  type="checkbox"
                                  checked={server.allowedTools.includes(tool.name)}
                                  onChange={(event) => toggleMcpTool(server.id, tool.name, event.target.checked)}
                                />
                                {tool.name}
                              </label>
                              {tool.description ? <span className={styles.hint}>{tool.description}</span> : null}
                              <span className={styles.hint}>
                                {tool.readOnlyHint
                                  ? "vom Server als schreibgeschützt gekennzeichnet"
                                  : "nicht als schreibgeschützt gekennzeichnet"}
                                {tool.approved ? " · in der gespeicherten Revision freigegeben" : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </fieldset>
                    ) : (
                      <p className={styles.hint}>
                        Noch keine Werkzeugliste geladen. Ein neuer Server muss zuerst gespeichert
                        werden, damit die Erkennung ihn authentifizieren kann.
                      </p>
                    )}
                  </div>
                );
              })}
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={addMcpServer}
                  disabled={settings.mcp.servers.length >= FINDOG_AGENT_LIMITS.maxMcpServers}
                >
                  MCP-Server hinzufügen
                </button>
              </div>
            </div>
          </details>

          <details className={styles.section}>
            <summary>Ausführungsgrenzen und Budget</summary>
            <div className={styles.sectionBody}>
              <div className={styles.fieldGrid}>
                <div className={styles.field}>
                  <label htmlFor="findog-agent-timeout">Zeitlimit pro Anbieteraufruf (Sekunden)</label>
                  <input
                    id="findog-agent-timeout"
                    type="number"
                    min={5}
                    max={600}
                    value={settings.limits.requestTimeoutSeconds}
                    onChange={(event) => patchLimits({ requestTimeoutSeconds: Number(event.target.value) })}
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="findog-agent-deadline">Gesamtfrist pro Lauf (Sekunden)</label>
                  <input
                    id="findog-agent-deadline"
                    type="number"
                    min={10}
                    max={3600}
                    value={settings.limits.deadlineSeconds}
                    onChange={(event) => patchLimits({ deadlineSeconds: Number(event.target.value) })}
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="findog-agent-steps">Maximale Modellschritte</label>
                  <input
                    id="findog-agent-steps"
                    type="number"
                    min={1}
                    max={100}
                    value={settings.limits.maxSteps}
                    onChange={(event) => patchLimits({ maxSteps: Number(event.target.value) })}
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="findog-agent-tools">Maximale Werkzeugaufrufe</label>
                  <input
                    id="findog-agent-tools"
                    type="number"
                    min={1}
                    max={200}
                    value={settings.limits.maxToolCalls}
                    onChange={(event) => patchLimits({ maxToolCalls: Number(event.target.value) })}
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="findog-agent-output">Maximale Ausgabetokens</label>
                  <input
                    id="findog-agent-output"
                    type="number"
                    min={1}
                    max={200000}
                    value={settings.limits.maxOutputTokens}
                    onChange={(event) => patchLimits({ maxOutputTokens: Number(event.target.value) })}
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="findog-agent-budget">Geschätztes Kostenlimit in USD (optional)</label>
                  <input
                    id="findog-agent-budget"
                    type="number"
                    min={0}
                    step="0.01"
                    value={settings.limits.estimatedCostLimitUsd ?? ""}
                    onChange={(event) => patchLimits({ estimatedCostLimitUsd: numberOrNull(event.target.value) })}
                  />
                  <p className={styles.hint}>
                    Das Limit gilt nur für messbare Schätzungen. Sind Kosten nicht messbar, bricht der
                    Lauf ab, statt weiterzurechnen.
                  </p>
                </div>
              </div>
            </div>
          </details>
        </div>
      ) : null}
    </section>
  );
}
