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
    categoryIds: ["cat-1"],
    createdAt: "2026-01-03T10:00:00Z",
    updatedAt: "2026-01-03T10:00:00Z",
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

function buttonByText(text: string, selector = "button"): HTMLButtonElement {
  const found = [...host.querySelectorAll(selector)].find((node) =>
    node.textContent?.trim().includes(text),
  );
  if (!found) throw new Error(`Button containing text "${text}" not found`);
  return found as HTMLButtonElement;
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

describe("ReasoningsView title-only view behavior", () => {
  it("renders default full-card view with all details visible and accessible Nur Titel toggle", async () => {
    await render(createElement(ReasoningsView, { accessToken: "test-token" }));

    const toggle = buttonByText("Nur Titel");
    expect(toggle).toBeDefined();
    expect(toggle.getAttribute("role")).toBe("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    const cards = host.querySelectorAll(".reasoning-card");
    expect(cards).toHaveLength(2);

    expect(host.textContent).toContain(testReasonings[0].content);
    expect(host.textContent).toContain(testReasonings[1].content);
    expect(host.textContent).toContain("Umsatzsteuer");
    expect(host.textContent).toContain("Aktualisiert");

    // Disclosure buttons are only rendered in title-only mode
    const disclosures = host.querySelectorAll(".reasoning-title-disclosure-button");
    expect(disclosures).toHaveLength(0);
  });

  it("toggles between full-card and title-only view", async () => {
    await render(createElement(ReasoningsView, { accessToken: "test-token" }));

    const toggle = buttonByText("Nur Titel");
    await click(toggle);

    expect(toggle.getAttribute("aria-checked")).toBe("true");
    const grid = host.querySelector(".reasoning-card-grid");
    expect(grid?.classList.contains("is-title-only")).toBe(true);

    // In title-only mode, content/categories/timestamp are hidden by default
    expect(host.textContent).not.toContain(testReasonings[0].content);
    expect(host.textContent).not.toContain(testReasonings[1].content);
    expect(host.textContent).not.toContain("Aktualisiert");

    // Toggle back to full-card view
    await click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(grid?.classList.contains("is-title-only")).toBe(false);
    expect(host.textContent).toContain(testReasonings[0].content);
  });

  it("persists preference in localStorage and restores on remount", async () => {
    await render(createElement(ReasoningsView, { accessToken: "test-token" }));

    const toggle = buttonByText("Nur Titel");
    await click(toggle);
    expect(mockStorage.getItem(STORAGE_KEY)).toBe("true");

    // Unmount and remount
    await act(async () => {
      root.unmount();
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await render(createElement(ReasoningsView, { accessToken: "test-token" }));
    const remountedToggle = buttonByText("Nur Titel");
    expect(remountedToggle.getAttribute("aria-checked")).toBe("true");
    expect(host.textContent).not.toContain(testReasonings[0].content);

    // Toggle off persists "false"
    await click(remountedToggle);
    expect(mockStorage.getItem(STORAGE_KEY)).toBe("false");
  });

  it("gracefully tolerates unavailable or malformed localStorage", async () => {
    // Malformed storage value defaults to false
    mockStorage.setItem(STORAGE_KEY, "invalid-garbage-value");
    await render(createElement(ReasoningsView, { accessToken: "test-token" }));
    expect(buttonByText("Nur Titel").getAttribute("aria-checked")).toBe("false");

    await act(async () => {
      root.unmount();
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    // Storage getItem throws error
    vi.spyOn(mockStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError: localStorage is disabled");
    });
    await render(createElement(ReasoningsView, { accessToken: "test-token" }));
    const toggle = buttonByText("Nur Titel");
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    // Storage setItem throws error
    vi.spyOn(mockStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    await click(toggle);
    // UI state still toggles in memory
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(host.textContent).not.toContain(testReasonings[0].content);
  });

  it("supports per-entry disclosure with keyboard and aria-expanded/controls", async () => {
    await render(createElement(ReasoningsView, { accessToken: "test-token" }));
    await click(buttonByText("Nur Titel"));

    const disclosureButtons = host.querySelectorAll<HTMLButtonElement>(
      ".reasoning-title-disclosure-button",
    );
    expect(disclosureButtons).toHaveLength(2);

    const firstButton = disclosureButtons[0];
    expect(firstButton.getAttribute("aria-expanded")).toBe("false");
    const controlsId = firstButton.getAttribute("aria-controls");
    expect(controlsId).toBeTruthy();

    // Click to expand first entry
    await click(firstButton);
    expect(firstButton.getAttribute("aria-expanded")).toBe("true");
    const expandedBody = host.querySelector(`#${controlsId}`);
    expect(expandedBody).not.toBeNull();
    expect(expandedBody?.textContent).toContain(testReasonings[0].content);
    expect(expandedBody?.textContent).toContain("Umsatzsteuer");
    expect(expandedBody?.textContent).toContain("Aktualisiert");

    // Second entry remains collapsed
    expect(disclosureButtons[1].getAttribute("aria-expanded")).toBe("false");
    expect(host.textContent).not.toContain(testReasonings[1].content);

    // Click again to collapse first entry
    await click(firstButton);
    expect(firstButton.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector(`#${controlsId}`)).toBeNull();

    // Keyboard support: pressing Enter activates disclosure button
    await act(async () => {
      firstButton.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      firstButton.click();
    });
    await act(async () => {
      await pause(30);
    });
    expect(firstButton.getAttribute("aria-expanded")).toBe("true");
  });

  it("copies full text content (not title) in title-only mode", async () => {
    await render(createElement(ReasoningsView, { accessToken: "test-token" }));
    await click(buttonByText("Nur Titel"));

    const copyButtons = host.querySelectorAll<HTMLButtonElement>(".reasoning-copy-button");
    expect(copyButtons).toHaveLength(2);

    await click(copyButtons[0]);
    expect(writeTextMock).toHaveBeenCalledWith(testReasonings[0].content);
    expect(writeTextMock).not.toHaveBeenCalledWith(testReasonings[0].title);
  });

  it("allows editing and filters categories in title-only mode", async () => {
    await render(createElement(ReasoningsView, { accessToken: "test-token" }));
    await click(buttonByText("Nur Titel"));

    // Category filtering
    const filterButtons = host.querySelectorAll(".reasoning-category-filters button");
    const umsatzsteuerFilter = [...filterButtons].find(
      (b) => b.textContent?.includes("Umsatzsteuer"),
    );
    expect(umsatzsteuerFilter).toBeDefined();
    await click(umsatzsteuerFilter!);

    // Only snippet 1 is visible
    expect(host.querySelectorAll(".reasoning-card")).toHaveLength(1);
    expect(host.textContent).toContain(testReasonings[0].title);
    expect(host.textContent).not.toContain(testReasonings[1].title);

    // Editing in title-only mode opens the editor
    const editButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label*="bearbeiten"]',
    );
    expect(editButton).not.toBeNull();
    await click(editButton!);

    const editorTitle = host.querySelector<HTMLInputElement>("#reasoning-title");
    expect(editorTitle?.value).toBe(testReasonings[0].title);
    const editorContent = host.querySelector<HTMLTextAreaElement>("#reasoning-content");
    expect(editorContent?.value).toBe(testReasonings[0].content);
  });
});
