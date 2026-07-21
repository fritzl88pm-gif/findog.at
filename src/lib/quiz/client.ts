import type { Quiz, QuizCategory, QuizQuestion } from "./generate";

const QUESTION_KEYS = new Set(["question", "options", "correctIndex", "explanation"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCategory(value: unknown): value is QuizCategory {
  return value === "Arbeitnehmerveranlagung" || value === "Verfahrensrecht";
}

function normalizeQuestion(value: unknown): QuizQuestion | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== QUESTION_KEYS.size || keys.some((key) => !QUESTION_KEYS.has(key))) return null;
  if (typeof value.question !== "string" || !value.question.trim()) return null;
  if (typeof value.explanation !== "string" || !value.explanation.trim()) return null;
  if (!Array.isArray(value.options) || value.options.length !== 4) return null;
  if (!value.options.every((option) => typeof option === "string" && option.trim())) return null;
  if (!Number.isInteger(value.correctIndex) || (value.correctIndex as number) < 0 || (value.correctIndex as number) > 3) return null;

  return {
    question: value.question.trim(),
    options: value.options.map((option) => (option as string).trim()) as [string, string, string, string],
    correctIndex: value.correctIndex as number,
    explanation: value.explanation.trim(),
  };
}

export function normalizeQuizResponse(value: unknown, expectedCategory: QuizCategory): Quiz | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || !value.id.trim()) return null;
  if (!isCategory(value.category) || value.category !== expectedCategory) return null;
  if (!Array.isArray(value.questions) || value.questions.length !== 10) return null;

  const questions = value.questions.map(normalizeQuestion);
  if (questions.some((question) => question === null)) return null;

  return {
    id: value.id.trim(),
    category: value.category,
    questions: questions as QuizQuestion[],
  };
}
