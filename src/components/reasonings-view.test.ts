// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReasoningsView from "./reasonings-view";

const STORAGE_KEY = "findog_reasonings_title_view_enabled";

class MockStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
}

const testCategories = [
  {
    id: "cat-1",
    name: "Steuerrecht",
    parentId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "cat-2",
    name: "Umsatzsteuer",
    parentId: "cat-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "cat-3",
    name: "Einkommensteuer",
    parentId: "cat-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];

const testReasonings = [
  {
    id: "snip-1",
    title: "Vorsteuerabzug bei Kleinunternehmern",
    content: "Gemäß § 6 Abs. 1 Z 27 UStG ist der Vorsteuerabzug für Kleinunternehmer ausgeschlossen.",
    categoryIds: ["cat-2"],
    createdAt: "2026-01-01T10:00:00Z",
    updatedAt: "2026-01-02T12:00:00Z",
  },
  {
    id: "snip-2",
    title: "Betriebsausgabenpauschalierung Basisregel",
    content: "Die Pauschalierung der Betriebsausgaben richtet sich nach den gesetzlichen Bestimmungen des EStG.",
    categoryIds: ["cat-3"],
    createdAt: "2026-01-03T10:00:00Z",
    updatedAt: "2026-01-03T10:00:00Z",
  },
  {
    id: "snip-3",
    title: "Änderung der Veranlagung",
    content: "Verfahrensrechtliche Wiederaufnahme gemäß § 303 BAO.",
    categoryIds: ["cat-1"],
    createdAt: "2026-01-01T08:00:00Z",
    updatedAt: "2026-01-04T09:00:00Z",
  },
];

let host: HTMLDivElement;
let root: Root;
let mockStorage: MockStorage;
const fetchMock = vi.fn();
const writeTextMock = vi.fn();
const reply = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));
const pause = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

async function render(node: ReactNode) {
  await act(async () => {
    root.render(node);
  });
  await act(async () => {
    await pause(60);
  });
}

async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).click();
  });
  await act(async () => {
    await pause(30);
  });
}

async function realClick(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  });
  await act(async () => {
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    (element as HTMLElement).click();
  });
  await act(async () => {
    await pause(30);
  });
}

async function changeInput(
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
) {
  await act(async () => {
    if (element instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(element, value);
    } else if (element instanceof HTMLSelectElement) {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        "value",
      )?.set;
      setter?.call(element, value);
    } else if (element instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(element, value);
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    await pause(30);
  });
}

function buttonByText(text: string, selector = "button"): HTMLButtonElement {
  const found = [...host.querySelectorAll(selector)].find((node) =>
    node.textContent?.trim().includes(text),
  );
  if (!found) throw new Error(`Button containing text "${text}" not found`);
  return found as HTMLButtonElement;
}

function getSearchInput(): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>("#reasonings-search-input");
  if (!input) throw new Error("Search input #reasonings-search-input not found");
  return input;
}

function getCategorySelect(): HTMLSelectElement {
  const select = host.querySelector<HTMLSelectElement>("#reasonings-category-select");
  if (!select) throw new Error("Category select #reasonings-category-select not found");
  return select;
}

