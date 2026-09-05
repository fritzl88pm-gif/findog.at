// @vitest-environment jsdom
import { act, createElement, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminWorkspace from "./admin-workspace";
import AdminDownloads from "./admin-downloads";
import AdminBfgNewsletters from "./admin-bfg-newsletters";
import AdminDashboardNews from "./admin-dashboard-news";
import AdminFeedbackView from "./admin-feedback-view";
import { AdminGuardContext, useAdminNavigationGuard } from "./admin-editor-guard";
import { ADMIN_AREAS, mayLeaveAdminEditor, type AdminArea } from "@/lib/admin-navigation";

let host: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();
const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
const pause = () => new Promise((resolve) => setTimeout(resolve, 30));
async function render(node: ReactNode) { await act(async () => { root.render(node); }); await act(pause); }
async function click(element: Element) { await act(async () => { (element as HTMLElement).click(); }); await act(pause); }
function button(text: string, selector = "button") {
  const found = [...host.querySelectorAll(selector)].find((node) => node.textContent?.trim() === text);
  if (!found) throw new Error(`Button not found: ${text}`);
  return found as HTMLButtonElement;
}
async function input(selector: string, value: string) {
  const element = host.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
  const prototype = element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function Harness({ initial = "overview", children }: { initial?: AdminArea; children?: ReactNode }) {
  const [area, setArea] = useState<AdminArea>(initial);
  const guard = useAdminNavigationGuard();
  return createElement(AdminGuardContext.Provider, { value: guard }, createElement(AdminWorkspace, {
    area, onNavigate: (next) => { if (guard.canLeave()) setArea(next); },
  }, children ?? createElement("p", null, `Bereich ${area}`)));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock.mockReset());
  vi.spyOn(window, "confirm").mockReturnValue(false);
  vi.spyOn(window, "alert").mockImplementation(() => {});
  // jsdom has no native dialog implementation; native focus trapping still requires browser QA.
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("administration workspace interactions", () => {
  it("opens all seven areas without fetching overview data, closes the mobile selector and focuses the title", async () => {
    await render(createElement(Harness));
    expect(host.querySelectorAll(".admin-area-card")).toHaveLength(7);
    expect(fetchMock).not.toHaveBeenCalled();
    for (const area of ADMIN_AREAS) {
      const selector = host.querySelector(".admin-mobile-navigation") as HTMLDetailsElement;
      selector.open = true;
      await click(button(area.title, ".admin-mobile-navigation button"));
      expect(host.querySelector("h1")?.textContent).toBe(area.title);
      expect(document.activeElement).toBe(host.querySelector("h1"));
      expect(selector.open).toBe(false);
      expect(host.querySelector('.admin-mobile-navigation [aria-current="page"]')?.textContent).toBe(area.title);
    }
  });

  it("keeps newsletter drafts on canceled navigation, record selection and a failed write; blocks duplicate writes", async () => {
    const items = [{ id: "edition-1", publicationDate: "2026-09-01", contentMarkdown: "Gespeicherter Newsletter" }];
    let finishWrite: ((response: Response) => void) | undefined;
    fetchMock.mockImplementation((_url, options) => options?.method
      ? new Promise<Response>((resolve) => { finishWrite = resolve; }) : reply({ items }));
    await render(createElement(Harness, { initial: "bfg-newsletters" }, createElement(AdminBfgNewsletters, { accessToken: "fixture" })));
    await input("#bfg-newsletter-content", "Mein ungespeicherter Entwurf");
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
    await click(button("Übersicht", ".admin-mobile-navigation button"));
    expect(host.querySelector("h1")?.textContent).toBe("BFG Newsletter");
    await click(host.querySelector(".admin-news-list-item")!);
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe("Mein ungespeicherter Entwurf");
    await click(button("Newsletter speichern"));
    expect(host.querySelector("fieldset")?.disabled).toBe(true);
    await click(button("Übersicht", ".admin-mobile-navigation button"));
    expect(window.alert).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
    await act(async () => finishWrite!(new Response(JSON.stringify({ error: "Speichern fehlgeschlagen" }), { status: 500 })));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Speichern fehlgeschlagen");
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe("Mein ungespeicherter Entwurf");
    vi.mocked(window.confirm).mockReturnValue(true);
    await click(host.querySelector(".admin-news-list-item")!);
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe("Gespeicherter Newsletter");
    const cleanUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(cleanUnload); expect(cleanUnload.defaultPrevented).toBe(false);
  });

  it("guards download edits and upload dialog closure, retaining input after cancellation", async () => {
    const category = { id: "cat-1", name: "Formulare", description: "", sortOrder: 0, documentCount: 1 };
    const document = { id: "doc-1", categoryId: category.id, title: "Muster", description: "", originalFilename: "Muster.pdf", sortOrder: 0, fileExtension: "pdf" };
    fetchMock.mockImplementation(() => reply({ categories: [category], documents: [document] }));
    await render(createElement(Harness, { initial: "downloads" }, createElement(AdminDownloads, { accessToken: "fixture" })));
    await click(button("Bearbeiten"));
    await input("#admin-download-edit-title", "Geändert");
    await click(button("Abbrechen"));
    expect((host.querySelector("#admin-download-edit-title") as HTMLInputElement).value).toBe("Geändert");
    vi.mocked(window.confirm).mockReturnValue(true);
    await click(button("Abbrechen"));
    expect(host.querySelector("#admin-download-edit-title")).toBeNull();
    const trigger = button("Dokument hochladen"); trigger.focus();
    await click(trigger);
    expect(host.querySelector("dialog")?.open).toBe(true);
    await input("#admin-download-upload-title", "Neues Dokument");
    vi.mocked(window.confirm).mockReturnValue(false);
    await click(host.querySelector('[aria-label="Dialog schließen"]')!);
    expect((host.querySelector("#admin-download-upload-title") as HTMLInputElement).value).toBe("Neues Dokument");
    vi.mocked(window.confirm).mockReturnValue(true);
    await click(host.querySelector('[aria-label="Dialog schließen"]')!);
    expect(host.querySelector("dialog")).toBeNull();
    expect(globalThis.document.activeElement).toBe(trigger);
    expect(fetchMock.mock.calls.some((call) => call[1]?.method)).toBe(false);
  });

  it("preserves a legal news source and stichtag on save and releases the dirty guard after success", async () => {
    const item = { id: "news-1", kind: "legal", title: "Testmeldung", summary: "Testbeschreibung", status: "draft", pinned: false, publishedAt: null,
      sourceSystem: "ris", documentKind: "norm", sourceIdentifier: "fixture-norm", sourceUrl: "https://www.ris.bka.gv.at/fixture",
      documentDate: "2026-08-01", asOfDate: "2026-09-01", createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-01T10:00:00Z" };
    fetchMock.mockImplementation((_url, options) => options?.method
      ? reply({ item: { ...item, ...JSON.parse(options.body) } }) : reply({ items: [item] }));
    await render(createElement(Harness, { initial: "dashboard-news" }, createElement(AdminDashboardNews, { accessToken: "fixture" })));
    await click(host.querySelector(".admin-news-list-item")!);
    await input("#dashboard-news-title", "Geänderter Titel");
    await click(button("Entwurf speichern"));
    const write = fetchMock.mock.calls.find((call) => call[1]?.method === "PUT")!;
    expect(JSON.parse(write[1].body)).toMatchObject({ id: item.id, title: "Geänderter Titel", sourceSystem: item.sourceSystem, documentKind: item.documentKind, sourceIdentifier: item.sourceIdentifier, sourceUrl: item.sourceUrl, documentDate: item.documentDate, asOfDate: item.asOfDate, status: "draft" });
    expect(host.querySelector(".admin-draft-status")?.textContent).toBe("Keine offenen Änderungen");
    await click(button("Übersicht", ".admin-mobile-navigation button"));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(host.querySelector("h1")?.textContent).toBe("Administration");
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(false);
  });

  it("filters negative feedback and shows only the selected question and response", async () => {
    fetchMock.mockImplementation(() => reply({ feedback: [
      { id: 1, userId: "u1", conversationId: "c1", userRequest: "Frage Alpha", assistantResponse: "Antwort Alpha", feedback: "Quelle fehlt", createdAt: "2026-09-01T10:00:00Z" },
      { id: 2, userId: "u1", conversationId: "c2", userRequest: "Frage Beta", assistantResponse: "Antwort Beta", feedback: "Stichtag falsch", createdAt: "2026-09-02T10:00:00Z" },
    ] }));
    await render(createElement(Harness, { initial: "feedback" }, createElement(AdminFeedbackView, { accessToken: "fixture", users: [{ id: "u1", email: "fixture@example.test" }] })));
    expect(host.querySelector(".admin-feedback-detail")?.textContent).toContain("Antwort Alpha");
    await click(host.querySelectorAll(".admin-feedback-inbox button")[1]);
    expect(host.querySelector(".admin-feedback-detail")?.textContent).toContain("Antwort Beta");
    expect(host.querySelector(".admin-feedback-detail")?.textContent).not.toContain("Antwort Alpha");
    await input('input[type="search"]', "Quelle");
    expect(host.querySelectorAll(".admin-feedback-inbox button")).toHaveLength(1);
    expect(host.querySelector(".admin-feedback-detail")?.textContent).toContain("Antwort Alpha");
    await input('input[type="search"]', "ohne Treffer");
    expect(host.textContent).toContain("Keine Rückmeldungen für diese Auswahl gefunden.");
  });
});

describe("shared leave decision", () => {
  it("prioritizes pending writes over discarding dirty editors", () => {
    const discard = vi.fn(() => true), busy = vi.fn();
    expect(mayLeaveAdminEditor([{ dirty: true, busy: false }, { dirty: false, busy: true }], discard, busy)).toBe(false);
    expect(discard).not.toHaveBeenCalled(); expect(busy).toHaveBeenCalledOnce();
  });
  it("asks only once for all dirty editors and permits clean navigation silently", () => {
    const discard = vi.fn(() => false), busy = vi.fn();
    expect(mayLeaveAdminEditor([{ dirty: false, busy: false }], discard, busy)).toBe(true);
    expect(discard).not.toHaveBeenCalled();
    expect(mayLeaveAdminEditor([{ dirty: true, busy: false }, { dirty: true, busy: false }], discard, busy)).toBe(false);
    expect(discard).toHaveBeenCalledOnce();
  });
});
