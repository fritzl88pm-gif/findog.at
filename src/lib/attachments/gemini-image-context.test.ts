
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeImage, GeminiImageError, GEMINI_CONTEXT_PROMPT } from "./gemini-image-context";

const originalKey = process.env.OPENROUTER_API_KEY;

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "google/gemini-3.5-flash";

function imageDataUri(): string {
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
}

describe("Gemini image context via OpenRouter", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-or-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  });

  it("sends prompt and image to OpenRouter and returns description text", async () => {
    const description = "This image contains a form with the text: Patient Name: John Doe, Date: 2024-01-15.";
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: description } }],
      }), { headers: { "Content-Type": "application/json" } }),
    );

    const result = await describeImage(imageDataUri(), { fetch });

    expect(result).toBe(description);

    // Verify the request
    const callUrl = vi.mocked(fetch).mock.calls[0]?.[0];
    expect(callUrl).toBe(ENDPOINT);
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body.model).toBe(MODEL);
    expect(body.max_tokens).toBe(15_000);
    const messages = body.messages as Array<Record<string, unknown>>;
    expect(messages[0].role).toBe("user");
    const userContent = messages[0].content as Array<Record<string, unknown>>;
    expect(userContent[0].type).toBe("text");
    expect(userContent[0].text).toBe(GEMINI_CONTEXT_PROMPT);
    expect(userContent[1].type).toBe("image_url");
    expect((userContent[1].image_url as Record<string, string>).url).toBe(imageDataUri());
    const headers = vi.mocked(fetch).mock.calls[0]?.[1]?.headers as Record<string, string>;
    const hObj = typeof headers === "object" ? Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])) : {};
    expect(hObj["authorization"]).toBe("Bearer test-or-key");
    expect(hObj["x-title"]).toBe("findog.at Attachments");
  });

  it("parses array text content parts", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: [
          { type: "text", text: "First part. " },
          { type: "text", text: "Second part." },
        ] } }],
      }), { headers: { "Content-Type": "application/json" } }),
    );

    const result = await describeImage(imageDataUri(), { fetch });
    expect(result).toBe("First part. Second part.");
  });

  it("throws when OPENROUTER_API_KEY is missing", async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(describeImage(imageDataUri()))
      .rejects.toThrow(GeminiImageError);
  });

  it("maps HTTP errors to GeminiImageError", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 }));
    await expect(describeImage(imageDataUri(), { fetch }))
      .rejects.toThrow(GeminiImageError);
  });

  it("maps non-JSON responses to GeminiImageError", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));
    await expect(describeImage(imageDataUri(), { fetch }))
      .rejects.toThrow(GeminiImageError);
  });

  it("caps description at a maximum character limit", async () => {
    const longText = "x".repeat(20000);
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: longText } }],
      }), { headers: { "Content-Type": "application/json" } }),
    );

    const result = await describeImage(imageDataUri(), { fetch });
    expect(result.length).toBeLessThanOrEqual(15000);
    expect(result).toContain("gekürzt");
  });

  it("rejects empty description content", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: "" } }],
      }), { headers: { "Content-Type": "application/json" } }),
    );
    await expect(describeImage(imageDataUri(), { fetch }))
      .rejects.toThrow(GeminiImageError);
  });

  it("supports abort signal", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(describeImage(imageDataUri(), { signal: ac.signal, fetch: vi.fn() }))
      .rejects.toThrow(GeminiImageError);
  });

  it("never exposes the provider key or response body in user errors", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("error details", { status: 500 }));
    const err = await describeImage(imageDataUri(), { fetch }).catch((e) => e);
    expect(err.message).not.toContain("test-or-key");
    expect(err.message).not.toContain("sk-");
  });

  it("caps the OpenRouter JSON body before parsing and never calls response.text", async () => {
    const response = new Response("x".repeat(33), { status: 200 });
    response.text = vi.fn(() => { throw new Error("unbounded text() must not run"); });
    const fetch = vi.fn().mockResolvedValue(response);

    await expect(describeImage(imageDataUri(), { fetch, maxResponseBytes: 32 }))
      .rejects.toThrow(GeminiImageError);
    expect(response.text).not.toHaveBeenCalled();
  });

  it("preserves an outer abort as an intentional abort error", async () => {
    const controller = new AbortController();
    const fetch = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      }));
    const pending = describeImage(imageDataUri(), { fetch, signal: controller.signal });
    controller.abort();

    const error = (await pending.catch((caught) => caught as Error)) as Error;
    expect(error).toBeInstanceOf(GeminiImageError);
    expect(error.message).toMatch(/abgebrochen/i);
    expect(error.message).not.toMatch(/nicht erreichbar/i);
  });

  it("allows an image analysis to run for 75 seconds before timing out", async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        }));
      let settled = false;
      const pending = describeImage(imageDataUri(), { fetch });
      const observed = pending.then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      );
      void observed.then(() => { settled = true; });

      await vi.advanceTimersByTimeAsync(30_000);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(44_999);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      const outcome = await observed;
      expect(outcome.status).toBe("rejected");
      if (outcome.status === "rejected") {
        expect(outcome.reason).toBeInstanceOf(GeminiImageError);
        expect((outcome.reason as Error).message).toBe("Die Bildanalyse hat nicht rechtzeitig geantwortet.");
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
