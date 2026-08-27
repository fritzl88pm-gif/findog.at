"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  OpenRouterAdminUsageSnapshot,
  OpenRouterCreditsSnapshot,
  OpenRouterUsageRange,
} from "@/lib/openrouter-usage-types";

type AdminOpenRouterUsageProps = {
  accessToken: string;
};

const RANGE_OPTIONS: Array<{ value: OpenRouterUsageRange; label: string }> = [
  { value: "24h", label: "Heute (24 Stunden)" },
  { value: "7d", label: "7 Tage" },
  { value: "30d", label: "30 Tage" },
];

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function snapshotFromPayload(value: unknown): OpenRouterAdminUsageSnapshot | null {
  const payload = optionalRecord(value);
  if (
    !payload
    || typeof payload.generatedAt !== "string"
    || typeof payload.stale !== "boolean"
    || (payload.range !== "24h" && payload.range !== "7d" && payload.range !== "30d")
    || !("credits" in payload)
    || !("summary" in payload)
    || !("models" in payload)
    || !("keys" in payload)
    || !("dailyTrend" in payload)
    || !("fredUsers" in payload)
    || !Array.isArray(payload.models)
    || !Array.isArray(payload.keys)
    || !Array.isArray(payload.dailyTrend)
    || (payload.warning !== undefined && typeof payload.warning !== "string")
  ) {
    return null;
  }
  return value as OpenRouterAdminUsageSnapshot;
}

function payloadError(value: unknown, fallback: string): string {
  const record = optionalRecord(value);
  return typeof record?.error === "string" ? record.error : fallback;
}

function formatNumber(value: number | null | undefined, digits = 0): string {
  return value === null || value === undefined
    ? "–"
    : new Intl.NumberFormat("de-AT", {
      maximumFractionDigits: digits,
      minimumFractionDigits: 0,
    }).format(value);
}

function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? "–" : `${formatNumber(value, 1)} %`;
}

function formatCost(value: number | null | undefined): string {
  return value === null || value === undefined ? "–" : `$ ${formatNumber(value, 4)}`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "–";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "–";
  return `${new Intl.DateTimeFormat("de-AT", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Vienna",
  }).format(date)} Uhr`;
}

function formatDuration(value: number | null | undefined): string {
  if (value === null || value === undefined) return "–";
  if (value < 1_000) return `${formatNumber(value)} ms`;
  if (value < 60_000) return `${formatNumber(value / 1_000, 1)} s`;
  return `${formatNumber(value / 60_000, 1)} min`;
}

