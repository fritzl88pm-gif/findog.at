"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  OmniRouteAdminUsageSnapshot,
  OmniRouteExchangeRateSnapshot,
  OmniRouteModelUsage,
  OmniRouteProviderHealth,
  OmniRouteQuotaSnapshot,
  OmniRouteRouteSnapshot,
  OmniRouteUsageRange,
} from "@/lib/omniroute-usage-types";

type AdminOmniRouteUsageProps = {
  accessToken: string;
};

const RANGE_OPTIONS: Array<{ value: OmniRouteUsageRange; label: string; shortLabel: string }> = [
  { value: "24h", label: "Letzte 24 Stunden", shortLabel: "24 h" },
  { value: "7d", label: "Letzte 7 Tage", shortLabel: "7 Tage" },
  { value: "30d", label: "Letzte 30 Tage", shortLabel: "30 Tage" },
];

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validExchangeRate(value: unknown): value is OmniRouteExchangeRateSnapshot | null {
  if (value === null) return true;
  const rate = optionalRecord(value);
  return Boolean(
    rate
      && typeof rate.rate === "number"
      && Number.isFinite(rate.rate)
      && rate.rate > 0
      && typeof rate.date === "string"
      && typeof rate.source === "string"
      && typeof rate.fetchedAt === "string",
  );
}

