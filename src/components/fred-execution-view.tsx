import { Fragment, useId, useMemo } from "react";
import type { ReactElement, ReactNode } from "react";

import {
  aggregateExecutionSources,
  buildExecutionOverview,
  buildSourceView,
  shortenText,
  executionIconKey,
  formatDuration,
  matchTypeLabel,
  parsePlanningDetail,
  type ExecutionIconKey,
} from "@/lib/fred/execution-display";
import {
  SOURCE_KIND_LABELS,
  highlightSegments,
  sourceDomain,
  type FredExecutionSource,
} from "@/lib/fred/execution-structured";
import {
  sanitizeStoredExecutionTrace,
  type FredExecutionStep,
} from "@/lib/fred/execution-trace";
import type { FredSourceReference } from "@/lib/weknora/fred-research";

const ICON_PATHS: Record<ExecutionIconKey, ReactNode> = {
  analysis: (
    <>
      <path d="M12 3.5l1.7 4.4 4.4 1.7-4.4 1.7L12 15.7l-1.7-4.4-4.4-1.7 4.4-1.7z" />
      <path d="M18.5 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="5.5" />
      <path d="M15 15l5 5" />
      <path d="M8.2 10.5h4.6M10.5 8.2v4.6" />
    </>
  ),
  read: (
    <>
      <path d="M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20z" />
      <path d="M14 3.5V8h4M9 12h6M9 15.5h6" />
    </>
  ),
  web: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <ellipse cx="12" cy="12" rx="3.8" ry="8.5" />
      <path d="M3.5 12h17" />
    </>
  ),
  shell: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <path d="M7.500 10l3 2.500-3 2.500M12.500 15h4" />
    </>
  ),
  agent: (
    <>
      <rect x="5" y="8" width="14" height="10.500" rx="3" />
      <path d="M12 8V5M9.500 12.500v1M14.500 12.500v1" />
      <circle cx="12" cy="4" r="1" />
    </>
  ),
  planning: (
    <>
      <path d="M4.500 7l1.500 1.500L8.500 6M4.500 13l1.500 1.500L8.500 12M4.500 19l1.500 1.500" />
      <path d="M12 7.500h8M12 13.500h8M12 19.500h8" />
    </>
  ),
  memory: (
    <path d="M7 3.500h10a.5.5 0 0 1 .5.5v16.500L12 16.500 6.500 20.500V4a.5.5 0 0 1 .5-.5z" />
  ),
  context: (
    <>
      <path d="M4 5h16M4 19h16" />
      <path d="M12 8.500v7M9 12.500l3 3 3-3M9 11.500l3-3 3 3" />
    </>
  ),
  sources: (
    <>
      <path d="M12 3.500l8.500 4.500L12 12.500 3.500 8z" />
      <path d="M3.500 12L12 16.500 20.500 12M3.500 16L12 20.500 20.500 16" />
    </>
  ),
  generic: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.500v2.500M12 18v2.500M3.500 12H6M18 12h2.500M6 6l1.800 1.800M16.200 16.200L18 18M18 6l-1.800 1.800M7.800 16.200L6 18" />
    </>
  ),
};

