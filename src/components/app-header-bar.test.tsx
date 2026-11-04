// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AppHeaderBar from "./app-header-bar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Overrides = Partial<Parameters<typeof AppHeaderBar>[0]>;

let container: HTMLDivElement;
let root: Root;

function render(overrides: Overrides = {}) {
  const props = {
    activeView: "chat",
    isAdmin: false,
    email: "harald.fritz@example.com",
    isSigningOut: false,
    hasUnreadNews: false,
    accountTriggerRef: createRef<HTMLButtonElement>(),
    onOpenNews: vi.fn(),
    onSelectTool: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenAdministration: vi.fn(),
    onSignOut: vi.fn(),
    ...overrides,
  };
  act(() => root.render(<AppHeaderBar {...props} />));
  return props;
}

const byLabel = (label: string) => container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
const tiles = () => Array.from(container.querySelectorAll<HTMLButtonElement>(".tools-launcher-tile"));
// Soft hyphens (U+00AD) are invisible break hints, not part of the visible label.
const tileLabels = () => tiles().map((tile) => tile.textContent?.replace(/\u00AD/g, ""));

function click(element: Element | null) {
  act(() => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function pressKey(target: Element | Document, key: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("AppHeaderBar", () => {
  it("renders the three controls in order with the account initials", () => {
    render();
    const controls = Array.from(container.querySelectorAll(".app-header-bar > button, .app-header-bar > .app-header-menu > button"))
      .map((element) => element.getAttribute("aria-label"));
    expect(controls).toEqual(["Neuigkeiten", "Werkzeuge", "Konto"]);
    expect(byLabel("Konto")?.textContent).toBe("HF");
  });

  it("shows the yellow unread dot only when there is unseen news", () => {
    render({ hasUnreadNews: false });
    expect(container.querySelector(".app-header-news-dot")).toBeNull();
    render({ hasUnreadNews: true });
    expect(container.querySelector(".app-header-news-dot")).not.toBeNull();
  });

  it("opens the news view from the bell", () => {
    const props = render();
    click(byLabel("Neuigkeiten"));
    expect(props.onOpenNews).toHaveBeenCalledTimes(1);
  });

  it("lists every tool for admins with Admin badges and hides admin tiles for regular users", () => {
    render({ isAdmin: false });
    click(byLabel("Werkzeuge"));
    expect(byLabel("Werkzeuge")?.getAttribute("aria-expanded")).toBe("true");
    expect(tileLabels()).toEqual([
      "BFG Suche", "BFG Suche PRO", "BFG Newsletter", "Wissensbestand",
      "Dokumente scannen", "Textbausteine", "Formulare", "Downloads",
      "Deutsche SV-Rente", "L17b-Rechner",
      "Fredrun", "Fredrun 2.0",
    ]);
    expect(container.querySelector(".tools-launcher-admin-badge")).toBeNull();

    render({ isAdmin: true });
    expect(tileLabels().slice(-4)).toEqual(["Fredrun", "Fredrun 2.0", "QuizAdmin", "Fred LiveAdmin"]);
    expect(container.querySelectorAll(".tools-launcher-admin-badge")).toHaveLength(2);
  });

  it("highlights the active tool, selects a tool and closes afterwards", () => {
    const props = render({ isAdmin: true, activeView: "downloads" });
    click(byLabel("Werkzeuge"));
    const active = container.querySelector('.tools-launcher-tile[aria-current="page"]');
    expect(active?.textContent).toBe("Downloads");
    expect(document.activeElement).toBe(active);

    click(tiles().find((tile) => tile.textContent?.startsWith("Fred Live")) ?? null);
    expect(props.onSelectTool).toHaveBeenCalledWith("fred-live");
    expect(container.querySelector(".tools-launcher-panel")).toBeNull();
    expect(document.activeElement).toBe(byLabel("Werkzeuge"));
  });

  it("closes the launcher on Escape (returning focus) and on outside pointer down", () => {
    render();
    click(byLabel("Werkzeuge"));
    pressKey(document, "Escape");
    expect(container.querySelector(".tools-launcher-panel")).toBeNull();
    expect(document.activeElement).toBe(byLabel("Werkzeuge"));

    click(byLabel("Werkzeuge"));
    act(() => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(container.querySelector(".tools-launcher-panel")).toBeNull();
  });

  it("offers settings, sign-out and (admin only) administration in the account menu", () => {
    const props = render({ isAdmin: false });
    click(byLabel("Konto"));
    const items = () => Array.from(container.querySelectorAll('[role="menuitem"]')).map((item) => item.textContent);
    expect(container.querySelector(".account-menu-identity-email")?.textContent).toBe("harald.fritz@example.com");
    expect(items()).toEqual(["Einstellungen", "Abmelden"]);

    click(container.querySelector('[role="menuitem"]'));
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".account-menu-panel")).toBeNull();

    const adminProps = render({ isAdmin: true });
    click(byLabel("Konto"));
    expect(items()).toEqual(["Einstellungen", "Administration", "Abmelden"]);
    click(Array.from(container.querySelectorAll('[role="menuitem"]')).find((item) => item.textContent === "Administration") ?? null);
    expect(adminProps.onOpenAdministration).toHaveBeenCalledTimes(1);
    expect(props.onOpenAdministration).not.toHaveBeenCalled();
  });

  it("signs out from the menu, disables the action while signing out and closes on Escape", () => {
    const props = render();
    click(byLabel("Konto"));
    click(Array.from(container.querySelectorAll('[role="menuitem"]')).find((item) => item.textContent === "Abmelden") ?? null);
    expect(props.onSignOut).toHaveBeenCalledTimes(1);

    render({ isSigningOut: true, onSignOut: props.onSignOut });
    click(byLabel("Konto"));
    const signOut = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((item) => item.textContent === "Abmelden");
    expect(signOut?.disabled).toBe(true);

    pressKey(document, "Escape");
    expect(container.querySelector(".account-menu-panel")).toBeNull();
    expect(document.activeElement).toBe(byLabel("Konto"));
  });

  it("exposes the account button through the settings trigger ref for focus return", () => {
    const accountTriggerRef = createRef<HTMLButtonElement>();
    render({ accountTriggerRef });
    expect(accountTriggerRef.current).toBe(byLabel("Konto"));
  });
});
