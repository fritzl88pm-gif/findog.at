import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateSupabaseRequest } from "@/lib/auth/server";
import { UserVisibleError } from "@/lib/errors";
import { MAX_FORM_MULTIPART_BYTES } from "@/lib/forms/config";
import { renderVerf5Document } from "@/lib/forms/docx";
import { extractVerf5ImageFields } from "@/lib/forms/extraction";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { POST } from "./route";

vi.mock("@/lib/auth/server", () => ({
  authenticateSupabaseRequest: vi.fn(),
}));

vi.mock("@/lib/forms/docx", () => ({
  renderVerf5Document: vi.fn(),
}));

vi.mock("@/lib/forms/extraction", () => ({
  extractVerf5ImageFields: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: vi.fn(),
}));

function generateRequest(options?: {
  image?: File;
  images?: File[];
  saldo?: string;
  formId?: string;
  authorization?: boolean;
  contentLength?: string | null;
}): Promise<Request> {
  const formData = new FormData();
  formData.append("formId", options?.formId ?? "verf5");
  formData.append("saldo", options?.saldo ?? "1234.56");
  for (const image of options?.images ?? [options?.image ?? new File([new Uint8Array([1, 2, 3])], "beleg.png", { type: "image/png" })]) {
    formData.append("image", image, image.name);
  }

  const request = new Request("http://localhost/api/forms/generate", {
    method: "POST",
    headers: options?.authorization === false ? undefined : { Authorization: "Bearer access-token" },
    body: formData,
  });

  return request.clone().arrayBuffer().then((body) => {
    if (options?.contentLength !== null) {
      request.headers.set("Content-Length", options?.contentLength ?? String(body.byteLength));
    }
    return request;
  });
}

describe("POST /api/forms/generate", () => {
  const download = vi.fn();
  const storageFrom = vi.fn(() => ({ download }));

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
    vi.mocked(authenticateSupabaseRequest).mockResolvedValue({ id: "user-1" });
    vi.mocked(getSupabaseServerClient).mockReturnValue({
      storage: { from: storageFrom },
    } as never);
    download.mockResolvedValue({
      data: new Blob([new Uint8Array([80, 75, 3, 4])]),
      error: null,
    });
    vi.mocked(extractVerf5ImageFields).mockResolvedValue({
      steuernummer: "12 345/6789",
      vorname: "Anna",
      nachname: "Muster",
      letzteadresse: "Hauptstraße 1, 1010 Wien",
      sterbedatum: "03.04.2026",
    });
    vi.mocked(renderVerf5Document).mockReturnValue(new Uint8Array([80, 75, 3, 4, 5]));
  });

  it("rejects unauthenticated requests", async () => {
    vi.mocked(authenticateSupabaseRequest).mockRejectedValueOnce(
      new UserVisibleError("Bitte zuerst anmelden.", 401),
    );

    const response = await POST(await generateRequest({ authorization: false }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Bitte zuerst anmelden." });
    expect(extractVerf5ImageFields).not.toHaveBeenCalled();
  });

  it.each([
    { label: "malformed", contentLength: "1.5", status: 400, error: "Die Formularanfrage ist ungültig." },
    { label: "zero", contentLength: "0", status: 400, error: "Die Formularanfrage ist ungültig." },
    {
      label: "over-limit",
      contentLength: String(MAX_FORM_MULTIPART_BYTES + 1),
      status: 413,
      error: "Die Formularanfrage ist zu groß.",
    },
  ])("rejects $label Content-Length before external services", async ({ contentLength, status, error }) => {
    const response = await POST(await generateRequest({ contentLength }));

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error });
    expect(getSupabaseServerClient).not.toHaveBeenCalled();
    expect(authenticateSupabaseRequest).not.toHaveBeenCalled();
    expect(extractVerf5ImageFields).not.toHaveBeenCalled();
    expect(storageFrom).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it("accepts a valid multipart request without Content-Length", async () => {
    const request = await generateRequest({ contentLength: null });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(authenticateSupabaseRequest).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ storage: expect.anything() }),
    );
    expect(renderVerf5Document).toHaveBeenCalledOnce();
  });

  it("rejects an oversized multipart body without Content-Length before storage or Gemini", async () => {
    const response = await POST(await generateRequest({
      contentLength: null,
      image: new File(
        [new Uint8Array(MAX_FORM_MULTIPART_BYTES)],
        "beleg.png",
        { type: "image/png" },
      ),
    }));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "Die Formularanfrage ist zu groß." });
    expect(storageFrom).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    expect(extractVerf5ImageFields).not.toHaveBeenCalled();
  });

  it("rejects an oversized multipart body with an under-reported Content-Length", async () => {
    const response = await POST(await generateRequest({
      contentLength: "1",
      image: new File(
        [new Uint8Array([1])],
        `${"x".repeat(MAX_FORM_MULTIPART_BYTES)}.png`,
        { type: "image/png" },
      ),
    }));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "Die Formularanfrage ist zu groß." });
    expect(storageFrom).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    expect(extractVerf5ImageFields).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "wrong MIME",
      request: () => generateRequest({ image: new File(["text"], "beleg.txt", { type: "text/plain" }) }),
      status: 400,
    },
    {
      label: "oversized image",
      request: () => generateRequest({
        image: new File([new Uint8Array(5_000_001)], "beleg.png", { type: "image/png" }),
      }),
      status: 413,
    },
    {
      label: "multiple images",
      request: () => generateRequest({
        images: [
          new File([new Uint8Array([1])], "eins.png", { type: "image/png" }),
          new File([new Uint8Array([2])], "zwei.webp", { type: "image/webp" }),
        ],
      }),
      status: 400,
    },
    {
      label: "invalid saldo",
      request: () => generateRequest({ saldo: "123,456" }),
      status: 400,
    },
  ])("rejects $label before Gemini", async ({ request, status }) => {
    const response = await POST(await request());

    expect(response.status).toBe(status);
    expect(extractVerf5ImageFields).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it("logs bounded storage error details and returns the generic template error", async () => {
    const storageError = new Error("x".repeat(600));
    storageError.name = "S".repeat(200);
    download.mockResolvedValueOnce({ data: null, error: storageError });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(await generateRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Die Formularvorlage ist derzeit nicht verfügbar. Bitte Administrator kontaktieren.",
    });
    expect(consoleError).toHaveBeenCalledWith("Form template download failed", {
      name: "S".repeat(100),
      message: "x".repeat(500),
    });
    consoleError.mockRestore();
  });

  it("downloads the private template and returns a rendered dated DOCX", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T23:30:00.000Z"));
    const request = await generateRequest({ saldo: "1234.56" });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(authenticateSupabaseRequest).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ storage: expect.anything() }),
    );
    expect(storageFrom).toHaveBeenCalledWith("findog-form-templates");
    expect(download).toHaveBeenCalledWith("verf5/Verf5_Test.docx");
    expect(extractVerf5ImageFields).toHaveBeenCalledWith({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/png",
    });
    expect(renderVerf5Document).toHaveBeenCalledWith(
      new Uint8Array([80, 75, 3, 4]),
      {
        datum: "02.01.2026",
        saldo: "1.234,56 ",
        steuernummer: "12 345/6789",
        vorname: "Anna",
        nachname: "Muster",
        letzteadresse: "Hauptstraße 1, 1010 Wien",
        sterbedatum: "03.04.2026",
      },
    );
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="Verf5_02.01.2026.docx"',
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([80, 75, 3, 4, 5]));
  });
});
