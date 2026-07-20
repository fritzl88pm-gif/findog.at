import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  clampSidebarHistoryPercent,
  DEFAULT_SIDEBAR_HISTORY_PERCENT,
  MAX_SIDEBAR_HISTORY_PERCENT,
  MIN_SIDEBAR_HISTORY_PERCENT,
  parseStoredApplicationNavigationExpanded,
  parseStoredSidebarHistoryPercent,
} from "@/lib/chat/sidebar-split";

const pageSource = readFileSync(
  fileURLToPath(new URL("../../app/page.tsx", import.meta.url)),
  "utf8",
);
const cssSource = readFileSync(
  fileURLToPath(new URL("../../app/globals.css", import.meta.url)),
  "utf8",
);

describe("sidebar split helpers", () => {
  it("clamps the history share to the supported range", () => {
    expect(clampSidebarHistoryPercent(10)).toBe(MIN_SIDEBAR_HISTORY_PERCENT);
    expect(clampSidebarHistoryPercent(63)).toBe(63);
    expect(clampSidebarHistoryPercent(95)).toBe(MAX_SIDEBAR_HISTORY_PERCENT);
    expect(clampSidebarHistoryPercent(Number.NaN)).toBe(DEFAULT_SIDEBAR_HISTORY_PERCENT);
  });

  it("parses a stored history share and rejects invalid values", () => {
    expect(parseStoredSidebarHistoryPercent("67.5")).toBe(67.5);
    expect(parseStoredSidebarHistoryPercent("5")).toBe(MIN_SIDEBAR_HISTORY_PERCENT);
    expect(parseStoredSidebarHistoryPercent("not-a-number")).toBe(
      DEFAULT_SIDEBAR_HISTORY_PERCENT,
    );
    expect(parseStoredSidebarHistoryPercent(null)).toBe(DEFAULT_SIDEBAR_HISTORY_PERCENT);
  });

  it("parses the persisted application-navigation preference safely", () => {
    expect(parseStoredApplicationNavigationExpanded("true")).toBe(true);
    expect(parseStoredApplicationNavigationExpanded("false")).toBe(false);
    expect(parseStoredApplicationNavigationExpanded("invalid")).toBe(true);
    expect(parseStoredApplicationNavigationExpanded(null)).toBe(true);
  });
});

describe("sidebar split integration", () => {
  it("renders an accessible horizontal separator with pointer capture and keyboard controls", () => {
    expect(pageSource).toContain('className="sidebar-split-divider"');
    expect(pageSource).toContain('role="separator"');
    expect(pageSource).toContain('aria-orientation="horizontal"');
    expect(pageSource).toContain("aria-valuemin={MIN_SIDEBAR_HISTORY_PERCENT}");
    expect(pageSource).toContain("aria-valuemax={MAX_SIDEBAR_HISTORY_PERCENT}");
    expect(pageSource).toContain("aria-valuenow={sidebarHistoryPercent}");
    expect(pageSource).toContain("setPointerCapture(event.pointerId)");
    expect(pageSource).toContain("onPointerMove={handleSidebarSplitPointerMove}");
    expect(pageSource).toContain("onPointerUp={finishSidebarSplitResize}");
    expect(pageSource).toContain("onPointerCancel={finishSidebarSplitResize}");
    expect(pageSource).toContain(
      "persistSidebarHistoryPercent(sidebarHistoryPercentRef.current)",
    );
    expect(pageSource).toContain("SIDEBAR_HISTORY_PERCENT_STORAGE_KEY");
    expect(pageSource).toContain('event.key === "ArrowUp"');
    expect(pageSource).toContain('event.key === "ArrowDown"');
    expect(pageSource).toContain('event.key === "Home"');
    expect(pageSource).toContain('event.key === "End"');
    expect(pageSource).not.toMatch(/(?:window|document)\.addEventListener\("pointer(?:move|up|cancel)"/u);
  });

  it("keeps a persisted application toggle visible outside the scrollable navigation", () => {
    expect(pageSource).toContain('className="application-navigation-toggle"');
    expect(pageSource).toContain("Anwendungsbereiche");
    expect(pageSource).toContain("aria-expanded={isApplicationNavigationExpanded}");
    expect(pageSource).toContain('aria-controls="application-navigation"');
    expect(pageSource).toContain("SIDEBAR_APPLICATION_NAVIGATION_STORAGE_KEY");
    expect(pageSource).toMatch(
      /application-navigation-toggle[\s\S]*?isApplicationNavigationExpanded \? \([\s\S]*?<nav/u,
    );
  });

  it("uses a height-only split layout with internal scrolling and no width resize affordance", () => {
    expect(cssSource).toMatch(/\.sidebar-split-region \{[\s\S]*?grid-template-rows:/u);
    expect(cssSource).toMatch(/\.sidebar-split-region\.is-resizing \{[\s\S]*?transition: none;/u);
    expect(cssSource).toMatch(/\.sidebar-split-divider \{[\s\S]*?touch-action: none;/u);
    expect(cssSource).toMatch(/\.forms-navigation \{[\s\S]*?overflow-y: auto;/u);
    expect(cssSource).toMatch(
      /\.sidebar-split-region\.applications-collapsed \{[\s\S]*?grid-template-rows: minmax\(0, 1fr\) auto;/u,
    );
    expect(cssSource).not.toContain("cursor: col-resize");
  });
});
