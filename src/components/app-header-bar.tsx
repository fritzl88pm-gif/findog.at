"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";

import { getAccountInitials } from "@/lib/account-initials";
import type { LauncherToolId } from "@/lib/tools-launcher";

import ToolsLauncher from "./tools-launcher";

type AccountMenuProps = {
  email: string;
  isAdmin: boolean;
  isAdministrationActive: boolean;
  isSigningOut: boolean;
  /** Also used by the settings dialog to return focus when it closes. */
  triggerRef: RefObject<HTMLButtonElement | null>;
  onOpenSettings: () => void;
  onOpenAdministration: () => void;
  onSignOut: () => void;
};

function AccountMenu({
  email,
  isAdmin,
  isAdministrationActive,
  isSigningOut,
  triggerRef,
  onOpenSettings,
  onOpenAdministration,
  onSignOut,
}: AccountMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!isOpen) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();

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
  }, [isOpen, triggerRef]);

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") {
      requestAnimationFrame(() => {
        if (!containerRef.current?.contains(document.activeElement)) setIsOpen(false);
      });
      return;
    }
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: HTMLButtonElement | undefined;
    if (event.key === "ArrowDown") next = items[(index + 1) % items.length];
    else if (event.key === "ArrowUp") next = items[(index - 1 + items.length) % items.length];
    else if (event.key === "Home") next = items[0];
    else if (event.key === "End") next = items[items.length - 1];
    else return;
    event.preventDefault();
    next?.focus();
  }

  function choose(action: () => void) {
    setIsOpen(false);
    action();
  }

  return (
    <div className="app-header-menu" ref={containerRef}>
      <button
        ref={triggerRef}
        className={`app-header-avatar${isOpen ? " is-open" : ""}`}
        type="button"
        aria-label="Konto"
        title="Konto"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        onClick={() => setIsOpen((open) => !open)}
      >
        {getAccountInitials(email)}
      </button>
      {isOpen ? (
        <div
          ref={menuRef}
          id={menuId}
          className="account-menu-panel"
          role="menu"
          aria-label="Konto"
          onKeyDown={handleMenuKeyDown}
        >
          <div className="account-menu-identity">
            <span className="account-menu-identity-label">Angemeldet als</span>
            <span className="account-menu-identity-email" title={email}>{email}</span>
          </div>
          <button className="account-menu-item" type="button" role="menuitem" onClick={() => choose(onOpenSettings)}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></svg>
            Einstellungen
          </button>
          {isAdmin ? (
            <button
              className="account-menu-item"
              type="button"
              role="menuitem"
              aria-current={isAdministrationActive ? "page" : undefined}
              onClick={() => choose(onOpenAdministration)}
            >
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></svg>
              Administration
            </button>
          ) : null}
          <button
            className="account-menu-item"
            type="button"
            role="menuitem"
            disabled={isSigningOut}
            onClick={() => choose(onSignOut)}
          >
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
            Abmelden
          </button>
        </div>
      ) : null}
    </div>
  );
}

type Props = {
  activeView: string;
  isAdmin: boolean;
  email: string;
  isSigningOut: boolean;
  hasUnreadNews: boolean;
  accountTriggerRef: RefObject<HTMLButtonElement | null>;
  onOpenNews: () => void;
  onSelectTool: (id: LauncherToolId) => void;
  onOpenSettings: () => void;
  onOpenAdministration: () => void;
  onSignOut: () => void;
};

/** Compact top-right bar: Neuigkeiten · Werkzeuge · Konto. */
export default function AppHeaderBar({
  activeView,
  isAdmin,
  email,
  isSigningOut,
  hasUnreadNews,
  accountTriggerRef,
  onOpenNews,
  onSelectTool,
  onOpenSettings,
  onOpenAdministration,
  onSignOut,
}: Props) {
  return (
    <div className="app-header-bar">
      <button
        className={`app-header-icon-button${activeView === "news" ? " is-open" : ""}`}
        type="button"
        aria-label="Neuigkeiten"
        title={hasUnreadNews ? "Neuigkeiten – Neues verfügbar" : "Neuigkeiten"}
        aria-current={activeView === "news" ? "page" : undefined}
        onClick={onOpenNews}
      >
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {hasUnreadNews ? <span className="app-header-news-dot" aria-hidden="true" /> : null}
      </button>
      <ToolsLauncher isAdmin={isAdmin} activeView={activeView} onSelect={onSelectTool} />
      <AccountMenu
        email={email}
        isAdmin={isAdmin}
        isAdministrationActive={activeView === "administration"}
        isSigningOut={isSigningOut}
        triggerRef={accountTriggerRef}
        onOpenSettings={onOpenSettings}
        onOpenAdministration={onOpenAdministration}
        onSignOut={onSignOut}
      />
    </div>
  );
}
