"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ADMIN_AREAS, ADMIN_AREA_GROUPS, type AdminArea } from "@/lib/admin-navigation";

function AreaIcon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    users: <><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5"/></>,
    feedback: <><path d="M4 4h16v12H9l-5 5V4Z"/><path d="M8 8h8M8 12h5"/></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>,
    news: <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h3M14 15h2M8 18h3M14 18h2"/></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/></>,
    scan: <><path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M7 8h10M7 12h10M7 16h6"/></>,
    chart: <><path d="M3 3v18h18M7 16v-5M12 16V7M17 16v-8"/></>,
    agent: <><path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.4-4.6A8 8 0 1 1 21 12Z"/><path d="M12 8v4l3 2"/></>,
    "agent-config": <><path d="M5 5v6M5 15v4M12 5v3M12 12v7M19 5v9M19 18v1"/><circle cx="5" cy="13" r="2"/><circle cx="12" cy="10" r="2"/><circle cx="19" cy="16" r="2"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export default function AdminWorkspace({ area, onNavigate, children, error, notice }: {
  area: AdminArea; onNavigate: (area: AdminArea) => void; children?: ReactNode; error?: string; notice?: string;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const previousArea = useRef(area);
  const active = ADMIN_AREAS.find((entry) => entry.id === area);
  useEffect(() => {
    if (previousArea.current !== area) {
      title.current?.focus();
      if (menu.current) menu.current.open = false;
      previousArea.current = area;
    }
  }, [area]);
  const navigation = (
    <nav className="admin-area-navigation" aria-label="Adminbereiche">
      <button type="button" aria-current={area === "overview" ? "page" : undefined} onClick={() => onNavigate("overview")}>
        <AreaIcon name="overview"/>Übersicht
      </button>
      {ADMIN_AREA_GROUPS.map((group) => (
        <div className="admin-navigation-group" key={group}>
          <p>{group}</p>
          {ADMIN_AREAS.filter((entry) => entry.group === group).map((entry) => (
            <button key={entry.id} type="button" aria-current={area === entry.id ? "page" : undefined} onClick={() => onNavigate(entry.id)}>
              <AreaIcon name={entry.icon}/><span>{entry.title}</span>
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
  return (
    <section className="forms-panel admin-host" aria-labelledby="administration-view-title">
      <div className="admin-workspace">
        <header className="admin-workspace-heading">
          <p className="eyebrow">Administration{active ? ` / ${active.group}` : ""}</p>
          <h1 ref={title} tabIndex={-1} id="administration-view-title">{active?.title ?? "Administration"}</h1>
          <p>{active?.description ?? "Benutzer, Inhalte und Systemeinstellungen an einem Ort verwalten."}</p>
        </header>
        <div className="admin-workspace-grid">
          <aside className="admin-desktop-navigation">{navigation}</aside>
          <details className="admin-mobile-navigation" ref={menu}>
            <summary><AreaIcon name={active?.icon ?? "overview"}/><span>{active?.title ?? "Übersicht"}</span><span aria-hidden="true">⌄</span></summary>
            {navigation}
          </details>
          <div className="admin-area-content">
            {error ? <div className="admin-message error-box" role="alert">{error}</div> : null}
            {notice ? <div className="notice-box" role="status">{notice}</div> : null}
            {area === "overview" ? (
              <div className="admin-overview">
                {ADMIN_AREA_GROUPS.map((group) => (
                  <section key={group} className="admin-overview-group" aria-label={group}>
                    <h2>{group}</h2>
                    <div className="admin-overview-cards">
                      {ADMIN_AREAS.filter((entry) => entry.group === group).map((entry) => (
                        <button key={entry.id} type="button" className="admin-area-card" onClick={() => onNavigate(entry.id)}>
                          <span className="admin-area-icon"><AreaIcon name={entry.icon}/></span>
                          <span><strong>{entry.title}</strong><small>{entry.description}</small></span>
                          <span className="admin-area-arrow" aria-hidden="true">↗</span>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : children}
          </div>
        </div>
      </div>
    </section>
  );
}
