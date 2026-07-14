import { beforeEach, describe, expect, it, vi } from "vitest";

import { chatCompletion } from "./deepseek";
import { generateConversationTitle } from "./conversation-title";
import type { LlmRuntime } from "./llm/runtime";

vi.mock("./deepseek", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./deepseek")>();
  return {
    ...actual,
    chatCompletion: vi.fn(),
  };
});

const mockedChatCompletion = vi.mocked(chatCompletion);
const TEST_RUNTIME = {
  model: "deepseek-v4-pro",
  provider: "deepseek",
  upstreamModel: "deepseek-v4-pro",
  baseUrl: "https://api.deepseek.com",
  apiKey: "server-key",
  reasoning: "max",
} satisfies LlmRuntime;

describe("generateConversationTitle", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("uses a compact German LLM title derived only from the latest user request", async () => {
    mockedChatCompletion.mockResolvedValueOnce({
      content: "Unterhaltsabsetzbetrag bei Drittstaatenkindern",
      toolCalls: [],
    });

    await expect(
      generateConversationTitle({
        runtime: TEST_RUNTIME,
        userRequest: "Unterhaltsabsetzbetrag für Kinder in Drittstaaten",
      }),
    ).resolves.toBe("Unterhaltsabsetzbetrag bei Drittstaatenkindern");

    const prompt = mockedChatCompletion.mock.calls[0]?.[0].messages;
    expect(prompt).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: "Unterhaltsabsetzbetrag für Kinder in Drittstaaten",
        }),
      ]),
    );
    expect(prompt?.map((message) => message.content).join("\n")).not.toContain("Antworttext");
    expect(mockedChatCompletion.mock.calls[0]?.[0].runtime.reasoning).toBe("disabled");
  });

  it("falls back deterministically and never exceeds 80 characters", async () => {
    mockedChatCompletion.mockRejectedValueOnce(new Error("provider timeout"));
    const request =
      "  Bitte   prüfe den Unterhaltsabsetzbetrag für Kinder in Drittstaaten anhand der aktuellen Rechtslage und Rechtsprechung.  ";

    const title = await generateConversationTitle({
      runtime: TEST_RUNTIME,
      userRequest: request,
    });

    expect(title).toBe("Bitte prüfe den Unterhaltsabsetzbetrag für Kinder in Drittstaaten anhand der…");
    expect(title.length).toBeLessThanOrEqual(80);
  });
});
