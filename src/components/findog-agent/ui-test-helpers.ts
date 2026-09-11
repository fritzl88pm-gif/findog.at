/**
 * DOM helpers for the Findog Agent component tests. Test support only: no
 * production module imports this file.
 */

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

export const pause = () => new Promise((resolve) => setTimeout(resolve, 30));

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function createHost() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  return {
    host,
    async render(node: ReactNode) {
      await act(async () => {
        root.render(node);
      });
      await act(pause);
    },
    async flush() {
      await act(pause);
    },
    async click(element: Element) {
      await act(async () => {
        (element as HTMLElement).click();
      });
      await act(pause);
    },
    async type(selector: string, value: string) {
      const element = host.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
      if (!element) {
        throw new Error(`Feld nicht gefunden: ${selector}`);
      }
      const prototype = element.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      await act(async () => {
        Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(pause);
    },
    async select(selector: string, value: string) {
      const element = host.querySelector(selector) as HTMLSelectElement | null;
      if (!element) {
        throw new Error(`Auswahl nicht gefunden: ${selector}`);
      }
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(element, value);
        element.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await act(pause);
    },
    button(text: string): HTMLButtonElement {
      const found = [...host.querySelectorAll("button")].find((node) => node.textContent?.trim() === text);
      if (!found) {
        throw new Error(`Schaltfläche nicht gefunden: ${text}`);
      }
      return found as HTMLButtonElement;
    },
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    },
  };
}

export type TestHost = ReturnType<typeof createHost>;
