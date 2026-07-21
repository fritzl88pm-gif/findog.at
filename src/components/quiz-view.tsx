"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { QuizCategory, QuizQuestion } from "@/lib/quiz/generate";
import { normalizeQuizResponse } from "@/lib/quiz/client";

type QuizState =
  | { phase: "choose" }
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "playing"; quizId: string; category: QuizCategory; questions: QuizQuestion[]; currentIndex: number; answers: Array<{ selected: number | null; showingResult: boolean }>; score: number }
  | { phase: "done"; quizId: string; category: QuizCategory; questions: QuizQuestion[]; score: number; total: number };

const CATEGORIES: Array<{ id: QuizCategory; label: string; description: string }> = [
  {
    id: "Arbeitnehmerveranlagung",
    label: "Arbeitnehmerveranlagung",
    description: "Werbungskosten, außergewöhnliche Belastungen, Absetzbeträge",
  },
  {
    id: "Verfahrensrecht",
    label: "Verfahrensrecht",
    description: "BAO, Fristen und Zustellung, Beschwerden und Vorlageanträge, Wiederaufnahme, Rechtsmittel und Bescheidänderungen, Beweislast und Nachweise, Zurückweisung oder Abweisung",
  },
];

type QuizViewProps = {
  accessToken: string;
};

