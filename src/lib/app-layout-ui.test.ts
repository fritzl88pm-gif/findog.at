import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const pageSource = read("../app/page.tsx");
const cssSource = read("../app/globals.css");

function rule(selector: string): string {
  const start = cssSource.indexOf(`\n${selector} {`);
  expect(start, `${selector} rule exists`).toBeGreaterThan(-1);
  return cssSource.slice(start, cssSource.indexOf("\n}", start));
}

describe("app header row layout", () => {
  it("renders the header bar and the mobile toggle in a layout row above the active view", () => {
    const main = pageSource.indexOf('className="app-main"');
    const topbar = pageSource.indexOf('className="app-topbar"');
    const toggle = pageSource.indexOf('className="mobile-menu-toggle"');
    const header = pageSource.indexOf("<AppHeaderBar");
    const view = pageSource.indexOf('className="app-main-view"');
    const firstView = pageSource.indexOf('{appView === "news" ? (');
    expect(main).toBeGreaterThan(-1);
    expect(topbar).toBeGreaterThan(main);
    expect(toggle).toBeGreaterThan(topbar);
    expect(header).toBeGreaterThan(toggle);
    expect(view).toBeGreaterThan(header);
    expect(firstView).toBeGreaterThan(view);
  });

  it("keeps the header out of the content flow's overlay layer", () => {
    expect(rule(".app-header-bar")).not.toContain("position: absolute");
    expect(rule(".mobile-menu-toggle")).not.toContain("position: absolute");
    expect(rule(".app-topbar")).toContain("flex: 0 0 auto");
    expect(rule(".app-main")).toContain("flex-direction: column");
    expect(rule(".app-main-view")).toContain("min-height: 0");
    expect(rule(".app-main-view")).toContain("overflow: hidden");
  });

  it("no longer pads views to clear a floating header", () => {
    expect(cssSource).not.toMatch(/padding:\s*(6[48]|72)px/u);
    expect(cssSource).not.toContain("clears the floating header bar");
  });
});

describe("sidebar without a history/navigation divider", () => {
  it("lets the conversation history fill the sidebar", () => {
    expect(pageSource).not.toContain("sidebar-split");
    expect(pageSource).not.toContain("SIDEBAR_HISTORY");
    expect(pageSource).not.toContain('role="separator"');
    expect(cssSource).not.toContain("sidebar-split");
    expect(cssSource).not.toContain("--sidebar-history-share");
    expect(rule(".conversation-history")).toContain("flex: 1");
    expect(existsSync(fileURLToPath(new URL("./chat/sidebar-split.ts", import.meta.url)))).toBe(false);
  });
});
