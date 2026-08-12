import { randomUUID } from "node:crypto";

import { UserVisibleError } from "../errors";
import { getPoolQuestions } from "./pool";
import { CATEGORIES } from "./types";
import type { Quiz, QuizCategory, QuizQuestion } from "./types";

function isValidCategory(value: string): value is QuizCategory {
  return CATEGORIES.includes(value as (typeof CATEGORIES)[number]);
}

function shuffleArray<T>(arr: readonly T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function shuffleQuestionOptions(
  question: QuizQuestion,
): QuizQuestion {
  const indices = [0, 1, 2, 3];
  const shuffledIndices = shuffleArray(indices);
  const newOptions = shuffledIndices.map((i) => question.options[i]) as [
    string,
    string,
    string,
    string,
  ];
  const newCorrectIndex = shuffledIndices.indexOf(question.correctIndex);
  return {
    question: question.question,
    options: newOptions,
    correctIndex: newCorrectIndex,
    explanation: question.explanation,
  };
}

/**
 * Generate a quiz of 10 randomly selected questions from the static pool
 * for the requested category. Question order and answer options are
 * shuffled server-side. No LLM, MCP, retrieval service, or external API
 * is called.
 */
export function generateQuiz(category: string): Quiz {
  if (!isValidCategory(category)) {
    throw new UserVisibleError(
      `Ungültige Kategorie. Erlaubt: ${CATEGORIES.join(", ")}.`,
      400,
    );
  }

  const pool = getPoolQuestions(category);
  if (pool.length < 10) {
    throw new UserVisibleError(
      "Für diese Kategorie sind nicht genügend Fragen vorhanden.",
      500,
    );
  }

  const seed = randomUUID();

  // Randomly select 10 unique questions
  const selected = shuffleArray(pool).slice(0, 10);

  // Shuffle answer options for each question
  const shuffledQuestions = selected.map(shuffleQuestionOptions);

  return {
    id: seed,
    category,
    questions: shuffledQuestions,
  };
}
