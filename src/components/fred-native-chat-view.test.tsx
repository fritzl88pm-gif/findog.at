// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import FredNativeChatView, { type FredNativeMessage } from "./fred-native-chat-view";
import type { FredNativeConversation } from "@/lib/fred-native-stream";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const conversationA: FredNativeConversation = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  title: "A",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  agentKey: "fred",
};
const conversationBId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const messagesA: FredNativeMessage[] = [
  { id: 1, role: "user", content: "Frage A", createdAt: "2026-01-01T00:00:00Z", agentKey: "fred" },
  { id: 2, role: "assistant", content: "Antwort A", createdAt: "2026-01-01T00:00:01Z", agentKey: "fred" },
];
const messagesB: FredNativeMessage[] = [
  { id: 11, role: "user", content: "Frage B", createdAt: "2026-01-02T00:00:00Z", agentKey: "fred" },
  { id: 12, role: "assistant", content: "Antwort B", createdAt: "2026-01-02T00:00:01Z", agentKey: "fred" },
];

type ChatRequest = {
  init: RequestInit;
  push: (event: Record<string, unknown>) => void;
  close: () => void;
};

let container: HTMLDivElement;
let root: Root;
let chatRequests: ChatRequest[];
let feedbackResponses: Array<(response: Response) => void>;
let chatRejections: Response[];
let conversationUpdates: Array<{ id: string; messages?: FredNativeMessage[] }>;

function installFetch() {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url === "/api/fred/capabilities") {
      return new Response(JSON.stringify({
        webSearch: true,
        fileUpload: true,
        imageUpload: true,
        proMode: true,
        quickFred: true,
      }), { status: 200 });
    }
    if (url === "/api/feedback") {
      return new Promise<Response>((resolve) => feedbackResponses.push(resolve));
    }
    if (url === "/api/fred/chat") {
      const rejection = chatRejections.shift();
      if (rejection) return rejection;
      const encoder = new TextEncoder();
      let streamController!: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
        },
      });
      init.signal?.addEventListener("abort", () => {
        streamController.error(new DOMException("aborted", "AbortError"));
      });
      chatRequests.push({
        init,
        push: (event) => streamController.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)),
        close: () => streamController.close(),
      });
      return new Response(body, { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }));
}

async function renderView(conversationId: string, messages: FredNativeMessage[]) {
  // Re-rendering the same root with other props mirrors how page.tsx switches
  // conversations: the view is updated in place, not remounted.
  await act(async () => {
    root.render(createElement(FredNativeChatView, {
      accessToken: "token",
      conversationId,
      initialMessages: messages,
      renderAssistantContent: (content: string) => content,
      renderUserContent: (content: string) => content,
      onConversationUpdated: (updated: FredNativeConversation, updatedMessages?: FredNativeMessage[]) => {
        conversationUpdates.push({ id: updated.id, messages: updatedMessages });
      },
    }));
  });
  await settle();
}

