import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { normalizeQuizResponse } from "./client";
import type { QuizCategory } from "./types";

function validResponse(category?: string): Record<string, unknown> {
  return {
    id: " quiz-id ",
    category: category ?? "Arbeitnehmerveranlagung",
    questions: Array.from({ length: 10 }, (_, index) => ({
      question: ` Frage ${index + 1}? `,
      options: [" A ", " B ", " C ", " D "],
      correctIndex: index % 4,
      explanation: ` Erklärung ${index + 1}. `,
    })),
  };
}

describe("normalizeQuizResponse", () => {
  it("keeps client validation free of server generator and pool imports", () => {
    const source = readFileSync(new URL("./client.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from ["']\.\/generate["']/u);
    expect(source).not.toMatch(/from ["']\.\/pool["']/u);
  });

  it("accepts and trims a strict valid response for all three categories", () => {
    for (const category of [
      "Bundesabgabenordnung (Verfahrensrecht)",
      "Arbeitnehmerveranlagung",
      "Familienbeihilfe",
    ]) {
      const normalized = normalizeQuizResponse(validResponse(category), category as QuizCategory);
      expect(normalized?.id).toBe("quiz-id");
      expect(normalized?.category).toBe(category);
      expect(normalized?.questions).toHaveLength(10);
      expect(normalized?.questions[0]).toEqual({
        question: "Frage 1?",
        options: ["A", "B", "C", "D"],
        correctIndex: 0,
        explanation: "Erklärung 1.",
      });
    }
  });

  it("rejects the legacy Verfahrensrecht category", () => {
    expect(normalizeQuizResponse(validResponse("Verfahrensrecht"), "Verfahrensrecht" as unknown as QuizCategory)).toBeNull();
  });

  it("rejects empty IDs and mismatched or unknown categories", () => {
    const emptyId = validResponse();
    emptyId.id = "  ";
    expect(normalizeQuizResponse(emptyId, "Arbeitnehmerveranlagung" as QuizCategory)).toBeNull();

    const mismatched = validResponse("Familienbeihilfe");
    expect(normalizeQuizResponse(mismatched, "Arbeitnehmerveranlagung" as QuizCategory)).toBeNull();

    const unknownCategory = validResponse();
    unknownCategory.category = "Andere Kategorie";
    expect(normalizeQuizResponse(unknownCategory, "Arbeitnehmerveranlagung" as QuizCategory)).toBeNull();
  });

  it("rejects invalid correctIndex and non-string options", () => {
    for (const correctIndex of [-1, 1.5, 4]) {
      const response = validResponse();
      (response.questions as Array<Record<string, unknown>>)[0].correctIndex = correctIndex;
      expect(normalizeQuizResponse(response, "Arbeitnehmerveranlagung" as QuizCategory)).toBeNull();
    }

    const response = validResponse();
    (response.questions as Array<Record<string, unknown>>)[0].options = ["A", "B", 3, "D"];
    expect(normalizeQuizResponse(response, "Arbeitnehmerveranlagung" as QuizCategory)).toBeNull();
  });

  it("rejects missing, extra, or malformed question data", () => {
    const extraField = validResponse();
    (extraField.questions as Array<Record<string, unknown>>)[0].extra = true;
    expect(normalizeQuizResponse(extraField, "Arbeitnehmerveranlagung" as QuizCategory)).toBeNull();

    const emptyQuestion = validResponse();
    (emptyQuestion.questions as Array<Record<string, unknown>>)[0].question = " ";
    expect(normalizeQuizResponse(emptyQuestion, "Arbeitnehmerveranlagung" as QuizCategory)).toBeNull();

    const wrongCount = validResponse();
    (wrongCount.questions as unknown[]).pop();
    expect(normalizeQuizResponse(wrongCount, "Arbeitnehmerveranlagung" as QuizCategory)).toBeNull();
  });
});
