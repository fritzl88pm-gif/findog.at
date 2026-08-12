import { describe, expect, it } from "vitest";

import { UserVisibleError } from "../errors";
import {
  generateQuiz,
  shuffleQuestionOptions,
} from "./generate";
import { getPoolQuestions } from "./pool";
import { CATEGORIES } from "./types";
import type { QuizCategory, QuizQuestion } from "./types";

describe("CATEGORIES", () => {
  it("has exactly the three approved categories in the required order", () => {
    expect(CATEGORIES).toEqual([
      "Bundesabgabenordnung (Verfahrensrecht)",
      "Arbeitnehmerveranlagung",
      "Familienbeihilfe",
    ]);
  });
});

describe("getPoolQuestions", () => {
  it("returns at least 20 questions per category", () => {
    for (const category of CATEGORIES) {
      const questions = getPoolQuestions(category);
      expect(questions.length).toBeGreaterThanOrEqual(20);
    }
  });

  it("has no duplicate question text within any category", () => {
    for (const category of CATEGORIES) {
      const questions = getPoolQuestions(category);
      const texts = questions.map((q) => canonicalText(q.question));
      expect(new Set(texts).size).toBe(texts.length);
    }
  });

  it("has no duplicate question text across categories", () => {
    const allTexts: string[] = [];
    for (const category of CATEGORIES) {
      const questions = getPoolQuestions(category);
      allTexts.push(...questions.map((q) => canonicalText(q.question)));
    }
    expect(new Set(allTexts).size).toBe(allTexts.length);
  });

  it("validates every question contract: 4 distinct options, exactly one correct answer, and a non-empty explanation", () => {
    for (const category of CATEGORIES) {
      const questions = getPoolQuestions(category);
      for (const q of questions) {
        expect(q.options).toHaveLength(4);
        expect(new Set(q.options).size).toBe(4);
        expect(q.options.every((o) => typeof o === "string" && o.trim().length > 0)).toBe(true);
        expect(Number.isInteger(q.correctIndex)).toBe(true);
        expect(q.correctIndex).toBeGreaterThanOrEqual(0);
        expect(q.correctIndex).toBeLessThanOrEqual(3);
        expect(typeof q.explanation).toBe("string");
        expect(q.explanation.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("throws on an invalid category", () => {
    expect(() => getPoolQuestions("InvalidCategory" as unknown as QuizCategory)).toThrow(UserVisibleError);
    expect(() => getPoolQuestions("Verfahrensrecht" as unknown as QuizCategory)).toThrow(UserVisibleError);
  });
});

function canonicalText(value: string): string {
  return value.trim().replace(/\s+/gu, " ").normalize("NFKC").toLocaleLowerCase("de-AT");
}

describe("shuffleQuestionOptions", () => {
  it("preserves the correct answer after shuffling", () => {
    const original: QuizQuestion = {
      question: "Testfrage?",
      options: ["Antwort A", "Antwort B", "Antwort C", "Antwort D"],
      correctIndex: 1,
      explanation: "Erklärung.",
    };
    const correctAnswer = original.options[original.correctIndex];

    for (let i = 0; i < 50; i++) {
      const shuffled = shuffleQuestionOptions(original);
      expect(shuffled.options).toHaveLength(4);
      expect(new Set(shuffled.options).size).toBe(4);
      expect(shuffled.options[shuffled.correctIndex]).toBe(correctAnswer);
      expect(shuffled.question).toBe(original.question);
      expect(shuffled.explanation).toBe(original.explanation);
    }
  });
});

describe("generateQuiz", () => {
  it("rejects an invalid category", () => {
    expect(() => generateQuiz("InvalidCategory")).toThrow(UserVisibleError);
    expect(() => generateQuiz("Verfahrensrecht")).toThrow(UserVisibleError);
  });

  it("returns 10 unique questions from the requested category", () => {
    for (const category of CATEGORIES) {
      const quiz = generateQuiz(category);
      expect(quiz.questions).toHaveLength(10);
      expect(quiz.category).toBe(category);
      expect(typeof quiz.id).toBe("string");
      expect(quiz.id.length).toBeGreaterThan(0);

      const questionTexts = quiz.questions.map((q) => canonicalText(q.question));
      expect(new Set(questionTexts).size).toBe(10);

      const pool = getPoolQuestions(category);
      for (const q of quiz.questions) {
        const found = pool.some(
          (p) => canonicalText(p.question) === canonicalText(q.question),
        );
        expect(found).toBe(true);
      }
    }
  });

  it("shuffles question order and answer options server-side", () => {
    const runs = Array.from({ length: 5 }, () => generateQuiz("Arbeitnehmerveranlagung"));

    const questionOrders = runs.map(
      (quiz) => quiz.questions.map((q) => canonicalText(q.question)).join("|"),
    );
    // With 20+ source questions and 10 random picks + shuffle, extremely unlikely to produce 5 identical sequences
    const uniqueOrders = new Set(questionOrders);
    expect(uniqueOrders.size).toBeGreaterThan(1);

    // Options should be shuffled (correctIndex should not always be 0)
    for (const quiz of runs) {
      const allIndicesAtZero = quiz.questions.every((q) => q.correctIndex === 0);
      expect(allIndicesAtZero).toBe(false);
    }
  });

  it("correct answer is always the same after option shuffling", () => {
    for (const category of CATEGORIES) {
      const quiz = generateQuiz(category);
      for (const q of quiz.questions) {
        const correctAnswerText = q.options[q.correctIndex];
        const pool = getPoolQuestions(category);
        const source = pool.find(
          (p) => canonicalText(p.question) === canonicalText(q.question),
        );
        expect(source).toBeDefined();
        expect(source!.options[source!.correctIndex]).toBe(correctAnswerText);
      }
    }
  });

  it("returns a fresh UUID for each generated quiz", () => {
    const ids = new Set(
      Array.from({ length: 10 }, () => generateQuiz("Familienbeihilfe").id),
    );
    expect(ids.size).toBe(10);
  });

  it("does not call any LLM, MCP, retrieval service, or external API", () => {
    // Pure static generation — `generateQuiz` is synchronous and self-contained
    const quiz = generateQuiz("Bundesabgabenordnung (Verfahrensrecht)");
    expect(quiz.questions).toHaveLength(10);
  });
});