export default function QuizView({ accessToken }: QuizViewProps) {
  const [state, setState] = useState<QuizState>({ phase: "choose" });
  const feedbackRef = useRef<HTMLDivElement>(null);

  const startQuiz = useCallback(async (category: QuizCategory) => {
    setState({ phase: "loading" });

    try {
      const response = await fetch("/api/quiz/generate", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ category }),
      });

      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        setState({
          phase: "error",
          message: typeof payload.error === "string"
            ? payload.error
            : "Das Quiz konnte nicht geladen werden.",
        });
        return;
      }

      const quiz = normalizeQuizResponse(payload, category);
      if (!quiz) {
        setState({ phase: "error", message: "Das Quiz enthält ungültige Daten." });
        return;
      }

      setState({
        phase: "playing",
        quizId: quiz.id,
        category: quiz.category,
        questions: quiz.questions,
        currentIndex: 0,
        answers: quiz.questions.map(() => ({ selected: null, showingResult: false })),
        score: 0,
      });
    } catch {
      setState({ phase: "error", message: "Das Quiz konnte nicht geladen werden. Bitte später erneut versuchen." });
    }
  }, [accessToken]);

  const answerQuestion = useCallback((questionIndex: number, optionIndex: number) => {
    setState((prev) => {
      if (prev.phase !== "playing") return prev;
      const currentQuestion = prev.questions[prev.currentIndex];
      if (prev.currentIndex !== questionIndex) return prev;
      if (prev.answers[questionIndex]?.showingResult) return prev;

      const isCorrect = optionIndex === currentQuestion.correctIndex;
      const newAnswers = [...prev.answers];
      newAnswers[questionIndex] = { selected: optionIndex, showingResult: true };
      const newScore = isCorrect ? prev.score + 1 : prev.score;

      return {
        ...prev,
        answers: newAnswers,
        score: newScore,
      };
    });
  }, []);

  const nextQuestion = useCallback(() => {
    setState((prev) => {
      if (prev.phase !== "playing") return prev;

      const nextIndex = prev.currentIndex + 1;
      if (nextIndex >= prev.questions.length) {
        return {
          phase: "done" as const,
          quizId: prev.quizId,
          category: prev.category,
          questions: prev.questions,
          score: prev.score,
          total: prev.questions.length,
        };
      }

      return { ...prev, currentIndex: nextIndex };
    });
  }, []);

  useEffect(() => {
    if (state.phase === "playing" && state.answers[state.currentIndex]?.showingResult) {
      feedbackRef.current?.focus();
    }
  }, [state]);

  if (state.phase === "choose") {
    return (
      <section className="forms-panel" aria-labelledby="quiz-view-title">
        <div className="forms-view quiz-view">
          <header className="forms-view-header">
            <p className="eyebrow">Wissenstest</p>
            <h1 id="quiz-view-title">Quiz</h1>
            <p>Wähle eine Kategorie und starte ein zufälliges Quiz mit 10 Fragen.</p>
          </header>
          <div className="quiz-category-grid">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                className="form-choice-card quiz-category-card"
                type="button"
                onClick={() => void startQuiz(cat.id)}
              >
                <span className="form-choice-icon" aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <path d="M9 9a3 3 0 0 1 6 0c0 2-3 3-3 5"></path>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                  </svg>
                </span>
                <span>
                  <strong>{cat.label}</strong>
                  <small>{cat.description}</small>
                </span>
                <span aria-hidden="true">›</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (state.phase === "loading") {
    return (
      <section className="forms-panel" aria-labelledby="quiz-view-title">
        <div className="forms-view quiz-view">
          <header className="forms-view-header">
            <p className="eyebrow">Wissenstest</p>
            <h1 id="quiz-view-title">Quiz wird erstellt…</h1>
          </header>
          <div className="quiz-loading" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true"></span>
            <p>Fragen werden generiert…</p>
          </div>
        </div>
      </section>
    );
  }

  if (state.phase === "error") {
    return (
      <section className="forms-panel" aria-labelledby="quiz-view-title">
        <div className="forms-view quiz-view">
          <header className="forms-view-header">
            <p className="eyebrow">Wissenstest</p>
            <h1 id="quiz-view-title">Quiz</h1>
          </header>
          <div className="error-box" role="alert" aria-live="polite">
            {state.message}
          </div>
          <div className="quiz-actions">
            <button className="primary-button" type="button" onClick={() => setState({ phase: "choose" })}>
              Kategorie wählen
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (state.phase === "done") {
    const percentage = Math.round((state.score / state.total) * 100);
    let grade = "";
    if (percentage >= 90) grade = "Hervorragend!";
    else if (percentage >= 70) grade = "Gut gemacht!";
    else if (percentage >= 50) grade = "Nicht schlecht!";
    else grade = "Weiter üben!";

    return (
      <section className="forms-panel" aria-labelledby="quiz-view-title">
        <div className="forms-view quiz-view">
          <header className="forms-view-header">
            <p className="eyebrow">Wissenstest</p>
            <h1 id="quiz-view-title">Quiz abgeschlossen</h1>
          </header>
          <div className="quiz-score-card" role="status" aria-live="polite">
            <div className="quiz-score-grade">{grade}</div>
            <div className="quiz-score-value">
              <span className="quiz-score-fraction">{state.score}/{state.total}</span>
              <span className="quiz-score-percentage">{percentage}%</span>
            </div>
            <p className="quiz-score-category">{state.category}</p>
          </div>
          <div className="quiz-actions">
            <button
              className="primary-button"
              type="button"
              onClick={() => void startQuiz(state.category)}
            >
              Gleiche Kategorie wiederholen
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setState({ phase: "choose" })}
            >
              Andere Kategorie wählen
            </button>
          </div>
        </div>
      </section>
    );
  }

  // Playing phase
  const currentQuestion = state.questions[state.currentIndex];
  const currentAnswer = state.answers[state.currentIndex];
  const isAnswered = currentAnswer.showingResult;
  const isCorrect = isAnswered && currentAnswer.selected === currentQuestion.correctIndex;

  return (
    <section className="forms-panel" aria-labelledby="quiz-view-title">
      <div className="forms-view quiz-view">
        <header className="forms-view-header">
          <p className="eyebrow">Wissenstest · {state.category}</p>
          <h1 id="quiz-view-title">Quiz</h1>
        </header>
        <div className="quiz-progress" role="progressbar" aria-valuenow={state.currentIndex + 1} aria-valuemin={1} aria-valuemax={state.questions.length}>
          <span className="quiz-progress-text">Frage {state.currentIndex + 1} von {state.questions.length}</span>
          <span className="quiz-progress-bar">
            <span className="quiz-progress-fill" style={{ width: `${((state.currentIndex + 1) / state.questions.length) * 100}%` }}></span>
          </span>
        </div>
        <div className="quiz-question-card">
          <p className="quiz-question-text">{currentQuestion.question}</p>
          <div className="quiz-options" aria-label="Antwortmöglichkeiten">
            {currentQuestion.options.map((option, idx) => {
              let className = "quiz-option-button";
              if (isAnswered) {
                if (idx === currentQuestion.correctIndex) {
                  className += " quiz-option-correct";
                } else if (idx === currentAnswer.selected && !isCorrect) {
                  className += " quiz-option-incorrect";
                } else {
                  className += " quiz-option-disabled";
                }
              }
              return (
                <button
                  key={idx}
                  className={className}
                  type="button"
                  onClick={() => { if (!isAnswered) answerQuestion(state.currentIndex, idx); }}
                  disabled={isAnswered}
                >
                  <span className="quiz-option-letter">{String.fromCharCode(65 + idx)}</span>
                  <span className="quiz-option-text">{option}</span>
                  {isAnswered && idx === currentQuestion.correctIndex ? (
                    <span className="quiz-option-icon" aria-label="Richtig">✓</span>
                  ) : null}
                  {isAnswered && idx === currentAnswer.selected && !isCorrect ? (
                    <span className="quiz-option-icon quiz-option-icon-wrong" aria-label="Falsch">✗</span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {isAnswered ? (
            <div
              ref={feedbackRef}
              className={`quiz-feedback ${isCorrect ? "quiz-feedback-correct" : "quiz-feedback-incorrect"}`}
              tabIndex={-1}
              role="alert"
              aria-live="assertive"
            >
              <p className="quiz-feedback-status">
                {isCorrect ? "✓ Richtig!" : "✗ Leider falsch."}
              </p>
              <p className="quiz-feedback-explanation">{currentQuestion.explanation}</p>
              <button
                className="primary-button quiz-continue-button"
                type="button"
                onClick={nextQuestion}
              >
                {state.currentIndex < state.questions.length - 1 ? "Weiter" : "Ergebnis anzeigen"}
              </button>
            </div>
          ) : null}
        </div>
        <div className="quiz-score-mini" aria-live="polite">
          Punkte: {state.score} / {state.answers.filter((a) => a.showingResult).length}
        </div>
      </div>
    </section>
  );
}