function snapshotFromPayload(value: unknown): OmniRouteAdminUsageSnapshot | null {
  const payload = optionalRecord(value);
  if (
    !payload
    || typeof payload.generatedAt !== "string"
    || typeof payload.stale !== "boolean"
    || (payload.range !== "24h" && payload.range !== "7d" && payload.range !== "30d")
    || typeof payload.userQuestions !== "number"
    || !Number.isSafeInteger(payload.userQuestions)
    || payload.userQuestions < 0
    || !validExchangeRate(payload.exchangeRate)
    || (payload.costConversionWarning !== null && typeof payload.costConversionWarning !== "string")
    || !("quota" in payload)
    || !("codexQuota" in payload)
    || !("usage" in payload)
    || !Array.isArray(payload.routes)
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

function formatEuro(value: number | null | undefined): string {
  return value === null || value === undefined
    ? "Nicht verfügbar"
    : `${formatNumber(value, 4)} €`;
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

function formatDate(value: string | null | undefined): string {
  if (!value) return "–";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "–"
    : new Intl.DateTimeFormat("de-AT", { dateStyle: "medium", timeZone: "Europe/Vienna" }).format(date);
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

function compactNumber(value: number | null | undefined): string {
  return value === null || value === undefined
    ? "–"
    : new Intl.NumberFormat("de-AT", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function remainingAtSnapshot(value: number | null, generatedAt: string | undefined): number | null {
  if (value === null) return null;
  const elapsed = generatedAt ? Math.max(0, Date.now() - new Date(generatedAt).getTime()) : 0;
  return value - elapsed;
}

function isRateLimited(provider: OmniRouteProviderHealth | undefined, generatedAt: string | undefined): boolean {
  if (!provider) return false;
  if ((remainingAtSnapshot(provider.cooldownRemainingMs, generatedAt) ?? 0) > 0) return true;
  return provider.models.some((model) => {
    if (!model.isLockedOut) return false;
    const remaining = remainingAtSnapshot(model.lockoutRemainingMs, generatedAt);
    return remaining === null || remaining > 0;
  }) || (provider.rateLimitedUntil !== null && new Date(provider.rateLimitedUntil).getTime() > Date.now());
}

function progressValue(value: number | null | undefined): number {
  if (value === null || value === undefined || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function providerLabel(provider: OmniRouteProviderHealth["provider"]): string {
  return provider === "codex" ? "OpenAI Codex" : "Gemini / Antigravity";
}

function statusLabel(active: boolean): string {
  return active ? "Aktiv" : "Nein";
}

function Metric({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: "primary" | "warning" }) {
  return (
    <div className={`admin-omniroute-metric${tone ? ` admin-omniroute-metric-${tone}` : ""}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

function KpiCard({
  label,
  value,
  detail,
  emphasis,
}: {
  label: string;
  value: string;
  detail?: string;
  emphasis?: "blue" | "yellow";
}) {
  return (
    <div className={`admin-omniroute-kpi${emphasis ? ` admin-omniroute-kpi-${emphasis}` : ""}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

function normalizedQuotaUsage(quota: OmniRouteQuotaSnapshot | null): string {
  if (!quota) return "–";
  if (quota.unlimited) {
    return quota.used === null ? "Unbegrenzt" : `${formatNumber(quota.used)} Einheiten · unbegrenzt`;
  }
  if (quota.used === null || quota.total === null) return "–";
  return metricValue(`${formatNumber(quota.used)} / ${formatNumber(quota.total)}`, "Einheiten");
}

function QuotaDetails({
  quota,
  health,
  generatedAt,
}: {
  quota: OmniRouteQuotaSnapshot | null;
  health: OmniRouteProviderHealth;
  generatedAt: string;
}) {
  return (
    <div className="admin-omniroute-quota">
      <div className="admin-omniroute-progress">
        <div className="admin-omniroute-progress-label">
          <span>Verbleibend</span>
          <strong>{formatPercent(quota?.remainingPercent)}</strong>
        </div>
        {quota?.remainingPercent !== null && quota?.remainingPercent !== undefined ? (
          <div
            role="progressbar"
            aria-label={`${providerLabel(health.provider)} verbleibende Quote`}
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
      <dl className="admin-omniroute-metric-grid">
        <Metric label="Normalisierte Nutzung" value={normalizedQuotaUsage(quota)} />
        <Metric label="Verbleibende Einheiten" value={quota?.remaining === null || quota?.remaining === undefined ? "–" : formatNumber(quota.remaining)} />
        <Metric label="Reset / Fenster" value={formatDateTime(quota?.resetAt)} detail={quota?.quotaLabel ?? undefined} />
        <Metric label="Quota-Quelle" value={quota?.source ?? "–"} detail={quota?.plan ?? undefined} />
        <Metric label="Letzte Synchronisation" value={formatDateTime(quota?.quotaFetchedAt)} detail={quota?.quotaSyncIntervalMinutes === null || quota?.quotaSyncIntervalMinutes === undefined ? undefined : metricValue(formatNumber(quota.quotaSyncIntervalMinutes), "Minuten")} />
        <Metric label="Cooldown / Rate-Limit" value={statusLabel(isRateLimited(health, generatedAt))} tone={isRateLimited(health, generatedAt) ? "warning" : undefined} detail={health.cooldownRemainingMs ? `Verbleibend ${formatDuration(remainingAtSnapshot(health.cooldownRemainingMs, generatedAt))}` : health.rateLimitedUntil ? `Bis ${formatDateTime(health.rateLimitedUntil)}` : undefined} />
      </dl>
    </div>
  );
}

function ProviderHealthCard({
  health,
  quota,
  generatedAt,
}: {
  health: OmniRouteProviderHealth;
  quota: OmniRouteQuotaSnapshot | null;
  generatedAt: string;
}) {
  const limited = isRateLimited(health, generatedAt);
  return (
    <article className={`admin-omniroute-provider-card${limited ? " admin-omniroute-provider-warning" : ""}`}>
      <div className="admin-omniroute-provider-heading">
        <h4>{providerLabel(health.provider)}</h4>
        <span className={`admin-omniroute-pill${limited ? " admin-omniroute-pill-warning" : ""}`}>
          {health.state ?? "Status unbekannt"}
        </span>
      </div>
      <dl className="admin-omniroute-metric-grid">
        <Metric label="Anfragen" value={formatNumber(health.requests)} />
        <Metric label="Erfolgsquote" value={formatPercent(health.successRatePct)} />
        <Metric label="Latenz" value={formatDuration(health.avgLatencyMs)} />
        <Metric label="Verbindungen" value={formatNumber(health.connections)} />
        <Metric label="Gesperrte Modelle" value={formatNumber(health.modelLockoutCount)} />
        <Metric label="Letzter Fehler" value={[health.lastErrorType, health.lastErrorCode].filter(Boolean).join(" · ") || "–"} detail={formatDateTime(health.lastErrorAt)} />
      </dl>
      <QuotaDetails quota={quota} health={health} generatedAt={generatedAt} />
      {health.models.length > 0 ? (
        <ul className="admin-omniroute-model-health-list">
          {health.models.map((model) => (
            <li key={model.model}>
              <span className="admin-omniroute-model-name">{model.model}</span>
              <dl>
                <Metric label="Status" value={model.status ?? model.lastStatus ?? "–"} detail={model.isLockedOut ? `Lockout aktiv · ${formatDuration(remainingAtSnapshot(model.lockoutRemainingMs, generatedAt))}` : undefined} />
                <Metric label="Anfragen" value={formatNumber(model.requests)} />
                <Metric label="Erfolgsquote" value={formatPercent(model.successRatePct)} />
                <Metric label="Latenz" value={formatDuration(model.avgLatencyMs)} />
              </dl>
            </li>
          ))}
        </ul>
      ) : (
        <p className="admin-empty-state">Keine Modell-Health-Werte für konfigurierte Ziele.</p>
      )}
    </article>
  );
}

function ModelPerformanceCard({ model }: { model: OmniRouteModelUsage }) {
  return (
    <article className="admin-omniroute-model-card">
      <div>
        <h4>{model.model}</h4>
        <span className="admin-omniroute-pill">{model.provider}</span>
      </div>
      <dl className="admin-omniroute-metric-grid">
        <Metric label="Anfragen" value={formatNumber(model.requests)} />
        <Metric label="Tokens" value={compactNumber(model.totalTokens)} detail={`${formatNumber(model.promptTokens)} in · ${formatNumber(model.completionTokens)} out`} />
        <Metric label="Erfolgsquote" value={formatPercent(model.successRatePct)} />
        <Metric label="Latenz" value={formatDuration(model.avgLatencyMs)} />
        <Metric label="Kosten (EUR)" value={formatEuro(model.costEur)} />
        <Metric label="Letzte Nutzung" value={formatDateTime(model.lastUsed)} />
      </dl>
    </article>
  );
}

function RouteCard({ route }: { route: OmniRouteRouteSnapshot }) {
  return (
    <article className={`admin-omniroute-route-card${route.productionTraffic ? " admin-omniroute-route-live" : ""}`}>
      <div className="admin-omniroute-route-heading">
        <div>
          <h4>{route.name}</h4>
          <p>Strategie: {route.strategy ?? "–"}{route.version === null ? "" : ` · Version ${formatNumber(route.version)}`}</p>
        </div>
        <span className={`admin-omniroute-pill${route.productionTraffic ? " admin-omniroute-pill-blue" : ""}`}>
          {route.productionTraffic ? "Produktion" : "Kein Produktions-Traffic"}
        </span>
      </div>
      <ol className="admin-omniroute-target-flow" aria-label="Ziele in konfigurierter Reihenfolge">
        {route.targets.map((target, index) => (
          <li key={`${route.name}-${index}-${target}`}>
            <span>{index === 0 ? "Primär" : `Stufe ${index + 1}`}</span>
            <strong>{target}</strong>
          </li>
        ))}
      </ol>
      <dl className="admin-omniroute-metric-grid">
        <Metric label="Anfragen" value={formatNumber(route.requests)} />
        <Metric label="Erfolgreiche Anfragen" value={formatNumber(route.successes)} />
        <Metric label="Fehler" value={formatNumber(route.failures)} />
        <Metric label="Fallbacks" value={formatNumber(route.fallbacks)} detail={route.fallbackRatePct === null ? undefined : formatPercent(route.fallbackRatePct)} />
        <Metric label="Erfolgsquote" value={formatPercent(route.successRatePct)} />
        <Metric label="Latenz" value={formatDuration(route.avgLatencyMs)} />
        <Metric label="Letzte Nutzung" value={formatDateTime(route.lastUsedAt)} />
      </dl>
      {route.models.length > 0 ? (
        <ul className="admin-omniroute-route-models">
          {route.models.map((model) => (
            <li key={`${route.name}-${model.model}`}>
              <span className="admin-omniroute-model-name">{model.model}</span>
              <dl className="admin-omniroute-metric-grid">
                <Metric label="Anfragen" value={formatNumber(model.requests)} />
                <Metric label="Erfolge" value={formatNumber(model.successes)} />
                <Metric label="Fehler" value={formatNumber(model.failures)} />
                <Metric label="Latenz" value={formatDuration(model.avgLatencyMs)} />
                <Metric label="Letzter Status" value={model.lastStatus ?? "–"} detail={formatDateTime(model.lastUsedAt)} />
              </dl>
            </li>
          ))}
        </ul>
      ) : (
        <p className="admin-empty-state">Keine Zielmodell-Metriken im ausgewählten Zeitraum.</p>
      )}
    </article>
  );
}

function TrendPanel({ snapshot }: { snapshot: OmniRouteAdminUsageSnapshot }) {
  const days = snapshot.usage.dailyTrend;
  const maxRequests = Math.max(1, ...days.map((day) => day.requests ?? 0));
  if (days.length === 0) return <p className="admin-empty-state">Kein Tagesverlauf vorhanden.</p>;
  return (
    <ol className="admin-omniroute-trend">
      {days.map((day) => {
        const width = ((day.requests ?? 0) / maxRequests) * 100;
        return (
          <li key={day.date}>
            <div className="admin-omniroute-trend-head">
              <time dateTime={day.date}>{formatDate(day.date)}</time>
              <strong>{formatNumber(day.requests)} Anfragen</strong>
            </div>
            <div className="admin-omniroute-trend-track" aria-hidden="true">
              <span style={{ width: `${Math.max(2, width)}%` }} />
            </div>
            <dl>
              <Metric label="Tokens" value={formatNumber(day.tokens)} />
              <Metric label="Kosten (EUR)" value={formatEuro(day.costEur)} />
            </dl>
          </li>
        );
      })}
    </ol>
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
      setError(loadError instanceof Error ? loadError.message : "Die OmniRoute-Nutzung konnte nicht geladen werden.");
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

  const summary = snapshot?.usage.summary ?? null;
  const models = snapshot?.usage.models ?? [];
  const routes = snapshot?.routes ?? [];
  const providers = snapshot?.providerHealth ?? [];
  const isBusy = isLoading && Boolean(snapshot);
  const rangeLabel = RANGE_OPTIONS.find((option) => option.value === range)?.label ?? "";

  return (
    <section
      className="admin-omniroute-panel"
      role="tabpanel"
      id="admin-panel-omniroute"
      aria-labelledby="admin-tab-omniroute"
    >
      <div className="form-generator-card admin-omniroute-card">
        <header className="admin-omniroute-heading">
          <div>
            <p className="admin-omniroute-eyebrow">Operations Console</p>
            <h2>OmniRoute Stats</h2>
            <p>Geschützte Auswertung aller OmniRoute-Anfragen, konfigurierter Routen, Provider-Health und EUR-Kosten.</p>
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
              {isBusy ? "Aktualisiert …" : "Aktualisieren"}
            </button>
          </div>
        </header>

        {error ? <div className="error-box" role="alert">{error}</div> : null}
        {snapshot?.warning ? <div className="notice-box" role="status">Veraltete Daten: {snapshot.warning}</div> : null}
        {snapshot?.costConversionWarning ? (
          <div className="notice-box admin-omniroute-compact-warning" role="status">{snapshot.costConversionWarning}</div>
        ) : null}

        {isLoading && !snapshot ? (
          <div className="admin-omniroute-loading" role="status">
            <span aria-hidden="true" />
            <p>OmniRoute-Daten werden geladen …</p>
          </div>
        ) : !snapshot ? (
          <div className="admin-empty-state admin-omniroute-empty">
            <p>Keine OmniRoute-Daten verfügbar.</p>
          </div>
        ) : (
          <>
            <div className="admin-omniroute-metadata">
              <dl>
                <div><dt>Zuletzt aktualisiert</dt><dd><time dateTime={snapshot.generatedAt}>{formatDateTime(snapshot.generatedAt)}</time></dd></div>
                <div><dt>Zeitraum</dt><dd>{rangeLabel}</dd></div>
                <div>
                  <dt>EUR-Referenzkurs</dt>
                  <dd>{snapshot.exchangeRate ? `1 USD = ${formatNumber(snapshot.exchangeRate.rate, 4)} EUR` : "Nicht verfügbar"}</dd>
                </div>
                <div><dt>Kursdatum</dt><dd>{snapshot.exchangeRate ? `${formatDate(snapshot.exchangeRate.date)} · ${snapshot.exchangeRate.source}` : "–"}</dd></div>
              </dl>
              <span className={`admin-omniroute-pill${snapshot.stale ? " admin-omniroute-pill-warning" : " admin-omniroute-pill-blue"}`}>
                {snapshot.stale ? "Veraltet" : "Aktuell"}
              </span>
            </div>

            <section className="admin-omniroute-section admin-omniroute-summary" aria-labelledby="admin-omniroute-kpis-title">
              <div className="admin-omniroute-section-heading">
                <h3 id="admin-omniroute-kpis-title">Gesamtüberblick</h3>
                <p>Alle OmniRoute-Anfragen im Zeitraum. Modell- und Provider-Details sind auf aktuell konfigurierte Ziele beschränkt.</p>
              </div>
              <dl className="admin-omniroute-kpis">
                <KpiCard label="Anfragen" value={formatNumber(summary?.totalRequests)} detail={`Fallbacks: ${formatNumber(summary?.fallbackCount)}`} emphasis="blue" />
                <KpiCard label="Erfolgsquote" value={formatPercent(summary?.successRatePct)} detail={`${formatNumber(summary?.successfulRequests)} erfolgreich`} />
                <KpiCard label="Latenz Ø" value={formatDuration(summary?.avgLatencyMs)} detail={`Letzte Anfrage: ${formatDateTime(summary?.lastRequest)}`} />
                <KpiCard label="Tokens" value={compactNumber(summary?.totalTokens)} detail={`${compactNumber(summary?.promptTokens)} in · ${compactNumber(summary?.completionTokens)} out`} />
                <KpiCard label="Kosten (EUR)" value={formatEuro(summary?.totalCostEur)} detail={snapshot.exchangeRate ? "Referenz: Frankfurter USD→EUR" : "Kein gültiger EUR-Kurs"} emphasis="yellow" />
                <KpiCard label="Findog-Fragen" value={formatNumber(snapshot.userQuestions)} detail="Exakte Anzahl Nutzerfragen" />
              </dl>
            </section>

            <section className="admin-omniroute-section" aria-labelledby="admin-omniroute-models-title">
              <div className="admin-omniroute-section-heading">
                <h3 id="admin-omniroute-models-title">Konfigurierte Modell-Performance</h3>
                <p>Nur Zielmodelle aus der aktuellen Route-Konfiguration.</p>
              </div>
              {models.length > 0 ? (
                <div className="admin-omniroute-model-grid">
                  {models.map((model) => <ModelPerformanceCard key={`${model.provider}-${model.model}`} model={model} />)}
                </div>
              ) : (
                <p className="admin-empty-state">Keine Nutzung für aktuell konfigurierte Zielmodelle.</p>
              )}
            </section>

            <section className="admin-omniroute-section" aria-labelledby="admin-omniroute-routes-title">
              <div className="admin-omniroute-section-heading">
                <h3 id="admin-omniroute-routes-title">Routen</h3>
                <p>Aktuelle Combo-Konfiguration und zugeordnete Metriken.</p>
              </div>
              {routes.length > 0 ? (
                <div className="admin-omniroute-routes-list">
                  {routes.map((route) => <RouteCard key={route.name} route={route} />)}
                </div>
              ) : (
                <p className="admin-empty-state">Keine konfigurierten Routen gefunden.</p>
              )}
            </section>

            <section className="admin-omniroute-section" aria-labelledby="admin-omniroute-trend-title">
              <div className="admin-omniroute-section-heading">
                <h3 id="admin-omniroute-trend-title">Aktivität</h3>
                <p>Tagesverlauf mit Anfragen, Tokens und EUR-Kosten.</p>
              </div>
              <TrendPanel snapshot={snapshot} />
            </section>

            <section className="admin-omniroute-section" aria-labelledby="admin-omniroute-health-title">
              <div className="admin-omniroute-section-heading">
                <h3 id="admin-omniroute-health-title">Health &amp; Quoten</h3>
                <p>Ausschließlich Provider, die von konfigurierten Routen genutzt werden.</p>
              </div>
              {providers.length > 0 ? (
                <div className="admin-omniroute-provider-grid">
                  {providers.map((health) => (
                    <ProviderHealthCard
                      key={health.provider}
                      health={health}
                      quota={health.provider === "codex" ? snapshot.codexQuota : snapshot.quota}
                      generatedAt={snapshot.generatedAt}
                    />
                  ))}
                </div>
              ) : (
                <p className="admin-empty-state">Keine unterstützten Provider-Health-Daten für konfigurierte Ziele.</p>
              )}
            </section>
          </>
        )}
      </div>
    </section>
  );
}
