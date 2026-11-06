"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { citedSourceLabel, findCitedIndex } from "@/lib/fred/citations";
import type { FredSourceReference } from "@/lib/weknora/fred-research";

type Snippet = { doc: string; location?: string; text: string };

type PopoverView =
  | { index: number; anchor: HTMLElement; status: "loading" }
  | { index: number; anchor: HTMLElement; status: "ready"; snippet: Snippet }
  | { index: number; anchor: HTMLElement; status: "error" };

type FredCitationContextValue = {
  /** Ordered cited sources of the message (no ids); marker n is entry n-1. */
  cited: readonly FredSourceReference[];
  /** Snippets can only be loaded for stored messages. */
  canOpen: boolean;
  activeIndex: number | null;
  open: (index: number, anchor: HTMLElement) => void;
};

const FredCitationContext = createContext<FredCitationContextValue | null>(null);

export function useFredCitations(): FredCitationContextValue | null {
  return useContext(FredCitationContext);
}

/** Fetched snippets by conversation, message and source index; kept for the whole session. */
const snippetCache = new Map<string, Snippet>();

const MOBILE_QUERY = "(max-width: 640px)";
const POPOVER_WIDTH = 400;
const POPOVER_MARGIN = 12;

function subscribeToMobileQuery(callback: () => void): () => void {
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribeToMobileQuery,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
}

function parseSnippet(payload: unknown): Snippet | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.text !== "string" || !record.text.trim()) return null;
  return {
    doc: typeof record.doc === "string" ? record.doc : "",
    ...(typeof record.location === "string" && record.location ? { location: record.location } : {}),
    text: record.text,
  };
}

export function FredCitationScope({
  accessToken,
  conversationId,
  messageId,
  citedSources,
  children,
}: {
  accessToken: string;
  conversationId: string;
  messageId: number | undefined;
  citedSources: readonly FredSourceReference[] | undefined;
  children: ReactNode;
}) {
  const cited = useMemo(() => citedSources ?? [], [citedSources]);
  const [view, setView] = useState<PopoverView | null>(null);
  const canOpen = Boolean(accessToken && conversationId && messageId !== undefined);

  const open = useCallback((index: number, anchor: HTMLElement) => {
    setView((current) => {
      if (current?.index === index) return current.anchor === anchor ? null : { ...current, anchor };
      const cached = snippetCache.get(`${conversationId}:${messageId}:${index}`);
      return cached
        ? { index, anchor, status: "ready", snippet: cached }
        : { index, anchor, status: "loading" };
    });
  }, [conversationId, messageId]);

  const close = useCallback(() => setView(null), []);

  const loadingIndex = view?.status === "loading" ? view.index : null;
  useEffect(() => {
    if (loadingIndex === null) return;
    const controller = new AbortController();
    const key = `${conversationId}:${messageId}:${loadingIndex}`;
    void (async () => {
      try {
        const response = await fetch(
          `/api/fred/conversations/${encodeURIComponent(conversationId)}/messages/${messageId}/sources/${loadingIndex}`,
          {
            headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          },
        );
        const snippet = response.ok ? parseSnippet(await response.json().catch(() => null)) : null;
        if (controller.signal.aborted) return;
        if (!snippet) throw new Error("snippet unavailable");
        snippetCache.set(key, snippet);
        setView((current) => current && current.index === loadingIndex
          ? { index: current.index, anchor: current.anchor, status: "ready", snippet }
          : current);
      } catch {
        if (controller.signal.aborted) return;
        setView((current) => current && current.index === loadingIndex
          ? { index: current.index, anchor: current.anchor, status: "error" }
          : current);
      }
    })();
    return () => controller.abort();
  }, [loadingIndex, accessToken, conversationId, messageId]);

  const value = useMemo<FredCitationContextValue>(() => ({
    cited,
    canOpen,
    activeIndex: view?.index ?? null,
    open,
  }), [cited, canOpen, view?.index, open]);

  return (
    <FredCitationContext.Provider value={value}>
      {children}
      {view && cited[view.index]?.kind === "knowledge"
        ? <CitationPopover view={view} source={cited[view.index]} onClose={close} />
        : null}
    </FredCitationContext.Provider>
  );
}

