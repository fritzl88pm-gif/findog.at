import { beforeEach, describe, expect, it, vi } from "vitest";

import { chatCompletion } from "./deepseek";
import { generateConversationTitle } from "./conversation-title";

vi.mock("./deepseek", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./deepseek")>();
  return {
    ...actual,
    chatCompletion: vi.fn(),
  };
});

const mockedChatCompletion = vi.mocked(chatCompletion);

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
        apiKey: "server-key",
        model: "deepseek-v4-pro",
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
  });

  it("falls back deterministically and never exceeds 80 characters", async () => {
    mockedChatCompletion.mockRejectedValueOnce(new Error("provider timeout"));
    const request =
      "  Bitte   prüfe den Unterhaltsabsetzbetrag für Kinder in Drittstaaten anhand der aktuellen Rechtslage und Rechtsprechung.  ";

    const title = await generateConversationTitle({
      apiKey: "server-key",
      model: "deepseek-v4-pro",
      userRequest: request,
    });

    expect(title).toBe("Bitte prüfe den Unterhaltsabsetzbetrag für Kinder in Drittstaaten anhand der…");
    expect(title.length).toBeLessThanOrEqual(80);
  });
});
