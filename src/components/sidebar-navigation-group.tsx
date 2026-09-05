"use client";

import { useId, useState, type ReactNode } from "react";

export default function SidebarNavigationGroup({
  title,
  active,
  defaultExpanded = false,
  children,
}: {
  title: string;
  active: boolean;
  defaultExpanded?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const isOpen = active || expanded;

  return (
    <div className="sidebar-navigation-group">
      <button
        className="sidebar-group-toggle"
        type="button"
        aria-expanded={isOpen}
        aria-controls={id}
        aria-disabled={active || undefined}
        onClick={() => { if (!active) setExpanded(!expanded); }}
      >
        <span>{title}</span>
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d={isOpen ? "m6 9 6 6 6-6" : "m9 6 6 6-6 6"} />
        </svg>
      </button>
      <div className="sidebar-group-items" id={id} hidden={!isOpen}>
        {children}
      </div>
    </div>
  );
}
