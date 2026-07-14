import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");

  return {
    ...actual,
    after: vi.fn((callback: () => void | Promise<void>) => {
      void callback();
    }),
  };
});

import { MAX_IMAGE_UPLOAD_BYTES } from "@/lib/config";
import { runAgent } from "@/lib/agent";
import { resolveDeepSeekApiKey } from "@/lib/deepseek-key";
import { extractImageContext, extractPdfContext } from "@/lib/pdf-context";
import { parseChatStreamLine } from "@/lib/chat-stream";
import { persistConversationTurn } from "@/lib/persistence";
import { generateConversationTitle } from "@/lib/conversation-title";
import { recordAdminRequest } from "@/lib/admin-request-history";
import { UserVisibleError } from "@/lib/errors";
import * as chatRoute from "./route";

const { POST } = chatRoute;

vi.mock("@/lib/auth/server", () => ({
  authenticateSupabaseRequest: vi.fn().mockResolvedValue({ id: "user-1" }),
}));

vi.mock("@/lib/deepseek-key", () => ({
  resolveDeepSeekApiKey: vi.fn().mockReturnValue("deepseek-key"),
}));

vi.mock("@/lib/admin-request-history", () => ({
  recordAdminRequest: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/conversation-title", () => ({
  generateConversationTitle: vi.fn().mockResolvedValue("Präziser Gesprächstitle"),
}));

vi.mock("@/lib/persistence", () => ({
  persistConversationTurn: vi.fn().mockResolvedValue(undefined),
  resolveConversationIdForClient: vi.fn().mockResolvedValue("conversation-1"),
  resolveConversationContextForClient: vi.fn(({ conversationId }: { conversationId?: string }) =>
    Promise.resolve(
      conversationId
        ? { id: conversationId, title: "Bestehender Titel", isNew: false }
        : { id: "conversation-1", isNew: true },
    ),
  ),
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: vi.fn().mockReturnValue({}),
}));

vi.mock("@/lib/mcp/server-token", () => ({
  getServerMcpBearerToken: vi.fn().mockReturnValue("mcp-token"),
}));

vi.mock("@/lib/pdf-context", () => ({
  extractPdfContext: vi.fn(async ({ filename }: { filename: string }) => `PDF-Kontext ${filename}`),
  extractImageContext: vi.fn(async ({ filename }: { filename: string }) => `Bild-Kontext ${filename}`),
}));

vi.mock("@/lib/agent", () => ({
  runAgent: vi.fn().mockResolvedValue({
    answer: "Antwort",
    steps: [],
    tools: [],
  }),
}));

function chatPayload() {
  return {
    messages: [{ role: "user", content: "Bitte auswerten." }],
  };
}

function jsonRequest(payload: Record<string, unknown>, signal?: AbortSignal): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal,
  });
}