function CitationPopover({
  view,
  source,
  onClose,
}: {
  view: PopoverView;
  source: FredSourceReference;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const [, setLayoutTick] = useState(0);
  const { anchor } = view;

  // Focus moves into the dialog and returns to the marker on close.
  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true });
    return () => {
      if (anchor.isConnected) anchor.focus({ preventScroll: true });
    };
  }, [anchor]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (dialogRef.current?.contains(target) || anchor.contains(target))) return;
      onClose();
    };
    const relayout = () => setLayoutTick((tick) => tick + 1);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", relayout);
    window.addEventListener("scroll", relayout, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", relayout);
      window.removeEventListener("scroll", relayout, true);
    };
  }, [anchor, onClose]);

  let style: React.CSSProperties | undefined;
  if (!isMobile) {
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(POPOVER_WIDTH, window.innerWidth - 2 * POPOVER_MARGIN);
    const left = Math.max(
      POPOVER_MARGIN,
      Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - POPOVER_MARGIN),
    );
    const spaceBelow = window.innerHeight - rect.bottom;
    const placeAbove = spaceBelow < 260 && rect.top > spaceBelow;
    style = placeAbove
      ? { left, width, bottom: window.innerHeight - rect.top + 8, maxHeight: Math.max(160, rect.top - 20) }
      : { left, width, top: rect.bottom + 8, maxHeight: Math.max(160, spaceBelow - 20) };
  }

  const title = citedSourceLabel(source);
  const location = view.status === "ready" ? view.snippet.location : undefined;

  return createPortal(
    <>
      {isMobile ? <div className="fred-cite-backdrop" aria-hidden="true" onClick={onClose} /> : null}
      <div
        ref={dialogRef}
        className={isMobile ? "fred-cite-pop is-sheet" : "fred-cite-pop"}
        role="dialog"
        aria-modal={isMobile ? true : undefined}
        aria-label={`Fundstelle: ${title}`}
        tabIndex={-1}
        style={style}
      >
        <div className="fred-cite-head">
          <span className="fred-cite-num" aria-hidden="true">{view.index + 1}</span>
          <strong className="fred-cite-title">{title}</strong>
          <button className="fred-cite-close" type="button" aria-label="Fundstelle schließen" onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        {location ? <p className="fred-cite-location">{location}</p> : null}
        {view.status === "loading" ? (
          <p className="fred-cite-status" role="status">Fundstelle wird geladen …</p>
        ) : view.status === "error" ? (
          <p className="fred-cite-status is-error" role="alert">Fundstelle nicht verfügbar</p>
        ) : (
          <div className="fred-cite-text">{view.snippet.text}</div>
        )}
      </div>
    </>,
    document.body,
  );
}

/** Superscript citation marker inside an answer (`⟦n⟧`). Plain `[n]` outside a message scope. */
export function CitationMarker({ number }: { number: number }) {
  const citations = useFredCitations();
  const source = citations?.cited[number - 1];
  if (!citations || !source) return <span className="fred-cite-plain">[{number}]</span>;
  const label = citedSourceLabel(source);
  if (source.kind === "web") {
    return (
      <sup className="fred-cite">
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`Quelle ${number}: ${label} (öffnet in neuem Tab)`}
        >
          {number}
        </a>
      </sup>
    );
  }
  if (!citations.canOpen) {
    return <sup className="fred-cite"><span className="fred-cite-static">{number}</span></sup>;
  }
  return (
    <sup className="fred-cite">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={citations.activeIndex === number - 1}
        aria-label={`Quelle ${number}: ${label} anzeigen`}
        onClick={(event) => citations.open(number - 1, event.currentTarget)}
      >
        {number}
      </button>
    </sup>
  );
}

/**
 * Makes an entry of a source list open its cited snippet. Only knowledge sources
 * that are cited in the answer become clickable; everything else renders as before.
 */
export function CitedSourceEntry({
  entry,
  className,
  fallback,
  children,
}: {
  entry: { doc?: string; title?: string; url?: string };
  className?: string;
  fallback: ReactNode;
  children: ReactNode;
}) {
  const citations = useFredCitations();
  const index = citations ? findCitedIndex(citations.cited, entry) : -1;
  if (!citations || !citations.canOpen || index < 0 || citations.cited[index].kind !== "knowledge") {
    return <>{fallback}</>;
  }
  return (
    <button
      type="button"
      className={className ? `fred-source-cite ${className}` : "fred-source-cite"}
      aria-haspopup="dialog"
      aria-expanded={citations.activeIndex === index}
      title="Fundstelle anzeigen"
      onClick={(event) => citations.open(index, event.currentTarget)}
    >
      {children}
    </button>
  );
}
