// Shared quiz types and category list — environment-neutral
// No Node.js, server, or external-service imports.

export const CATEGORIES = [
  "Bundesabgabenordnung (Verfahrensrecht)",
  "Arbeitnehmerveranlagung",
  "Familienbeihilfe",
] as const;

export type QuizCategory = (typeof CATEGORIES)[number];

export type QuizQuestion = {
  question: string;
  options: [string, string, string, string];
  correctIndex: number;
  explanation: string;
};

export type Quiz = {
  id: string;
  category: QuizCategory;
  questions: QuizQuestion[];
};