function getSortSelect(): HTMLSelectElement {
  const select = host.querySelector<HTMLSelectElement>("#reasonings-sort-select");
  if (!select) throw new Error("Sort select #reasonings-sort-select not found");
  return select;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetchMock.mockReset();
  fetchMock.mockImplementation(() =>
    reply({ categories: testCategories, reasonings: testReasonings }),
  );
  vi.stubGlobal("fetch", fetchMock);

  writeTextMock.mockReset();
  writeTextMock.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: writeTextMock },
    configurable: true,
    writable: true,
  });

  mockStorage = new MockStorage();
  Object.defineProperty(window, "localStorage", {
    value: mockStorage,
    configurable: true,
    writable: true,
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);

  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root.unmount();
    });
  }
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Task 1: Searchable, filterable, sortable compact list", () => {
  it("renders visible labelled search input, category select, sort select, and compact rows", async () => {
    await render(createElement(ReasoningsView, { accessToken: "test-token" }));

    // Labelled search input
    const searchInput = getSearchInput();
    expect(searchInput).toBeDefined();
    const searchLabel = host.querySelector('label[for="reasonings-search-input"]');
    expect(searchLabel?.textContent).toContain("Textbausteine durchsuchen");

    // Category select with Alle Kategorien
    const catSelect = getCategorySelect();
    expect(catSelect).toBeDefined();
    const catLabel = host.querySelector('label[for="reasonings-category-select"]');
    expect(catLabel?.textContent).toContain("Kategorie");
    expect(catSelect.options[0].text).toBe("Alle Kategorien");

    // Sort select with Zuletzt geändert and A–Z
    const sortSelect = getSortSelect();
    expect(sortSelect).toBeDefined();
    const sortLabel = host.querySelector('label[for="reasonings-sort-select"]');
    expect(sortLabel?.textContent).toContain("Sortierung");
    expect(sortSelect.value).toBe("updated");

    // Compact rows rendered with preview by default
    const rows = host.querySelectorAll(".reasoning-row");
    expect(rows).toHaveLength(3);
    const previews = host.querySelectorAll(".reasoning-row-preview");
    expect(previews.length).toBeGreaterThan(0);
  });

  it("filters items by search query matching title or content case-insensitively with whitespace trim", async () => {
    await render(createElement(ReasoningsView, { accessToken: "test-token" }));

    const searchInput = getSearchInput();

    // Search by title substring with leading/trailing whitespace
    await changeInput(searchInput, "  vorsteuer  ");
    let rows = host.querySelectorAll(".reasoning-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Vorsteuerabzug bei Kleinunternehmern");

    // Search by content keyword (wiederaufnahme in snip-3 content)
    await changeInput(searchInput, "WIEDERAUFNAHME");
    rows = host.querySelectorAll(".reasoning-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Änderung der Veranlagung");

    // Clear search restores all
    await changeInput(searchInput, "");
    rows = host.querySelectorAll(".reasoning-row");
    expect(rows).toHaveLength(3);
  });

  it("combines category filter and search query; parent category includes children", async () => {
    await render(createElement(ReasoningsView, { accessToken: "test-token" }));

    const catSelect = getCategorySelect();
    const searchInput = getSearchInput();

    // Selecting parent category "cat-1" (Steuerrecht) should include snip-1 (child cat-2), snip-2 (child cat-3), and snip-3 (cat-1)
    await changeInput(catSelect, "cat-1");
    let rows = host.querySelectorAll(".reasoning-row");
    expect(rows).toHaveLength(3);

    // Selecting child category "cat-2" (Umsatzsteuer) should only include snip-1
    await changeInput(catSelect, "cat-2");
    rows = host.querySelectorAll(".reasoning-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Vorsteuerabzug bei Kleinunternehmern");

    // Combine category with search query that doesn't match
    await changeInput(searchInput, "EStG");
    rows = host.querySelectorAll(".reasoning-row");
    expect(rows).toHaveLength(0);

    // Switch category back to all, search still applies
    await changeInput(catSelect, "");
    rows = host.querySelectorAll(".reasoning-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Betriebsausgabenpauschalierung Basisregel");
  });

  it("sorts by Zuletzt geändert (default) and A–Z (German locale-aware)", async () => {
    await render(createElement(ReasoningsView, { accessToken: "test-token" }));

    const sortSelect = getSortSelect();

    // Default is "updated":
    // snip-3: 2026-01-04, snip-2: 2026-01-03, snip-1: 2026-01-02
    let rows = host.querySelectorAll(".reasoning-row");
    expect(rows[0].textContent).toContain("Änderung der Veranlagung");
    expect(rows[1].textContent).toContain("Betriebsausgabenpauschalierung Basisregel");
    expect(rows[2].textContent).toContain("Vorsteuerabzug bei Kleinunternehmern");

    // Change to "alpha" (A–Z)
    await changeInput(sortSelect, "alpha");
    rows = host.querySelectorAll(".reasoning-row");
    // German alphabetical order:
    // 1. Änderung der Veranlagung (Ä collates as A)
    // 2. Betriebsausgabenpauschalierung Basisregel
    // 3. Vorsteuerabzug bei Kleinunternehmern
    expect(rows[0].textContent).toContain("Änderung der Veranlagung");
    expect(rows[1].textContent).toContain("Betriebsausgabenpauschalierung Basisregel");
    expect(rows[2].textContent).toContain("Vorsteuerabzug bei Kleinunternehmern");
  });

  it("shows empty state when no reasonings exist vs no-results state when filtered out", async () => {
    // 1. Filtered out case: "Keine Treffer"
    await render(createElement(ReasoningsView, { accessToken: "test-token" }));
    const searchInput = getSearchInput();
    await changeInput(searchInput, "unbekannter-begriff-xyz");

    expect(host.querySelectorAll(".reasoning-row")).toHaveLength(0);
    expect(host.textContent).toContain("Keine Treffer");
    expect(host.textContent).not.toContain("Ersten Textbaustein anlegen");

    // 2. Initial empty case: "Noch keine Textbausteine"
    fetchMock.mockImplementation(() => reply({ categories: [], reasonings: [] }));
    await act(async () => {
      root.unmount();
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await render(createElement(ReasoningsView, { accessToken: "test-token" }));
    expect(host.textContent).toContain("Noch keine Textbausteine");
    expect(host.textContent).toContain("Ersten Textbaustein anlegen");
  });

  it("preserves findog_reasonings_title_view_enabled localStorage semantics (true => no preview, default false => preview)", async () => {
    await render(createElement(ReasoningsView, { accessToken: "test-token" }));

    const toggle = buttonByText("Nur Titel");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    // In preview mode (default false), preview is rendered
    expect(host.querySelectorAll(".reasoning-row-preview").length).toBeGreaterThan(0);

    // Toggle to title-only (no preview)
    await click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(mockStorage.getItem(STORAGE_KEY)).toBe("true");
    expect(host.querySelectorAll(".reasoning-row-preview")).toHaveLength(0);

    // Remount restores saved preference
    await act(async () => {
      root.unmount();
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await render(createElement(ReasoningsView, { accessToken: "test-token" }));
    const remountedToggle = buttonByText("Nur Titel");
    expect(remountedToggle.getAttribute("aria-checked")).toBe("true");
    expect(host.querySelectorAll(".reasoning-row-preview")).toHaveLength(0);
  });

  it("gracefully tolerates unavailable or malformed localStorage", async () => {
    mockStorage.setItem(STORAGE_KEY, "corrupted-json");
    await render(createElement(ReasoningsView, { accessToken: "test-token" }));
    expect(buttonByText("Nur Titel").getAttribute("aria-checked")).toBe("false");

    // Storage getItem throws error
    vi.spyOn(mockStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError: localStorage is disabled");
    });
    await act(async () => {
      root.unmount();
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await render(createElement(ReasoningsView, { accessToken: "test-token" }));
    const toggle = buttonByText("Nur Titel");
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    // Storage setItem throws error
    vi.spyOn(mockStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    await click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });
});

describe("Task 2: Responsive reader and selection", () => {
  it("renders reader panel with selected entry full content, metadata, and copy button", async () => {
    await render(createElement(ReasoningsView, { accessToken: "test-token" }));

    const reader = host.querySelector(".reasoning-reader-panel");
    expect(reader).not.toBeNull();

    // Default selected is first item: snip-3 (most recently updated: 2026-01-04)
    expect(reader?.textContent).toContain("Änderung der Veranlagung");
    expect(reader?.textContent).toContain("Verfahrensrechtliche Wiederaufnahme gemäß § 303 BAO.");
    expect(reader?.textContent).toContain("Aktualisiert");
    expect(reader?.textContent).toContain("Steuerrecht");

    // Clear copy action in reader
    const readerCopy = reader?.querySelector<HTMLButtonElement>(".reasoning-reader-copy-button");
    expect(readerCopy).not.toBeNull();
    await click(readerCopy!);
    expect(writeTextMock).toHaveBeenCalledWith(testReasonings[2].content);
  });

  it("updates reader when clicking another row", async () => {
    await render(createElement(ReasoningsView, { accessToken: "test-token" }));

    const rows = host.querySelectorAll<HTMLElement>(".reasoning-row");
    // Click second row: snip-2
    await click(rows[1]);

    const reader = host.querySelector(".reasoning-reader-panel");
    expect(reader?.textContent).toContain("Betriebsausgabenpauschalierung Basisregel");
    expect(reader?.textContent).toContain(testReasonings[1].content);
    expect(rows[1].classList.contains("is-selected")).toBe(true);
  });

  it("safely falls back to first visible item when selected item is filtered out", async () => {
    await render(createElement(ReasoningsView, { accessToken: "test-token" }));

    const rows = host.querySelectorAll<HTMLElement>(".reasoning-row");
    // Select snip-3 (row 0)
    await click(rows[0]);
    let reader = host.querySelector(".reasoning-reader-panel");
    expect(reader?.textContent).toContain("Änderung der Veranlagung");

    // Filter to category "cat-2" which only contains snip-1 (Vorsteuerabzug)
    const catSelect = getCategorySelect();
    await changeInput(catSelect, "cat-2");

    // Selection must safely fallback to snip-1; never show filtered-out snip-3
    reader = host.querySelector(".reasoning-reader-panel");
    expect(reader?.textContent).toContain("Vorsteuerabzug bei Kleinunternehmern");
    expect(reader?.textContent).not.toContain("Änderung der Veranlagung");
  });

  it("supports mobile disclosure accordion without dangling aria-controls or nested buttons", async () => {
    await render(createElement(ReasoningsView, { accessToken: "test-token" }));

    const disclosureButtons = host.querySelectorAll<HTMLButtonElement>(".reasoning-row-title-btn");
    expect(disclosureButtons.length).toBeGreaterThan(0);

    // Verify native button semantics: no nested buttons within buttons
    disclosureButtons.forEach((btn) => {
      expect(btn.querySelector("button")).toBeNull();
    });

    const firstBtn = disclosureButtons[0];
    const controlsId = firstBtn.getAttribute("aria-controls");
    expect(controlsId).toBeTruthy();

    // The controlled panel must exist in DOM with hidden attribute when collapsed
    const controlledPanel = host.querySelector<HTMLElement>(`#${controlsId}`);
    expect(controlledPanel).not.toBeNull();
    expect(controlledPanel?.hidden).toBe(true);
    expect(firstBtn.getAttribute("aria-expanded")).toBe("false");

    // Click to expand on mobile
    await click(firstBtn);
    expect(firstBtn.getAttribute("aria-expanded")).toBe("true");
    expect(controlledPanel?.hidden).toBe(false);

    // Click again to collapse
    await click(firstBtn);
    expect(firstBtn.getAttribute("aria-expanded")).toBe("false");
    expect(controlledPanel?.hidden).toBe(true);
  });

  it("leaves no stale content in reader when filter yields zero results", async () => {
    await render(createElement(ReasoningsView, { accessToken: "test-token" }));

    const searchInput = getSearchInput();
    await changeInput(searchInput, "unbekannter-suchbegriff-12345");

    // No library layout or reader is rendered when 0 results
    expect(host.querySelectorAll(".reasoning-row")).toHaveLength(0);
    expect(host.querySelector(".reasoning-reader-card")).toBeNull();
    expect(host.textContent).not.toContain("Verfahrensrechtliche Wiederaufnahme");
    expect(host.textContent).toContain("Keine Treffer");
  });

  it("preserves exact full text unmodified with whitespaces in reader", async () => {
    const formattedContent = "Absatz 1:\n  - Aufwand A\n  - Aufwand B\n\nAbsatz 2 mit  mehreren   Leerzeichen.";
    fetchMock.mockImplementation(() =>
      reply({
        categories: testCategories,
        reasonings: [
          {
            ...testReasonings[0],
            content: formattedContent,
          },
        ],
      }),
    );

    await render(createElement(ReasoningsView, { accessToken: "test-token" }));
    const readerContent = host.querySelector(".reasoning-reader-content");
    expect(readerContent?.textContent).toBe(formattedContent);
  });
});

describe("Task 3: Action menu, delete/edit CRUD, and on-demand forms", () => {
  it("copies full original content while preview is hidden (title-only mode)", async () => {
    await render(createElement(ReasoningsView, { accessToken: "test-token" }));
    await click(buttonByText("Nur Titel"));

    // Verify preview is hidden
    expect(host.querySelectorAll(".reasoning-row-preview")).toHaveLength(0);

    const copyButtons = host.querySelectorAll<HTMLButtonElement>(".reasoning-row .reasoning-copy-button");
    expect(copyButtons.length).toBeGreaterThan(0);

    await click(copyButtons[0]);
    // The first item in default sort (updated) is snip-3
    expect(writeTextMock).toHaveBeenCalledWith(testReasonings[2].content);
    expect(writeTextMock).not.toHaveBeenCalledWith(testReasonings[2].title);
  });

  it("opens action menu with Bearbeiten and Löschen only, with accessible title in aria-label", async () => {
    await render(createElement(ReasoningsView, { accessToken: "test-token" }));

    const menuTriggers = host.querySelectorAll<HTMLButtonElement>(".reasoning-menu-trigger");
    expect(menuTriggers.length).toBe(3);

    const firstTrigger = menuTriggers[0];
    expect(firstTrigger.getAttribute("aria-label")).toContain("Änderung der Veranlagung");
    expect(firstTrigger.getAttribute("aria-expanded")).toBe("false");

    // Open menu
    await click(firstTrigger);
    expect(firstTrigger.getAttribute("aria-expanded")).toBe("true");

    const menu = host.querySelector(".reasoning-action-menu");
    expect(menu).not.toBeNull();
    const menuItems = menu?.querySelectorAll("button");
    expect(menuItems).toHaveLength(2);
    expect(menuItems?.[0].textContent).toContain("Bearbeiten");
    expect(menuItems?.[1].textContent).toContain("Löschen");
  });

  it("opens edit form via menu and closes menu", async () => {
    await render(createElement(ReasoningsView, { accessToken: "test-token" }));

    const firstTrigger = host.querySelectorAll<HTMLButtonElement>(".reasoning-menu-trigger")[0];
    await click(firstTrigger);

    const editBtn = buttonByText("Bearbeiten", ".reasoning-action-menu button");
    await click(editBtn);

    // Menu must be closed
    expect(host.querySelector(".reasoning-action-menu")).toBeNull();

    // Editor form must be visible with data prefilled
    const editor = host.querySelector(".reasoning-editor");
    expect(editor).not.toBeNull();
    const titleInput = host.querySelector<HTMLInputElement>("#reasoning-title");
    expect(titleInput?.value).toBe(testReasonings[2].title);
    const contentInput = host.querySelector<HTMLTextAreaElement>("#reasoning-content");
    expect(contentInput?.value).toBe(testReasonings[2].content);
  });

  it("handles delete cancel and confirm with synthetic fetch fixtures", async () => {
    await render(createElement(ReasoningsView, { accessToken: "test-token" }));

    // 1. Cancel delete when confirm returns false
    vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    const firstTrigger = host.querySelectorAll<HTMLButtonElement>(".reasoning-menu-trigger")[0];
    await click(firstTrigger);

    const deleteBtn = buttonByText("Löschen", ".reasoning-action-menu button");
    await click(deleteBtn);

    // DELETE request not sent
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/reasonings/snip-3"),
      expect.objectContaining({ method: "DELETE" }),
    );

    // 2. Confirm delete when confirm returns true
    vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    fetchMock.mockImplementationOnce((url, init) => {
      if (init?.method === "DELETE") {
        return reply({ success: true });
      }
      return reply({ categories: testCategories, reasonings: testReasonings });
    });

    const triggerAgain = host.querySelectorAll<HTMLButtonElement>(".reasoning-menu-trigger")[0];
    await click(triggerAgain);
    const confirmDeleteBtn = buttonByText("Löschen", ".reasoning-action-menu button");
    await click(confirmDeleteBtn);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/reasonings/${testReasonings[2].id}`),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("closes action menu on Escape key and restores focus to trigger", async () => {
    await render(createElement(ReasoningsView, { accessToken: "test-token" }));

    const trigger = host.querySelectorAll<HTMLButtonElement>(".reasoning-menu-trigger")[0];
    await click(trigger);
    expect(host.querySelector(".reasoning-action-menu")).not.toBeNull();

    // Press Escape
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await act(async () => {
      await pause(30);
    });

    expect(host.querySelector(".reasoning-action-menu")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("closes action menu on outside click", async () => {
    await render(createElement(ReasoningsView, { accessToken: "test-token" }));

    const trigger = host.querySelectorAll<HTMLButtonElement>(".reasoning-menu-trigger")[0];
    await click(trigger);
    expect(host.querySelector(".reasoning-action-menu")).not.toBeNull();

    // Click outside on document body
    await act(async () => {
      document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    await act(async () => {
      await pause(30);
    });

    expect(host.querySelector(".reasoning-action-menu")).toBeNull();
  });

  it("updates reader when selected reasoning is deleted", async () => {
    await render(createElement(ReasoningsView, { accessToken: "test-token" }));

    // Selected item is snip-3
    let reader = host.querySelector(".reasoning-reader-panel");
    expect(reader?.textContent).toContain("Änderung der Veranlagung");

    // After deleting snip-3, next fetch returns remaining 2 snippets
    fetchMock.mockImplementation((url, init) => {
      if (init?.method === "DELETE") {
        return reply({ success: true });
      }
      return reply({
        categories: testCategories,
        reasonings: [testReasonings[0], testReasonings[1]],
      });
    });

    vi.spyOn(window, "confirm").mockReturnValue(true);
    const trigger = host.querySelectorAll<HTMLButtonElement>(".reasoning-menu-trigger")[0];
    await click(trigger);
    const deleteBtn = buttonByText("Löschen", ".reasoning-action-menu button");
    await click(deleteBtn);

    // Reader updates to the new first item: snip-2 (updated: 2026-01-03)
    reader = host.querySelector(".reasoning-reader-panel");
    expect(reader?.textContent).not.toContain("Änderung der Veranlagung");
    expect(reader?.textContent).toContain("Betriebsausgabenpauschalierung Basisregel");
  });

  it("keeps create/edit form hidden until user action", async () => {
    await render(createElement(ReasoningsView, { accessToken: "test-token" }));

    // Form is not visible initially
    expect(host.querySelector(".reasoning-editor")).toBeNull();

    // Click Neuer Textbaustein
    const newBtn = buttonByText("Neuer Textbaustein");
    await click(newBtn);

    expect(host.querySelector(".reasoning-editor")).not.toBeNull();
    const titleInput = host.querySelector<HTMLInputElement>("#reasoning-title");
    expect(titleInput?.value).toBe("");

    // Click Abbrechen closes form
    const cancelBtn = buttonByText("Abbrechen", ".reasoning-editor button");
    await click(cancelBtn);
    expect(host.querySelector(".reasoning-editor")).toBeNull();
  });

  it("disables operation controls during saving", async () => {
    let resolveSave: (res: Response) => void;
    const savePromise = new Promise<Response>((resolve) => {
      resolveSave = resolve;
    });

    fetchMock.mockImplementation((url, init) => {
      if (init?.method === "POST" || init?.method === "PATCH") {
        return savePromise;
      }
      return reply({ categories: testCategories, reasonings: testReasonings });
    });

    await render(createElement(ReasoningsView, { accessToken: "test-token" }));
    await click(buttonByText("Neuer Textbaustein"));

    const titleInput = host.querySelector<HTMLInputElement>("#reasoning-title")!;
    const contentInput = host.querySelector<HTMLTextAreaElement>("#reasoning-content")!;
    await changeInput(titleInput, "Neuer Baustein");
    await changeInput(contentInput, "Neuer Inhalt");

    const form = host.querySelector<HTMLFormElement>(".reasoning-editor")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      await pause(30);
    });

    // During save, submit button is disabled and shows loading text
    const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(submitBtn?.disabled).toBe(true);
    expect(submitBtn?.textContent).toContain("Wird gespeichert");

    // Resolve save
    await act(async () => {
      resolveSave!(new Response(JSON.stringify({ success: true }), { status: 200 }));
    });
    await act(async () => {
      await pause(50);
    });
  });

  it("regression: second click on action menu trigger closes the menu and sets aria-expanded false", async () => {
    await render(createElement(ReasoningsView, { accessToken: "test-token" }));

    const triggers = host.querySelectorAll<HTMLButtonElement>(".reasoning-menu-trigger");
    expect(triggers.length).toBeGreaterThan(1);
    const firstTrigger = triggers[0];

    // First click opens
    await realClick(firstTrigger);
    expect(firstTrigger.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector(".reasoning-action-menu")).not.toBeNull();

    // Second click on the same trigger must close it
    await realClick(firstTrigger);
    expect(firstTrigger.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector(".reasoning-action-menu")).toBeNull();

    // Clicking another row's trigger switches the open menu
    await realClick(firstTrigger);
    expect(firstTrigger.getAttribute("aria-expanded")).toBe("true");
    const secondTrigger = triggers[1];
    await realClick(secondTrigger);
    expect(firstTrigger.getAttribute("aria-expanded")).toBe("false");
    expect(secondTrigger.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector(".reasoning-action-menu")).not.toBeNull();
  });

  it("regression: retains activeElement on content field and unchanged title during successive per-character updates", async () => {
    await render(createElement(ReasoningsView, { accessToken: "test-token" }));

    // Click Neuer Textbaustein
    const newBtn = buttonByText("Neuer Textbaustein");
    await click(newBtn);

    const titleInput = host.querySelector<HTMLInputElement>("#reasoning-title")!;
    const contentInput = host.querySelector<HTMLTextAreaElement>("#reasoning-content")!;
    expect(titleInput).not.toBeNull();
    expect(contentInput).not.toBeNull();

    // Opening new editor deliberately focuses title
    expect(document.activeElement).toBe(titleInput);

    // Fill title
    await changeInput(titleInput, "Synthetic focus check");
    expect(titleInput.value).toBe("Synthetic focus check");

    // Explicitly focus content textarea
    contentInput.focus();
    expect(document.activeElement).toBe(contentInput);

    // Type 'a', 'b', 'c' successively into activeElement per-character
    for (const char of ["a", "b", "c"]) {
      await act(async () => {
        const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement;
        const proto = active instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        setter?.call(active, (active.value || "") + char);
        active.dispatchEvent(new Event("input", { bubbles: true }));
        active.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await act(async () => {
        await pause(30);
      });
    }


    // Active element must remain the content textarea
    expect(document.activeElement).toBe(contentInput);
    // Content must have all typed characters
    expect(contentInput.value).toBe("abc");
    // Title must remain completely unchanged
    expect(titleInput.value).toBe("Synthetic focus check");

    // Also verify: ordinary category checkbox change does not steal focus
    const catCheckbox = host.querySelector<HTMLInputElement>('.reasoning-category-options input[type="checkbox"]');
    if (catCheckbox) {
      contentInput.focus();
      expect(document.activeElement).toBe(contentInput);
      await act(async () => {
        catCheckbox.click();
      });
      await act(async () => {
        await pause(30);
      });
      // Focus must not be yanked to title input
      expect(document.activeElement).not.toBe(titleInput);
    }

    // Also verify: opening another session deliberately focuses the title field
    const cancelBtn = buttonByText("Abbrechen", ".reasoning-editor button");
    await click(cancelBtn);

    const editBtn = host.querySelectorAll<HTMLButtonElement>(".reasoning-menu-trigger")[0];
    await click(editBtn);
    const bearbeitenBtn = buttonByText("Bearbeiten", ".reasoning-action-menu button");
    await click(bearbeitenBtn);

    const editTitleInput = host.querySelector<HTMLInputElement>("#reasoning-title")!;
    expect(document.activeElement).toBe(editTitleInput);
  });
});