function Icon({ name }: { name: ExecutionIconKey }) {
  return (
    <svg
      className="fred-exec-icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

function StatusIcon({ status }: { status: FredExecutionStep["status"] }) {
  if (status === "running") return <span className="fred-exec-spinner" aria-hidden="true" />;
  return (
    <svg
      className="fred-exec-status-icon"
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {status === "completed" ? <path d="M5 12.500l4.500 4.500L19 7.500" /> : <path d="M6.500 6.500l11 11M17.500 6.500l-11 11" />}
    </svg>
  );
}

const STATUS_LABELS = { running: "läuft", completed: "abgeschlossen", failed: "fehlgeschlagen" } as const;

function HighlightedText({ text, queries }: { text: string; queries: readonly string[] }) {
  return (
    <>
      {highlightSegments(text, queries).map((segment, index) => segment.match
        ? <mark className="fred-source-hit" key={index}>{segment.text}</mark>
        : <Fragment key={index}>{segment.text}</Fragment>)}
    </>
  );
}

function SourceCard({ source, queries, headingLevel = 4 }: {
  source: FredExecutionSource;
  queries: readonly string[];
  headingLevel?: 3 | 4;
}) {
  const kind = source.kind ?? "document";
  const Heading = `h${headingLevel}` as "h3" | "h4";
  const view = buildSourceView(source);
  const percent = source.score !== undefined ? Math.round(source.score * 100) : undefined;
  const match = matchTypeLabel(source.matchType);
  const domain = sourceDomain(source.url);
  const hitQueries = source.query ? [source.query, ...queries] : queries;
  const meta = [view.locator, match].filter(Boolean).join(" · ");
  const answer = view.faq && view.faq.answer.length > 400 ? shortenText(view.faq.answer, 400) : view.faq?.answer;

  return (
    <article className={`fred-source-card kind-${kind}`}>
      <header className="fred-source-card-head">
        <span className={`fred-source-badge kind-${kind}`}>{SOURCE_KIND_LABELS[kind]}</span>
        <Heading className="fred-source-card-title">
          {source.url ? (
            <a href={source.url} target="_blank" rel="noreferrer">{view.title}</a>
          ) : view.title}
        </Heading>
      </header>
      {view.subtitle ? <p className="fred-source-subtitle">{view.subtitle}</p> : null}
      {domain || meta ? (
        <p className="fred-source-meta-line">{[domain, meta].filter(Boolean).join(" · ")}</p>
      ) : null}
      {percent !== undefined ? (
        <div className="fred-source-meter" role="img" aria-label={`Relevanz ${percent} Prozent`}>
          <span className="fred-source-meter-track" aria-hidden="true">
            <span className="fred-source-meter-fill" style={{ width: `${Math.max(percent, 3)}%` }} />
          </span>
          <small aria-hidden="true">{percent} %</small>
        </div>
      ) : null}
      {view.faq ? (
        <div className="fred-source-faq">
          {view.title !== view.faq.question ? (
            <p className="fred-source-faq-question"><HighlightedText text={view.faq.question} queries={hitQueries} /></p>
          ) : null}
          {answer ? <p className="fred-source-faq-answer"><HighlightedText text={answer} queries={hitQueries} /></p> : null}
        </div>
      ) : view.snippet ? (
        <p className="fred-source-snippet"><HighlightedText text={view.snippet} queries={hitQueries} /></p>
      ) : null}
      {view.excerpt ? (
        <details className="fred-source-fulltext">
          <summary>
            <span className="fred-source-fulltext-show">Volltext-Ausschnitt anzeigen</span>
            <span className="fred-source-fulltext-hide">Volltext-Ausschnitt ausblenden</span>
          </summary>
          <div className="fred-source-excerpt">{view.excerpt}</div>
        </details>
      ) : null}
    </article>
  );
}

function Terminal({ command, output }: { command?: string; output?: string }) {
  return (
    <div className="fred-exec-terminal" role="group" aria-label="Terminal">
      <div className="fred-exec-terminal-bar" aria-hidden="true"><i /><i /><i /></div>
      <pre className="fred-exec-terminal-body">
        {command ? <span className="fred-exec-prompt">{`$ ${command}`}{output ? "\n" : ""}</span> : null}
        {output}
      </pre>
    </div>
  );
}

function PlanningList({ detail }: { detail: string }) {
  const { notes, items } = parsePlanningDetail(detail);
  return (
    <>
      {notes.length > 0 ? <p className="fred-exec-summary">{notes.join(" · ")}</p> : null}
      {items.length > 0 ? (
        <ul className="fred-exec-checklist">
          {items.map((item, index) => (
            <li className={`is-${item.state}`} key={index}>
              <span className="fred-exec-check-box" aria-hidden="true" />
              <span>{item.text}</span>
              <span className="fred-exec-sr-only">
                {item.state === "done" ? " (erledigt)" : item.state === "active" ? " (in Bearbeitung)" : " (offen)"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function stepMeta(step: FredExecutionStep): string[] {
  const meta: string[] = [];
  const sourceCount = step.sources?.length ?? 0;
  if (step.kind !== "sources" && sourceCount > 0) meta.push(executionIconKey(step) === "read" ? "Ausschnitt" : `${sourceCount} Treffer`);
  else if (step.detail && step.kind !== "planning" && step.detail.length <= 40 && !step.detail.includes("\n")) meta.push(step.detail);
  return meta;
}

function ExecutionStepItem({ step, children }: { step: FredExecutionStep; children?: ReactNode }) {
  const iconKey = executionIconKey(step);
  const queries = step.queries ?? [];
  const sources = step.kind === "sources" ? [] : step.sources ?? [];
  const meta = stepMeta(step);
  const isPlanning = step.kind === "planning" && Boolean(step.detail);
  const longDetail = !isPlanning && step.detail !== undefined && step.detail.length > 40;
  const hasTerminal = Boolean(step.command || step.output);
  const facts = step.facts ?? [];
  const taskName = step.kind === "agent" ? step.taskName : undefined;
  const hasBody = sources.length > 0 || hasTerminal || facts.length > 0 || isPlanning || longDetail;

  const head = (
    <>
      <span className="fred-exec-title">
        <span className="fred-exec-label">{step.label}</span>
        <span className="fred-exec-sr-only">{` – ${STATUS_LABELS[step.status]}`}</span>
      </span>
      <span className="fred-exec-badges">
        {meta.map((text) => <span className="fred-exec-meta" key={text}>{text}</span>)}
        {step.durationMs !== undefined ? <span className="fred-exec-duration">{formatDuration(step.durationMs)}</span> : null}
      </span>
      {hasBody ? <span className="fred-exec-chevron" aria-hidden="true" /> : null}
    </>
  );

  const queryChips = queries.length > 0 ? (
    <span className="fred-exec-chips" aria-label="Suchanfragen">
      {queries.map((query) => <span className="fred-exec-chip" key={query}>{query}</span>)}
    </span>
  ) : null;

  const body = (
    <div className="fred-exec-body">
      {isPlanning && step.detail ? <PlanningList detail={step.detail} /> : null}
      {longDetail && step.detail ? (
        <p className="fred-exec-summary">{step.detail}</p>
      ) : null}
      {facts.length > 0 ? (
        <dl className="fred-exec-facts">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {hasTerminal ? <Terminal command={step.command} output={step.output} /> : null}
      {sources.length > 0 ? (
        <div className="fred-source-list">
          {sources.map((source, index) => (
            <SourceCard source={source} queries={queries} key={`${source.title}-${index}`} />
          ))}
        </div>
      ) : null}
    </div>
  );

  return (
    <li className={`fred-exec-step is-${step.status} kind-${step.kind} icon-${iconKey}`}>
      <span className="fred-exec-marker" aria-hidden="true">
        <Icon name={iconKey} />
        <span className="fred-exec-marker-status"><StatusIcon status={step.status} /></span>
      </span>
      <div className="fred-exec-card">
        {hasBody ? (
          <details className="fred-exec-fold" open={step.status === "running" ? true : undefined}>
            <summary className="fred-exec-head">
              {head}
              {queryChips}
            </summary>
            {body}
          </details>
        ) : (
          <div className="fred-exec-head">
            {head}
            {queryChips}
          </div>
        )}
        {taskName ? <p className="fred-exec-task">Aufgabe: {taskName}</p> : null}
        {!hasBody && !longDetail && step.detail && !meta.includes(step.detail) && step.kind !== "agent" ? (
          <p className="fred-exec-summary">{step.detail}</p>
        ) : null}
        {step.kind === "agent" && step.detail ? <p className="fred-exec-summary">{step.detail}</p> : null}
        {step.status === "failed" ? (
          <p className="fred-exec-error" role="status">{step.error ?? "Schritt fehlgeschlagen"}</p>
        ) : null}
        {children}
      </div>
    </li>
  );
}

function Overview({ steps, references }: { steps: FredExecutionStep[]; references: readonly FredSourceReference[] }) {
  const overview = buildExecutionOverview(steps, references);
  return (
    <ul className="fred-exec-overview" aria-label="Zusammenfassung des Ablaufs">
      <li><strong>{overview.steps}</strong> {overview.steps === 1 ? "Schritt" : "Schritte"}</li>
      <li><strong>{overview.tools}</strong> {overview.tools === 1 ? "Werkzeug" : "Werkzeuge"}</li>
      <li><strong>{overview.sources}</strong> {overview.sources === 1 ? "Quelle" : "Quellen"}</li>
      {overview.durationMs !== undefined ? <li><strong>{formatDuration(overview.durationMs)}</strong> Gesamtdauer</li> : null}
    </ul>
  );
}

function Timeline({ steps }: { steps: FredExecutionStep[] }) {
  const ids = new Set(steps.map((step) => step.id));
  const childrenOf = new Map<string, FredExecutionStep[]>();
  const topLevel: FredExecutionStep[] = [];
  for (const step of steps) {
    if (step.parentId && step.parentId !== step.id && ids.has(step.parentId)) {
      childrenOf.set(step.parentId, [...(childrenOf.get(step.parentId) ?? []), step]);
    } else {
      topLevel.push(step);
    }
  }

  const renderList = (list: FredExecutionStep[], nested: boolean): ReactElement => (
    <ol className={nested ? "fred-exec-timeline fred-exec-children" : "fred-exec-timeline"}>
      {list.map((step) => {
        const children = childrenOf.get(step.id);
        return (
          <ExecutionStepItem step={step} key={step.id}>
            {children ? renderList(children, true) : null}
          </ExecutionStepItem>
        );
      })}
    </ol>
  );

  return renderList(topLevel, false);
}

function AggregatedSources({ steps, references }: { steps: FredExecutionStep[]; references: readonly FredSourceReference[] }) {
  const headingId = useId();
  const sources = aggregateExecutionSources(steps, references);
  if (sources.length === 0) return null;
  const queries = [...new Set(steps.flatMap((step) => step.queries ?? []))];
  return (
    <section className="fred-exec-sources" aria-labelledby={headingId}>
      <h3 id={headingId} className="fred-exec-section-title">Quellen</h3>
      <div className="fred-source-list">
        {sources.map((source, index) => (
          <SourceCard source={source} queries={queries} key={`${source.title}-${index}`} />
        ))}
      </div>
    </section>
  );
}

/**
 * Advanced mode: vertical timeline of Fred's work with structured, tool-specific views and an
 * aggregated source section. Steps are re-sanitized here so that legacy stored or hand-built data
 * can never surface reasoning text, internal ids or raw payloads.
 */
export function ExecutionTimeline({ steps, references = [] }: {
  steps: FredExecutionStep[];
  references?: readonly FredSourceReference[];
}) {
  const safeSteps = useMemo(() => sanitizeStoredExecutionTrace(steps), [steps]);
  return (
    <div className="fred-exec">
      <Overview steps={safeSteps} references={references} />
      <Timeline steps={safeSteps} />
      <AggregatedSources steps={safeSteps} references={references} />
    </div>
  );
}