function streamingJsonRequest(payload: Record<string, unknown>): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: {
      Accept: "application/x-ndjson",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

function multipartRequest(formData: FormData): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/chat uploads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ignores stale client prompt fields and never forwards them to the agent", async () => {
    const request = jsonRequest({
      ...chatPayload(),
      systemPrompt: "Staler persönlicher Prompt",
      usesGlobalDefault: false,
    });
    request.headers.set("x-forwarded-for", "test-stale-personal-prompt");
    const response = await POST(request);

    expect(response.status).toBe(200);
    const agentOptions = vi.mocked(runAgent).mock.calls[0]?.[0];
    expect(agentOptions).not.toHaveProperty("systemPrompt");
    const payload = await response.json();
    expect(payload).not.toHaveProperty("systemPrompt");
    expect(JSON.stringify(payload)).not.toContain("Staler persönlicher Prompt");
  });

  it("does not load or forward an external prompt when the request has none", async () => {
    const request = jsonRequest(chatPayload());
    request.headers.set("x-forwarded-for", "test-global-prompt");
    const response = await POST(request);

    expect(response.status).toBe(200);
    const agentOptions = vi.mocked(runAgent).mock.calls[0]?.[0];
    expect(agentOptions).not.toHaveProperty("systemPrompt");
  });

  it("accepts DeepSeek v4 Flash and uses it throughout the response lifecycle", async () => {
    const response = await POST(
      jsonRequest({
        ...chatPayload(),
        model: "deepseek-v4-flash",
        deepSeekApiKey: "user-key",
      }),
    );

    expect(response.status).toBe(200);
    expect(resolveDeepSeekApiKey).toHaveBeenCalledWith();
    expect(generateConversationTitle).toHaveBeenCalledWith(
      expect.objectContaining({ model: "deepseek-v4-flash" }),
    );
    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "deepseek-key",
        model: "deepseek-v4-flash",
      }),
    );
    expect(persistConversationTurn).toHaveBeenCalledWith(
      expect.objectContaining({ model: "deepseek-v4-flash" }),
    );
    await expect(response.json()).resolves.toMatchObject({
      model: "deepseek-v4-flash",
      availableModels: ["deepseek-v4-flash", "deepseek-v4-pro"],
    });
  });

  it("defaults to server-keyed DeepSeek v4 Pro and ignores stale client API keys", async () => {
    const response = await POST(jsonRequest({ ...chatPayload(), deepSeekApiKey: "user-key" }));

    expect(response.status).toBe(200);
    expect(resolveDeepSeekApiKey).toHaveBeenCalledWith();
    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "deepseek-key", model: "deepseek-v4-pro" }),
    );
  });

  it.each(["obsolete-client-model", 42])(
    "rejects an unsupported or non-string model value: %s",
    async (model) => {
      const response = await POST(jsonRequest({ ...chatPayload(), model }));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "Das ausgewählte Modell wird nicht unterstützt.",
      });
      expect(runAgent).not.toHaveBeenCalled();
    },
  );

  it("accepts a chat message longer than 6,000 characters within the request cap", async () => {
    const longMessage = "a".repeat(6_001);

    const response = await POST(
      jsonRequest({
        ...chatPayload(),
        messages: [{ role: "user", content: longMessage }],
      }),
    );

    expect(response.status).toBe(200);
    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: "user", content: longMessage }],
      }),
    );
  });

  it("records the submitted user request before agent execution", async () => {
    const executionOrder: string[] = [];
    vi.mocked(recordAdminRequest).mockImplementationOnce(async () => {
      executionOrder.push("audit");
    });
    vi.mocked(runAgent).mockImplementationOnce(async () => {
      executionOrder.push("agent");
      return { answer: "Antwort", steps: [], tools: [] };
    });

    const request = jsonRequest(chatPayload());
    request.headers.set("x-forwarded-for", "test-audit-order");
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(recordAdminRequest).toHaveBeenCalledWith({
      supabase: expect.anything(),
      userId: "user-1",
      conversationId: "conversation-1",
      content: "Bitte auswerten.",
    });
    expect(executionOrder).toEqual(["audit", "agent"]);
  });

  it("does not execute the agent or title generation when request auditing fails", async () => {
    vi.mocked(recordAdminRequest).mockRejectedValueOnce(
      new UserVisibleError("Audit nicht verfügbar", 503),
    );

    const request = jsonRequest(chatPayload());
    request.headers.set("x-forwarded-for", "test-audit-failure");
    const response = await POST(request);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Audit nicht verfügbar" });
    expect(generateConversationTitle).not.toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();
    expect(persistConversationTurn).not.toHaveBeenCalled();
  });

  it("passes the prior assistant answer to the agent on a follow-up request", async () => {
    const messages = [
      { role: "user", content: "Erste Frage" },
      { role: "assistant", content: "Erste Antwort" },
      { role: "user", content: "Nachfrage" },
    ];

    const request = jsonRequest({ ...chatPayload(), messages });
    request.headers.set("x-forwarded-for", "test-multi-turn-context");
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({ messages }));
    expect(recordAdminRequest).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Nachfrage" }),
    );
  });

  it("does not declare a Vercel max duration for the chat route", () => {
    expect(chatRoute).not.toHaveProperty("maxDuration");
  });

  it("passes unbounded request cancellation to attachment extraction and the agent", async () => {
    const formData = new FormData();
    formData.append("payload", JSON.stringify(chatPayload()));
    formData.append(
      "pdf",
      new File([new Uint8Array([37, 80, 68, 70])], "Bescheid.pdf", { type: "application/pdf" }),
    );

    const response = await POST(multipartRequest(formData));

    expect(response.status).toBe(200);
    const pdfOptions = vi.mocked(extractPdfContext).mock.calls[0]?.[0] as {
      deadline?: { signal?: AbortSignal; remainingMs?: () => number };
    };
    expect(pdfOptions.deadline?.signal).toBeInstanceOf(AbortSignal);
    expect(pdfOptions.deadline?.remainingMs?.()).toBe(Number.POSITIVE_INFINITY);

    const agentOptions = vi.mocked(runAgent).mock.calls[0]?.[0] as {
      deadline?: { signal?: AbortSignal; remainingMs?: () => number };
    };
    expect(agentOptions.deadline?.signal).toBeInstanceOf(AbortSignal);
    expect(agentOptions.deadline?.remainingMs?.()).toBe(Number.POSITIVE_INFINITY);
  });

  it("propagates request aborts to the agent cancellation signal", async () => {
    const requestController = new AbortController();
    let agentSignal: AbortSignal | undefined;
    vi.mocked(runAgent).mockImplementationOnce(async (options) => {
      agentSignal = options.deadline?.signal;
      await new Promise<void>((resolve) => {
        agentSignal?.addEventListener("abort", () => resolve(), { once: true });
      });
      return { answer: "Antwort", steps: [], tools: [] };
    });

    const responsePromise = POST(jsonRequest(chatPayload(), requestController.signal));
    await vi.waitFor(() => expect(agentSignal).toBeInstanceOf(AbortSignal));

    requestController.abort();

    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(agentSignal?.aborted).toBe(true);
    expect(agentSignal?.reason).toBe(requestController.signal.reason);
  });

  it("streams the final event before best-effort persistence failures", async () => {
    vi.mocked(persistConversationTurn).mockRejectedValueOnce(new Error("database unavailable"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(streamingJsonRequest(chatPayload()));
    const events = (await response.text())
      .split("\n")
      .map((line) => parseChatStreamLine(line))
      .filter((event) => event !== null);

    expect(events[0]).toMatchObject({
      type: "final",
      answer: "Antwort",
      conversationId: "conversation-1",
      title: "Präziser Gesprächstitle",
    });
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      "Chat persistence failed",
      expect.objectContaining({ message: "database unavailable" }),
    );

    errorSpy.mockRestore();
  });

  it("returns non-streaming JSON before best-effort persistence failures", async () => {
    vi.mocked(persistConversationTurn).mockRejectedValueOnce(new Error("database unavailable"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(jsonRequest(chatPayload()));
    await expect(response.json()).resolves.toMatchObject({
      answer: "Antwort",
      conversationId: "conversation-1",
      title: "Präziser Gesprächstitle",
    });
    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalledWith(
      "Chat persistence failed",
      expect.objectContaining({ message: "database unavailable" }),
    );

    errorSpy.mockRestore();
  });

  it("generates and persists a title only when starting a new conversation", async () => {
    const newResponse = await POST(jsonRequest(chatPayload()));
    expect(newResponse.status).toBe(200);
    expect(generateConversationTitle).toHaveBeenCalledWith(
      expect.objectContaining({ userRequest: "Bitte auswerten." }),
    );
    expect(persistConversationTurn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: "Präziser Gesprächstitle",
        model: "deepseek-v4-pro",
        steps: [],
      }),
    );

    vi.clearAllMocks();
    vi.mocked(generateConversationTitle).mockResolvedValue("Darf nicht verwendet werden");
    const existingResponse = await POST(
      jsonRequest({ ...chatPayload(), conversationId: "33333333-3333-4333-8333-333333333333" }),
    );
    expect(existingResponse.status).toBe(200);
    await expect(existingResponse.json()).resolves.toMatchObject({ title: "Bestehender Titel" });
    expect(generateConversationTitle).not.toHaveBeenCalled();
    expect(persistConversationTurn).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Bestehender Titel" }),
    );
  });

  it("accepts five PDFs without inspecting or blocking page count", async () => {
    const formData = new FormData();
    formData.append("payload", JSON.stringify(chatPayload()));
    for (let index = 1; index <= 5; index += 1) {
      formData.append(
        "pdf",
        new File([new Uint8Array([37, 80, 68, 70])], `200-page-document-${index}.pdf`, {
          type: "application/pdf",
        }),
      );
    }

    const response = await POST(multipartRequest(formData));

    expect(response.status).toBe(200);
    expect(extractPdfContext).toHaveBeenCalledTimes(5);
    const agentOptions = vi.mocked(runAgent).mock.calls[0]?.[0] as {
      attachmentContexts?: Array<{ type: string; filename: string; content: string }>;
    };
    expect(agentOptions.attachmentContexts).toHaveLength(5);
    expect(agentOptions.attachmentContexts?.map((context) => context.filename)).toEqual([
      "200-page-document-1.pdf",
      "200-page-document-2.pdf",
      "200-page-document-3.pdf",
      "200-page-document-4.pdf",
      "200-page-document-5.pdf",
    ]);
  });

  it("extracts up to five image contexts and passes them with PDF context to the agent", async () => {
    const formData = new FormData();
    formData.append("payload", JSON.stringify(chatPayload()));
    formData.append(
      "pdf",
      new File([new Uint8Array([37, 80, 68, 70])], "Bescheid.pdf", { type: "application/pdf" }),
    );
    for (let index = 1; index <= 5; index += 1) {
      formData.append(
        "image",
        new File([new Uint8Array([137, 80, 78, 71])], `Beleg-${index}.png`, {
          type: "image/png",
        }),
      );
    }

    const response = await POST(multipartRequest(formData));

    expect(response.status).toBe(200);
    expect(extractPdfContext).toHaveBeenCalledTimes(1);
    expect(extractImageContext).toHaveBeenCalledTimes(5);
    const agentOptions = vi.mocked(runAgent).mock.calls[0]?.[0] as {
      attachmentContexts?: Array<{ type: string; filename: string; content: string }>;
    };
    expect(agentOptions.attachmentContexts).toEqual([
      { type: "pdf", filename: "Bescheid.pdf", content: "PDF-Kontext Bescheid.pdf" },
      { type: "image", filename: "Beleg-1.png", content: "Bild-Kontext Beleg-1.png" },
      { type: "image", filename: "Beleg-2.png", content: "Bild-Kontext Beleg-2.png" },
      { type: "image", filename: "Beleg-3.png", content: "Bild-Kontext Beleg-3.png" },
      { type: "image", filename: "Beleg-4.png", content: "Bild-Kontext Beleg-4.png" },
      { type: "image", filename: "Beleg-5.png", content: "Bild-Kontext Beleg-5.png" },
    ]);
  });

  it("accepts exactly five PDFs and five images with deterministic PDF-then-image context order", async () => {
    const formData = new FormData();
    formData.append("payload", JSON.stringify(chatPayload()));
    for (let index = 1; index <= 5; index += 1) {
      formData.append(
        "pdf",
        new File([new Uint8Array([37, 80, 68, 70])], `Dokument-${index}.pdf`, {
          type: "application/pdf",
        }),
      );
      formData.append(
        "image",
        new File([new Uint8Array([137, 80, 78, 71])], `Bild-${index}.png`, {
          type: "image/png",
        }),
      );
    }

    const response = await POST(multipartRequest(formData));

    expect(response.status).toBe(200);
    expect(extractPdfContext).toHaveBeenCalledTimes(5);
    expect(extractImageContext).toHaveBeenCalledTimes(5);
    const agentOptions = vi.mocked(runAgent).mock.calls[0]?.[0] as {
      attachmentContexts?: Array<{ type: string; filename: string; content: string }>;
    };
    expect(agentOptions.attachmentContexts).toEqual([
      ...Array.from({ length: 5 }, (_, index) => ({
        type: "pdf",
        filename: `Dokument-${index + 1}.pdf`,
        content: `PDF-Kontext Dokument-${index + 1}.pdf`,
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        type: "image",
        filename: `Bild-${index + 1}.png`,
        content: `Bild-Kontext Bild-${index + 1}.png`,
      })),
    ]);
  });

  it("rejects a sixth PDF before attachment extraction or the agent runs", async () => {
    const formData = new FormData();
    formData.append("payload", JSON.stringify(chatPayload()));
    for (let index = 1; index <= 6; index += 1) {
      formData.append(
        "pdf",
        new File([new Uint8Array([37, 80, 68, 70])], `Dokument-${index}.pdf`, {
          type: "application/pdf",
        }),
      );
    }

    const response = await POST(multipartRequest(formData));

    expect(response.status).toBe(400);
    expect(extractPdfContext).not.toHaveBeenCalled();
    expect(extractImageContext).not.toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("rejects a sixth image before attachment extraction or the agent runs", async () => {
    const formData = new FormData();
    formData.append("payload", JSON.stringify(chatPayload()));
    for (let index = 1; index <= 6; index += 1) {
      formData.append(
        "image",
        new File([new Uint8Array([137, 80, 78, 71])], `Bild-${index}.png`, {
          type: "image/png",
        }),
      );
    }

    const response = await POST(multipartRequest(formData));

    expect(response.status).toBe(400);
    expect(extractPdfContext).not.toHaveBeenCalled();
    expect(extractImageContext).not.toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("rejects images above the per-image upload limit", async () => {
    const oversizedImage = new File([new ArrayBuffer(MAX_IMAGE_UPLOAD_BYTES + 1)], "huge.png", {
      type: "image/png",
    });

    const formData = new FormData();
    formData.append("payload", JSON.stringify(chatPayload()));
    formData.append("image", oversizedImage);

    const response = await POST(multipartRequest(formData));

    expect(response.status).toBe(413);
    expect(extractImageContext).not.toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("caps sanitized attachment filenames before sending them to extraction", async () => {
    const longFilename = `${"steuerbescheid".repeat(30)}.pdf`;
    const formData = new FormData();
    formData.append("payload", JSON.stringify(chatPayload()));
    formData.append(
      "pdf",
      new File([new Uint8Array([37, 80, 68, 70])], longFilename, { type: "application/pdf" }),
    );

    const response = await POST(multipartRequest(formData));

    expect(response.status).toBe(200);
    const pdfOptions = vi.mocked(extractPdfContext).mock.calls[0]?.[0] as { filename: string };
    expect(pdfOptions.filename.length).toBeLessThanOrEqual(255);
  });
});