function progressValue(value: number | null | undefined): number {
  if (value === null || value === undefined || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="admin-omniroute-metric">
      <dt>{label}</dt>
      <dd>{value}</dd>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

function CreditsPanel({
  credits,
  periodCost,
  generatedAt,
  headingId,
}: {
  credits: OpenRouterCreditsSnapshot | null;
  periodCost: number | null | undefined;
  generatedAt: string | undefined;
  headingId: string;
}) {
  return (
    <section className="admin-omniroute-section" aria-labelledby={headingId}>
      <h3 id={headingId}>Guthaben</h3>
      <div className="admin-omniroute-quota">
        <div className="admin-omniroute-progress">
          <div className="admin-omniroute-progress-label">
            <span>Verbleibend</span>
            <strong>{formatPercent(credits?.remainingPercent)}</strong>
          </div>
          {credits?.remainingPercent !== null && credits?.remainingPercent !== undefined ? (
            <div
              role="progressbar"
              aria-labelledby={headingId}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressValue(credits.remainingPercent)}
              aria-valuetext={`${formatNumber(credits.remainingPercent, 1)} Prozent verbleibend`}
            >
              <span style={{ width: `${progressValue(credits.remainingPercent)}%` }} />
            </div>
          ) : (
            <p className="admin-empty-state">Keine Quotenwerte vorhanden.</p>
          )}
        </div>
        <dl className="admin-omniroute-metrics">
          <Metric label="Gekaufte Credits (USD)" value={formatCost(credits?.totalCredits)} />
          <Metric label="Verbrauch gesamt (USD)" value={formatCost(credits?.totalUsage)} />
          <Metric label="Verbleibend (USD)" value={formatCost(credits?.remaining)} />
          <Metric label="Verbrauch im gewählten Zeitraum (USD)" value={formatCost(periodCost)} />
          <Metric label="Letzte Aktualisierung" value={formatDateTime(generatedAt)} />
        </dl>
      </div>
    </section>
  );
}

export default function AdminOpenRouterUsage({ accessToken }: AdminOpenRouterUsageProps) {
  const [range, setRange] = useState<OpenRouterUsageRange>("24h");
  const [snapshot, setSnapshot] = useState<OpenRouterAdminUsageSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const loadIdRef = useRef(0);

  const load = useCallback(async (selectedRange: OpenRouterUsageRange, refresh: boolean, signal?: AbortSignal) => {
    if (!accessToken) {
      setError("Kein Administrationszugriff vorhanden.");
      setIsLoading(false);
      return;
    }
    const loadId = ++loadIdRef.current;
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/openrouter-usage?range=${encodeURIComponent(selectedRange)}${refresh ? "&refresh=1" : ""}`, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Authorization: `Bearer ${accessToken}` },
        signal,
      });
      const payload = await response.json().catch(() => null) as unknown;
      if (!response.ok) throw new Error(payloadError(payload, "Die OpenRouter-Nutzung konnte nicht geladen werden."));
      const nextSnapshot = snapshotFromPayload(payload);
      if (!nextSnapshot) throw new Error("Die OpenRouter-Nutzung konnte nicht geladen werden.");
      if (loadIdRef.current !== loadId) return;
      setSnapshot(nextSnapshot);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      if (loadIdRef.current !== loadId) return;
      setError(loadError instanceof Error
        ? loadError.message
        : "Die OpenRouter-Nutzung konnte nicht geladen werden.");
    } finally {
      if (loadIdRef.current === loadId) setIsLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    const controller = new AbortController();
    const loadFrame = window.requestAnimationFrame(() => void load(range, false, controller.signal));
    return () => {
      window.cancelAnimationFrame(loadFrame);
      controller.abort();
    };
  }, [load, range]);

  const credits = snapshot?.credits ?? null;
  const summary = snapshot?.summary ?? null;
  const models = snapshot?.models ?? [];
  const keys = snapshot?.keys ?? [];
  const dailyTrend = snapshot?.dailyTrend ?? [];
  const fredUsers = snapshot?.fredUsers;

  return (
    <section
      className="admin-omniroute-panel"
      role="tabpanel"
      id="admin-panel-openrouter"
      aria-labelledby="admin-tab-openrouter"
    >
      <div className="form-generator-card admin-omniroute-card">
        <div className="admin-omniroute-heading">
          <div>
            <h2>OpenRouter-Nutzung</h2>
            <p>Kosten, Modelle, API-Keys und Fred-Nutzung</p>
          </div>
          <div className="admin-omniroute-controls">
            <label htmlFor="admin-omniroute-range">Zeitraum</label>
            <select
              id="admin-omniroute-range"
              value={range}
              onChange={(event) => setRange(event.target.value as OpenRouterUsageRange)}
              disabled={isLoading}
            >
              {RANGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <button
              className="secondary-button compact-button"
              type="button"
              onClick={() => void load(range, true)}
              disabled={isLoading || !accessToken}
            >
              {isLoading ? "Wird aktualisiert …" : "Aktualisieren"}
            </button>
          </div>
        </div>

        {error ? <div className="error-box" role="alert">{error}</div> : null}
        {snapshot?.warning ? (
          <div className="notice-box" role="status">
            Veraltete Daten: {snapshot.warning}
          </div>
        ) : null}
        {snapshot?.truncated ? (
          <div className="notice-box" role="status">
            Der Abfragezeitraum enthält mehr Einträge als das Abfragelimit. Die Statistik ist möglicherweise unvollständig.
          </div>
        ) : null}
        {snapshot?.warnings && snapshot.warnings.length > 0 ? (
          <div className="notice-box" role="status">
            {snapshot.warnings.join(" · ")}
          </div>
        ) : null}

        {isLoading && !snapshot ? (
          <p className="admin-empty-state" role="status">OpenRouter-Daten werden geladen …</p>
        ) : !snapshot ? (
          <p className="admin-empty-state">Keine OpenRouter-Daten verfügbar.</p>
        ) : (
          <>
            <p className="admin-omniroute-updated">
              Zuletzt aktualisiert:{" "}
              <time dateTime={snapshot.generatedAt}>{formatDateTime(snapshot.generatedAt)}</time>
            </p>

            <CreditsPanel
              headingId="admin-openrouter-credits-title"
              credits={credits}
              periodCost={summary?.totalCost}
              generatedAt={snapshot.generatedAt}
            />

            <section className="admin-omniroute-section" aria-labelledby="admin-openrouter-usage-title">
              <h3 id="admin-openrouter-usage-title">Nutzung im Zeitraum</h3>
              <dl className="admin-omniroute-metrics">
                <Metric label="OpenRouter-Aufrufe" value={formatNumber(summary?.requests)} />
                <Metric label="Eingabe-Tokens" value={formatNumber(summary?.promptTokens)} detail="Token" />
                <Metric label="Ausgabe-Tokens" value={formatNumber(summary?.completionTokens)} detail="Token" />
                <Metric label="Reasoning-Tokens" value={formatNumber(summary?.reasoningTokens)} detail="Token" />
                <Metric label="Tokens gesamt" value={formatNumber(summary?.totalTokens)} detail="Token" />
                <Metric
                  label="Cache-Tokens"
                  value={formatNumber(summary?.cachedTokens)}
                  detail={summary?.cacheHitRate !== null && summary?.cacheHitRate !== undefined ? `Hit-Rate: ${formatPercent(summary.cacheHitRate)}` : "Token"}
                />
                <Metric label="Durchschnittliche Latenz" value={formatDuration(summary?.avgLatencyMs)} />
                <Metric label="p90-Latenz" value={formatDuration(summary?.p90LatencyMs)} />
                <Metric label="Kosten (USD)" value={formatCost(summary?.totalCost)} />
              </dl>
            </section>

            <section className="admin-omniroute-section" aria-labelledby="admin-openrouter-models-title">
              <h3 id="admin-openrouter-models-title">Modelle und Provider</h3>
              {models.length > 0 ? (
                <div className="admin-omniroute-table-wrap">
                  <table>
                    <caption>Nutzung nach Modell und Provider</caption>
                    <thead>
                      <tr>
                        <th scope="col">Modell</th>
                        <th scope="col">Provider</th>
                        <th scope="col">Aufrufe</th>
                        <th scope="col">Eingabe-Tokens</th>
                        <th scope="col">Ausgabe-Tokens</th>
                        <th scope="col">Reasoning-Tokens</th>
                        <th scope="col">Kosten (USD)</th>
                        <th scope="col">Ø Latenz</th>
                      </tr>
                    </thead>
                    <tbody>
                      {models.map((model) => (
                        <tr key={`${model.provider}-${model.model}`}>
                          <th scope="row">{model.model}</th>
                          <td>{model.provider}</td>
                          <td>{formatNumber(model.requests)}</td>
                          <td>{formatNumber(model.promptTokens)}</td>
                          <td>{formatNumber(model.completionTokens)}</td>
                          <td>{formatNumber(model.reasoningTokens)}</td>
                          <td>{formatCost(model.cost)}</td>
                          <td>{formatDuration(model.avgLatencyMs)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="admin-empty-state">Keine Modellnutzung im ausgewählten Zeitraum.</p>
              )}
            </section>

            <section className="admin-omniroute-section" aria-labelledby="admin-openrouter-keys-title">
              <h3 id="admin-openrouter-keys-title">API-Key-Nutzung</h3>
              {keys.length > 0 ? (
                <div className="admin-omniroute-table-wrap">
                  <table>
                    <caption>Nutzung nach OpenRouter-API-Key</caption>
                    <thead>
                      <tr>
                        <th scope="col">API-Key-Name</th>
                        <th scope="col">Aufrufe</th>
                        <th scope="col">Kosten im Zeitraum (USD)</th>
                        <th scope="col">Kosten heute</th>
                        <th scope="col">Kosten Woche</th>
                        <th scope="col">Kosten Monat</th>
                        <th scope="col">Limit / verbleibend</th>
                      </tr>
                    </thead>
                    <tbody>
                      {keys.map((key) => (
                        <tr key={key.id || key.name}>
                          <th scope="row">{key.name}</th>
                          <td>{formatNumber(key.requests)}</td>
                          <td>{formatCost(key.cost)}</td>
                          <td>{formatCost(key.usageDaily)}</td>
                          <td>{formatCost(key.usageWeekly)}</td>
                          <td>{formatCost(key.usageMonthly)}</td>
                          <td>
                            {key.limit !== null
                              ? `${formatCost(key.limit)} / ${formatCost(key.remainingLimit)}`
                              : "Unbegrenzt"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="admin-empty-state">Keine API-Key-Nutzungsdaten vorhanden.</p>
              )}
            </section>

            <section className="admin-omniroute-section" aria-labelledby="admin-openrouter-trend-title">
              <h3 id="admin-openrouter-trend-title">Zeitverlauf</h3>
              {dailyTrend.length > 0 ? (
                <div className="admin-omniroute-table-wrap">
                  <table>
                    <caption>Zeitverlauf im ausgewählten Zeitraum</caption>
                    <thead>
                      <tr>
                        <th scope="col">Zeitraum</th>
                        <th scope="col">Aufrufe</th>
                        <th scope="col">Tokens</th>
                        <th scope="col">Kosten (USD)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyTrend.map((bucket) => (
                        <tr key={bucket.date}>
                          <th scope="row"><time dateTime={bucket.date}>{bucket.date}</time></th>
                          <td>{formatNumber(bucket.requests)}</td>
                          <td>{formatNumber(bucket.tokens)}</td>
                          <td>{formatCost(bucket.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="admin-empty-state">Kein Zeitverlauf vorhanden.</p>
              )}
            </section>

            <section className="admin-omniroute-section" aria-labelledby="admin-openrouter-users-title">
              <h3 id="admin-openrouter-users-title">Fred-Nutzung nach User</h3>
              <p className="admin-omniroute-attribution-note">
                Anfragen sind exakt. Der Kostenanteil wird proportional aus den Kosten des gemeinsamen OpenRouter-Keys „WeKnora“ geschätzt; OpenRouter erhält derzeit keine Findog-User-ID.
              </p>
              {fredUsers && (fredUsers.users.length > 0 || fredUsers.systemRemainder) ? (
                <div className="admin-omniroute-table-wrap">
                  <table>
                    <caption>Fred-Anfragen und geschätzter Kostenanteil pro User</caption>
                    <thead>
                      <tr>
                        <th scope="col">User (E-Mail)</th>
                        <th scope="col">Fred-Fragen (exakt)</th>
                        <th scope="col">Anteil an Fred-Fragen</th>
                        <th scope="col">Kostenanteil (Schätzung)</th>
                        <th scope="col">Letzte Frage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fredUsers.users.map((user) => (
                        <tr key={user.clientId ?? user.email}>
                          <th scope="row">{user.email}</th>
                          <td>{formatNumber(user.questions)}</td>
                          <td>{formatPercent(user.questionSharePct)}</td>
                          <td>{formatCost(user.estimatedCost)}</td>
                          <td>{formatDateTime(user.lastQuestionAt)}</td>
                        </tr>
                      ))}
                      {fredUsers.systemRemainder ? (
                        <tr key="system-remainder" className="admin-omniroute-provider-row">
                          <th scope="row">{fredUsers.systemRemainder.email || "System / nicht zugeordnet"}</th>
                          <td>{formatNumber(fredUsers.systemRemainder.questions)}</td>
                          <td>{formatPercent(fredUsers.systemRemainder.questionSharePct)}</td>
                          <td>{formatCost(fredUsers.systemRemainder.estimatedCost)}</td>
                          <td>{formatDateTime(fredUsers.systemRemainder.lastQuestionAt)}</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="admin-empty-state">Keine Fred-Nutzungsdaten im ausgewählten Zeitraum vorhanden.</p>
              )}
            </section>
          </>
        )}
      </div>
    </section>
  );
}
