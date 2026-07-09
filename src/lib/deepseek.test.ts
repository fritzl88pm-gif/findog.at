import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDeadline } from "./deadline";
import { chatCompletion } from "./deepseek";

describe("chatCompletion", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes a bounded abort signal to DeepSeek fetches", async () => {
    const deadline = createDeadline(240_000);
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "Antwort",
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    await expect(
      chatCompletion({
        apiKey: "deepseek-key",
        model: "deepseek-v4-pro",
        messages: [{ role: "user", content: "Frage" }],
        deadline,
      }),
    ).resolves.toMatchObject({ content: "Antwort", toolCalls: [] });

    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    deadline.dispose();
  });
});
