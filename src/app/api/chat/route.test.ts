import { beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_IMAGE_UPLOAD_BYTES } from "@/lib/config";
import { runAgent } from "@/lib/agent";
import { extractImageContext, extractPdfContext } from "@/lib/pdf-context";
import { POST } from "./route";

vi.mock("@/lib/auth/server", () => ({
  authenticateSupabaseRequest: vi.fn().mockResolvedValue({ id: "user-1" }),
}));

vi.mock("@/lib/deepseek-key", () => ({
  resolveDeepSeekApiKey: vi.fn().mockReturnValue("deepseek-key"),
}));

vi.mock("@/lib/persistence", () => ({
  persistConversationTurn: vi.fn().mockResolvedValue(undefined),
  resolveConversationIdForClient: vi.fn().mockResolvedValue("conversation-1"),
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
    model: "deepseek-v4-flash",
    systemPrompt: "System",
    messages: [{ role: "user", content: "Bitte auswerten." }],
  };
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
