import { describe, expect, it } from "vitest";

import { normalizeQuizResponse } from "./client";

function validResponse(): Record<string, unknown> {
  return {
    id: " quiz-id ",
    category: "Arbeitnehmerveranlagung",
    questions: Array.from({ length: 10 }, (_, index) => ({
      question: ` Frage ${index + 1}? `,
      options: [" A ", " B ", " C ", " D "],
      correctIndex: index % 4,
      explanation: ` Erklärung ${index + 1}. `,
    })),
  };
}

describe("normalizeQuizResponse", () => {
  it("accepts and trims a strict valid response", () => {
    const normalized = normalizeQuizResponse(validResponse(), "Arbeitnehmerveranlagung");

    expect(normalized?.id).toBe("quiz-id");
    expect(normalized?.category).toBe("Arbeitnehmerveranlagung");
    expect(normalized?.questions[0]).toEqual({
      question: "Frage 1?",
      options: ["A", "B", "C", "D"],
      correctIndex: 0,
      explanation: "Erklärung 1.",
    });
  });

  it("rejects empty IDs and mismatched or unknown categories", () => {
    const emptyId = validResponse();
    emptyId.id = "  ";
    expect(normalizeQuizResponse(emptyId, "Arbeitnehmerveranlagung")).toBeNull();

    expect(normalizeQuizResponse(validResponse(), "Verfahrensrecht")).toBeNull();

    const unknownCategory = validResponse();
    unknownCategory.category = "Andere Kategorie";
    expect(normalizeQuizResponse(unknownCategory, "Arbeitnehmerveranlagung")).toBeNull();
  });

  it("rejects invalid correctIndex and non-string options", () => {
    for (const correctIndex of [-1, 1.5, 4]) {
      const response = validResponse();
      (response.questions as Array<Record<string, unknown>>)[0].correctIndex = correctIndex;
      expect(normalizeQuizResponse(response, "Arbeitnehmerveranlagung")).toBeNull();
    }

    const response = validResponse();
    (response.questions as Array<Record<string, unknown>>)[0].options = ["A", "B", 3, "D"];
    expect(normalizeQuizResponse(response, "Arbeitnehmerveranlagung")).toBeNull();
  });

  it("rejects missing, extra, or malformed question data", () => {
    const extraField = validResponse();
    (extraField.questions as Array<Record<string, unknown>>)[0].extra = true;
    expect(normalizeQuizResponse(extraField, "Arbeitnehmerveranlagung")).toBeNull();

    const emptyQuestion = validResponse();
    (emptyQuestion.questions as Array<Record<string, unknown>>)[0].question = " ";
    expect(normalizeQuizResponse(emptyQuestion, "Arbeitnehmerveranlagung")).toBeNull();

    const wrongCount = validResponse();
    (wrongCount.questions as unknown[]).pop();
    expect(normalizeQuizResponse(wrongCount, "Arbeitnehmerveranlagung")).toBeNull();
  });
});
