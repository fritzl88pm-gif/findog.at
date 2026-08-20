"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  OmniRouteAdminUsageSnapshot,
  OmniRouteQuotaSnapshot,
  OmniRouteModelHealth,
  OmniRouteProviderHealth,
  OmniRouteUsageRange,
} from "@/lib/omniroute-usage-types";

type AdminOmniRouteUsageProps = {
  accessToken: string;
};

const RANGE_OPTIONS: Array<{ value: OmniRouteUsageRange; label: string }> = [
  { value: "24h", label: "Heute (24 Stunden)" },
  { value: "7d", label: "7 Tage" },
  { value: "30d", label: "30 Tage" },
];

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function snapshotFromPayload(value: unknown): OmniRouteAdminUsageSnapshot | null {
  const payload = optionalRecord(value);
  if (
    !payload
    || typeof payload.generatedAt !== "string"
    || typeof payload.stale !== "boolean"
    || (payload.range !== "24h" && payload.range !== "7d" && payload.range !== "30d")
    || !("quota" in payload)
    || !("codexQuota" in payload)
    || !("usage" in payload)
    || !("combo" in payload)
    || !Array.isArray(payload.providerHealth)
    || (payload.warning !== undefined && typeof payload.warning !== "string")
  ) {
    return null;
  }
  return value as OmniRouteAdminUsageSnapshot;
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
  return value === null || value === undefined ? "–" : formatNumber(value, 4);
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

function metricValue(value: string | number, unit?: string): string {
  return unit ? `${value} ${unit}` : String(value);
}

function remainingAtSnapshot(value: number | null, generatedAt: string | undefined): number | null {
  if (value === null) return null;
  const elapsed = generatedAt ? Math.max(0, Date.now() - new Date(generatedAt).getTime()) : 0;
  return value - elapsed;
}

function isRateLimited(
  provider: OmniRouteProviderHealth | undefined,
  generatedAt: string | undefined,
): boolean {
  if (!provider) return false;
  if ((remainingAtSnapshot(provider.cooldownRemainingMs, generatedAt) ?? 0) > 0) return true;
  return provider.models.some((model: OmniRouteModelHealth) => {
    if (!model.isLockedOut) return false;
    const remaining = remainingAtSnapshot(model.lockoutRemainingMs, generatedAt);
    return remaining === null || remaining > 0;
  })
    || (provider.rateLimitedUntil !== null && new Date(provider.rateLimitedUntil).getTime() > Date.now());
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

function normalizedQuotaUsage(quota: OmniRouteQuotaSnapshot | null): string {
  if (!quota) return "–";
  if (quota.unlimited) {
    return quota.used === null
      ? "Unbegrenzt"
      : `${formatNumber(quota.used)} Einheiten · unbegrenzt`;
  }
  if (quota.used === null || quota.total === null) return "–";
  return metricValue(`${formatNumber(quota.used)} / ${formatNumber(quota.total)}`, "Einheiten");
}

function QuotaPanel({
  title,
  quota,
  health,
  generatedAt,
  headingId,
}: {
  title: string;
  quota: OmniRouteQuotaSnapshot | null;
  health: OmniRouteProviderHealth | undefined;
  generatedAt: string | undefined;
  headingId: string;
}) {
  return (
    <section className="admin-omniroute-section" aria-labelledby={headingId}>
      <h3 id={headingId}>{title}</h3>
      <div className="admin-omniroute-quota">
        <div className="admin-omniroute-progress">
          <div className="admin-omniroute-progress-label">
            <span>Verbleibend</span>
            <strong>{formatPercent(quota?.remainingPercent)}</strong>
          </div>
          {quota?.remainingPercent !== null && quota?.remainingPercent !== undefined ? (
            <div
              role="progressbar"
              aria-labelledby={headingId}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressValue(quota.remainingPercent)}
              aria-valuetext={`${formatNumber(quota.remainingPercent, 1)} Prozent verbleibend`}
            >
              <span style={{ width: `${progressValue(quota.remainingPercent)}%` }} />
            </div>
          ) : (
            <p className="admin-empty-state">Keine Quotenwerte vorhanden.</p>
          )}
        </div>
        <dl className="admin-omniroute-metrics">
          <Metric label="Normalisierte Nutzung" value={normalizedQuotaUsage(quota)} />
          <Metric label="Verbleibende Einheiten" value={quota?.remaining === null || quota?.remaining === undefined ? "–" : formatNumber(quota.remaining)} />
          <Metric label="Reset / Fenster" value={formatDateTime(quota?.resetAt)} detail={quota?.quotaLabel ?? undefined} />
          <Metric label="Plan" value={quota?.plan ?? "–"} />
          <Metric label="Quota-Quelle" value={quota?.source ?? "–"} />
          <Metric label="Letzte Quota-Synchronisation" value={formatDateTime(quota?.quotaFetchedAt)} />
          <Metric
            label="Quota-Intervall"
            value={quota?.quotaSyncIntervalMinutes === null || quota?.quotaSyncIntervalMinutes === undefined
              ? "–"
              : metricValue(formatNumber(quota.quotaSyncIntervalMinutes), "Minuten")}
          />
          <Metric
            label="Aktiver Cooldown / Rate-Limit"
            value={isRateLimited(health, generatedAt) ? "Aktiv" : "Nein"}
            detail={health?.cooldownRemainingMs
              ? `Verbleibend ${formatDuration(remainingAtSnapshot(health.cooldownRemainingMs, generatedAt))}`
              : health?.rateLimitedUntil
                ? `Bis ${formatDateTime(health.rateLimitedUntil)}`
                : undefined}
          />
        </dl>
      </div>
    </section>
  );
}

export default function AdminOmniRouteUsage({ accessToken }: AdminOmniRouteUsageProps) {
  const [range, setRange] = useState<OmniRouteUsageRange>("24h");
  const [snapshot, setSnapshot] = useState<OmniRouteAdminUsageSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const loadIdRef = useRef(0);

  const load = useCallback(async (selectedRange: OmniRouteUsageRange, refresh: boolean, signal?: AbortSignal) => {
    if (!accessToken) {
      setError("Kein Administrationszugriff vorhanden.");
      setIsLoading(false);
      return;
    }
    const loadId = ++loadIdRef.current;
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/omniroute-usage?range=${encodeURIComponent(selectedRange)}${refresh ? "&refresh=1" : ""}`, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Authorization: `Bearer ${accessToken}` },
        signal,
      });
      const payload = await response.json().catch(() => null) as unknown;
      if (!response.ok) throw new Error(payloadError(payload, "Die OmniRoute-Nutzung konnte nicht geladen werden."));
      const nextSnapshot = snapshotFromPayload(payload);
      if (!nextSnapshot) throw new Error("Die OmniRoute-Nutzung konnte nicht geladen werden.");
      if (loadIdRef.current !== loadId) return;
      setSnapshot(nextSnapshot);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      if (loadIdRef.current !== loadId) return;
      setError(loadError instanceof Error
        ? loadError.message
        : "Die OmniRoute-Nutzung konnte nicht geladen werden.");
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

  const quota = snapshot?.quota ?? null;
  const summary = snapshot?.usage.summary ?? null;
  const combo = snapshot?.combo ?? null;
  const codexQuota = snapshot?.codexQuota ?? null;
  const codexHealth = snapshot?.providerHealth.find((provider) => provider.provider === "codex");
  const geminiHealth = snapshot?.providerHealth.find((provider) => provider.provider === "gemini");

  return (
    <section
      className="admin-omniroute-panel"
      role="tabpanel"
      id="admin-panel-omniroute"
      aria-labelledby="admin-tab-omniroute"
    >
      <div className="form-generator-card admin-omniroute-card">
        <div className="admin-omniroute-heading">
          <div>
            <h2>Codex, Gemini &amp; OmniRoute</h2>
            <p>Geschützte Serverauswertung von Codex-OAuth- und Gemini-Quoten, Nutzung, Route und Provider-Health.</p>
          </div>
          <div className="admin-omniroute-controls">
            <label htmlFor="admin-omniroute-range">Zeitraum</label>
            <select
              id="admin-omniroute-range"
              value={range}
              onChange={(event) => setRange(event.target.value as OmniRouteUsageRange)}
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

        {isLoading && !snapshot ? (
          <p className="admin-empty-state" role="status">OmniRoute-Daten werden geladen …</p>
        ) : !snapshot ? (
          <p className="admin-empty-state">Keine OmniRoute-Daten verfügbar.</p>
        ) : (
          <>
            <p className="admin-omniroute-updated">
              Zuletzt aktualisiert:{" "}
              <time dateTime={snapshot.generatedAt}>{formatDateTime(snapshot.generatedAt)}</time>
            </p>

            <QuotaPanel
              title="Codex OAuth Quota"
              headingId="admin-omniroute-codex-quota-title"
              quota={codexQuota}
              health={codexHealth}
              generatedAt={snapshot.generatedAt}
            />
            <QuotaPanel
              title="Gemini Flash Pool"
              headingId="admin-omniroute-quota-title"
              quota={quota}
              health={geminiHealth}
              generatedAt={snapshot.generatedAt}
            />

            <section className="admin-omniroute-section" aria-labelledby="admin-omniroute-usage-title">
              <h3 id="admin-omniroute-usage-title">OmniRoute-Nutzung</h3>
              <dl className="admin-omniroute-metrics">
                <Metric label="Anfragen" value={formatNumber(summary?.totalRequests)} />
                <Metric label="Eingabe-Tokens" value={formatNumber(summary?.promptTokens)} detail="Token" />
                <Metric label="Ausgabe-Tokens" value={formatNumber(summary?.completionTokens)} detail="Token" />
                <Metric label="Tokens insgesamt" value={formatNumber(summary?.totalTokens)} detail="Token" />
                <Metric label="Erfolgsquote" value={formatPercent(summary?.successRatePct)} />
                <Metric label="Durchschnittliche Latenz" value={formatDuration(summary?.avgLatencyMs)} />
                <Metric label="Kosten (USD)" value={formatCost(summary?.totalCost)} />
                <Metric label="Letzte Anfrage" value={formatDateTime(summary?.lastRequest)} />
                <Metric label="Fallbacks" value={formatNumber(summary?.fallbackCount)} />
              </dl>
            </section>

            <section className="admin-omniroute-section" aria-labelledby="admin-omniroute-route-title">
              <h3 id="admin-omniroute-route-title">Aktive Route</h3>
              {combo ? (
                <>
                  <dl className="admin-omniroute-metrics">
                    <Metric label="Combo" value={combo.name} />
                    <Metric label="Prioritäts-Strategie" value={combo.strategy ?? "–"} />
                    <Metric label="Primäres Ziel (Luna Max via Codex OAuth)" value={combo.targets[0] ?? "–"} />
                    <Metric label="Fallback-Ziel (Gemini 3.7 Flash High)" value={combo.targets[1] ?? "–"} />
                    <Metric label="Produktionsstatus" value={combo.productionTraffic ? "Produktion" : "Kein Produktions-Traffic"} />
                    <Metric label="Erfolgreiche Anfragen" value={formatNumber(combo.successes)} />
                    <Metric label="Fehler" value={formatNumber(combo.failures)} />
                    <Metric label="Fallbacks" value={formatNumber(combo.fallbacks)} />
                    <Metric label="Letzte Nutzung" value={formatDateTime(combo.lastUsedAt)} />
                  </dl>
                  {combo.models.length > 0 ? (
                    <div className="admin-omniroute-table-wrap">
                      <table>
                        <caption>Combo-Modellstatus</caption>
                        <thead>
                          <tr>
                            <th scope="col">Modell</th>
                            <th scope="col">Anfragen</th>
                            <th scope="col">Erfolge</th>
                            <th scope="col">Fehler</th>
                            <th scope="col">Latenz</th>
                            <th scope="col">Letzter Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {combo.models.map((model) => (
                            <tr key={model.model}>
                              <th scope="row">{model.model}</th>
                              <td>{formatNumber(model.requests)}</td>
                              <td>{formatNumber(model.successes)}</td>
                              <td>{formatNumber(model.failures)}</td>
                              <td>{formatDuration(model.avgLatencyMs)}</td>
                              <td>{model.lastStatus ?? "–"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="admin-empty-state">Keine Combo-Modellwerte vorhanden.</p>
                  )}
                </>
              ) : (
                <p className="admin-empty-state">Keine aktive Codex/Gemini-Combo gefunden.</p>
              )}
            </section>

            <section className="admin-omniroute-section" aria-labelledby="admin-omniroute-breakdown-title">
              <h3 id="admin-omniroute-breakdown-title">Provider und Modell</h3>
              {snapshot.usage.models.length > 0 || snapshot.usage.providers.length > 0 ? (
                <div className="admin-omniroute-table-wrap">
                  <table>
                    <caption>Nutzung nach Provider und Modell</caption>
                    <thead>
                      <tr>
                        <th scope="col">Provider</th>
                        <th scope="col">Modell</th>
                        <th scope="col">Anfragen</th>
                        <th scope="col">Tokens</th>
                        <th scope="col">Kosten</th>
                        <th scope="col">Erfolgsquote</th>
                        <th scope="col">Latenz</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.usage.models.map((model) => (
                        <tr key={`${model.provider}-${model.model}`}>
                          <th scope="row">{model.provider}</th>
                          <td>{model.model}</td>
                          <td>{formatNumber(model.requests)}</td>
                          <td>{formatNumber(model.totalTokens)}</td>
                          <td>{formatCost(model.cost)}</td>
                          <td>{formatPercent(model.successRatePct)}</td>
                          <td>{formatDuration(model.avgLatencyMs)}</td>
                        </tr>
                      ))}
                      {snapshot.usage.providers.map((provider) => (
                        <tr key={`provider-${provider.provider}`} className="admin-omniroute-provider-row">
                          <th scope="row">{provider.provider}</th>
                          <td>Provider-Summe</td>
                          <td>{formatNumber(provider.requests)}</td>
                          <td>{formatNumber(provider.totalTokens)}</td>
                          <td>{formatCost(provider.cost)}</td>
                          <td>{formatPercent(provider.successRatePct)}</td>
                          <td>{formatDuration(provider.avgLatencyMs)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="admin-empty-state">Keine Nutzung im ausgewählten Zeitraum.</p>
              )}
            </section>

            <section className="admin-omniroute-section" aria-labelledby="admin-omniroute-trend-title">
              <h3 id="admin-omniroute-trend-title">Tagesverlauf</h3>
              {snapshot.usage.dailyTrend.length > 0 ? (
                <div className="admin-omniroute-table-wrap">
                  <table>
                    <caption>Tagesverlauf im ausgewählten Zeitraum</caption>
                    <thead>
                      <tr>
                        <th scope="col">Datum</th>
                        <th scope="col">Anfragen</th>
                        <th scope="col">Tokens</th>
                        <th scope="col">Kosten</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.usage.dailyTrend.map((day) => (
                        <tr key={day.date}>
                          <th scope="row"><time dateTime={day.date}>{day.date}</time></th>
                          <td>{formatNumber(day.requests)}</td>
                          <td>{formatNumber(day.tokens)}</td>
                          <td>{formatCost(day.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="admin-empty-state">Kein Tagesverlauf vorhanden.</p>
              )}
            </section>

            <section className="admin-omniroute-section" aria-labelledby="admin-omniroute-health-title">
              <h3 id="admin-omniroute-health-title">Provider-Health</h3>
              {[codexHealth, geminiHealth].every((provider) => !provider) ? (
                <p className="admin-empty-state">Keine Provider-Health-Daten vorhanden.</p>
              ) : (
                <div className="admin-omniroute-health-grid">
                  {[
                    { label: "OpenAI Codex", provider: codexHealth },
                    { label: "Gemini / Antigravity", provider: geminiHealth },
                  ].map(({ label, provider }) => (
                    <article key={label} className="admin-omniroute-health">
                      <h4>{label}</h4>
                      {provider ? (
                        <dl>
                          <div><dt>Status</dt><dd>{provider.state ?? "–"}</dd></div>
                          <div><dt>Cooldown / Rate-Limit</dt><dd>{isRateLimited(provider, snapshot?.generatedAt) ? "Aktiv" : "Nein"}</dd></div>
                          <div><dt>Verbindungen</dt><dd>{formatNumber(provider.connections)}</dd></div>
                          <div><dt>Gesperrte Modelle</dt><dd>{formatNumber(provider.modelLockoutCount)}</dd></div>
                          <div><dt>Letzter Anbieter-Fehler</dt><dd>{[
                            provider.lastErrorType,
                            provider.lastErrorCode,
                          ].filter(Boolean).join(" · ") || "–"}</dd></div>
                          <div><dt>Fehlerzeit</dt><dd>{formatDateTime(provider.lastErrorAt)}</dd></div>
                          {provider.models.map((model) => (
                            <div key={model.model} className="admin-omniroute-model-health">
                              <dt>Zielmodell {model.model}</dt>
                              <dd>
                                {model.status ?? model.lastStatus ?? "–"}
                                {model.isLockedOut ? " · Lockout aktiv" : ""}
                                {model.lockoutRemainingMs !== null ? ` · ${formatDuration(remainingAtSnapshot(model.lockoutRemainingMs, snapshot.generatedAt))}` : ""}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      ) : (
                        <p className="admin-empty-state">Kein Anbieter gefunden.</p>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </section>
  );
}
