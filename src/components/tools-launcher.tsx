"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import {
  getLauncherGroups,
  type LauncherIconName,
  type LauncherToolId,
} from "@/lib/tools-launcher";

const ICON_PATHS: Record<LauncherIconName, ReactNode> = {
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4M8 11h6M11 8v6" /></>,
  sparkles: <><path d="m12 3 1.4 4.2L18 9l-4.6 1.8L12 15l-1.4-4.2L6 9l4.6-1.8L12 3Z" /><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" /></>,
  newsletter: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6M7 16h5" /></>,
  database: <><ellipse cx="12" cy="5" rx="7" ry="3" /><path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></>,
  scan: <><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" /><path d="M7 8h10M7 12h10M7 16h6" /></>,
  text: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5V5.5Z" /><path d="M8 7h8M8 11h8" /></>,
  form: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M8 13h8M8 17h8" /></>,
  download: <><path d="M12 3v12m0 0 5-5m-5 5-5-5" /><path d="M5 20h14" /></>,
  calculator: <><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M8 6h8M8 11h2M14 11h2M8 16h2M14 16h2" /></>,
  currency: <><circle cx="12" cy="12" r="10" /><path d="M16 8.5a5 5 0 1 0 0 7M7 10h7M7 14h7" /></>,
  game: <><path d="M7 9h10a4 4 0 0 1 3.8 5.2l-1 3a2 2 0 0 1-3.3.8L14 16h-4l-2.5 2a2 2 0 0 1-3.3-.8l-1-3A4 4 0 0 1 7 9Z" /><path d="M7 13h4M9 11v4M16 13h.01" /></>,
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />,
  quiz: <><circle cx="12" cy="12" r="10" /><path d="M9 9a3 3 0 0 1 6 0c0 2-3 3-3 5M12 18h.01" /></>,
  headset: <path d="M4 10a8 8 0 0 1 16 0v4a2 2 0 0 1-2 2h-2v-6h4M4 10v6H2v-4a2 2 0 0 1 2-2M8 19h8" />,
};

function LauncherIcon({ name }: { name: LauncherIconName }) {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      {ICON_PATHS[name]}
    </svg>
  );
}

type Props = {
  isAdmin: boolean;
  activeView: string;
  onSelect: (id: LauncherToolId) => void;
};

export default function ToolsLauncher({ isAdmin, activeView, onSelect }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const groups = getLauncherGroups(isAdmin);

  useEffect(() => {
    if (!isOpen) return;
    const panel = panelRef.current;
    const target = panel?.querySelector<HTMLElement>('[aria-current="page"]')
      ?? panel?.querySelector<HTMLElement>(".tools-launcher-tile");
    target?.focus();

    function closeOnOutsidePointer(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    }
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setIsOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  function handlePanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") {
      // Close once keyboard focus has left the popover so it never lingers over the page.
      requestAnimationFrame(() => {
        if (!containerRef.current?.contains(document.activeElement)) setIsOpen(false);
      });
      return;
    }
    const tiles = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>(".tools-launcher-tile") ?? []);
    const index = tiles.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;

    let next: HTMLButtonElement | undefined;
    if (event.key === "ArrowRight") next = tiles[Math.min(index + 1, tiles.length - 1)];
    else if (event.key === "ArrowLeft") next = tiles[Math.max(index - 1, 0)];
    else if (event.key === "Home") next = tiles[0];
    else if (event.key === "End") next = tiles[tiles.length - 1];
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const current = tiles[index].getBoundingClientRect();
      const centerX = current.left + current.width / 2;
      const candidates = tiles.filter((tile) => {
        const rect = tile.getBoundingClientRect();
        return direction === 1 ? rect.top > current.bottom - 2 : rect.bottom < current.top + 2;
      });
      if (candidates.length > 0) {
        const rowEdge = direction === 1
          ? Math.min(...candidates.map((tile) => tile.getBoundingClientRect().top))
          : Math.max(...candidates.map((tile) => tile.getBoundingClientRect().top));
        next = candidates
          .filter((tile) => Math.abs(tile.getBoundingClientRect().top - rowEdge) < 2)
          .sort((a, b) => {
            const distance = (tile: HTMLElement) => {
              const rect = tile.getBoundingClientRect();
              return Math.abs(rect.left + rect.width / 2 - centerX);
            };
            return distance(a) - distance(b);
          })[0];
      }
    } else {
      return;
    }
    event.preventDefault();
    next?.focus();
  }

  return (
    <div className="app-header-menu" ref={containerRef}>
      <button
        ref={triggerRef}
        className={`app-header-icon-button app-header-labeled-button${isOpen ? " is-open" : ""}`}
        type="button"
        aria-label="Werkzeuge"
        title="Werkzeuge"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
        onClick={() => setIsOpen((open) => !open)}
      >
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          {[5, 12, 19].flatMap((cy) => [5, 12, 19].map((cx) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.1" />
          )))}
        </svg>
        <span className="app-header-button-label">Werkzeuge</span>
      </button>
      {isOpen ? (
        <div
          ref={panelRef}
          id={panelId}
          className="tools-launcher-panel"
          role="dialog"
          aria-label="Werkzeuge"
          onKeyDown={handlePanelKeyDown}
        >
          {groups.map((group) => (
            <section key={group.id} className="tools-launcher-group" aria-labelledby={`${panelId}-${group.id}`}>
              <h2 id={`${panelId}-${group.id}`} className="tools-launcher-group-title">{group.title}</h2>
              <div className="tools-launcher-grid">
                {group.tools.map((tool) => (
                  <button
                    key={tool.id}
                    className={`tools-launcher-tile${activeView === tool.id ? " is-active" : ""}`}
                    type="button"
                    aria-current={activeView === tool.id ? "page" : undefined}
                    onClick={() => {
                      setIsOpen(false);
                      triggerRef.current?.focus();
                      onSelect(tool.id);
                    }}
                  >
                    <span className={`tools-launcher-tile-icon tone-${group.tone}`}>
                      <LauncherIcon name={tool.icon} />
                    </span>
                    <span className="tools-launcher-tile-label">{tool.label.replace("Wissensbestand", "Wissens\u00ADbestand")}</span>
                    {tool.adminOnly ? <span className="tools-launcher-admin-badge">Admin</span> : null}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}