async function settle() {
  for (let index = 0; index < 5; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function transcriptText(): string {
  return container.querySelector(".transcript")?.textContent ?? "";
}

function button(label: string): HTMLButtonElement {
  const element = container.querySelector(`button[aria-label="${label}"]`);
  if (!(element instanceof HTMLButtonElement)) throw new Error(`Button ${label} fehlt.`);
  return element;
}

async function typeInto(textarea: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function composer(): HTMLTextAreaElement {
  return container.querySelector('textarea[aria-label="Nachricht an Fred"]') as HTMLTextAreaElement;
}

async function sendQuestion(question: string) {
  await typeInto(composer(), question);
  await act(async () => {
    (container.querySelector("form.composer") as HTMLFormElement).requestSubmit();
  });
  await settle();
}

beforeEach(() => {
  chatRequests = [];
  feedbackResponses = [];
  chatRejections = [];
  conversationUpdates = [];
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => (
    setTimeout(() => callback(0), 0) as unknown as number
  ));
  window.cancelAnimationFrame = ((frame: number) => clearTimeout(frame));
  installFetch();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("FredNativeChatView conversation switch", () => {
  it("keeps the newly selected conversation when a regeneration of the previous one is aborted", async () => {
    await renderView(conversationA.id, messagesA);
    await act(async () => button("Antwort erneut erzeugen").click());
    await settle();
    chatRequests[0].push({ type: "conversation", conversation: conversationA });
    await settle();

    await renderView(conversationBId, messagesB);

    expect(transcriptText()).toContain("Antwort B");
    expect(transcriptText()).not.toContain("Antwort A");
  });

  it("keeps the newly selected conversation when a streaming follow-up of the previous one is aborted", async () => {
    await renderView(conversationA.id, messagesA);
    await sendQuestion("Folgefrage A");
    chatRequests[0].push({ type: "conversation", conversation: conversationA });
    chatRequests[0].push({ type: "delta", content: "Teilantwort A2" });
    await settle();

    await renderView(conversationBId, messagesB);

    expect(transcriptText()).toContain("Antwort B");
    expect(transcriptText()).not.toContain("Folgefrage A");
    expect(transcriptText()).not.toContain("Teilantwort A2");

    await sendQuestion("Folgefrage B");
    expect(JSON.parse(String(chatRequests[1].init.body))).toMatchObject({
      query: "Folgefrage B",
      conversationId: conversationBId,
    });
    chatRequests[1].push({
      type: "conversation",
      conversation: { ...conversationA, id: conversationBId, title: "B" },
    });
    await settle();
    expect(conversationUpdates.at(-1)?.messages?.map((message) => message.content)).toEqual([
      "Frage B",
      "Antwort B",
      "Folgefrage B",
    ]);
  });

  it("keeps the partial answer when the user stops the stream in the same conversation", async () => {
    await renderView(conversationA.id, messagesA);
    await sendQuestion("Folgefrage A");
    chatRequests[0].push({ type: "conversation", conversation: conversationA });
    chatRequests[0].push({ type: "delta", content: "Teilantwort A2" });
    await settle();

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((element) => element.textContent?.trim() === "Stoppen")!
        .click();
    });
    await settle();

    expect(transcriptText()).toContain("Folgefrage A");
    expect(transcriptText()).toContain("Teilantwort A2");
  });
});

describe("FredNativeChatView feedback after regeneration", () => {
  async function submitNegativeFeedback(reason: string) {
    await act(async () => button("Antwort nicht korrekt").click());
    await settle();
    await typeInto(container.querySelector("form.feedback-inline-form textarea") as HTMLTextAreaElement, reason);
    await act(async () => {
      (container.querySelector("form.feedback-inline-form") as HTMLFormElement).requestSubmit();
    });
    await settle();
  }

  async function regenerate(finalAnswer: string) {
    await act(async () => button("Antwort erneut erzeugen").click());
    await settle();
    chatRequests.at(-1)!.push({ type: "conversation", conversation: conversationA });
    chatRequests.at(-1)!.push({
      type: "final",
      answer: finalAnswer,
      assistantMessageId: 4,
      conversation: conversationA,
    });
    chatRequests.at(-1)!.close();
    await settle();
  }

  it("starts a regenerated answer unrated after negative feedback on the replaced one", async () => {
    await renderView(conversationA.id, messagesA);
    await submitNegativeFeedback("Falsch");
    feedbackResponses[0](new Response("{}", { status: 200 }));
    await settle();
    expect(button("Antwort nicht korrekt").disabled).toBe(true);

    await regenerate("Neue Antwort");

    expect(transcriptText()).toContain("Neue Antwort");
    expect(button("Antwort nicht korrekt").disabled).toBe(false);
    expect(button("Antwort nicht korrekt").getAttribute("aria-pressed")).toBe("false");
    expect(button("Antwort hilfreich").disabled).toBe(false);
  });

  it("does not carry a thumbs-up over to the regenerated answer", async () => {
    await renderView(conversationA.id, messagesA);
    await act(async () => button("Antwort hilfreich").click());
    expect(button("Antwort hilfreich").getAttribute("aria-pressed")).toBe("true");

    await regenerate("Neue Antwort");

    expect(button("Antwort hilfreich").getAttribute("aria-pressed")).toBe("false");
  });

  it("does not mark the regenerated answer when the replaced answer's feedback is saved late", async () => {
    await renderView(conversationA.id, messagesA);
    await submitNegativeFeedback("Falsch");

    await regenerate("Neue Antwort");
    feedbackResponses[0](new Response("{}", { status: 200 }));
    await settle();

    expect(transcriptText()).toContain("Neue Antwort");
    expect(button("Antwort nicht korrekt").disabled).toBe(false);
    expect(button("Antwort nicht korrekt").getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps the rating of the restored answer when the regeneration fails", async () => {
    await renderView(conversationA.id, messagesA);
    await act(async () => button("Antwort hilfreich").click());

    await act(async () => button("Antwort erneut erzeugen").click());
    await settle();
    chatRequests[0].push({ type: "error", error: "Fred ist nicht erreichbar." });
    chatRequests[0].close();
    await settle();

    expect(transcriptText()).toContain("Antwort A");
    expect(button("Antwort hilfreich").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("FredNativeChatView rejected questions", () => {
  async function attachFile(file: File) {
    const input = container.querySelector('input[type="file"][accept^=".pdf"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  it("returns a question the server rejected before storing it to the composer", async () => {
    await renderView(conversationA.id, messagesA);
    await attachFile(new File(["%PDF-1.7"], "Bescheid.pdf", { type: "application/pdf" }));
    chatRejections.push(new Response(
      JSON.stringify({ error: "Zu viele Fred-Anfragen. Bitte kurz warten." }),
      { status: 429 },
    ));

    await sendQuestion("Neue Frage");

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Zu viele Fred-Anfragen");
    expect(transcriptText()).toContain("Antwort A");
    expect(transcriptText()).not.toContain("Neue Frage");
    expect(composer().value).toBe("Neue Frage");
    expect(container.querySelector(".attachment-chips")?.textContent).toContain("Bescheid.pdf");
    expect(conversationUpdates).toEqual([]);
  });

  it("returns the question when the stream fails before the conversation event", async () => {
    await renderView("", []);
    await sendQuestion("Erste Frage");
    chatRequests[0].push({ type: "error", error: "Die Anhänge konnten nicht analysiert werden." });
    chatRequests[0].close();
    await settle();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Die Anhänge konnten nicht analysiert werden.");
    expect(container.querySelector(".transcript article")).toBeNull();
    expect(composer().value).toBe("Erste Frage");
  });

  it("keeps a stored question in the transcript when the answer fails later", async () => {
    await renderView(conversationA.id, messagesA);
    await sendQuestion("Neue Frage");
    chatRequests[0].push({ type: "conversation", conversation: conversationA });
    chatRequests[0].push({ type: "error", error: "Fred ist nicht erreichbar." });
    chatRequests[0].close();
    await settle();

    expect(transcriptText()).toContain("Neue Frage");
    expect(composer().value).toBe("");
  });
});
